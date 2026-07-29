// ICY/Shoutcast stream metadata: URL parsing, header reading, title parsing,
// and the get_stream_metadata command used by the frontend for a one-shot probe.

use serde::Serialize;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
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

// Largest `icy-metaint` we will act on. Real Shoutcast/Icecast servers use
// 8192–65536; the value decides how big a buffer we allocate to skip past the
// audio, and it arrives from whatever host the station URL points at. Left
// unbounded, `icy-metaint: 999999999999` from a hostile or broken server turns
// one Play into a terabyte allocation and aborts the whole process.
const MAX_METAINT: usize = 1024 * 1024;

pub(crate) fn parse_metaint(value: &str) -> Option<usize> {
    value
        .trim()
        .parse::<usize>()
        .ok()
        .filter(|n| *n > 0 && *n <= MAX_METAINT)
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
                    icy_metaint = parse_metaint(val);
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

// Read the value of a `key="value"` attribute, matching `key` only where it
// actually starts an attribute (start of input, or after a comma or space) so
// `title` does not also match `subtitle`. Values are read to the next quote.
fn attr_value<'a>(s: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("{}=\"", key);
    let mut from = 0;
    while let Some(offset) = s[from..].find(&pat) {
        let at = from + offset;
        let starts_attr = at == 0 || matches!(s.as_bytes()[at - 1], b',' | b' ' | b'\t');
        if starts_attr {
            let start = at + pat.len();
            return s[start..].find('"').map(|end| s[start..start + end].trim());
        }
        from = at + pat.len();
    }
    None
}

// Byte that may appear inside an attribute key.
fn is_key_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

// Offset where the trailing `key="value"` attribute blob begins, if any. Found
// by locating the first `="` and walking back over the key to its first byte,
// which must itself start at the beginning of the string or after a separator.
fn attr_blob_start(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut from = 0;
    while let Some(offset) = s[from..].find("=\"") {
        let eq = from + offset;
        let mut key_start = eq;
        while key_start > 0 && is_key_byte(bytes[key_start - 1]) {
            key_start -= 1;
        }
        let starts_attr = key_start < eq
            && (key_start == 0 || matches!(bytes[key_start - 1], b',' | b' ' | b'\t'));
        if starts_attr && s.is_char_boundary(key_start) {
            return Some(key_start);
        }
        from = eq + 2;
    }
    None
}

// Some encoders (iHeartRadio and friends) append a structured payload to
// StreamTitle instead of sending a plain "Artist - Song" string. Two shapes
// show up in the wild, and the quotes inside a value are never escaped, so the
// whole blob used to be displayed verbatim as the track name:
//
//   title="BREAK MY HEART",artist="Dua Lipa",url="song_spot="F" MediaBaseId="0" …
//   Pink Pantheress / Zara Larsson - text="Stateside" song_spot="M" TAID="0" …
//
// Handled as one rule: cut the attribute blob off, then splice back whatever
// title it carried (`title`, or `text`) and its `artist`. Whatever preceded the
// blob is kept as the artist part when the blob names no artist of its own, so
// the second shape survives as "Pink Pantheress / Zara Larsson - Stateside".
// Returns None when there is no blob at all — the case of an ordinary title,
// which is then left exactly as the station sent it.
fn rebuild_structured_title(raw: &str) -> Option<String> {
    let blob_start = attr_blob_start(raw)?;
    let prefix = raw[..blob_start]
        .trim()
        .trim_end_matches(&['-', '–', '—', ':'][..])
        .trim();
    let blob = &raw[blob_start..];

    let title = attr_value(blob, "title")
        .or_else(|| attr_value(blob, "text"))
        .filter(|s| !s.is_empty());
    let artist = attr_value(blob, "artist")
        .filter(|s| !s.is_empty())
        .or(if prefix.is_empty() {
            None
        } else {
            Some(prefix)
        });

    let rebuilt = match (artist, title) {
        (Some(a), Some(t)) => format!("{} - {}", a, t),
        (Some(a), None) => a.to_string(),
        (None, Some(t)) => t.to_string(),
        // A blob with nothing usable in it: better to show the raw string than
        // to claim there is no track playing.
        (None, None) => return None,
    };
    Some(rebuilt)
}

// Parse StreamTitle from ICY metadata string
pub(crate) fn parse_stream_title(meta_str: &str) -> Option<String> {
    if let Some(start) = meta_str.find("StreamTitle='") {
        let rest = &meta_str[start + 13..];
        if let Some(end) = rest.find("';") {
            let title = rest[..end].trim();
            if !title.is_empty() {
                return Some(rebuild_structured_title(title).unwrap_or_else(|| title.to_string()));
            }
        }
    }
    None
}

