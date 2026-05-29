// player.js — playback lifecycle: stream selection, HLS, auto-reconnect,
// volume / fade, ICY metadata polling, OS media session, the live timer,
// and stream recording. Drives the audio element and shared playback state.

import { state } from './state.js';
import { dom } from './dom.js';
import { MAX_RECONNECT } from './constants.js';
import {
    hasTauriApi,
    generatePlaceholderLogo,
    getFaviconFromUrl,
    sanitizeFilename,
    recordingExtension,
    formatTimer
} from './util.js';
import { saveSetting } from './db.js';
import { apiFetch } from './api.js';
import { ensureAudioGraph } from './audio.js';
import { startVisualization, stopVisualization } from './visualizer.js';
import { addToRecentlyPlayed, updateCurrentStationInfo } from './stations.js';
import { setStationName, updateMetadata, applyMarquee, updateBrandStatus, toast } from './ui.js';

// Fetch proxy port from the Rust backend
export async function initProxy() {
    if (!hasTauriApi) return;
    try {
        const { invoke } = window.__TAURI__.core;
        state.proxyPort = await invoke('get_proxy_port');
        console.log('CORS Proxy server running on port:', state.proxyPort);
    } catch (e) {
        console.error('Failed to load proxy port:', e);
    }
}

// Helper to get a proxied stream URL for bypassing CORS. When `raw` is true the
// proxy streams the response verbatim without resolving .pls/.m3u playlists
// (used for HLS manifests served to hls.js).
export function getProxiedUrl(originalUrl, raw) {
    if (state.proxyPort > 0 && originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
        if (originalUrl.includes('localhost') || originalUrl.includes('127.0.0.1')) {
            return originalUrl;
        }
        let proxied = `http://127.0.0.1:${state.proxyPort}/stream?url=${encodeURIComponent(originalUrl)}`;
        if (raw) proxied += '&raw=1';
        return proxied;
    }
    return originalUrl;
}

// --- Volume / fade ----------------------------------------------------------

export function setVolume(volume) {
    // An explicit volume change overrides any running fade animation
    cancelFade();
    volume = Math.max(0, Math.min(100, parseInt(volume) || 0));
    dom.volumeSlider.value = volume;
    dom.audioPlayer.volume = volume / 100;
    // Drive the slider fill gradient and the percentage label
    dom.volumeSlider.style.setProperty('--vol', volume + '%');
    dom.volumeValueLabel.textContent = volume + '%';
    dom.volumeBar.classList.toggle('muted', volume === 0);
}

// The user's chosen volume as a 0..1 gain (independent of any active fade)
function targetVolume() {
    return Math.max(0, Math.min(100, parseInt(dom.volumeSlider.value) || 0)) / 100;
}

function cancelFade() {
    if (state.fadeRAF) {
        cancelAnimationFrame(state.fadeRAF);
        state.fadeRAF = null;
    }
}

// Ramp audioPlayer.volume to `target` (0..1) over FADE_DURATION, then run onDone.
// onDone only fires on natural completion — a superseding fade cancels it.
function fadeTo(target, onDone) {
    cancelFade();
    target = Math.max(0, Math.min(1, target));
    const start = dom.audioPlayer.volume;
    const delta = target - start;
    if (Math.abs(delta) < 0.005) {
        dom.audioPlayer.volume = target;
        if (onDone) onDone();
        return;
    }
    const startTime = performance.now();
    const FADE_DURATION = 600; // ms
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / FADE_DURATION);
        const eased = 1 - Math.pow(1 - t, 2); // ease-out
        dom.audioPlayer.volume = Math.max(0, Math.min(1, start + delta * eased));
        if (t < 1) {
            state.fadeRAF = requestAnimationFrame(step);
        } else {
            state.fadeRAF = null;
            dom.audioPlayer.volume = target;
            if (onDone) onDone();
        }
    };
    state.fadeRAF = requestAnimationFrame(step);
}

export function toggleMute() {
    const current = parseInt(dom.volumeSlider.value);
    if (current > 0) {
        state.lastVolumeBeforeMute = current;
        setVolume(0);
    } else {
        setVolume(state.lastVolumeBeforeMute > 0 ? state.lastVolumeBeforeMute : 70);
    }
}

