// Core playback engine: HLS handling, station selection, play/stop with fade,
// next/prev navigation, custom-URL preview, the live timer, and the play button.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { getFaviconFromUrl, formatTimer, isWebKit } from '../../core/util.js';
import { applyLogo, resolveLogoSrc } from '../../core/favicon.js';
import { saveSetting } from '../../core/db.js';
import { apiFetch } from '../../services/api.js';
import {
    ensureAudioGraph, prepareAudioGraph,
    ensurePcmWorklet, connectPcmWorklet, disconnectPcmWorklet
} from '../../services/audio.js';
import { startVisualization, stopVisualization } from '../../services/visualizer.js';
import { addToRecentlyPlayed, updateCurrentStationInfo } from '../stations.js';
import { setStationName, updateMetadata, updateBrandStatus, toast } from '../../ui/ui.js';
import { getProxiedUrl, getProxyPcmUrl } from './proxy.js';
import { fadeTo, targetVolume, cancelFade } from './volume.js';
import { setConnectionState, scheduleReconnect, handleStreamDrop } from './connection.js';
import { startMetadataPolling, stopMetadataPolling } from './metadata.js';
import { updateMediaSession } from './mediaSession.js';
import { stopRecording } from './recording.js';

// Shared playback success / error handlers
function onPlaySuccess() {
    state.isPlaying = true;
    state.reconnectAttempts = 0;
    clearTimeout(state.reconnectTimer);
    // Fade the audio in from silence to the user's chosen volume
    fadeTo(targetVolume());
    updatePlayButton();
    startMetadataPolling();
    // Build the audio graph (and resume it) so the equalizer applies even
    // when the visualizer is disabled.
    ensureAudioGraph();
    if (state.audioContext && state.audioContext.state === 'suspended') state.audioContext.resume();
    startVisualization();
    startLiveTimer();
    addToRecentlyPlayed(state.currentStation);
    reportStationClick(state.currentStation);
    updateMediaSession();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
}

function onPlayError(error) {
    console.error('Play error:', error);
    if (state.wantPlayback) {
        scheduleReconnect();
    } else {
        state.isPlaying = false;
        updatePlayButton();
    }
}

// Detect HLS streams (Radio Browser sets hls=1, or URL ends with .m3u8)
function isHlsStream(station, url) {
    if (station && station.hls === 1) return true;
    const path = (url || '').split(/[?#]/)[0].toLowerCase();
    return path.endsWith('.m3u8');
}

// Build a hls.js loader that routes every request through the local CORS proxy
function getProxyHlsLoader() {
    if (state.proxyHlsLoader) return state.proxyHlsLoader;
    const BaseLoader = Hls.DefaultConfig.loader;
    state.proxyHlsLoader = class ProxyHlsLoader extends BaseLoader {
        load(context, config, callbacks) {
            const realUrl = context.url;
            const wrapped = Object.assign({}, callbacks, {
                onSuccess: (response, stats, ctx, networkDetails) => {
                    // Restore the real URL so hls.js resolves relative URIs correctly
                    if (response) response.url = realUrl;
                    if (ctx) ctx.url = realUrl;
                    callbacks.onSuccess(response, stats, ctx, networkDetails);
                }
            });
            context.url = getProxiedUrl(realUrl, true);
            super.load(context, config, wrapped);
        }
    };
    return state.proxyHlsLoader;
}

// Play an HLS (.m3u8) stream through hls.js
function playHlsStation(url, onSuccess, onError) {
    onSuccess = onSuccess || onPlaySuccess;
    onError = onError || onPlayError;

    if (typeof Hls === 'undefined') {
        onError(new Error('hls.js not loaded (missing src/hls.min.js)'));
        return;
    }

    if (Hls.isSupported()) {
        // Ensure the source node taps the element before MSE attaches, so the
        // EQ chain stays in the path on WebKit.
        prepareAudioGraph();
        state.hls = new Hls({
            enableWorker: false,
            loader: getProxyHlsLoader()
        });
        state.hls.loadSource(url);
        state.hls.attachMedia(dom.audioPlayer);
        state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            dom.audioPlayer.play().then(onSuccess).catch(onError);
        });
        state.hls.on(Hls.Events.ERROR, (evt, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                state.hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                state.hls.recoverMediaError();
            } else {
                onError(new Error('HLS: ' + data.details));
            }
        });
    } else if (dom.audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (e.g. Safari)
        dom.audioPlayer.src = getProxiedUrl(url);
        dom.audioPlayer.play().then(onSuccess).catch(onError);
    } else {
        onError(new Error('HLS is not supported'));
    }
}