// One step produced by IcyDemux::pull: either a chunk of clean audio written
// into the caller's buffer, a consumed metadata block (carrying the new track
// title when it changed), or end of stream.
pub(crate) enum IcyEvent {
    // `usize` bytes of audio were written to the front of the caller's buffer.
    Audio(usize),
    // A metadata block was consumed; `Some(title)` when the StreamTitle changed.
    Title(Option<String>),
    // The upstream ended cleanly on an audio boundary.
    End,
}

// Shared ICY metadata de-interleaver. An ICY stream carries `metaint` bytes of
// audio, then a length byte (in 16-byte units) followed by that many metadata
// bytes, repeating. This walks that framing once so every consumer (live
// playback, the PCM decoder feed, and recording) shares a single implementation
// instead of re-deriving the state machine. Audio bytes are handed back
// verbatim; metadata blocks are parsed for the track title and never surface in
// the audio.
pub(crate) struct IcyDemux {
    metaint: usize,
    until_meta: usize,
    last_title: String,
}

impl IcyDemux {
    pub(crate) fn new(metaint: usize) -> Self {
        IcyDemux {
            metaint,
            until_meta: metaint,
            last_title: String::new(),
        }
    }

    // Advance the stream by one step. Reads audio up to the next metadata
    // boundary into `buf` (returning Audio), or consumes a metadata block at the
    // boundary (returning Title). A clean EOF on an audio read yields End; an EOF
    // mid-frame surfaces as an Err (an interrupted/closed connection), which
    // callers treat as the end of the stream.
    pub(crate) async fn pull<R>(
        &mut self,
        reader: &mut R,
        buf: &mut [u8],
    ) -> std::io::Result<IcyEvent>
    where
        R: AsyncRead + Unpin,
    {
        if self.until_meta > 0 {
            // Forward audio, but never past the next metadata boundary.
            let to_read = buf.len().min(self.until_meta);
            let n = reader.read(&mut buf[..to_read]).await?;
            if n == 0 {
                return Ok(IcyEvent::End);
            }
            self.until_meta -= n;
            Ok(IcyEvent::Audio(n))
        } else {
            // Metadata block: one length byte (in 16-byte units) + payload.
            let mut len_byte = [0u8; 1];
            reader.read_exact(&mut len_byte).await?;
            let meta_len = (len_byte[0] as usize) * 16;
            let mut changed = None;
            if meta_len > 0 {
                let mut meta_buf = vec![0u8; meta_len];
                reader.read_exact(&mut meta_buf).await?;
                if let Some(title) = parse_stream_title(&String::from_utf8_lossy(&meta_buf)) {
                    if title != self.last_title {
                        self.last_title = title.clone();
                        changed = Some(title);
                    }
                }
            }
            self.until_meta = self.metaint;
            Ok(IcyEvent::Title(changed))
        }
    }
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

    // The header comes from whatever host the station URL points at, and the
    // probe path allocates a buffer of that size to skip past the audio.
    #[test]
    fn parse_metaint_rejects_absurd_and_zero_values() {
        assert_eq!(parse_metaint("16000"), Some(16000));
        assert_eq!(parse_metaint("  8192 "), Some(8192));
        assert_eq!(parse_metaint(&MAX_METAINT.to_string()), Some(MAX_METAINT));
        // One past the cap, a 4 GiB buffer, and a terabyte are all refused.
        assert_eq!(parse_metaint(&(MAX_METAINT + 1).to_string()), None);
        assert_eq!(parse_metaint("4294967295"), None);
        assert_eq!(parse_metaint("999999999999"), None);
        // Zero would make every read a metadata boundary; junk is not a number.
        assert_eq!(parse_metaint("0"), None);
        assert_eq!(parse_metaint("-1"), None);
        assert_eq!(parse_metaint("banana"), None);
        assert_eq!(parse_metaint(""), None);
    }

    #[test]
    fn parse_stream_title_empty_is_none() {
        assert_eq!(parse_stream_title("StreamTitle='';"), None);
        assert_eq!(parse_stream_title("no metadata here"), None);
    }

    // Real payload from an iHeartRadio stream: the unescaped quotes inside the
    // `url` value used to leak into the displayed track name.
    #[test]
    fn parse_stream_title_rebuilds_structured_payload() {
        let meta = "StreamTitle='title=\"BREAK MY HEART\",artist=\"Dua Lipa\",\
                    url=\"song_spot=\"F\" MediaBaseId=\"0\" itunesTrackId=\"0\" \
                    amgTrackId=\"-1\" TPID=\"116056426\" \
                    amgArtworkURL=\"http://image.iheart.com/x.jpg\" \
                    length=\"00:03:39\" spotInstanceId=\"07664985-571b\"';";
        assert_eq!(
            parse_stream_title(meta),
            Some("Dua Lipa - BREAK MY HEART".to_string())
        );
    }

