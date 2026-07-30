// ui.js — presentation helpers: toasts, marquee, metadata display, layout
// modes (compact / narrow / wide), sleep timer, and the track copy / YouTube
// actions. These functions only touch the DOM and shared state.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { COPY_ICON_SVG, CHECK_ICON_SVG } from '../core/constants.js';
import { hasTauriApi } from '../core/util.js';
import { saveSetting } from '../core/db.js';
import { refreshVisualizerSize } from '../services/visualizer.js';
import { stopStation, selectStation } from '../features/player.js';
import { addToTrackHistory } from '../features/stations.js';

// Non-blocking toast notification (replaces native alert). `action`, when
// given as { label, onClick }, adds a button (e.g. "Undo") that runs onClick
// and dismisses the toast immediately instead of waiting out the timer.
export function toast(message, type = 'info', duration = 3200, action = null) {
    if (!state.toastContainer) {
        state.toastContainer = document.createElement('div');
        state.toastContainer.className = 'toast-container';
        // Announce toasts to screen readers. Polite, not assertive: these are
        // status messages and must not interrupt what is being read.
        state.toastContainer.setAttribute('role', 'status');
        state.toastContainer.setAttribute('aria-live', 'polite');
        document.body.appendChild(state.toastContainer);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    el.appendChild(text);

    let dismissTimer = null;
    const dismiss = () => {
        if (dismissTimer) clearTimeout(dismissTimer);
        el.classList.add('toast-out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            action.onClick();
            dismiss();
        });
        el.appendChild(btn);
    }

    state.toastContainer.appendChild(el);
    dismissTimer = setTimeout(dismiss, duration);
}

// --- Modal focus management -------------------------------------------------
// A dialog has to take focus when it opens, keep Tab inside itself while it is
// open, and hand focus back to whatever opened it on close. Without this the
// keyboard silently walks out of the dialog into the page behind it.

const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The element focus returns to when the dialog closes.
let modalReturnFocus = null;
// Fallback descriptor used when that element does not survive a re-render.
let modalReturnOrigin = null;

function visibleFocusables(modal) {
    return [...modal.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);
}

// Cycle Tab / Shift+Tab within the dialog, and close it on Escape.
function onModalKeydown(e) {
    const modal = e.currentTarget;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(modal);
        return;
    }
    if (e.key !== 'Tab') return;

    const items = visibleFocusables(modal);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

export function openModal(modal) {
    if (!modal) return;
    modalReturnFocus = document.activeElement;
    modalReturnOrigin = describeOrigin(modalReturnFocus);
    modal.removeAttribute('inert');
    modal.classList.remove('hidden');
    // Nothing behind the dialog should be reachable by Tab or announced while
    // it is open; `inert` handles both in one attribute.
    if (dom.appContainer) dom.appContainer.setAttribute('inert', '');
    modal.addEventListener('keydown', onModalKeydown);
    const items = visibleFocusables(modal);
    if (items.length) items[0].focus();
}

// Saving from the dialog re-renders the list that opened it, so the remembered
// element is detached by the time we close. Describe it well enough to find its
// replacement: the action it performed, on the row for the same station.
function describeOrigin(el) {
    const row = el && el.closest && el.closest('[data-stationuuid]');
    const action = el && el.dataset ? el.dataset.action : null;
    return row && action ? { uuid: row.dataset.stationuuid, action } : null;
}

function reacquireOrigin(origin) {
    if (!origin) return null;
    return document.querySelector(
        `[data-stationuuid="${CSS.escape(origin.uuid)}"] [data-action="${CSS.escape(origin.action)}"]`
    );
}

export function closeModal(modal) {
    if (!modal) return;
    modal.removeEventListener('keydown', onModalKeydown);
    modal.classList.add('hidden');
    if (dom.appContainer) dom.appContainer.removeAttribute('inert');
    // Restore focus before making the dialog inert, otherwise the browser drops
    // focus to <body> when the element it sits on becomes inert.
    const target = modalReturnFocus && document.contains(modalReturnFocus)
        ? modalReturnFocus
        : reacquireOrigin(modalReturnOrigin);
    if (target) target.focus();
    modalReturnFocus = null;
    modalReturnOrigin = null;
    modal.setAttribute('inert', '');
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
    const ver = state.appVersion ? `v${state.appVersion} · ` : '';
    dom.brandStatus.textContent = `${ver}${state.isPlaying ? 'ON AIR' : 'OFF AIR'}`;
}