// Whether to use the Rust-decoded PCM + AudioWorklet path. Needed on macOS
// (WebKit) for plain streams, where a network <audio> element does not feed the
// Web Audio graph, so the EQ/visualizer would otherwise be dead. HLS keeps the
// hls.js (MSE) path; Chromium keeps the simpler <audio> path.
function shouldUsePcmPath(station, url) {
    return isWebKit && state.proxyPort > 0 && !isHlsStream(station, url);
}

// Abort the in-flight PCM fetch and detach the worklet source.
function teardownPcm() {
    if (state.pcmAbort) {
        try { state.pcmAbort.abort(); } catch { /* noop */ }
        state.pcmAbort = null;
    }
    disconnectPcmWorklet();
}

// Read the /pcm response: parse the small header, then forward interleaved
// stereo f32 frames to the worklet. Calls onSuccess once audio starts flowing
// and triggers a reconnect when the stream ends or errors.
async function pumpPcm(reader, node, abort, onSuccess) {
    let headerParsed = false;
    let started = false;
    let carry = new Uint8Array(0);
    const FRAME_BYTES = 8; // stereo: 2 × f32

    const concat = (a, b) => {
        const c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            let buf = value && value.length ? concat(carry, value) : carry;

            if (!headerParsed) {
                if (buf.length < 9) { carry = buf; continue; }
                // Header: "PCM1" + sampleRate u32le + channels u8. We always
                // resample to 48 kHz stereo, so the values are informational.
                headerParsed = true;
                buf = buf.subarray(9);
            }

            const usable = buf.length - (buf.length % FRAME_BYTES);
            if (usable > 0) {
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable);
                const samples = new Float32Array(ab); // host is little-endian
                node.port.postMessage({ type: 'pcm', samples }, [samples.buffer]);
                carry = buf.slice(usable);
                if (!started) { started = true; onSuccess(); }
            } else {
                carry = buf.slice();
            }
        }
        // Upstream ended — treat as a drop so the reconnect logic kicks in.
        if (state.wantPlayback && !abort.signal.aborted) handleStreamDrop('pcm stream ended');
    } catch (e) {
        if (e.name === 'AbortError' || abort.signal.aborted) return;
        onPlayError(e);
    }
}

// Play a plain stream via the Rust /pcm endpoint + AudioWorklet (macOS path).
async function playPcmStation(url, onSuccess, onError) {
    onSuccess = onSuccess || onPlaySuccess;
    onError = onError || onPlayError;
    try {
        await ensurePcmWorklet();
        if (state.audioContext.state === 'suspended') await state.audioContext.resume();

        const node = connectPcmWorklet();
        state.workletActive = true;
        // Start silent on the master gain so playback can fade in.
        cancelFade();
        if (state.masterGain) state.masterGain.gain.value = 0;

        const abort = new AbortController();
        state.pcmAbort = abort;
        const resp = await fetch(getProxyPcmUrl(url), { signal: abort.signal });
        if (!resp.ok || !resp.body) throw new Error('PCM HTTP ' + resp.status);

        pumpPcm(resp.body.getReader(), node, abort, onSuccess);
    } catch (e) {
        if (e.name === 'AbortError') return;
        onError(e);
    }
}

