// Stream recording: write upstream audio to disk, optionally splitting into one
// file per track using the ICY StreamTitle, plus the start/stop/is_recording
// commands and the recording-progress event.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::time::timeout;

use crate::metadata::{IcyDemux, IcyEvent};
use crate::proxy::{open_audio_stream, read_budget, AsyncStream};

// Recording progress pushed to the frontend roughly once per second so the UI
// can show elapsed time and the growing file size.
#[derive(Serialize, Clone)]
struct RecordingProgress {
    seconds: u64,
    bytes: u64,
}

// Emitted when a recording cannot start or dies early. start_recording returns
// as soon as the task is spawned, so without this the UI would keep showing a
// REC indicator for a recording that never wrote a byte.
#[derive(Serialize, Clone)]
struct RecordingError {
    message: String,
}

fn emit_recording_error(app: &tauri::AppHandle, message: impl Into<String>) {
    let message = message.into();
    eprintln!("[rec] {}", message);
    let _ = app.emit("recording-error", RecordingError { message });
}

// Tracks the currently active recording. The stop flag is shared with the
// recording task: setting it to true (via stop_recording or natural stream
// end) terminates the write loop. `is_recording` treats a set flag as "done".
#[derive(Default)]
pub(crate) struct RecordingState {
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

// File extensions a recording may be written to. The frontend picks one from
// the codec; anything else (.exe, .lnk, .bat, a startup script …) is refused so
// a compromised webview cannot use "record" as an arbitrary-file-write
// primitive with attacker-chosen stream bytes.
const RECORDING_EXTENSIONS: [&str; 4] = ["mp3", "aac", "ogg", "flac"];

fn validate_record_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err("recording path must be absolute".into());
    }
    let ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| RECORDING_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err("recordings must use an audio file extension (mp3, aac, ogg, flac)".into())
    }
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
        // The insecure-TLS flag is surfaced only on the playback path, not while
        // recording, so it is ignored here.
        Ok((reader, _content_type, metaint, _insecure)) => match (split, metaint) {
            (true, Some(mi)) if mi > 0 => record_split(&app, reader, mi, &path, &stop).await,
            // No ICY metadata available: fall back to a single continuous file.
            _ => record_single(&app, reader, &path, &stop).await,
        },
        Err(e) => emit_recording_error(&app, format!("Cannot open stream: {}", e)),
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
    // Buffered so each network chunk (often much smaller than the 16 KiB
    // scratch buffer) doesn't turn into its own dispatch to tokio's blocking
    // file-IO thread pool; writes now coalesce into 64 KiB flushes.
    let mut file = match tokio::fs::File::create(path).await {
        Ok(f) => BufWriter::with_capacity(64 * 1024, f),
        Err(e) => {
            emit_recording_error(app, format!("Cannot create {}: {}", path, e));
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
        match timeout(read_budget(total > 0), reader.read(&mut buf)).await {
            Ok(Ok(0)) => break, // stream ended
            Ok(Ok(n)) => {
                if let Err(e) = file.write_all(&buf[..n]).await {
                    emit_recording_error(app, format!("Write failed: {}", e));
                    break;
                }
                total += n as u64;
                emit_recording_progress(app, &started, total, &mut last_sec);
            }
            Ok(Err(e)) => {
                emit_recording_error(app, format!("Stream read failed: {}", e));
                break;
            }
            Err(_) => break, // stalled stream
        }
    }
    let _ = file.flush().await;
    if total == 0 {
        emit_recording_error(app, "Stream produced no data");
    }
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
        Ok(f) => BufWriter::with_capacity(64 * 1024, f),
        Err(e) => {
            emit_recording_error(app, format!("Cannot create recording segment: {}", e));
            return;
        }
    };
    let mut buf = vec![0u8; 16384];
    let mut demux = IcyDemux::new(metaint);
    let started = std::time::Instant::now();
    let mut total: u64 = 0;
    let mut last_sec = u64::MAX;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        // Guards against a stalled connection; the budget widens once bytes
        // land, since from then on a slow disk can hold up the loop too.
        match timeout(read_budget(total > 0), demux.pull(&mut reader, &mut buf)).await {
            Ok(Ok(IcyEvent::Audio(n))) => {
                if let Err(e) = file.write_all(&buf[..n]).await {
                    emit_recording_error(app, format!("Write failed: {}", e));
                    break;
                }
                total += n as u64;
                emit_recording_progress(app, &started, total, &mut last_sec);
            }
            Ok(Ok(IcyEvent::Title(Some(title)))) => {
                // Finish the current segment and open one for the new track.
                let _ = file.flush().await;
                index += 1;
                match tokio::fs::File::create(segment_path(base, index, Some(&title))).await {
                    Ok(f) => file = BufWriter::with_capacity(64 * 1024, f),
                    Err(e) => {
                        emit_recording_error(app, format!("Cannot create segment: {}", e));
                        break;
                    }
                }
            }
            Ok(Ok(IcyEvent::Title(None))) => {}
            // End of stream, read error, or a stalled connection: stop.
            Ok(Ok(IcyEvent::End)) | Ok(Err(_)) | Err(_) => break,
        }
    }
    let _ = file.flush().await;
    if total == 0 {
        emit_recording_error(app, "Stream produced no data");
    }
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
pub(crate) fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecordingState>,
    url: String,
    path: String,
    split: bool,
) -> Result<(), String> {
    validate_record_path(&path)?;
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
pub(crate) fn stop_recording(state: tauri::State<'_, RecordingState>) {
    if let Ok(mut guard) = state.stop.lock() {
        if let Some(flag) = guard.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub(crate) fn is_recording(state: tauri::State<'_, RecordingState>) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_path_needs_an_absolute_audio_path() {
        #[cfg(windows)]
        let (abs, other) = ("C:\\rec\\a.mp3", "C:\\rec\\a.exe");
        #[cfg(not(windows))]
        let (abs, other) = ("/tmp/rec/a.mp3", "/tmp/rec/a.exe");
        assert!(validate_record_path(abs).is_ok());
        assert!(validate_record_path(&abs.to_uppercase()).is_ok());
        assert!(validate_record_path(other).is_err());
        assert!(validate_record_path("a.mp3").is_err());
        assert!(validate_record_path("../a.mp3").is_err());
        assert!(validate_record_path("").is_err());
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
}
