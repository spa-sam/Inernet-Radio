// ui.js — presentation helpers: toasts, marquee, metadata display, layout
// modes (compact / narrow / wide), sleep timer, and the track copy / YouTube
// actions. These functions only touch the DOM and shared state.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { APP_VERSION, COPY_ICON_SVG, CHECK_ICON_SVG } from '../core/constants.js';
import { hasTauriApi } from '../core/util.js';
import { saveSetting } from '../core/db.js';
import { refreshVisualizerSize } from '../services/visualizer.js';
import { stopStation, selectStation } from '../features/player.js';
import { addToTrackHistory } from '../features/stations.js';

// Non-blocking toast notification (replaces native alert)
export function toast(message, type = 'info', duration = 3200) {
    if (!state.toastContainer) {
        state.toastContainer = document.createElement('div');
        state.toastContainer.className = 'toast-container';
        document.body.appendChild(state.toastContainer);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    state.toastContainer.appendChild(el);

    setTimeout(() => {
        el.classList.add('toast-out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
}

// Enable marquee scrolling on an element when its text overflows its parent
export function applyMarquee(el) {
    el.classList.remove('marquee');
    el.style.removeProperty('--marquee-distance');
    requestAnimationFrame(() => {
        const overflow = el.scrollWidth - el.parentElement.clientWidth;
        if (overflow > 4) {
            el.style.setProperty('--marquee-distance', `-${overflow + 12}px`);
            el.classList.add('marquee');
        }
    });
}

export function setStationName(text) {
    dom.stationName.textContent = text;
    applyMarquee(dom.stationName);
}

// Update metadata display
export function updateMetadata(station) {
    const tags = station.tags ? station.tags.split(',')[0].trim() : '';
    if (tags) {
        dom.metaGenre.textContent = tags;
        dom.metaGenre.classList.remove('hidden');
    } else {
        dom.metaGenre.classList.add('hidden');
    }

    if (station.bitrate && station.bitrate > 0) {
        dom.metaBitrate.textContent = station.bitrate + ' kbps';
        dom.metaBitrate.classList.remove('hidden');
    } else {
        dom.metaBitrate.classList.add('hidden');
    }

    if (station.codec) {
        dom.metaCodec.textContent = station.codec;
        dom.metaCodec.classList.remove('hidden');
    } else {
        dom.metaCodec.classList.add('hidden');
    }

    if (station.country) {
        dom.metaCountry.textContent = station.country;
        dom.metaCountry.classList.remove('hidden');
    } else {
        dom.metaCountry.classList.add('hidden');
    }

    // Secondary info lines used by the wide layout
    updateStationDetails(station);
}

// Clear metadata display
export function clearMetadata() {
    dom.metaGenre.classList.add('hidden');
    dom.metaBitrate.classList.add('hidden');
    dom.metaCodec.classList.add('hidden');
    dom.metaCountry.classList.add('hidden');
    dom.nowPlayingTrack.textContent = '';
}

// Fill the secondary info lines (sub-title + stream quality)
export function updateStationDetails(station) {
    if (!station) {
        if (dom.stationSub) dom.stationSub.textContent = '';
        if (dom.transportQuality) dom.transportQuality.textContent = '—';
        return;
    }
    const genre = station.tags ? station.tags.split(',')[0].trim() : '';
    const country = station.country || '';
    if (dom.stationSub) {
        dom.stationSub.textContent = [country, genre].filter(Boolean).join('  ·  ');
    }
    if (dom.transportQuality) {
        const bitrate = station.bitrate && station.bitrate > 0 ? station.bitrate + ' KBPS' : '';
        const codec = station.codec || '';
        dom.transportQuality.textContent = [bitrate, codec].filter(Boolean).join(' · ') || 'LIVE STREAM';
    }
}

// Reflect playing / stopped state on the brand "ON AIR" badge
export function updateBrandStatus() {
    if (!dom.brandStatus) return;
    dom.brandStatus.textContent = `v${APP_VERSION} · ${state.isPlaying ? 'ON AIR' : 'OFF AIR'}`;
}

// Wait until the webview viewport changes after a window resize
function waitForWindowResize(timeout = 250) {
    return new Promise(resolve => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            window.removeEventListener('resize', done);
            resolve();
        };
        window.addEventListener('resize', done);
        setTimeout(done, timeout);
    });
}

// Target window size for the current (non-compact) layout
export function getNormalWindowSize() {
    return state.settings.wideMode
        ? { w: 1180, h: 760, minW: 920, minH: 600 }
        : { w: 500, h: 760, minW: 420, minH: 560 };
}

// Settings: compact widget mode
export async function toggleCompactMode(forceCompact = null) {
    if (forceCompact !== null) {
        state.settings.compactMode = forceCompact;
        dom.compactModeCheckbox.checked = forceCompact;
    } else {
        state.settings.compactMode = dom.compactModeCheckbox.checked;
    }
    saveSetting('compactMode', state.settings.compactMode);

    // The compact widget reuses the wide studio player card; only the
    // header and the search / stations sidebar are hidden (via CSS).
    if (state.settings.compactMode) {
        dom.appContainer.classList.add('compact', 'wide');
    } else {
        dom.appContainer.classList.remove('compact');
        dom.appContainer.classList.toggle('wide', state.settings.wideMode);
    }

    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();

            if (state.settings.compactMode) {
                // Fit the widget height to the player card. Apply the compact
                // width first, wait for the webview to reflow, then shrink the
                // window so its content area matches the card exactly.
                const W = window.__TAURI__.window;
                await appWindow.setMinSize(new W.LogicalSize(380, 420));
                const reflowed = waitForWindowResize();
                await appWindow.setSize(new W.LogicalSize(470, 740));
                await reflowed;
                const cardHeight = dom.playerSection.getBoundingClientRect().height;
                // 32px = .radio-layout padding (1rem top + bottom), +2px guard
                const neededInner = Math.ceil(cardHeight) + 34;
                const delta = neededInner - window.innerHeight;
                if (delta !== 0) {
                    await appWindow.setSize(new W.LogicalSize(470, 740 + delta));
                }
            } else {
                const size = getNormalWindowSize();
                await appWindow.setMinSize(new window.__TAURI__.window.LogicalSize(size.minW, size.minH));
                await appWindow.setSize(new window.__TAURI__.window.LogicalSize(size.w, size.h));
            }
        } catch (e) {
            console.error('Failed to resize window:', e);
        }
    }

    // The player box changed size — refresh the visualizer + name marquee
    refreshVisualizerSize();
    applyMarquee(dom.stationName);
    applyMarquee(dom.nowPlayingTrack);
}

