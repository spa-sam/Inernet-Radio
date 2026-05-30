// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

#[derive(Serialize, Default, Clone)]
struct StreamMetadata {
    title: Option<String>,
    genre: Option<String>,
    bitrate: Option<String>,
    name: Option<String>,
}

// Live track metadata pushed to the frontend as it is parsed out of the
// playback stream. `url` is the original (pre-redirect) stream URL so the
// frontend can ignore stale events from a connection it has switched away from.
#[derive(Serialize, Clone)]
struct LiveMetadata {
    url: String,
    title: String,
}

// Recording progress pushed to the frontend roughly once per second so the UI
// can show elapsed time and the growing file size.
#[derive(Serialize, Clone)]
struct RecordingProgress {
    seconds: u64,
    bytes: u64,
}

struct ProxyPort(u16);

// Tracks the currently active recording. The stop flag is shared with the
// recording task: setting it to true (via stop_recording or natural stream
// end) terminates the write loop. `is_recording` treats a set flag as "done".
#[derive(Default)]
struct RecordingState {
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

// Replace characters that are invalid in file names (Windows-safe) and clamp
// the length so a long track title cannot produce an unusable path.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

// Build the path for one recording segment, derived from the base path the user
// chose. The first (pre-metadata) segment has no title. Example:
//   base "C:\rec\Jazz.mp3", index 2, title "Artist - Song"
//   -> "C:\rec\Jazz - 02 - Artist - Song.mp3"
fn segment_path(base: &std::path::Path, index: usize, title: Option<&str>) -> std::path::PathBuf {
    let dir = base.parent().unwrap_or_else(|| std::path::Path::new("."));
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("rec");
    let ext = base.extension().and_then(|s| s.to_str()).unwrap_or("mp3");
    let name = match title {
        Some(t) => format!("{} - {:02} - {}.{}", stem, index, sanitize_filename(t), ext),
        None => format!("{} - {:02}.{}", stem, index, ext),
    };
    dir.join(name)
}

// Connect to a stream and write its raw audio bytes to `path` until the stop
// flag is set or the stream ends. Reuses the proxy's stream resolver so
// redirects and playlists are followed. When `split` is set and the server
// provides ICY metadata, the recording is cut into one file per track.
async fn record_stream(
    app: tauri::AppHandle,
    url: String,
    path: String,
    stop: Arc<AtomicBool>,
    split: bool,
) {
    match open_audio_stream(&url, 0, false, split).await {
        Ok((reader, _content_type, metaint)) => match (split, metaint) {
            (true, Some(mi)) if mi > 0 => record_split(&app, reader, mi, &path, &stop).await,
            // No ICY metadata available: fall back to a single continuous file.
            _ => record_single(&app, reader, &path, &stop).await,
        },
        Err(e) => eprintln!("[rec] open error for {}: {:?}", url, e),
    }
    // Mark the recording as finished so is_recording() reports false.
    stop.store(true, Ordering::Relaxed);
}

// Record the stream verbatim into a single file, emitting progress events.
async fn record_single(
    app: &tauri::AppHandle,
    mut reader: BufReader<Box<dyn AsyncStream>>,
    path: &str,
    stop: &Arc<AtomicBool>,
) {
    let mut file = match tokio::fs::File::create(path).await {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[rec] cannot create file {}: {:?}", path, e);
            return;
        }
    };
    let mut buf = vec![0u8; 16384];
    let started = std::time::Instant::now();
    let mut total: u64 = 0;
    let mut last_sec = u64::MAX;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match timeout(Duration::from_secs(15), reader.read(&mut buf)).await {
            Ok(Ok(0)) => break, // stream ended
            Ok(Ok(n)) => {
                if file.write_all(&buf[..n]).await.is_err() {
                    break;
                }
                total += n as u64;
                emit_recording_progress(app, &started, total, &mut last_sec);
            }
            Ok(Err(_)) => break, // read error
            Err(_) => break,     // stalled stream
        }
    }
    let _ = file.flush().await;
}