// Show the "Unverified" badge in the station header when the active stream's
// TLS certificate could not be validated (hidden otherwise).
export function updateInsecureBadge() {
    if (!dom.insecureBadge) return;
    const show = state.isPlaying && state.insecureStream;
    dom.insecureBadge.classList.toggle('hidden', !show);
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
    // header and the search / stations sidebar are hidden (via CSS). The
    // native title bar stays, so pin-on-top and exiting compact mode get
    // their own row on the card instead (.compact-window-bar).
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
                // Like Winamp's shade mode: a fixed-size widget, not a fluid
                // one. The card's styles aren't built to reflow, and scaling
                // it to track a resizable window (tried via CSS `zoom`) kept
                // hitting edge cases (scrollbars, width/height drifting out of
                // sync). Simplest and most robust is to just not allow
                // resizing at all — the window is sized to fit the card once,
                // on entry.
                await appWindow.setResizable(false);

                // Fit the widget height to the player card. Apply the compact
                // width first, wait for the webview to reflow, then shrink the
                // window so its content area matches the card exactly.
                const W = window.__TAURI__.window;
                await appWindow.setMinSize(new W.LogicalSize(380, 420));
                const reflowed = waitForWindowResize();
                await appWindow.setSize(new W.LogicalSize(470, 740));
                await reflowed;
                // Where the card's bottom edge actually sits vs. the bottom
                // of the viewport: positive means it's clipped (window too
                // short), negative means there's dead space below it (window
                // too tall) — either way, this closes the gap exactly.
                // (document.documentElement.scrollHeight doesn't work for
                // this: body has `min-height: 100vh`, so scrollHeight can
                // never report *less* than the current viewport, which hid
                // the "window too tall" case entirely.)
                const cardRect = dom.playerSection.getBoundingClientRect();
                const overflow = Math.round(cardRect.top + cardRect.height) - window.innerHeight;
                if (overflow !== 0) {
                    await appWindow.setSize(new W.LogicalSize(470, 740 + overflow));
                }
            } else {
                await appWindow.setResizable(true);
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

// Two pin buttons exist (header, for normal/narrow use; the compact widget's
// own title bar, since the header is hidden there) — only one is ever visible
// at a time, but both must reflect the same state.
export async function toggleAlwaysOnTop() {
    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();
            state.isAlwaysOnTop = !state.isAlwaysOnTop;
            await appWindow.setAlwaysOnTop(state.isAlwaysOnTop);
            document.querySelectorAll('.pin-btn').forEach((btn) => {
                btn.classList.toggle('active', state.isAlwaysOnTop);
                btn.setAttribute('aria-pressed', String(state.isAlwaysOnTop));
            });
        } catch (e) {
            console.error('Failed to toggle always on top:', e);
        }
    }
}