// --- Connection state / reconnect -------------------------------------------

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
function scheduleReconnect() {
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

// --- ICY metadata polling ---------------------------------------------------

async function fetchStreamMetadata(url) {
    if (!hasTauriApi) return;

    try {
        const { invoke } = window.__TAURI__.core;
        const metadata = await invoke('get_stream_metadata', { url });

        if (metadata && metadata.title) {
            const cleanTitle = metadata.title.trim();
            dom.nowPlayingTrack.textContent = '♪ ' + cleanTitle;
            applyMarquee(dom.nowPlayingTrack);
            showSongNotification(state.currentStation.name, cleanTitle);
            updateMediaSession(cleanTitle);
        }
    } catch (error) {
        console.error('Metadata fetch error:', error);
    }
}

function startMetadataPolling() {
    stopMetadataPolling();

    if (state.currentStation && hasTauriApi) {
        const streamUrl = state.currentStation.url_resolved || state.currentStation.url;
        fetchStreamMetadata(streamUrl);

        state.metadataInterval = setInterval(() => {
            if (state.isPlaying && state.currentStation) {
                fetchStreamMetadata(streamUrl);
            }
        }, 10000);
    }
}

function stopMetadataPolling() {
    if (state.metadataInterval) {
        clearInterval(state.metadataInterval);
        state.metadataInterval = null;
    }
}

// --- OS media session / notifications ---------------------------------------

// Wire OS-level media controls (media keys, lock screen, system widget)
export function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => { if (state.currentStation) playStation(); });
    ms.setActionHandler('pause', stopStation);
    ms.setActionHandler('stop', stopStation);
    ms.setActionHandler('previoustrack', prevStation);
    ms.setActionHandler('nexttrack', nextStation);
}

// Update the metadata shown by the OS media controls
function updateMediaSession(trackTitle) {
    if (!('mediaSession' in navigator) || !state.currentStation) return;
    const artwork = state.currentStation.favicon || generatePlaceholderLogo(state.currentStation.name);
    navigator.mediaSession.metadata = new MediaMetadata({
        title: trackTitle || state.currentStation.name,
        artist: trackTitle ? state.currentStation.name : (state.currentStation.country || 'Internet Radio'),
        album: 'Internet Radio',
        artwork: [{ src: artwork, sizes: '512x512', type: artwork.startsWith('data:') ? 'image/svg+xml' : 'image/png' }]
    });
}

export function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
}

function showSongNotification(stationName, trackTitle) {
    if ('Notification' in window && Notification.permission === 'granted') {
        if (trackTitle && trackTitle !== state.lastTrackTitle) {
            state.lastTrackTitle = trackTitle;
            new Notification(stationName, {
                body: `Now playing: ${trackTitle}`,
                icon: state.currentStation.favicon || generatePlaceholderLogo(stationName),
                silent: true
            });
        }
    }
}

// --- Playback ---------------------------------------------------------------

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

    // Tear down any previous HLS instance before switching streams
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }

    const streamUrl = state.currentStation.url_resolved || state.currentStation.url;

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
        const { searchStations } = await import('./stations.js');
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
    if (uuid.startsWith('custom_') || uuid.startsWith('preview_') || uuid.startsWith('somafm_')) return;

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
    const logoSrc = station.favicon || generatePlaceholderLogo(station.name);
    if (station.favicon) {
        dom.stationLogo.src = station.favicon;
        dom.stationLogo.onerror = function() {
            this.src = generatePlaceholderLogo(station.name);
            this.onerror = null;
        };
    } else {
        dom.stationLogo.src = logoSrc;
    }
    if (dom.trackCardThumb) dom.trackCardThumb.style.backgroundImage = `url("${logoSrc}")`;

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
    if (favicon) {
        dom.stationLogo.src = favicon;
        dom.stationLogo.onerror = function() {
            this.src = generatePlaceholderLogo(name);
            this.onerror = null;
        };
    } else {
        dom.stationLogo.src = generatePlaceholderLogo(name);
    }

    updateCurrentStationInfo();

    // Tear down any previous HLS instance
    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }

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

// --- Stream recording -------------------------------------------------------

export async function toggleRecording() {
    if (!hasTauriApi) {
        toast('Recording is only available in the desktop app', 'error');
        return;
    }
    if (state.isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if (!state.currentStation) {
        toast('Start playing a station first', 'error');
        return;
    }
    const { invoke } = window.__TAURI__.core;
    const { save } = window.__TAURI__.dialog;

    const ext = recordingExtension(state.currentStation);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const defaultName = `${sanitizeFilename(state.currentStation.name)}_${stamp}.${ext}`;

    try {
        const path = await save({
            defaultPath: defaultName,
            filters: [{ name: 'Audio', extensions: [ext] }]
        });
        if (!path) return;

        const url = state.currentStation.url_resolved || state.currentStation.url;
        await invoke('start_recording', { url, path });
        state.isRecording = true;
        updateRecordButton();
        toast('Recording started', 'info');
    } catch (error) {
        console.error('Recording start error:', error);
        toast('Recording failed: ' + (error && error.message ? error.message : error), 'error');
    }
}

async function stopRecording() {
    const { invoke } = window.__TAURI__.core;
    try {
        await invoke('stop_recording');
    } catch (error) {
        console.error('Recording stop error:', error);
    }
    state.isRecording = false;
    updateRecordButton();
    toast('Recording saved', 'info');
}

function updateRecordButton() {
    if (!dom.recordBtn) return;
    dom.recordBtn.classList.toggle('recording', state.isRecording);
    dom.recordBtn.title = state.isRecording ? 'Stop recording' : 'Record stream';
}
