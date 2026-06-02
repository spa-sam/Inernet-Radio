// Local CORS audio proxy: resolves redirects/playlists, opens the upstream
// stream, strips ICY metadata blocks while forwarding clean audio to the
// <audio> element, and emits live track titles to the frontend.

use serde::Serialize;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use crate::metadata::{parse_stream_title, parse_url, LiveMetadata};

// Local proxy server state: the bound port and a per-launch access token.
// The token is required on every /stream request so that only this app's
// frontend (which fetched it via get_proxy_port) can drive the proxy — other
// local processes cannot use it as an open relay to internal hosts.
pub(crate) struct ProxyState {
    pub(crate) port: u16,
    pub(crate) token: String,
}

// Returned to the frontend so it can build authorized proxy URLs.
#[derive(Serialize, Clone)]
pub(crate) struct ProxyInfo {
    pub(crate) port: u16,
    pub(crate) token: String,
}

// Generate a random hex token without pulling in an RNG crate: each
// RandomState is seeded with OS entropy, and finishing a hasher over no input
// yields a value derived purely from that random seed. Two of them give a
// 128-bit token — ample for a localhost capability check.
fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut token = String::with_capacity(32);
    for _ in 0..2 {
        let h = std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish();
        token.push_str(&format!("{:016x}", h));
    }
    token
}

// A boxed async stream — either a plain TCP or a TLS connection.
pub(crate) trait AsyncStream:
    tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send
{
}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> AsyncStream for T {}

// Send the proxy response headers to the audio client (CORS-enabled)
async fn write_proxy_headers(client: &mut TcpStream, content_type: &str) -> std::io::Result<()> {
    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Headers: *\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Content-Type: {}\r\n\
         Cache-Control: no-cache\r\n\
         Connection: close\r\n\
         \r\n",
        content_type
    );
    client.write_all(headers.as_bytes()).await
}

// Whether an I/O error is just the client closing the connection
// (e.g. the user switched stations) rather than a real failure.
fn is_disconnect(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::UnexpectedEof
    )
}

// Parse the numeric status code from an HTTP/ICY status line
fn parse_status_code(status_line: &str) -> u16 {
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(200)
}

// Resolve a redirect Location (absolute or relative) against the base URL
fn resolve_location(base: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    if let Some((host, port, _, is_ssl)) = parse_url(base) {
        let scheme = if is_ssl { "https" } else { "http" };
        let default_port = if is_ssl { 443 } else { 80 };
        let port_part = if port == default_port {
            String::new()
        } else {
            format!(":{}", port)
        };
        if location.starts_with('/') {
            format!("{}://{}{}{}", scheme, host, port_part, location)
        } else {
            format!("{}://{}{}/{}", scheme, host, port_part, location)
        }
    } else {
        location.to_string()
    }
}

// Detect a .pls / .m3u playlist response (HLS .m3u8 is excluded — not playable)
fn is_playlist(content_type: &str, url: &str) -> bool {
    let ct = content_type.to_lowercase();
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    if path.ends_with(".m3u8") {
        return false;
    }
    path.ends_with(".pls")
        || path.ends_with(".m3u")
        || ct.contains("scpls")
        || ct.contains("pls+xml")
        || ct.contains("x-mpegurl")
        || ct.contains("audio/mpegurl")
}

// Extract the first real stream URL from a .pls / .m3u playlist body
fn first_stream_url(body: &str) -> Option<String> {
    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        // PLS entry: FileN=http://...
        if let Some(eq) = line.find('=') {
            let (key, value) = line.split_at(eq);
            if key.trim().to_lowercase().starts_with("file") {
                let value = value[1..].trim();
                if value.starts_with("http") && !value.to_lowercase().ends_with(".m3u8") {
                    return Some(value.to_string());
                }
            }
        }
        // M3U entry: a bare URL line
        if (line.starts_with("http://") || line.starts_with("https://"))
            && !line.to_lowercase().ends_with(".m3u8")
        {
            return Some(line.to_string());
        }
    }
    None
}