// Apply narrow / wide layout to the UI (and resize the window)
export async function applyViewMode(wide, isInit = false) {
    state.settings.wideMode = wide;
    dom.appContainer.classList.toggle('wide', wide);
    // Reset the scroll-collapsed player when switching views (re-collapses on scroll)
    if (dom.radioLayout) dom.radioLayout.classList.remove('player-collapsed');

    // Sync the header segmented switch and the settings dropdown
    if (dom.viewSwitch) {
        dom.viewSwitch.querySelectorAll('.view-opt').forEach(opt => {
            const on = opt.dataset.view === (wide ? 'wide' : 'narrow');
            opt.classList.toggle('active', on);
            opt.setAttribute('aria-pressed', String(on));
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

// Start the countdown to an absolute end time (ms). Shared by the duration and
// the "stop at time" modes; stopStation fades the volume out on expiry.
function beginSleepTimer(endMs) {
    state.sleepTimerEnd = endMs;
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
}

// Sleep timer: stop playback automatically after the chosen number of minutes.
export function startSleepTimer(minutes) {
    cancelSleepTimer();
    if (dom.sleepUntilTime) dom.sleepUntilTime.value = ''; // the two modes are mutually exclusive
    if (!minutes || minutes <= 0) return;
    beginSleepTimer(Date.now() + minutes * 60 * 1000);
    toast(`Sleep timer: ${minutes} min`, 'success');
}

// Sleep timer: stop playback at an absolute clock time "HH:MM" (today if still
// ahead, otherwise tomorrow).
export function startSleepUntil(timeStr) {
    cancelSleepTimer();
    if (!timeStr) return;
    if (dom.sleepTimerSelect) dom.sleepTimerSelect.value = '0'; // clear the duration mode
    const target = nextAlarmTimestamp(timeStr);
    if (!target) return;
    beginSleepTimer(target);
    toast(`Sleep timer: until ${timeStr}`, 'success');
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
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    // Show hours only when the "stop at time" mode runs longer than an hour.
    dom.sleepTimerRemaining.textContent = h > 0
        ? `${h}:${pad(m)}:${pad(s)}`
        : `${pad(m)}:${pad(s)}`;
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

// --- Resizable player column (wide view) ------------------------------------

// Player column min width and the minimum the list column must keep, plus the
// divider width — used to clamp the drag so neither side gets crushed.
const SPLIT_MIN_MAIN = 360;
const SPLIT_MIN_SIDE = 300;
const SPLIT_WIDTH = 16;

function clampMainWidth(px, layoutWidth) {
    const max = Math.max(SPLIT_MIN_MAIN, layoutWidth - SPLIT_MIN_SIDE - SPLIT_WIDTH);
    return Math.round(Math.max(SPLIT_MIN_MAIN, Math.min(px, max)));
}

// Apply the saved player-column width (set as a CSS var the wide layout reads).
export function applyRadioMainWidth() {
    const w = state.settings.radioMainWidth;
    if (w && dom.appContainer) {
        dom.appContainer.style.setProperty('--radio-main-width', w + 'px');
    }
}

// Wire the divider so dragging it resizes the player column (wide view only).
export function setupRadioSplitter() {
    const { radioSplitter: splitter, radioLayout: layout, appContainer } = dom;
    if (!splitter || !layout || !appContainer) return;

    let dragging = false;
    // Cached once per drag instead of re-read on every mousemove: the layout
    // box doesn't move while dragging, but getBoundingClientRect() forces a
    // style/layout recalc, and doing that on every mouse-move frame was the
    // actual cause of the splitter feeling laggy while dragging.
    let rect = null;
    let pendingClientX = null;
    let rafId = null;

    const applyPending = () => {
        rafId = null;
        if (pendingClientX == null || !rect) return;
        const px = clampMainWidth(pendingClientX - rect.left, rect.width);
        appContainer.style.setProperty('--radio-main-width', px + 'px');
    };

    const onMove = (e) => {
        if (!dragging) return;
        pendingClientX = e.clientX;
        // Coalesce bursts of mousemove into at most one style write per frame.
        if (rafId == null) rafId = requestAnimationFrame(applyPending);
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        rect = null;
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        document.body.classList.remove('resizing-col');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        // Persist the actual rendered width (after min-width clamping).
        const px = dom.radioMain ? Math.round(dom.radioMain.getBoundingClientRect().width) : 0;
        if (px) {
            state.settings.radioMainWidth = px;
            saveSetting('radioMainWidth', px);
        }
    };

    splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        rect = layout.getBoundingClientRect();
        document.body.classList.add('resizing-col');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Re-clamp on window resize so an absolute width can't crush the list.
    window.addEventListener('resize', () => {
        const w = state.settings.radioMainWidth;
        const rect = layout.getBoundingClientRect();
        if (!w || !rect.width) return;
        appContainer.style.setProperty('--radio-main-width', clampMainWidth(w, rect.width) + 'px');
    });
}
