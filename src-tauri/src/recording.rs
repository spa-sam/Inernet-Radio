// Stream recording: write upstream audio to disk, optionally splitting into one
// file per track using the ICY StreamTitle, plus the start/stop/is_recording
// commands and the recording-progress event.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::time::timeout;

use crate::metadata::{IcyDemux, IcyEvent};
use crate::proxy::{open_audio_stream, AsyncStream};

// Recording progress pushed to the frontend roughly once per second so the UI
// can show elapsed time and the growing file size.
#[derive(Serialize, Clone)]
struct RecordingProgress {
    seconds: u64,
    bytes: u64,
}

// Tracks the currently active recording. The stop flag is shared with the
// recording task: setting it to true (via stop_recording or natural stream
// end) terminates the write loop. `is_recording` treats a set flag as "done".
#[derive(Default)]
pub(crate) struct RecordingState {
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
        // The insecure-TLS flag is surfaced only on the playback path, not while
        // recording, so it is ignored here.
        Ok((reader, _content_type, metaint, _insecure)) => match (split, metaint) {
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
    let mut demux = IcyDemux::new(metaint);
    let started = std::time::Instant::now();
    let mut total: u64 = 0;
    let mut last_sec = u64::MAX;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        // A 15s timeout guards against a stalled connection.
        match timeout(Duration::from_secs(15), demux.pull(&mut reader, &mut buf)).await {
            Ok(Ok(IcyEvent::Audio(n))) => {
                if file.write_all(&buf[..n]).await.is_err() {
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
                    Ok(f) => file = f,
                    Err(e) => {
                        eprintln!("[rec] cannot create segment: {:?}", e);
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
