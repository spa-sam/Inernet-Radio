// ICY metadata: a one-shot fetch at connect for instant feedback, live track
// titles delivered via the proxy's `stream-metadata` events, and the
// `recording-progress` listener that drives the REC indicator.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { hasTauriApi, formatTimer } from '../../core/util.js';
import { applyMarquee, updateInsecureBadge, toast } from '../../ui/ui.js';
import { showSongNotification, updateMediaSession } from './mediaSession.js';
import { abortRecording } from './recording.js';

// Display a freshly parsed track title and record it as the current one.
// state.lastTrackTitle must be updated here rather than as a side effect of
// showSongNotification: without notification permission it stayed empty, and
// setConnectionState('playing') — which fires after every rebuffer — then wiped
// the visible title until the next ICY metadata block arrived.
function showTrackTitle(title) {
    if (!title) return;
    dom.nowPlayingTrack.textContent = '♪ ' + title;
    dom.nowPlayingTrack.classList.remove('status-line', 'status-error');
    applyMarquee(dom.nowPlayingTrack);
    const stationName = state.currentStation ? state.currentStation.name : '';
    showSongNotification(stationName, title);
    state.lastTrackTitle = title;
    updateMediaSession(title);
}

async function fetchStreamMetadata(url) {
    if (!hasTauriApi) return;

    try {
        const { invoke } = window.__TAURI__.core;
        const metadata = await invoke('get_stream_metadata', { url });

        if (metadata && metadata.title) {
            showTrackTitle(metadata.title.trim());
        }
    } catch (error) {
        console.error('Metadata fetch error:', error);
    }
}

// Fetch the title once at connect for instant feedback. Subsequent updates
// arrive via the proxy's `stream-metadata` events (see setupStreamMetadataListener),
// so there is no repeating poll opening its own connection.
export function fetchInitialMetadata() {
    if (state.currentStation && hasTauriApi) {
        const streamUrl = state.currentStation.url_resolved || state.currentStation.url;
        fetchStreamMetadata(streamUrl);
    }
}

// Register backend event listeners once at startup:
//  - `stream-metadata`: live track titles parsed out of the playback stream by
//    the Rust proxy. Events carry the originating stream URL so titles from a
//    connection the user has switched away from are ignored.
//  - `recording-progress`: elapsed time and bytes written for the active
//    recording, used to drive the REC indicator.
//  - `stream-insecure`: the current stream's TLS certificate could not be
//    validated; the proxy connected anyway, so flag it in the UI.
export async function setupStreamMetadataListener() {
    if (!hasTauriApi || !window.__TAURI__.event) return;
    try {
        const { listen } = window.__TAURI__.event;
        await listen('stream-metadata', (event) => {
            const payload = event.payload || {};
            if (!state.isPlaying || !state.currentStation) return;
            const current = state.currentStation.url_resolved || state.currentStation.url;
            if (payload.url && current && payload.url !== current) return;
            showTrackTitle((payload.title || '').trim());
        });
        await listen('stream-insecure', (event) => {
            if (!state.isPlaying || !state.currentStation) return;
            const url = event.payload;
            const current = state.currentStation.url_resolved || state.currentStation.url;
            if (url && current && url !== current) return;
            // Notify once per connection (the flag is reset on each play).
            if (!state.insecureStream) {
                state.insecureStream = true;
                updateInsecureBadge();
                toast('Insecure connection: TLS certificate not verified', 'error');
            }
        });
        // The backend spawns the recording task and returns immediately, so a
        // failure to open the stream or create the file surfaces here rather
        // than from the start_recording call itself.
        await listen('recording-error', (event) => {
            const message = (event.payload && event.payload.message) || 'Recording failed';
            toast('Recording failed: ' + message, 'error');
            abortRecording();
        });
        await listen('recording-progress', (event) => {
            if (!state.isRecording) return;
            const { seconds = 0, bytes = 0 } = event.payload || {};
            const mb = (bytes / (1024 * 1024)).toFixed(1);
            const text = `REC ${formatTimer(seconds)} · ${mb} MB`;
            // The detailed indicator lives in the wide-view transport panel;
            // mirror it on the button title so narrow/mini views see it too.
            if (dom.recStatusText) dom.recStatusText.textContent = text;
            if (dom.recordBtn) dom.recordBtn.title = `Stop recording — ${text}`;
        });
    } catch (e) {
        console.error('Failed to set up metadata listener:', e);
    }
}