// Play current station
export function playStation() {
    if (!state.currentStation) return;

    // Stop any active recording when switching to a new station
    if (state.isRecording) stopRecording();

    state.wantPlayback = true;
    state.lastTrackTitle = '';
    clearTimeout(state.reconnectTimer);
    setConnectionState('connecting');

    // Start silent so playback can fade in once the stream begins
    cancelFade();
    dom.audioPlayer.volume = 0;

    // Tear down any previous HLS instance / PCM stream before switching
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }
    teardownPcm();

    const streamUrl = state.currentStation.url_resolved || state.currentStation.url;

    if (shouldUsePcmPath(state.currentStation, streamUrl)) {
        playPcmStation(streamUrl);
        return;
    }

    // Build/resume the audio graph before play() so the EQ chain is in the
    // signal path on WebKit (macOS), not bypassed. We are still inside the
    // user-gesture call stack that led here, so resume() is honoured.
    prepareAudioGraph();

    if (isHlsStream(state.currentStation, streamUrl)) {
        playHlsStation(streamUrl);
    } else {
        // Route stream URL through local CORS proxy
        dom.audioPlayer.src = getProxiedUrl(streamUrl);
        dom.audioPlayer.play().then(onPlaySuccess).catch(onPlayError);
    }
}

// Stop playback
export function stopStation() {
    state.wantPlayback = false;
    state.reconnectAttempts = 0;
    clearTimeout(state.reconnectTimer);
    stopMetadataPolling();
    if (state.isRecording) stopRecording();

    // Cut the stream and tear everything down once the fade-out finishes
    const finalize = () => {
        dom.audioPlayer.pause();
        if (state.hls) {
            state.hls.destroy();
            state.hls = null;
        }
        teardownPcm();
        dom.audioPlayer.src = '';
        // Leave the element at the user's level for the next play
        dom.audioPlayer.volume = targetVolume();
        stopVisualization();
    };

    state.isPlaying = false;
    updatePlayButton();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    stopLiveTimer();
    dom.nowPlayingTrack.textContent = '';
    dom.nowPlayingTrack.classList.remove('marquee');
    if (dom.previewBtn) {
        dom.previewBtn.textContent = 'Preview';
    }

    // Smoothly fade the audio out before stopping (visualizer keeps animating)
    fadeTo(0, finalize);
}

// Toggle play/pause
export async function togglePlay() {
    if (state.isPlaying) {
        stopStation();
    } else if (state.currentStation) {
        playStation();
    } else {
        // Lazy import avoids a load-time cycle with stations.js
        const { searchStations } = await import('../stations.js');
        await searchStations('', 'pop');
        if (state.currentStationsList.length > 0) {
            const firstItem = document.querySelector('.station-item');
            selectStation(state.currentStationsList[0], firstItem);
        }
    }
}

// Update play button appearance
export function updatePlayButton() {
    if (state.isPlaying) {
        dom.playIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z" fill="currentColor"/></svg>`;
        dom.playBtn.classList.add('playing');
    } else {
        dom.playIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
        dom.playBtn.classList.remove('playing');
    }
    // Drive the LIVE badges and the "ON AIR" indicator
    dom.appContainer.classList.toggle('playing', state.isPlaying);
    updateBrandStatus();
}

// Report a play to Radio Browser (improves their click/popularity stats).
// Only catalog stations have a real UUID; skip custom/preview/somafm entries.
function reportStationClick(station) {
    if (!station || !station.stationuuid) return;
    const uuid = station.stationuuid;
    if (uuid.startsWith('custom_') || uuid.startsWith('preview_') ||
        uuid.startsWith('somafm_') || uuid.startsWith('m3u_')) return;

    apiFetch(`/url/${uuid}`).catch(e => console.warn('Click report failed:', e.message));
}

// Select and play a station
export function selectStation(station, itemElement) {
    state.currentStation = station;
    state.lastStation = station;
    saveSetting('lastStation', station);

    setStationName(station.name);
    updateMetadata(station);
    updateCurrentStationInfo();

    dom.stationLogo.classList.remove('hidden');
    applyLogo(dom.stationLogo, station);
    if (dom.trackCardThumb) dom.trackCardThumb.style.backgroundImage = `url("${resolveLogoSrc(station)}")`;

    document.querySelectorAll('.station-item').forEach(item => {
        item.classList.remove('active');
    });
    if (itemElement) itemElement.classList.add('active');

    // Also update active in recently played items
    document.querySelectorAll('.recent-item').forEach(item => {
        item.classList.remove('active');
    });

    playStation();
}

