// Local CORS audio proxy: resolves redirects/playlists, opens the upstream
// stream, strips ICY metadata blocks while forwarding clean audio to the
// <audio> element, and emits live track titles to the frontend.

use serde::Serialize;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::metadata::{parse_stream_title, parse_url, LiveMetadata};

// Output format for the PCM path: fixed 48 kHz stereo f32 little-endian, so the
// frontend AudioWorklet always sees one rate/layout regardless of the source.
const PCM_OUT_RATE: u32 = 48_000;

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

// A blocking std::io::Read backed by an async mpsc of byte chunks. Lets the
// synchronous symphonia decoder pull from the async network reader: the reader
// task pushes chunks; this Read blocks on `blocking_recv` (run inside
// spawn_blocking, never on an async worker). Wrapped in a Mutex so the type is
// Sync, as symphonia's MediaSource requires.
struct ChannelReader {
    inner: std::sync::Mutex<ChannelReaderInner>,
}
struct ChannelReaderInner {
    rx: mpsc::Receiver<Vec<u8>>,
    buf: Vec<u8>,
    pos: usize,
}
impl ChannelReader {
    fn new(rx: mpsc::Receiver<Vec<u8>>) -> Self {
        ChannelReader {
            inner: std::sync::Mutex::new(ChannelReaderInner {
                rx,
                buf: Vec::new(),
                pos: 0,
            }),
        }
    }
}
impl std::io::Read for ChannelReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        let mut g = self.inner.lock().unwrap();
        loop {
            if g.pos < g.buf.len() {
                let start = g.pos;
                let n = (g.buf.len() - start).min(out.len());
                out[..n].copy_from_slice(&g.buf[start..start + n]);
                g.pos += n;
                return Ok(n);
            }
            match g.rx.blocking_recv() {
                Some(chunk) => {
                    g.buf = chunk;
                    g.pos = 0;
                }
                None => return Ok(0), // upstream ended
            }
        }
    }
}

// Map an upstream Content-Type to a container/codec extension hint for symphonia.
fn ext_from_content_type(ct: &str) -> Option<&'static str> {
    let c = ct.to_lowercase();
    if c.contains("mpeg") || c.contains("mp3") {
        Some("mp3")
    } else if c.contains("aac") || c.contains("aacp") {
        Some("aac")
    } else if c.contains("mp4") || c.contains("m4a") {
        Some("mp4")
    } else if c.contains("ogg") || c.contains("opus") || c.contains("vorbis") {
        Some("ogg")
    } else if c.contains("flac") {
        Some("flac")
    } else if c.contains("wav") {
        Some("wav")
    } else {
        None
    }
}

// Stateful linear resampler: interleaved stereo f32 at `in_rate` -> 48 kHz.
// Keeps the last input frame and fractional phase across calls so packet
// boundaries don't click. 48 kHz input passes through untouched.
struct Resampler {
    in_rate: u32,
    frac: f64,
    prev: [f32; 2],
    primed: bool,
}
impl Resampler {
    fn new(in_rate: u32) -> Self {
        Resampler {
            in_rate,
            frac: 0.0,
            prev: [0.0, 0.0],
            primed: false,
        }
    }

    // index space: 0 = prev frame, k>=1 = input frame (k-1)
    fn sample_at(&self, input: &[f32], n: usize, idx: i64) -> (f32, f32) {
        if idx <= 0 {
            (self.prev[0], self.prev[1])
        } else {
            let k = (idx - 1) as usize;
            let k = k.min(n - 1);
            (input[k * 2], input[k * 2 + 1])
        }
    }

    fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let n = input.len() / 2;
        if n == 0 {
            return Vec::new();
        }
        if self.in_rate == PCM_OUT_RATE {
            self.prev = [input[(n - 1) * 2], input[(n - 1) * 2 + 1]];
            return input.to_vec();
        }
        if !self.primed {
            self.prev = [input[0], input[1]];
            self.primed = true;
        }
        let step = self.in_rate as f64 / PCM_OUT_RATE as f64;
        let mut out = Vec::new();
        let mut pos = self.frac;
        while pos < n as f64 {
            let i = pos.floor() as i64;
            let f = (pos - i as f64) as f32;
            let (al, ar) = self.sample_at(input, n, i);
            let (bl, br) = self.sample_at(input, n, i + 1);
            out.push(al + (bl - al) * f);
            out.push(ar + (br - ar) * f);
            pos += step;
        }
        self.prev = [input[(n - 1) * 2], input[(n - 1) * 2 + 1]];
        self.frac = (pos - n as f64).max(0.0);
        out
    }
}