// Establish a TLS stream, validating the certificate first. Many radio servers
// have expired or hostname-mismatched certificates, so on a validation failure
// we retry once with validation disabled. The failed handshake consumes the
// socket, so a fresh TCP connection is opened for the fallback. The relaxation
// is logged, and strict validation is still enforced for well-behaved servers.
async fn connect_tls(
    addr: &str,
    host: &str,
) -> Result<Box<dyn AsyncStream>, Box<dyn std::error::Error + Send + Sync>> {
    let tcp = timeout(Duration::from_secs(8), TcpStream::connect(addr)).await??;
    let strict = tokio_native_tls::TlsConnector::from(native_tls::TlsConnector::new()?);
    match timeout(Duration::from_secs(8), strict.connect(host, tcp)).await? {
        Ok(tls) => Ok(Box::new(tls)),
        Err(e) => {
            eprintln!(
                "[tls] certificate validation failed for {} ({}); retrying without validation",
                host, e
            );
            let tcp = timeout(Duration::from_secs(8), TcpStream::connect(addr)).await??;
            let insecure = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .build()?;
            let insecure = tokio_native_tls::TlsConnector::from(insecure);
            let tls = timeout(Duration::from_secs(8), insecure.connect(host, tcp)).await??;
            Ok(Box::new(tls))
        }
    }
}

// Open an audio stream, following HTTP redirects and resolving playlists.
// Returns the reader positioned at the audio body, the resolved Content-Type,
// and the ICY metadata interval (bytes of audio between metadata blocks) when
// `want_meta` is set and the server supports it.
pub(crate) async fn open_audio_stream(
    url: &str,
    hops: u8,
    raw: bool,
    want_meta: bool,
) -> Result<
    (BufReader<Box<dyn AsyncStream>>, String, Option<usize>),
    Box<dyn std::error::Error + Send + Sync>,
> {
    if hops >= 5 {
        return Err("too many redirects".into());
    }

    let (host, port, path, is_ssl) = parse_url(url).ok_or("invalid url")?;
    let addr = format!("{}:{}", host, port);

    let mut stream: Box<dyn AsyncStream> = if is_ssl {
        connect_tls(&addr, &host).await?
    } else {
        let tcp = timeout(Duration::from_secs(8), TcpStream::connect(&addr)).await??;
        Box::new(tcp)
    };

    // Optionally ask for ICY metadata. When requested, the interleaved metadata
    // blocks are stripped back out by pipe_with_icy before the bytes reach the
    // <audio> element, so playback stays clean while we read the track title.
    let request = if want_meta {
        format!(
            "GET {} HTTP/1.0\r\n\
             Host: {}\r\n\
             User-Agent: Mozilla/5.0 TauriRadio/1.0\r\n\
             Icy-MetaData: 1\r\n\
             Connection: close\r\n\
             \r\n",
            path, host
        )
    } else {
        format!(
            "GET {} HTTP/1.0\r\n\
             Host: {}\r\n\
             User-Agent: Mozilla/5.0 TauriRadio/1.0\r\n\
             Connection: close\r\n\
             \r\n",
            path, host
        )
    };
    stream.write_all(request.as_bytes()).await?;

    let mut reader = BufReader::new(stream);

    // Read the status line and headers, bounded by a timeout
    let (status, content_type, location, metaint) = timeout(Duration::from_secs(8), async {
        let mut status_line = String::new();
        reader.read_line(&mut status_line).await?;
        let status = parse_status_code(&status_line);

        let mut content_type = String::new();
        let mut location = String::new();
        let mut metaint: Option<usize> = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await? == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if let Some(idx) = trimmed.find(':') {
                let name = trimmed[..idx].to_lowercase();
                let value = trimmed[idx + 1..].trim();
                match name.as_str() {
                    "content-type" => content_type = value.to_string(),
                    "location" => location = value.to_string(),
                    "icy-metaint" => metaint = value.parse().ok(),
                    _ => {}
                }
            }
        }
        Ok::<_, std::io::Error>((status, content_type, location, metaint))
    })
    .await
    .map_err(|_| "timeout reading response headers")??;

    // Follow HTTP redirects
    if (300..400).contains(&status) && !location.is_empty() {
        let next = resolve_location(url, &location);
        return Box::pin(open_audio_stream(&next, hops + 1, raw, want_meta)).await;
    }

    // Resolve .pls / .m3u playlists to the underlying stream URL.
    // Skipped in raw mode so HLS manifests reach hls.js untouched.
    if !raw && is_playlist(&content_type, url) {
        let body = timeout(Duration::from_secs(5), async {
            let mut buf = vec![0u8; 8192];
            let n = reader.read(&mut buf).await?;
            buf.truncate(n);
            Ok::<_, std::io::Error>(buf)
        })
        .await
        .map_err(|_| "timeout reading playlist")??;

        let body_text = String::from_utf8_lossy(&body);
        let stream_url = first_stream_url(&body_text).ok_or("playlist has no stream url")?;
        return Box::pin(open_audio_stream(&stream_url, hops + 1, raw, want_meta)).await;
    }

    let content_type = if content_type.is_empty() {
        String::from("audio/mpeg")
    } else {
        content_type
    };
    Ok((reader, content_type, metaint))
}

