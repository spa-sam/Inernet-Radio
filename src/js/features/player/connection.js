// Connection-state indicator and automatic reconnect after a stream drop.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { MAX_RECONNECT } from '../../core/constants.js';
import { applyMarquee } from '../../ui/ui.js';
import { stopVisualization } from '../../services/visualizer.js';
import { updatePlayButton, playStation } from './playback.js';
import { stopMetadataPolling } from './metadata.js';

// Show connection / playback status in the now-playing line
export function setConnectionState(phase) {
    dom.nowPlayingTrack.classList.remove('status-line', 'status-error');
    if (phase === 'connecting') {
        dom.nowPlayingTrack.textContent = '⏳ Connecting…';
        dom.nowPlayingTrack.classList.add('status-line');
    } else if (phase === 'buffering') {
        dom.nowPlayingTrack.textContent = '⏳ Buffering…';
        dom.nowPlayingTrack.classList.add('status-line');
    } else if (phase === 'reconnecting') {
        dom.nowPlayingTrack.textContent = `🔄 Reconnecting… (${state.reconnectAttempts}/${MAX_RECONNECT})`;
        dom.nowPlayingTrack.classList.add('status-line');
    } else if (phase === 'error') {
        dom.nowPlayingTrack.textContent = '⚠ Could not play this station';
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
    if (state.reconnectAttempts >= MAX_RECONNECT) {
        state.wantPlayback = false;
        state.isPlaying = false;
        updatePlayButton();
        stopVisualization();
        setConnectionState('error');
        return;
    }
    state.reconnectAttempts++;
    setConnectionState('reconnecting');
    state.reconnectTimer = setTimeout(() => {
        if (state.wantPlayback && state.currentStation) {
            playStation();
        }
    }, 2500);
}

// Handle an unexpected stream interruption
export function handleStreamDrop(reason) {
    if (!state.wantPlayback) return;
    console.warn('Stream interrupted:', reason);
    stopMetadataPolling();
    scheduleReconnect();
}
