// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
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

struct ProxyPort(u16);

// Parse URL into host, port, path, and is_ssl
fn parse_url(url: &str) -> Option<(String, u16, String, bool)> {
    let url = url.trim();
    let (rest, is_ssl) = if url.starts_with("https://") {
        (&url[8..], true)
    } else if url.starts_with("http://") {
        (&url[7..], false)
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
async fn read_icy_metadata_from_stream<S>(stream: S, path: &str, host: &str) -> Option<StreamMetadata>
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
// Returns the reader positioned at the audio body and the resolved Content-Type.
async fn open_audio_stream(
    url: &str,
    hops: u8,
    raw: bool,
) -> Result<(BufReader<Box<dyn AsyncStream>>, String), Box<dyn std::error::Error + Send + Sync>> {
    if hops >= 5 {
        return Err("too many redirects".into());
    }

    let (host, port, path, is_ssl) = parse_url(url).ok_or("invalid url")?;
    let addr = format!("{}:{}", host, port);

    let tcp = timeout(Duration::from_secs(8), TcpStream::connect(&addr)).await??;

    let mut stream: Box<dyn AsyncStream> = if is_ssl {
        // Radio servers often have expired/mismatched certificates; accept
        // them so streams are not blocked by TLS validation failures.
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

    // Request a clean audio stream. We must NOT ask for ICY metadata here:
    // interleaved metadata blocks would corrupt playback because the <audio>
    // element receives no icy-metaint header and cannot strip them out.
    let request = format!(
        "GET {} HTTP/1.0\r\n\
         Host: {}\r\n\
         User-Agent: Mozilla/5.0 TauriRadio/1.0\r\n\
         Connection: close\r\n\
         \r\n",
        path, host
    );
    stream.write_all(request.as_bytes()).await?;

    let mut reader = BufReader::new(stream);

    // Read the status line and headers, bounded by a timeout
    let (status, content_type, location) = timeout(Duration::from_secs(8), async {
        let mut status_line = String::new();
        reader.read_line(&mut status_line).await?;
        let status = parse_status_code(&status_line);

        let mut content_type = String::new();
        let mut location = String::new();
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
                    _ => {}
                }
            }
        }
        Ok::<_, std::io::Error>((status, content_type, location))
    })
    .await
    .map_err(|_| "timeout reading response headers")??;

    // Follow HTTP redirects
    if (300..400).contains(&status) && !location.is_empty() {
        let next = resolve_location(url, &location);
        return Box::pin(open_audio_stream(&next, hops + 1, raw)).await;
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
        let stream_url =
            first_stream_url(&body_text).ok_or("playlist has no stream url")?;
        return Box::pin(open_audio_stream(&stream_url, hops + 1, raw)).await;
    }

    let content_type = if content_type.is_empty() {
        String::from("audio/mpeg")
    } else {
        content_type
    };
    Ok((reader, content_type))
}

// Local CORS audio-proxy handler
async fn handle_proxy_client(
    mut client_stream: TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Read only the request line from the audio client
    let mut request_line = String::new();
    {
        let mut reader = BufReader::new(&mut client_stream);
        reader.read_line(&mut request_line).await?;
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

    match open_audio_stream(&target_url, 0, raw).await {
        Ok((mut remote_reader, content_type)) => {
            write_proxy_headers(&mut client_stream, &content_type).await?;
            let (_, mut client_write_half) = tokio::io::split(client_stream);
            tokio::io::copy(&mut remote_reader, &mut client_write_half).await?;
        }
        Err(e) => {
            eprintln!("Proxy resolve error for {}: {:?}", target_url, e);
            client_stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                .await?;
        }
    }

    Ok(())
}

async fn start_proxy_server() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let port = listener.local_addr().ok()?.port();

    tokio::spawn(async move {
        loop {
            if let Ok((client_stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    if let Err(e) = handle_proxy_client(client_stream).await {
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![get_stream_metadata, get_proxy_port])
        .setup(|app| {
            let port = tauri::async_runtime::block_on(async {
                start_proxy_server().await.unwrap_or(0)
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide window instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