// Copy an ICY stream to the client while stripping the interleaved metadata
// blocks and emitting the parsed track title to the frontend. Audio bytes are
// forwarded verbatim; only the metadata segments (one length byte + payload
// every `metaint` bytes) are consumed here so the <audio> element sees clean
// audio. Returns when the stream ends or the client disconnects.
async fn pipe_with_icy<R, W>(
    mut reader: R,
    mut writer: W,
    metaint: usize,
    app: tauri::AppHandle,
    url: String,
) -> std::io::Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; 16384];
    let mut until_meta = metaint;
    let mut last_title = String::new();
    loop {
        if until_meta > 0 {
            // Forward audio up to the next metadata boundary.
            let to_read = buf.len().min(until_meta);
            let n = reader.read(&mut buf[..to_read]).await?;
            if n == 0 {
                break; // stream ended
            }
            writer.write_all(&buf[..n]).await?;
            until_meta -= n;
        } else {
            // Metadata block: one length byte (in 16-byte units) + payload.
            let mut len_byte = [0u8; 1];
            reader.read_exact(&mut len_byte).await?;
            let meta_len = (len_byte[0] as usize) * 16;
            if meta_len > 0 {
                let mut meta_buf = vec![0u8; meta_len];
                reader.read_exact(&mut meta_buf).await?;
                let meta_str = String::from_utf8_lossy(&meta_buf);
                if let Some(title) = parse_stream_title(&meta_str) {
                    if title != last_title {
                        last_title = title.clone();
                        let _ = app.emit(
                            "stream-metadata",
                            LiveMetadata {
                                url: url.clone(),
                                title,
                            },
                        );
                    }
                }
            }
            until_meta = metaint;
        }
    }
    Ok(())
}