// Navigate to next station
export function nextStation() {
    if (state.currentStationsList.length === 0) return;

    state.currentStationIndex = (state.currentStationIndex + 1) % state.currentStationsList.length;
    const station = state.currentStationsList[state.currentStationIndex];
    const items = dom.stationsList.querySelectorAll('.station-item');

    if (items[state.currentStationIndex]) {
        selectStation(station, items[state.currentStationIndex]);
    }
}

// Navigate to previous station
export function prevStation() {
    if (state.currentStationsList.length === 0) return;

    state.currentStationIndex = state.currentStationIndex <= 0
        ? state.currentStationsList.length - 1
        : state.currentStationIndex - 1;
    const station = state.currentStationsList[state.currentStationIndex];
    const items = dom.stationsList.querySelectorAll('.station-item');

    if (items[state.currentStationIndex]) {
        selectStation(station, items[state.currentStationIndex]);
    }
}

// Preview a custom station URL (test playback from the Custom tab)
export function previewCustomUrl() {
    if (state.isPlaying && state.currentStation && state.currentStation.stationuuid &&
        state.currentStation.stationuuid.startsWith('preview_')) {
        stopStation();
        dom.previewBtn.textContent = 'Preview';
        return;
    }

    const url = dom.customUrlInput.value.trim();
    if (!url) {
        toast('Enter a stream URL', 'error');
        return;
    }

    const name = dom.customNameInput.value.trim() || 'Preview';
    const favicon = getFaviconFromUrl(url);

    const tempStation = {
        stationuuid: 'preview_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: dom.customGenreInput.value.trim(),
        country: 'Preview',
        favicon: favicon
    };

    state.currentStation = tempStation;
    setStationName(name + ' (Test)');

    dom.stationLogo.classList.remove('hidden');
    applyLogo(dom.stationLogo, tempStation);

    updateCurrentStationInfo();

    // Tear down any previous HLS instance / PCM stream
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }
    teardownPcm();

    // Start silent so the preview can fade in
    cancelFade();
    dom.audioPlayer.volume = 0;

    const onPreviewOk = () => {
        state.isPlaying = true;
        fadeTo(targetVolume());
        updatePlayButton();
        ensureAudioGraph();
        if (state.audioContext && state.audioContext.state === 'suspended') state.audioContext.resume();
        startVisualization();
        dom.previewBtn.textContent = 'Stop';
    };
    const onPreviewError = (error) => {
        console.error('Preview error:', error);
        toast('Failed to play URL: ' + (error && error.message ? error.message : error), 'error');
        state.isPlaying = false;
        updatePlayButton();
        dom.previewBtn.textContent = 'Preview';
    };

    if (shouldUsePcmPath(tempStation, url)) {
        playPcmStation(url, onPreviewOk, onPreviewError);
        return;
    }

    prepareAudioGraph();

    if (isHlsStream(tempStation, url)) {
        playHlsStation(url, onPreviewOk, onPreviewError);
    } else {
        dom.audioPlayer.src = getProxiedUrl(url);
        dom.audioPlayer.play().then(onPreviewOk).catch(onPreviewError);
    }
}

// --- Live timer -------------------------------------------------------------

function startLiveTimer() {
    stopLiveTimer();
    state.liveTimerSeconds = 0;
    if (dom.liveTimer) dom.liveTimer.textContent = formatTimer(0);
    state.liveTimerInterval = setInterval(() => {
        state.liveTimerSeconds++;
        if (dom.liveTimer) dom.liveTimer.textContent = formatTimer(state.liveTimerSeconds);
    }, 1000);
}

function stopLiveTimer() {
    if (state.liveTimerInterval) {
        clearInterval(state.liveTimerInterval);
        state.liveTimerInterval = null;
    }
}