    // The other real shape: a plain "Artist - " prefix followed by the blob,
    // with the title in `text=` and no `artist=` key at all.
    #[test]
    fn parse_stream_title_keeps_prefix_as_artist() {
        let meta = "StreamTitle='Pink Pantheress / Zara Larsson - text=\"Stateside\" \
                    song_spot=\"M\" MediaBaseId=\"3120734\" itunesTrackId=\"0\" \
                    amgTrackId=\"-1\" TAID=\"0\" TPID=\"354002035\" \
                    cartcutId=\"0445711001\" \
                    amgArtworkURL=\"https://i.iheart.com/v3/catalog/track/354002035\
                    ?ops=fit(200,200),format(%22jpeg%22)\" \
                    length=\"00:03:03\" unsID=\"-1\" spotInstanceId=\"-1\"';";
        assert_eq!(
            parse_stream_title(meta),
            Some("Pink Pantheress / Zara Larsson - Stateside".to_string())
        );
    }

    // A blob carrying no title at all: keep the plain part, drop the junk.
    #[test]
    fn parse_stream_title_strips_a_blob_with_no_title() {
        let meta = "StreamTitle='Nirvana - Lithium song_spot=\"M\" MediaBaseId=\"0\"';";
        assert_eq!(
            parse_stream_title(meta),
            Some("Nirvana - Lithium".to_string())
        );
    }

    #[test]
    fn parse_stream_title_structured_with_one_field() {
        assert_eq!(
            parse_stream_title("StreamTitle='title=\"Solo Track\",url=\"x\"';"),
            Some("Solo Track".to_string())
        );
        assert_eq!(
            parse_stream_title("StreamTitle='artist=\"Only Artist\"';"),
            Some("Only Artist".to_string())
        );
    }

    // A plain title must survive untouched, including one that merely contains
    // a quote or a key-looking word.
    #[test]
    fn parse_stream_title_leaves_plain_titles_alone() {
        assert_eq!(
            parse_stream_title("StreamTitle='Dua Lipa - Break My Heart';"),
            Some("Dua Lipa - Break My Heart".to_string())
        );
        assert_eq!(
            parse_stream_title("StreamTitle='The \"Subtitle\" Song';"),
            Some("The \"Subtitle\" Song".to_string())
        );
    }

    // `title=` must not be matched inside a longer key such as `subtitle=`.
    #[test]
    fn attr_value_requires_an_attribute_boundary() {
        assert_eq!(attr_value("subtitle=\"nope\"", "title"), None);
        assert_eq!(
            attr_value("subtitle=\"nope\",title=\"yes\"", "title"),
            Some("yes")
        );
    }

    #[test]
    fn icy_demux_walks_audio_and_metadata_frames() {
        // metaint = 4: 4 audio bytes, then a length byte (16-byte units) and the
        // metadata payload, repeating. "StreamTitle='A';" is exactly 16 bytes.
        let mut stream: Vec<u8> = Vec::new();
        stream.extend_from_slice(b"WXYZ"); // audio block 1
        stream.push(1); // 1 * 16 = 16 metadata bytes
        stream.extend_from_slice(b"StreamTitle='A';");
        stream.extend_from_slice(b"PQRS"); // audio block 2
        stream.push(0); // empty metadata block (no title)

        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(async {
            let mut reader: &[u8] = &stream;
            let mut demux = IcyDemux::new(4);
            let mut buf = [0u8; 32];

            // First audio chunk.
            match demux.pull(&mut reader, &mut buf).await.unwrap() {
                IcyEvent::Audio(n) => assert_eq!(&buf[..n], b"WXYZ"),
                _ => panic!("expected audio"),
            }
            // Metadata block carrying the new title.
            match demux.pull(&mut reader, &mut buf).await.unwrap() {
                IcyEvent::Title(t) => assert_eq!(t.as_deref(), Some("A")),
                _ => panic!("expected title"),
            }
            // Second audio chunk.
            match demux.pull(&mut reader, &mut buf).await.unwrap() {
                IcyEvent::Audio(n) => assert_eq!(&buf[..n], b"PQRS"),
                _ => panic!("expected audio"),
            }
            // Empty metadata block: no title change.
            match demux.pull(&mut reader, &mut buf).await.unwrap() {
                IcyEvent::Title(t) => assert_eq!(t, None),
                _ => panic!("expected empty title"),
            }
            // Clean end of stream on the next audio boundary.
            assert!(matches!(
                demux.pull(&mut reader, &mut buf).await.unwrap(),
                IcyEvent::End
            ));
        });
    }
}