// Record an ICY stream, starting a new file each time the StreamTitle changes.
// Audio bytes are written to the current segment; the interleaved metadata
// blocks are consumed here (never written to disk) and drive the splitting.
async fn record_split(
    app: &tauri::AppHandle,
    mut reader: BufReader<Box<dyn AsyncStream>>,
    metaint: usize,
    base_path: &str,
    stop: &Arc<AtomicBool>,
) {
    let base = std::path::Path::new(base_path);
    let mut index = 1usize;
    let mut file = match tokio::fs::File::create(segment_path(base, index, None)).await {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[rec] cannot create segment: {:?}", e);
            return;
        }
    };
    let mut buf = vec![0u8; 16384];
    let mut until_meta = metaint;
    let mut last_title = String::new();
    let started = std::time::Instant::now();
    let mut total: u64 = 0;
    let mut last_sec = u64::MAX;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if until_meta > 0 {
            let to_read = buf.len().min(until_meta);
            match timeout(Duration::from_secs(15), reader.read(&mut buf[..to_read])).await {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    if file.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                    until_meta -= n;
                    total += n as u64;
                    emit_recording_progress(app, &started, total, &mut last_sec);
                }
                Ok(Err(_)) => break,
                Err(_) => break,
            }
        } else {
            // Metadata block: one length byte (16-byte units) + payload.
            let mut len_byte = [0u8; 1];
            if timeout(Duration::from_secs(15), reader.read_exact(&mut len_byte))
                .await
                .map(|r| r.is_err())
                .unwrap_or(true)
            {
                break;
            }
            let meta_len = (len_byte[0] as usize) * 16;
            if meta_len > 0 {
                let mut meta_buf = vec![0u8; meta_len];
                if timeout(Duration::from_secs(15), reader.read_exact(&mut meta_buf))
                    .await
                    .map(|r| r.is_err())
                    .unwrap_or(true)
                {
                    break;
                }
                if let Some(title) = parse_stream_title(&String::from_utf8_lossy(&meta_buf)) {
                    if title != last_title {
                        last_title = title.clone();
                        // Finish the current segment and open one for the new track.
                        let _ = file.flush().await;
                        index += 1;
                        match tokio::fs::File::create(segment_path(base, index, Some(&title))).await
                        {
                            Ok(f) => file = f,
                            Err(e) => {
                                eprintln!("[rec] cannot create segment: {:?}", e);
                                break;
                            }
                        }
                    }
                }
            }
            until_meta = metaint;
        }
    }
    let _ = file.flush().await;
}

// Emit a recording-progress event at most once per elapsed second.
fn emit_recording_progress(
    app: &tauri::AppHandle,
    started: &std::time::Instant,
    total: u64,
    last_sec: &mut u64,
) {
    let secs = started.elapsed().as_secs();
    if secs != *last_sec {
        *last_sec = secs;
        let _ = app.emit(
            "recording-progress",
            RecordingProgress {
                seconds: secs,
                bytes: total,
            },
        );
    }
}

