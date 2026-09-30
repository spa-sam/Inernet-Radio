// Connection-state indicator and automatic reconnect after a stream drop.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import {
    MAX_RECONNECT, MAX_RECONNECT_LIVE, RECONNECT_BASE_MS, RECONNECT_MAX_MS
} from '../../core/constants.js';
import { applyMarquee } from '../../ui/ui.js';
import { stopVisualization } from '../../services/visualizer.js';
import { updatePlayButton, playStation } from './playback.js';
import { t } from '../../core/i18n.js';

// Show connection / playback status in the now-playing line
// How many reconnects to attempt before giving up, based on whether this
// station has ever actually played (see MAX_RECONNECT_LIVE in constants.js).
function reconnectBudget() {
    return state.hadSuccessfulPlayback ? MAX_RECONNECT_LIVE : MAX_RECONNECT;
}

export function setConnectionState(phase) {
    dom.nowPlayingTrack.classList.remove('status-line', 'status-error');
    if (phase === 'connecting') {
        dom.nowPlayingTrack.textContent = t('⏳ Connecting…');
        dom.nowPlayingTrack.classList.add('status-line');
    } else if (phase === 'buffering') {
        dom.nowPlayingTrack.textContent = t('⏳ Buffering…');
        dom.nowPlayingTrack.classList.add('status-line');
    } else if (phase === 'reconnecting') {
        dom.nowPlayingTrack.textContent =
            t(`🔄 Reconnecting… (${state.reconnectAttempts}/${reconnectBudget()})`);
        dom.nowPlayingTrack.classList.add('status-line');
    } else if (phase === 'error') {
        dom.nowPlayingTrack.textContent = t('⚠ Could not play this station');
        dom.nowPlayingTrack.classList.add('status-error');
    } else if (phase === 'playing') {
        dom.nowPlayingTrack.textContent = state.lastTrackTitle ? '♪ ' + state.lastTrackTitle : '';
    }
    // Scroll the track line if it overflows its card
    applyMarquee(dom.nowPlayingTrack);
}

// Schedule an automatic reconnect after the stream drops
export function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    if (state.reconnectAttempts >= reconnectBudget()) {
        state.wantPlayback = false;
        state.isPlaying = false;
        updatePlayButton();
        stopVisualization();
        setConnectionState('error');
        return;
    }
    state.reconnectAttempts++;
    setConnectionState('reconnecting');
    // Exponential backoff: 2s, 4s, 8s… capped at RECONNECT_MAX_MS.
    const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** (state.reconnectAttempts - 1),
        RECONNECT_MAX_MS
    );
    state.reconnectTimer = setTimeout(() => {
        if (state.wantPlayback && state.currentStation) {
            playStation();
        }
    }, delay);
}

// Handle an unexpected stream interruption
export function handleStreamDrop(reason) {
    if (!state.wantPlayback) return;
    console.warn('Stream interrupted:', reason);
    scheduleReconnect();
}

// Mirror the <audio> element's own stall / resume events in the status line, so
// a stream that stops delivering data shows "Buffering…" instead of silence.
// Only while playback is wanted: a deliberate stop must not flash the status.
export function setupBufferingIndicator() {
    dom.audioPlayer.addEventListener('waiting', () => {
        if (state.wantPlayback && state.isPlaying) setConnectionState('buffering');
    });
    dom.audioPlayer.addEventListener('playing', () => {
        if (state.wantPlayback && state.isPlaying) setConnectionState('playing');
    });
}