export function enterCompactMode() {
    toggleCompactMode(true);
}

export function exitCompactMode() {
    toggleCompactMode(false);
}

export async function toggleAlwaysOnTop() {
    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();
            state.isAlwaysOnTop = !state.isAlwaysOnTop;
            await appWindow.setAlwaysOnTop(state.isAlwaysOnTop);
            dom.alwaysOnTopBtn.classList.toggle('active', state.isAlwaysOnTop);
        } catch (e) {
            console.error('Failed to toggle always on top:', e);
        }
    }
}

// Apply narrow / wide layout to the UI (and resize the window)
export async function applyViewMode(wide, isInit = false) {
    state.settings.wideMode = wide;
    dom.appContainer.classList.toggle('wide', wide);

    // Sync the header segmented switch and the settings dropdown
    if (dom.viewSwitch) {
        dom.viewSwitch.querySelectorAll('.view-opt').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.view === (wide ? 'wide' : 'narrow'));
        });
    }
    if (dom.viewModeSelect) dom.viewModeSelect.value = wide ? 'wide' : 'narrow';

    if (!isInit) saveSetting('wideMode', wide);

    // Resize the window unless the compact widget is active
    if (hasTauriApi && !state.settings.compactMode) {
        try {
            const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();
            const size = getNormalWindowSize();
            await appWindow.setMinSize(new LogicalSize(size.minW, size.minH));
            // On startup keep the size restored by the window-state plugin;
            // only an explicit narrow/wide switch resets it to the layout default.
            if (!isInit) {
                await appWindow.setSize(new LogicalSize(size.w, size.h));
            }
        } catch (e) {
            console.error('Failed to resize window for view mode:', e);
        }
    }

    // The visualizer canvas changed size — refresh it
    refreshVisualizerSize();
    applyMarquee(dom.stationName);
    applyMarquee(dom.nowPlayingTrack);
}

export function toggleViewMode(wide) {
    if (state.settings.wideMode === wide) return;
    applyViewMode(wide);
}

// Sleep timer: stop playback automatically after the chosen number of minutes
export function startSleepTimer(minutes) {
    cancelSleepTimer();
    if (!minutes || minutes <= 0) return;

    state.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    dom.sleepTimerStatus.classList.remove('hidden');
    updateSleepTimerDisplay();

    state.sleepTimerInterval = setInterval(() => {
        if (Date.now() >= state.sleepTimerEnd) {
            cancelSleepTimer();
            if (state.isPlaying) stopStation();
            toast('Sleep timer: playback stopped', 'info');
        } else {
            updateSleepTimerDisplay();
        }
    }, 1000);

    toast(`Sleep timer: ${minutes} min`, 'success');
}

export function cancelSleepTimer() {
    if (state.sleepTimerInterval) {
        clearInterval(state.sleepTimerInterval);
        state.sleepTimerInterval = null;
    }
    state.sleepTimerEnd = 0;
    if (dom.sleepTimerStatus) dom.sleepTimerStatus.classList.add('hidden');
}

