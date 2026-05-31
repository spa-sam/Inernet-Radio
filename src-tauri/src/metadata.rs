// ICY/Shoutcast stream metadata: URL parsing, header reading, title parsing,
// and the get_stream_metadata command used by the frontend for a one-shot probe.

use serde::Serialize;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Serialize, Default, Clone)]
pub(crate) struct StreamMetadata {
    title: Option<String>,
    genre: Option<String>,
    bitrate: Option<String>,
    name: Option<String>,
}

// Live track metadata pushed to the frontend as it is parsed out of the
// playback stream. `url` is the original (pre-redirect) stream URL so the
// frontend can ignore stale events from a connection it has switched away from.
#[derive(Serialize, Clone)]
pub(crate) struct LiveMetadata {
    pub(crate) url: String,
    pub(crate) title: String,
}

// Parse URL into host, port, path, and is_ssl
pub(crate) fn parse_url(url: &str) -> Option<(String, u16, String, bool)> {
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
pub(crate) fn parse_stream_title(meta_str: &str) -> Option<String> {
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

#[tauri::command]
pub(crate) async fn get_stream_metadata(url: String) -> Option<StreamMetadata> {
    extract_icy_metadata_async(&url).await
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
    fn parse_stream_title_extracts_title() {
        let meta = "StreamTitle='Artist - Song';StreamUrl='http://x';";
        assert_eq!(parse_stream_title(meta), Some("Artist - Song".to_string()));
    }

    #[test]
    fn parse_stream_title_empty_is_none() {
        assert_eq!(parse_stream_title("StreamTitle='';"), None);
        assert_eq!(parse_stream_title("no metadata here"), None);
    }
}