// Local CORS audio-proxy handler
async fn handle_proxy_client(
    mut client_stream: TcpStream,
    app: tauri::AppHandle,
    token: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Read only the request line from the audio client
    let mut request_line = String::new();
    {
        let mut reader = BufReader::new(&mut client_stream);
        if let Err(e) = reader.read_line(&mut request_line).await {
            return if is_disconnect(&e) {
                Ok(())
            } else {
                Err(e.into())
            };
        }
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 || parts[0] != "GET" {
        return Ok(());
    }

    let uri = parts[1];
    if !uri.starts_with("/stream?url=") {
        client_stream
            .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }

    // Split "url=<encoded>" from any extra query params (e.g. token, raw).
    // The encoded URL never contains a literal '&', so the first '&'
    // marks the start of additional parameters.
    let query = &uri[12..];
    let (encoded_url, params) = query.split_once('&').unwrap_or((query, ""));
    let raw = params.contains("raw=1");

    // Require the per-launch access token so the proxy cannot be used as an
    // open relay by other local processes.
    if !params.contains(&format!("token={}", token)) {
        client_stream
            .write_all(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }

    let target_url = percent_encoding::percent_decode_str(encoded_url)
        .decode_utf8_lossy()
        .into_owned();

    // Request ICY metadata for normal playback (not raw HLS) so the track
    // title can be parsed out of the live stream and pushed to the frontend.
    match open_audio_stream(&target_url, 0, raw, !raw).await {
        Ok((mut remote_reader, content_type, metaint)) => {
            if let Err(e) = write_proxy_headers(&mut client_stream, &content_type).await {
                return if is_disconnect(&e) {
                    Ok(())
                } else {
                    Err(e.into())
                };
            }
            let (_, mut client_write_half) = tokio::io::split(client_stream);
            // A client disconnect (e.g. switching stations) aborts the copy —
            // that is normal stream termination, not an error worth reporting.
            let result = match metaint {
                // ICY-aware copy: strip metadata blocks and emit track titles.
                Some(mi) if mi > 0 => {
                    pipe_with_icy(
                        remote_reader,
                        client_write_half,
                        mi,
                        app,
                        target_url.clone(),
                    )
                    .await
                }
                // No metadata: forward the stream verbatim.
                _ => tokio::io::copy(&mut remote_reader, &mut client_write_half)
                    .await
                    .map(|_| ()),
            };
            if let Err(e) = result {
                if !is_disconnect(&e) {
                    return Err(e.into());
                }
            }
        }
        Err(e) => {
            eprintln!("Proxy resolve error for {}: {:?}", target_url, e);
            let _ = client_stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                .await;
        }
    }

    Ok(())
}

pub(crate) async fn start_proxy_server(app: tauri::AppHandle) -> Option<(u16, String)> {
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let port = listener.local_addr().ok()?.port();
    let token = random_token();

    let server_token = token.clone();
    tokio::spawn(async move {
        loop {
            if let Ok((client_stream, _)) = listener.accept().await {
                let app = app.clone();
                let token = server_token.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_proxy_client(client_stream, app, token).await {
                        eprintln!("Proxy client handle error: {:?}", e);
                    }
                });
            }
        }
    });

    Some((port, token))
}

#[tauri::command]
pub(crate) fn get_proxy_port(state: tauri::State<'_, ProxyState>) -> ProxyInfo {
    ProxyInfo {
        port: state.port,
        token: state.token.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_location_absolute_kept() {
        assert_eq!(
            resolve_location("http://a.com/x", "https://b.com/y"),
            "https://b.com/y"
        );
    }

    #[test]
    fn resolve_location_root_relative() {
        assert_eq!(
            resolve_location("http://a.com:8000/x", "/y/z"),
            "http://a.com:8000/y/z"
        );
    }

    #[test]
    fn resolve_location_relative_default_port_omitted() {
        assert_eq!(
            resolve_location("https://a.com/x", "y/z"),
            "https://a.com/y/z"
        );
    }

    #[test]
    fn is_playlist_detects_extensions_and_types() {
        assert!(is_playlist("", "http://a.com/list.pls"));
        assert!(is_playlist("", "http://a.com/list.m3u"));
        assert!(is_playlist("audio/x-scpls", "http://a.com/x"));
        assert!(is_playlist("application/x-mpegurl", "http://a.com/x?q=1"));
    }

    #[test]
    fn is_playlist_excludes_hls_manifest() {
        assert!(!is_playlist(
            "application/vnd.apple.mpegurl",
            "http://a.com/x.m3u8"
        ));
        assert!(!is_playlist("audio/mpeg", "http://a.com/stream"));
    }

    #[test]
    fn first_stream_url_from_pls() {
        let body = "[playlist]\nFile1=http://stream.fm/live\nTitle1=Radio\n";
        assert_eq!(
            first_stream_url(body),
            Some("http://stream.fm/live".to_string())
        );
    }

    #[test]
    fn first_stream_url_from_m3u_bare_line() {
        let body = "#EXTM3U\n#EXTINF:-1,Radio\nhttps://stream.fm/live\n";
        assert_eq!(
            first_stream_url(body),
            Some("https://stream.fm/live".to_string())
        );
    }

    #[test]
    fn first_stream_url_skips_hls() {
        let body = "File1=http://stream.fm/playlist.m3u8\n";
        assert_eq!(first_stream_url(body), None);
    }

    #[test]
    fn parse_status_code_variants() {
        assert_eq!(parse_status_code("HTTP/1.1 200 OK"), 200);
        assert_eq!(parse_status_code("ICY 200 OK"), 200);
        assert_eq!(parse_status_code("HTTP/1.0 302 Found"), 302);
        // Malformed lines fall back to 200
        assert_eq!(parse_status_code("garbage"), 200);
    }
}