function updateSleepTimerDisplay() {
    if (!dom.sleepTimerRemaining) return;
    const remainingMs = Math.max(0, state.sleepTimerEnd - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    dom.sleepTimerRemaining.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Alarm (wake-to-radio): start playback at a chosen time of day. Repeats daily
// until disabled. The chosen time and enabled flag are persisted, so the alarm
// survives a restart (rescheduled on startup via initAlarm).

// Next future timestamp (ms) for "HH:MM" — today if still ahead, else tomorrow.
function nextAlarmTimestamp(timeStr) {
    const [h, m] = (timeStr || '').split(':').map(n => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
    return target.getTime();
}

// Apply the alarm UI selection: persist it and (re)schedule or cancel.
export function setAlarm(enabled, timeStr) {
    state.settings.alarmEnabled = enabled;
    state.settings.alarmTime = timeStr;
    saveSetting('alarmEnabled', enabled);
    saveSetting('alarmTime', timeStr);
    if (enabled && timeStr) {
        scheduleAlarm();
        toast(`Alarm set for ${timeStr}`, 'success');
    } else {
        cancelAlarm();
    }
}

// Schedule (or reschedule) the alarm from the persisted settings.
export function initAlarm() {
    if (state.settings.alarmEnabled && state.settings.alarmTime) {
        if (dom.alarmTime) dom.alarmTime.value = state.settings.alarmTime;
        if (dom.alarmEnabledCheckbox) dom.alarmEnabledCheckbox.checked = true;
        scheduleAlarm();
    }
}

function scheduleAlarm() {
    cancelAlarm();
    state.alarmTarget = nextAlarmTimestamp(state.settings.alarmTime);
    if (!state.alarmTarget) return;
    if (dom.alarmStatus) dom.alarmStatus.classList.remove('hidden');
    updateAlarmDisplay();
    state.alarmInterval = setInterval(() => {
        if (Date.now() >= state.alarmTarget) {
            triggerAlarm();
        } else {
            updateAlarmDisplay();
        }
    }, 1000);
}

export function cancelAlarm() {
    if (state.alarmInterval) {
        clearInterval(state.alarmInterval);
        state.alarmInterval = null;
    }
    state.alarmTarget = 0;
    if (dom.alarmStatus) dom.alarmStatus.classList.add('hidden');
}

function triggerAlarm() {
    // Begin playback if idle. selectStation updates the now-playing card and
    // starts the stream (which fades the volume in from silence).
    if (!state.isPlaying) {
        const station = state.currentStation || state.lastStation;
        if (station) {
            selectStation(station, null);
            toast('Alarm — playback started', 'success');
        }
    }
    // Roll over to the same time tomorrow so the alarm repeats daily.
    state.alarmTarget = nextAlarmTimestamp(state.settings.alarmTime);
    updateAlarmDisplay();
}

function updateAlarmDisplay() {
    if (!dom.alarmRemaining || !state.alarmTarget) return;
    const totalSeconds = Math.max(0, Math.ceil((state.alarmTarget - Date.now()) / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    dom.alarmRemaining.textContent =
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Copy the current track title (falls back to the station name) to clipboard
export async function copyCurrentTrack() {
    if (!dom.trackCopyBtn) return;
    const trackText = (dom.nowPlayingTrack.textContent || '').replace(/^[\s♪•]+/, '').trim();
    const text = trackText || (state.currentStation ? state.currentStation.name : '');
    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        // Fallback for webviews without async clipboard access
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) { console.error('Copy failed:', e); }
        ta.remove();
    }

    // Save the track to history only on an explicit copy action
    if (trackText) addToTrackHistory(trackText, state.currentStation);

    // Brief "copied" confirmation on the button
    dom.trackCopyBtn.classList.add('copied');
    dom.trackCopyBtn.innerHTML = CHECK_ICON_SVG;
    dom.trackCopyBtn.title = 'Copied';
    clearTimeout(state.copyResetTimer);
    state.copyResetTimer = setTimeout(() => {
        dom.trackCopyBtn.classList.remove('copied');
        dom.trackCopyBtn.innerHTML = COPY_ICON_SVG;
        dom.trackCopyBtn.title = 'Copy track name';
    }, 1400);
}

// Open a YouTube search for an arbitrary query in the default browser
export async function openYouTubeSearch(query) {
    if (!query) return;
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
    try {
        const { invoke } = window.__TAURI__.core;
        await invoke('open_url', { url });
    } catch (e) {
        // Fallback for non-Tauri / restricted contexts
        console.error('Failed to open YouTube:', e);
        window.open(url, '_blank');
    }
}

// Open a YouTube search for the current track in the default browser
export function openTrackOnYouTube() {
    const trackText = (dom.nowPlayingTrack.textContent || '').replace(/^[\s♪•]+/, '').trim();
    const query = trackText || (state.currentStation ? state.currentStation.name : '');
    openYouTubeSearch(query);
}