#[tauri::command]
fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecordingState>,
    url: String,
    path: String,
    split: bool,
) -> Result<(), String> {
    let mut guard = state.stop.lock().map_err(|_| "lock poisoned")?;
    if let Some(flag) = guard.as_ref() {
        if !flag.load(Ordering::Relaxed) {
            return Err("already recording".into());
        }
    }
    let flag = Arc::new(AtomicBool::new(false));
    *guard = Some(flag.clone());
    tauri::async_runtime::spawn(record_stream(app, url, path, flag, split));
    Ok(())
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, RecordingState>) {
    if let Ok(mut guard) = state.stop.lock() {
        if let Some(flag) = guard.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
fn is_recording(state: tauri::State<'_, RecordingState>) -> bool {
    state
        .stop
        .lock()
        .map(|g| {
            g.as_ref()
                .map(|f| !f.load(Ordering::Relaxed))
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

// Parse URL into host, port, path, and is_ssl
fn parse_url(url: &str) -> Option<(String, u16, String, bool)> {
    let url = url.trim();
    let (rest, is_ssl) = if let Some(stripped) = url.strip_prefix("https://") {
        (stripped, true)
    } else if let Some(stripped) = url.strip_prefix("http://") {
        (stripped, false)
    } else {
        (url, false)
    };

    let (host_port, path) = if let Some(idx) = rest.find('/') {
        (&rest[..idx], &rest[idx..])
    } else {
        (rest, "/")
    };

    let (host, port) = if let Some(idx) = host_port.find(':') {
        let h = &host_port[..idx];
        let p = host_port[idx + 1..].parse::<u16>().ok()?;
        (h.to_string(), p)
    } else {
        let default_port = if is_ssl { 443 } else { 80 };
        (host_port.to_string(), default_port)
    };

    Some((host, port, path.to_string(), is_ssl))
}

// Read ICY metadata from a generic stream (HTTP or HTTPS)
async fn read_icy_metadata_from_stream<S>(
    stream: S,
    path: &str,
    host: &str,
) -> Option<StreamMetadata>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);

    // Send HTTP request with ICY metadata header
    let request = format!(
        "GET {} HTTP/1.0\r\n\
         Host: {}\r\n\
         User-Agent: TauriRadio/1.0\r\n\
         Icy-MetaData: 1\r\n\
         Connection: close\r\n\
         \r\n",
        path, host
    );

    timeout(Duration::from_secs(2), writer.write_all(request.as_bytes()))
        .await
        .ok()?
        .ok()?;

    let mut icy_metaint: Option<usize> = None;
    let mut icy_name: Option<String> = None;
    let mut icy_genre: Option<String> = None;
    let mut icy_br: Option<String> = None;

    // Read headers with timeout
    let headers_result = timeout(Duration::from_secs(3), async {
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await.ok()? == 0 {
                break;
            }

            let line_trimmed = line.trim();
            if line_trimmed.is_empty() {
                break;
            }

            let lower = line_trimmed.to_lowercase();
            if lower.starts_with("icy-metaint:") {
                if let Some(val) = line_trimmed.split(':').nth(1) {
                    icy_metaint = val.trim().parse().ok();
                }
            } else if lower.starts_with("icy-name:") {
                if let Some(val) = line_trimmed.split(':').nth(1) {
                    icy_name = Some(val.trim().to_string());
                }
            } else if lower.starts_with("icy-genre:") {
                if let Some(val) = line_trimmed.split(':').nth(1) {
                    icy_genre = Some(val.trim().to_string());
                }
            } else if lower.starts_with("icy-br:") {
                if let Some(val) = line_trimmed.split(':').nth(1) {
                    icy_br = Some(val.trim().to_string());
                }
            }
        }
        Some(())
    })
    .await;

    if headers_result.is_err() {
        return Some(StreamMetadata {
            title: None,
            genre: icy_genre,
            bitrate: icy_br,
            name: icy_name,
        });
    }

    // Read stream data to get current track title
    let title = if let Some(metaint) = icy_metaint {
        let title_result = timeout(Duration::from_secs(5), async {
            // Skip audio data until metadata block
            let mut skip_buf = vec![0u8; metaint];
            reader.read_exact(&mut skip_buf).await.ok()?;

            // Read metadata length byte
            let mut len_byte = [0u8; 1];
            reader.read_exact(&mut len_byte).await.ok()?;
            let meta_len = (len_byte[0] as usize) * 16;

            if meta_len > 0 && meta_len < 4096 {
                let mut meta_buf = vec![0u8; meta_len];
                reader.read_exact(&mut meta_buf).await.ok()?;

                let meta_str = String::from_utf8_lossy(&meta_buf);
                parse_stream_title(&meta_str)
            } else {
                None
            }
        })
        .await;

        title_result.ok().flatten()
    } else {
        None
    };

    Some(StreamMetadata {
        title,
        genre: icy_genre,
        bitrate: icy_br,
        name: icy_name,
    })
}

// Parse StreamTitle from ICY metadata string
fn parse_stream_title(meta_str: &str) -> Option<String> {
    if let Some(start) = meta_str.find("StreamTitle='") {
        let rest = &meta_str[start + 13..];
        if let Some(end) = rest.find("';") {
            let title = rest[..end].trim().to_string();
            if !title.is_empty() {
                return Some(title);
            }
        }
    }
    None
}

// Extract ICY metadata asynchronously supporting HTTP and HTTPS
async fn extract_icy_metadata_async(url: &str) -> Option<StreamMetadata> {
    let (host, port, path, is_ssl) = parse_url(url)?;

    let addr = format!("{}:{}", host, port);

    // Connect with timeout
    let stream = timeout(Duration::from_secs(3), TcpStream::connect(&addr))
        .await
        .ok()?
        .ok()?;

    if is_ssl {
        let connector = native_tls::TlsConnector::new().ok()?;
        let connector = tokio_native_tls::TlsConnector::from(connector);
        let tls_stream = timeout(Duration::from_secs(3), connector.connect(&host, stream))
            .await
            .ok()?
            .ok()?;
        read_icy_metadata_from_stream(tls_stream, &path, &host).await
    } else {
        read_icy_metadata_from_stream(stream, &path, &host).await
    }
}

// A boxed async stream — either a plain TCP or a TLS connection.
trait AsyncStream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
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

// Open an audio stream, following HTTP redirects and resolving playlists.
// Returns the reader positioned at the audio body, the resolved Content-Type,
// and the ICY metadata interval (bytes of audio between metadata blocks) when
// `want_meta` is set and the server supports it.
async fn open_audio_stream(
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

    let tcp = timeout(Duration::from_secs(8), TcpStream::connect(&addr)).await??;

    let mut stream: Box<dyn AsyncStream> = if is_ssl {
        // Radio servers often have expired/mismatched certificates; accept
        // them so streams are not blocked by TLS validation failures.
        eprintln!(
            "[tls] accepting unverified certificate for {} (validation disabled for stream proxy)",
            host
        );
        let connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .build()?;
        let connector = tokio_native_tls::TlsConnector::from(connector);
        let tls = timeout(Duration::from_secs(8), connector.connect(&host, tcp)).await??;
        Box::new(tls)
    } else {
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

    // Split "url=<encoded>" from any extra query params (e.g. raw=1).
    // The encoded URL never contains a literal '&', so the first '&'
    // marks the start of additional parameters.
    let query = &uri[12..];
    let (encoded_url, params) = query.split_once('&').unwrap_or((query, ""));
    let raw = params.contains("raw=1");

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

async fn start_proxy_server(app: tauri::AppHandle) -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let port = listener.local_addr().ok()?.port();

    tokio::spawn(async move {
        loop {
            if let Ok((client_stream, _)) = listener.accept().await {
                let app = app.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_proxy_client(client_stream, app).await {
                        eprintln!("Proxy client handle error: {:?}", e);
                    }
                });
            }
        }
    });

    Some(port)
}

#[tauri::command]
fn get_proxy_port(state: tauri::State<'_, ProxyPort>) -> u16 {
    state.0
}

#[tauri::command]
async fn get_stream_metadata(url: String) -> Option<StreamMetadata> {
    extract_icy_metadata_async(&url).await
}

// Open a web URL in the user's default browser.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) {
    use tauri_plugin_opener::OpenerExt;
    // Only allow web URLs to avoid launching arbitrary programs.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return;
    }
    // The opener plugin passes the URL straight to the OS handler
    // (ShellExecute / open / xdg-open) without going through a shell,
    // so URL contents cannot be interpreted as shell commands.
    let _ = app.opener().open_url(url, None::<&str>);
}