// Synchronous decode loop (runs in spawn_blocking): pull encoded bytes from
// `bytes_rx`, decode with symphonia, convert to stereo, resample to 48 kHz, and
// push interleaved f32 little-endian PCM to `pcm_tx`. Returns when the stream
// ends, the client drops (send fails), or decoding errors fatally.
fn decode_to_pcm(
    bytes_rx: mpsc::Receiver<Vec<u8>>,
    content_type: String,
    pcm_tx: mpsc::Sender<Vec<u8>>,
) {
    let mss = MediaSourceStream::new(
        Box::new(ReadOnlySource::new(ChannelReader::new(bytes_rx))),
        Default::default(),
    );
    let mut hint = Hint::new();
    if let Some(ext) = ext_from_content_type(&content_type) {
        hint.with_extension(ext);
    }
    let probed = match symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pcm] probe failed: {}", e);
            return;
        }
    };
    let mut format = probed.format;
    let track = match format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
    {
        Some(t) => t.clone(),
        None => return,
    };
    let track_id = track.id;
    let mut decoder = match symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
    {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[pcm] no decoder: {}", e);
            return;
        }
    };

    let mut resampler: Option<Resampler> = None;
    // Loop ends when next_packet() returns Err (end of stream / IO error).
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        };

        let spec = *decoded.spec();
        let in_rate = spec.rate;
        let in_ch = spec.channels.count();
        let frames = decoded.frames();
        if frames == 0 || in_ch == 0 {
            continue;
        }

        let mut sbuf = SampleBuffer::<f32>::new(frames as u64, spec);
        sbuf.copy_interleaved_ref(decoded);
        let samples = sbuf.samples();

        // Downmix/duplicate to stereo interleaved.
        let mut stereo = Vec::with_capacity(frames * 2);
        for f in 0..frames {
            let base = f * in_ch;
            let l = samples[base];
            let r = if in_ch > 1 { samples[base + 1] } else { l };
            stereo.push(l);
            stereo.push(r);
        }

        let r = resampler.get_or_insert_with(|| Resampler::new(in_rate));
        if r.in_rate != in_rate {
            *r = Resampler::new(in_rate);
        }
        let out = r.process(&stereo);

        let mut bytes = Vec::with_capacity(out.len() * 4);
        for s in out {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        if !bytes.is_empty() && pcm_tx.blocking_send(bytes).is_err() {
            break; // client gone
        }
    }
}

// Forward an upstream stream (no ICY) verbatim into the decoder channel.
async fn pump_raw_to_channel<R>(mut reader: R, tx: mpsc::Sender<Vec<u8>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = vec![0u8; 16384];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).await.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

// Forward an ICY stream into the decoder channel, stripping the interleaved
// metadata blocks and emitting parsed track titles to the frontend (same wire
// format as pipe_with_icy, but the audio bytes go to the decoder rather than
// straight to the client).
async fn pump_icy_to_channel<R>(
    mut reader: R,
    metaint: usize,
    app: tauri::AppHandle,
    url: String,
    tx: mpsc::Sender<Vec<u8>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = vec![0u8; 16384];
    let mut until_meta = metaint;
    let mut last_title = String::new();
    loop {
        if until_meta > 0 {
            let to_read = buf.len().min(until_meta);
            let n = match reader.read(&mut buf[..to_read]).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            if tx.send(buf[..n].to_vec()).await.is_err() {
                break;
            }
            until_meta -= n;
        } else {
            let mut len_byte = [0u8; 1];
            if reader.read_exact(&mut len_byte).await.is_err() {
                break;
            }
            let meta_len = (len_byte[0] as usize) * 16;
            if meta_len > 0 {
                let mut meta_buf = vec![0u8; meta_len];
                if reader.read_exact(&mut meta_buf).await.is_err() {
                    break;
                }
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
}

// Handle a /pcm request: open the upstream stream, decode it to 48 kHz stereo
// f32 PCM in the background, and stream it to the client preceded by a small
// header ("PCM1" + sample_rate u32le + channels u8). Used by the macOS path.
async fn handle_pcm_client(
    mut client_stream: TcpStream,
    target_url: String,
    app: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Request ICY metadata so live track titles can still be parsed: the feeder
    // strips the metadata blocks out before the audio bytes reach the decoder.
    let (reader, content_type, metaint) = match open_audio_stream(&target_url, 0, false, true).await
    {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[pcm] resolve error for {}: {:?}", target_url, e);
            let _ = client_stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                .await;
            return Ok(());
        }
    };

    // Reader task: forward clean encoded audio to the decoder via a bounded
    // channel, stripping ICY metadata (and emitting track titles) when present.
    let (bytes_tx, bytes_rx) = mpsc::channel::<Vec<u8>>(64);
    let meta_app = app.clone();
    let meta_url = target_url.clone();
    tokio::spawn(async move {
        match metaint {
            Some(mi) if mi > 0 => {
                pump_icy_to_channel(reader, mi, meta_app, meta_url, bytes_tx).await;
            }
            _ => pump_raw_to_channel(reader, bytes_tx).await,
        }
    });

    // Decoder task (blocking): encoded bytes -> PCM.
    let (pcm_tx, mut pcm_rx) = mpsc::channel::<Vec<u8>>(32);
    tokio::task::spawn_blocking(move || decode_to_pcm(bytes_rx, content_type, pcm_tx));

    // Response headers + PCM stream header.
    if let Err(e) = write_proxy_headers(&mut client_stream, "application/octet-stream").await {
        return if is_disconnect(&e) {
            Ok(())
        } else {
            Err(e.into())
        };
    }
    let mut header = Vec::with_capacity(9);
    header.extend_from_slice(b"PCM1");
    header.extend_from_slice(&PCM_OUT_RATE.to_le_bytes());
    header.push(2u8); // channels
    if client_stream.write_all(&header).await.is_err() {
        return Ok(());
    }

    while let Some(chunk) = pcm_rx.recv().await {
        if let Err(e) = client_stream.write_all(&chunk).await {
            return if is_disconnect(&e) {
                Ok(())
            } else {
                Err(e.into())
            };
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

    // Two endpoints: /stream (raw bytes to <audio>) and /pcm (decoded PCM for the
    // macOS AudioWorklet path).
    let uri = parts[1];
    let (is_pcm, prefix_len) = if uri.starts_with("/pcm?url=") {
        (true, 9)
    } else if uri.starts_with("/stream?url=") {
        (false, 12)
    } else {
        client_stream
            .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };

    // Split "url=<encoded>" from any extra query params (e.g. token, raw).
    // The encoded URL never contains a literal '&', so the first '&'
    // marks the start of additional parameters.
    let query = &uri[prefix_len..];
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

    // The PCM path decodes the stream to 48 kHz stereo f32 in the backend.
    if is_pcm {
        return handle_pcm_client(client_stream, target_url, app).await;
    }

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