// Check for and install an application update. Compiled only when the
// `updater` feature is enabled (desktop), which also registers the plugin.
#[cfg(all(desktop, feature = "updater"))]
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|_| "Updater is not configured yet".to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            Ok(format!("Updated to {} — restart to apply", version))
        }
        Ok(None) => Ok("You are on the latest version".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

// Stub used when the updater feature is off (default) or on mobile, so the
// frontend command always exists but reports the updater is unavailable.
#[cfg(not(all(desktop, feature = "updater")))]
#[tauri::command]
async fn check_for_updates() -> Result<String, String> {
    Err("Auto-updater is not enabled in this build".to_string())
}

fn main() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // Persist the window size between sessions (size only — position
        // stays centered, visibility is left to the tray logic).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE)
                .build(),
        );

    // The updater plugin is desktop-only and opt-in via the `updater` feature.
    // It panics on startup unless plugins.updater is configured, so it stays
    // out of default builds.
    #[cfg(all(desktop, feature = "updater"))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(RecordingState::default())
        .invoke_handler(tauri::generate_handler![
            get_stream_metadata,
            get_proxy_port,
            open_url,
            start_recording,
            stop_recording,
            is_recording,
            check_for_updates
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let port = tauri::async_runtime::block_on(async {
                start_proxy_server(app_handle).await.unwrap_or(0)
            });
            app.manage(ProxyPort(port));

            // Create tray menu
            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_url_https_default_port() {
        let (host, port, path, ssl) = parse_url("https://example.com/stream").unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 443);
        assert_eq!(path, "/stream");
        assert!(ssl);
    }

    #[test]
    fn parse_url_http_explicit_port_no_path() {
        let (host, port, path, ssl) = parse_url("http://radio.fm:8000").unwrap();
        assert_eq!(host, "radio.fm");
        assert_eq!(port, 8000);
        assert_eq!(path, "/");
        assert!(!ssl);
    }

    #[test]
    fn parse_url_no_scheme_defaults_to_http() {
        let (host, port, _, ssl) = parse_url("radio.fm/live").unwrap();
        assert_eq!(host, "radio.fm");
        assert_eq!(port, 80);
        assert!(!ssl);
    }

    #[test]
    fn parse_url_trims_whitespace() {
        let (host, _, _, _) = parse_url("  http://radio.fm/live  ").unwrap();
        assert_eq!(host, "radio.fm");
    }

    #[test]
    fn parse_url_rejects_bad_port() {
        assert!(parse_url("http://radio.fm:notaport/live").is_none());
    }

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
    fn parse_stream_title_extracts_title() {
        let meta = "StreamTitle='Artist - Song';StreamUrl='http://x';";
        assert_eq!(parse_stream_title(meta), Some("Artist - Song".to_string()));
    }

    #[test]
    fn parse_stream_title_empty_is_none() {
        assert_eq!(parse_stream_title("StreamTitle='';"), None);
        assert_eq!(parse_stream_title("no metadata here"), None);
    }

    #[test]
    fn sanitize_filename_strips_invalid_chars() {
        assert_eq!(sanitize_filename("AC/DC: Back?"), "AC_DC_ Back_");
        assert_eq!(sanitize_filename("   "), "track");
        assert_eq!(sanitize_filename("..."), "track");
    }

    #[test]
    fn segment_path_with_and_without_title() {
        // Forward slashes are accepted as separators on both Windows and Unix.
        let base = std::path::Path::new("rec/Jazz.mp3");
        let p1 = segment_path(base, 1, None);
        assert_eq!(p1.file_name().unwrap().to_str().unwrap(), "Jazz - 01.mp3");
        let p2 = segment_path(base, 2, Some("Artist - Song"));
        assert_eq!(
            p2.file_name().unwrap().to_str().unwrap(),
            "Jazz - 02 - Artist - Song.mp3"
        );
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
