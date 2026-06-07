// main.js — application orchestrator.
// Wires the modules together: loads persisted data into shared state, applies
// saved settings, renders the initial UI, and binds all DOM event listeners.
// All behaviour lives in the feature modules; this file only coordinates.

import { state } from './core/state.js';
import { dom } from './core/dom.js';
import { SOURCES } from './core/constants.js';
import { hasTauriApi } from './core/util.js';
import { applyLogo, resolveLogoSrc } from './core/favicon.js';
import { loadApiServers, loadFilterOptions } from './services/api.js';
import {
    openDatabase,
    loadAllDataFromDb,
    loadAllDataFromStorage,
    saveSetting,
    applySavedOrder
} from './core/db.js';
import { buildEqUi, toggleEq, applyEqPreset, toggleNormalization } from './services/audio.js';
import { toggleVisualizer, changeVisualizerColor, cycleVisualizerStyle, refreshVisualizerSize } from './services/visualizer.js';
import {
    initProxy,
    setVolume,
    toggleMute,
    togglePlay,
    prevStation,
    nextStation,
    previewCustomUrl,
    toggleRecording,
    setupMediaSession,
    setupStreamMetadataListener,
    requestNotificationPermission,
    handleStreamDrop,
    setConnectionState
} from './features/player.js';
import {
    searchStations,
    loadMoreStations,
    loadPopularStations,
    showFavorites,
    addCustomStation,
    saveEditedStation,
    renderCustomStations,
    renderRecentlyPlayed,
    renderTrackHistory,
    clearTrackHistory,
    updateCurrentStationInfo,
    exportFavorites,
    importStations
} from './features/stations.js';
import {
    renderGenrePresets,
    addGenrePreset,
    removeGenrePreset,
    resetGenrePresets,
    setupPresetDrag,
    updateAddGenreButton,
    setActivePreset
} from './features/presets.js';
import {
    isSourceEnabled,
    setSourceEnabled,
    checkConnectivity
} from './features/sources.js';
import { setupSearchDropdown } from './features/searchDropdown.js';
import {
    setStationName,
    updateMetadata,
    updateBrandStatus,
    applyMarquee,
    toggleCompactMode,
    enterCompactMode,
    exitCompactMode,
    toggleAlwaysOnTop,
    applyViewMode,
    toggleViewMode,
    startSleepTimer,
    startSleepUntil,
    setAlarm,
    initAlarm,
    copyCurrentTrack,
    openTrackOnYouTube,
    applyRadioMainWidth,
    setupRadioSplitter,
    toast
} from './ui/ui.js';

// Resolve the app version from the Tauri runtime (Cargo.toml is the single
// source of truth). Stays empty in a plain browser, where it is not displayed.
async function loadAppVersion() {
    if (hasTauriApi && window.__TAURI__.app && window.__TAURI__.app.getVersion) {
        try {
            state.appVersion = await window.__TAURI__.app.getVersion();
        } catch (e) {
            console.warn('Could not read app version:', e);
        }
    }
}

// Load persisted data from SQLite (or localStorage fallback) into shared state.
async function initDatabase() {
    const ok = await openDatabase(hasTauriApi);
    let data;
    if (ok) {
        data = await loadAllDataFromDb();
        console.log('Data loaded from database');
    } else {
        data = loadAllDataFromStorage();
        console.log('Using localStorage fallback');
    }

    state.favorites = data.favorites;
    state.customStations = data.customStations;
    state.blacklist = data.blacklist;
    state.recentlyPlayed = data.recentlyPlayed;
    state.trackHistory = data.trackHistory;
    state.settings = { ...state.settings, ...data.settings };
    if (data.lastStation !== null) state.lastStation = data.lastStation;

    // Apply any previously saved drag-and-drop ordering
    state.favorites = applySavedOrder(state.favorites, state.settings.favoritesOrder);
    state.customStations = applySavedOrder(state.customStations, state.settings.customOrder);
}

// Initialize
async function init() {
    dom.audioPlayer.volume = dom.volumeSlider.value / 100;

    // Load proxy port first
    await initProxy();

    // Resolve the app version (used by the brand badge and About panel)
    await loadAppVersion();

    // Listen for live track metadata pushed from the proxy stream
    setupStreamMetadataListener();

    // Refresh the Radio Browser mirror list, then populate filter suggestions
    loadApiServers().then(() => loadFilterOptions());

    // Initialize database
    await initDatabase();

    // Request notification permission
    requestNotificationPermission();

    // Wire OS-level media controls once
    setupMediaSession();

    // Apply saved settings
    dom.compactModeCheckbox.checked = state.settings.compactMode;
    dom.visualizerEnabledCheckbox.checked = state.settings.visualizerEnabled;
    dom.visualizerStyleSelect.value = state.settings.visualizerStyle || 'bars';
    dom.visualizerSensitivityInput.value = state.settings.visualizerSensitivity || 1.0;
    dom.visualizerColorPicker.value = state.settings.visualizerColor || '#ff5a36';
    dom.viewModeSelect.value = state.settings.wideMode ? 'wide' : 'narrow';
    buildEqUi();
    if (dom.normalizeCheckbox) dom.normalizeCheckbox.checked = state.settings.normalizeEnabled;
    if (dom.recordSplitCheckbox) dom.recordSplitCheckbox.checked = state.settings.recordSplit;

    // Restore and (re)schedule the wake-to-radio alarm
    initAlarm();

    // Apply narrow / wide layout
    applyViewMode(state.settings.wideMode, true);

    // Restore the saved player-column width and enable the resize divider
    applyRadioMainWidth();
    setupRadioSplitter();

    // Apply compact mode with window resize
    if (state.settings.compactMode) {
        toggleCompactMode(true);
    }

    // Reflect initial OFF AIR state and sync the About version label
    updateBrandStatus();
    if (dom.aboutVersion) dom.aboutVersion.textContent = state.appVersion ? 'v' + state.appVersion : '';

    if (!state.settings.visualizerEnabled) {
        dom.visualizerCanvas.classList.add('hidden');
    }

    // Initialize volume control
    setVolume(dom.volumeSlider.value);

    // Render the editable genre preset chips and enable drag-reorder
    renderGenrePresets();
    setupPresetDrag();

    // Build the Settings → Sources rows (connectivity is checked when opened)
    renderSourcesSettings();

    // Wire the combined search dropdown (suggestions + genres + collections)
    setupSearchDropdown();

    // Render recently played
    renderRecentlyPlayed();

    // Restore last station UI (without playing)
    if (state.lastStation) {
        state.currentStation = state.lastStation;
        setStationName(state.lastStation.name);
        updateMetadata(state.lastStation);
        updateCurrentStationInfo();
        dom.stationLogo.classList.remove('hidden');
        applyLogo(dom.stationLogo, state.lastStation);
        if (dom.trackCardThumb) dom.trackCardThumb.style.backgroundImage = `url("${resolveLogoSrc(state.lastStation)}")`;
    }

    // Load custom stations
    renderCustomStations();

    // Render track history
    renderTrackHistory();

    // Open the Favorites tab first when the user already has favorites;
    // otherwise default to Search with the popular stations list.
    if (state.favorites.length > 0) {
        setSource('favorites');
    } else {
        loadPopularStations();
    }
}

// ===========================================================================
// Event listeners
// ===========================================================================

dom.playBtn.addEventListener('click', togglePlay);
dom.prevBtn.addEventListener('click', prevStation);
dom.nextBtn.addEventListener('click', nextStation);

dom.volumeSlider.addEventListener('input', (e) => {
    setVolume(e.target.value);
});

dom.volumeMuteBtn.addEventListener('click', toggleMute);

dom.searchBtn.addEventListener('click', () => {
    searchStations(dom.searchInput.value.trim());
});

dom.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        clearTimeout(state.searchDebounce);
        searchStations(dom.searchInput.value.trim());
    }
});

// Search-as-you-type with debounce
dom.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchDebounce);
    state.searchDebounce = setTimeout(() => {
        const query = dom.searchInput.value.trim();
        if (query.length >= 2) {
            searchStations(query);
        } else if (query.length === 0) {
            loadPopularStations();
        }
    }, 500);
});

// Toggle the search filters panel
dom.filtersToggleBtn.addEventListener('click', () => {
    const willShow = dom.filtersPanel.classList.contains('hidden');
    dom.filtersPanel.classList.toggle('hidden', !willShow);
    dom.filtersToggleBtn.classList.toggle('active', willShow);
});

// Re-run search when a filter changes (keeps results in sync with the panel)
[dom.filterCountry, dom.filterTag, dom.filterBitrate, dom.filterCodec, dom.filterLanguage, dom.filterOrder].forEach(sel => {
    sel.addEventListener('change', () => {
        // A typed tag takes priority; otherwise fall back to the active preset
        let tag = dom.filterTag.value.trim();
        if (!tag) {
            const activeGenre = dom.presetGenres.querySelector('.preset-btn.active');
            tag = activeGenre ? activeGenre.dataset.genre : '';
        }
        searchStations(dom.searchInput.value.trim(), tag);
    });
});

// Infinite scroll: load the next page when the list nears the bottom. The
// scrolling element differs between layouts (the whole radio-layout in narrow
// view, the list itself in wide view), so listen on both.
// Collapse / expand the player (instant — no animation). overflow-anchor:none
// on the scroll container keeps the toggle from juddering near the threshold.
function setPlayerCollapsed(collapsed) {
    if (!dom.radioLayout) return;
    if (dom.radioLayout.classList.contains('player-collapsed') === collapsed) return;
    dom.radioLayout.classList.toggle('player-collapsed', collapsed);
    refreshVisualizerSize(); // spectrum canvas resizes for the mini / full layout
}

function onListScroll(e) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        loadMoreStations();
    }
    // Narrow view: collapse the player into a sticky bar once scrolled down,
    // and expand it again near the top (hysteresis avoids flicker at the edge).
    if (el === dom.radioLayout) {
        if (el.scrollTop > 60) setPlayerCollapsed(true);
        else if (el.scrollTop < 20) setPlayerCollapsed(false);
    }
}
dom.stationsList.addEventListener('scroll', onListScroll);
if (dom.radioLayout) dom.radioLayout.addEventListener('scroll', onListScroll);

// Click the collapsed mini-bar (anywhere but its controls) to scroll the list
// back to the top, which expands the player again.
if (dom.radioMain) {
    dom.radioMain.addEventListener('click', (e) => {
        if (!dom.radioLayout || !dom.radioLayout.classList.contains('player-collapsed')) return;
        if (e.target.closest('button, input, canvas, a')) return; // let controls work
        dom.radioLayout.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// Re-evaluate the marquees when the window is resized
window.addEventListener('resize', () => {
    applyMarquee(dom.stationName);
    applyMarquee(dom.nowPlayingTrack);
});

// Handle audio stream lifecycle events
dom.audioPlayer.addEventListener('error', () => {
    handleStreamDrop('audio error');
});

dom.audioPlayer.addEventListener('ended', () => {
    handleStreamDrop('stream ended');
});

dom.audioPlayer.addEventListener('waiting', () => {
    if (state.wantPlayback && state.isPlaying) {
        setConnectionState('buffering');
    }
});

dom.audioPlayer.addEventListener('playing', () => {
    state.reconnectAttempts = 0;
    setConnectionState('playing');
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById('tab-' + tabId).classList.add('active');

        // Refresh source connectivity dots when the Settings tab is opened
        if (tabId === 'settings') refreshEnabledConnectivity();
    });
});

// Source switch — two modes: unified Search (all enabled sources at once) and
// Favorites. The search controls + genre chips are shown only in Search mode.
function setSource(source) {
    document.querySelectorAll('.source-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.source === source));
    if (dom.ctxSearch) dom.ctxSearch.classList.toggle('hidden', source !== 'search');

    if (source === 'favorites') {
        setActivePreset('');
        showFavorites();
    } else {
        // Search: honour a typed query or an active genre chip, else popular.
        const query = dom.searchInput.value.trim();
        const activeGenre = dom.presetGenres.querySelector('.preset-btn.active');
        if (query) searchStations(query);
        else if (activeGenre) searchStations('', activeGenre.dataset.genre);
        else { setActivePreset(''); loadPopularStations(); }
    }
}

dom.sourceSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.source-btn');
    if (btn) setSource(btn.dataset.source);
});

// Genre chips (Search source only) — delegated so dynamic chips work too.
dom.presets.addEventListener('click', (e) => {
    // Remove (✕) affordance inside a genre chip (edit mode)
    const del = e.target.closest('.preset-del');
    if (del) {
        const chip = del.closest('.preset-btn');
        if (chip) removeGenrePreset(chip.dataset.genre);
        return;
    }

    // The edit toggle is not a .preset-btn, so it is ignored here (handled below)
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;

    // searchStations highlights the matching chip via setActivePreset.
    searchStations('', btn.dataset.genre);
});

// Genre preset editing: toggle edit mode, add by label, reset to defaults.
if (dom.presetEditBtn) {
    dom.presetEditBtn.addEventListener('click', () => {
        const editing = dom.presetGenres.classList.toggle('editing');
        dom.presetEditBtn.classList.toggle('active', editing);
        if (dom.presetEditBar) dom.presetEditBar.classList.toggle('hidden', !editing);
        // Re-render so chips pick up the draggable attribute for the new mode
        renderGenrePresets();
    });
}

function submitAddPreset() {
    if (addGenrePreset(dom.presetAddInput.value)) {
        dom.presetAddInput.value = '';
    } else {
        toast('Genre is empty or already added', 'error');
    }
}
if (dom.presetAddBtn) dom.presetAddBtn.addEventListener('click', submitAddPreset);
if (dom.presetAddInput) {
    dom.presetAddInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitAddPreset();
    });
}
if (dom.presetResetBtn) dom.presetResetBtn.addEventListener('click', resetGenrePresets);

// Quick-add: typing or picking a genre in the search box reveals a "+" that
// adds it straight to the genre presets.
dom.searchInput.addEventListener('input', updateAddGenreButton);
if (dom.addGenreBtn) {
    dom.addGenreBtn.addEventListener('click', () => {
        const val = dom.searchInput.value.trim();
        if (addGenrePreset(val)) {
            toast(`Added “${val}” to genres`, 'success');
            updateAddGenreButton();
        } else {
            toast('Genre is empty or already added', 'error');
        }
    });
}

// --- Settings: search sources -----------------------------------------------

// Set the connectivity dot for a source row: off | checking | online | offline | local
function setSourceDot(id, status) {
    const dot = dom.sourcesList &&
        dom.sourcesList.querySelector(`.source-row[data-source="${id}"] .source-dot`);
    if (dot) dot.className = 'source-dot ' + status;
}

async function refreshConnectivity(id) {
    if (!isSourceEnabled(id)) { setSourceDot(id, 'off'); return; }
    setSourceDot(id, 'checking');
    const ok = await checkConnectivity(id);
    setSourceDot(id, ok === null ? 'local' : (ok ? 'online' : 'offline'));
}

function refreshEnabledConnectivity() {
    SOURCES.forEach(src => refreshConnectivity(src.id));
}

// Build the Settings → Sources rows (toggle + connectivity dot) from SOURCES.
function renderSourcesSettings() {
    if (!dom.sourcesList) return;
    dom.sourcesList.replaceChildren();
    for (const src of SOURCES) {
        const row = document.createElement('div');
        row.className = 'source-row';
        row.dataset.source = src.id;

        const label = document.createElement('label');
        label.className = 'checkbox-container';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isSourceEnabled(src.id);
        cb.addEventListener('change', () => {
            setSourceEnabled(src.id, cb.checked);
            refreshConnectivity(src.id);
        });
        const mark = document.createElement('span');
        mark.className = 'checkmark';
        label.append(cb, mark, document.createTextNode(
            src.label + (src.note ? ` — ${src.note}` : '')
        ));

        const dot = document.createElement('span');
        dot.className = 'source-dot off';
        dot.title = 'Connectivity';

        row.append(label, dot);
        dom.sourcesList.appendChild(row);
    }
}

// Custom stations
dom.addCustomBtn.addEventListener('click', addCustomStation);
dom.previewBtn.addEventListener('click', previewCustomUrl);

// Track history
if (dom.clearHistoryBtn) dom.clearHistoryBtn.addEventListener('click', clearTrackHistory);

// Sleep timer
if (dom.sleepTimerSelect) {
    dom.sleepTimerSelect.addEventListener('change', () => {
        startSleepTimer(parseInt(dom.sleepTimerSelect.value, 10));
    });
}

// Sleep timer (absolute clock time): "stop at HH:MM"
if (dom.sleepUntilTime) {
    dom.sleepUntilTime.addEventListener('change', () => {
        startSleepUntil(dom.sleepUntilTime.value);
    });
}

// Alarm (wake to radio): re-apply whenever the toggle or time changes
function applyAlarmFromUi() {
    setAlarm(dom.alarmEnabledCheckbox.checked, dom.alarmTime.value);
}
if (dom.alarmEnabledCheckbox) dom.alarmEnabledCheckbox.addEventListener('change', applyAlarmFromUi);
if (dom.alarmTime) dom.alarmTime.addEventListener('change', applyAlarmFromUi);

// Auto-update UI: a single button that walks through the states
// Check for updates -> Install vX (with progress bar) -> Restart now.
if (hasTauriApi && window.__TAURI__.event && dom.updateActionBtn) {
    let updState = 'idle'; // idle | available | installed
    let pendingVersion = '';

    const setUpdStatus = (text, kind = '') => {
        if (!dom.updateStatus) return;
        dom.updateStatus.textContent = text || '';
        dom.updateStatus.className = 'update-status' + (kind ? ' ' + kind : '');
    };
    const fmtMB = (b) => (b / (1024 * 1024)).toFixed(1);
    const setBtn = (label, accent) => {
        dom.updateActionBtn.textContent = label;
        dom.updateActionBtn.classList.toggle('accent', !!accent);
    };

    // Live download progress while install_update runs
    window.__TAURI__.event.listen('update-progress', (event) => {
        const { downloaded = 0, total = null } = event.payload || {};
        if (dom.updateProgressWrap) dom.updateProgressWrap.classList.remove('hidden');
        if (dom.updateProgressBar) {
            const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
            dom.updateProgressBar.style.width = pct + '%';
        }
        setUpdStatus(`Downloading ${fmtMB(downloaded)}${total ? ` / ${fmtMB(total)} MB` : ''}…`);
    });

    const doCheck = async () => {
        const { invoke } = window.__TAURI__.core;
        dom.updateActionBtn.disabled = true;
        setBtn('Checking…', false);
        try {
            const info = await invoke('check_for_updates');
            if (info && info.available) {
                pendingVersion = info.version;
                updState = 'available';
                setBtn(`Install v${info.version}`, true);
                setUpdStatus(`Update available: v${info.version} (current v${info.current_version})`, 'ok');
            } else {
                updState = 'idle';
                setBtn('Check for updates', false);
                setUpdStatus(`You are on the latest version (v${info ? info.current_version : ''})`, 'ok');
            }
        } catch (e) {
            updState = 'idle';
            setBtn('Check for updates', false);
            setUpdStatus('Update check failed: ' + (e && e.message ? e.message : e), 'error');
        } finally {
            dom.updateActionBtn.disabled = false;
        }
    };

    const doInstall = async () => {
        const { invoke } = window.__TAURI__.core;
        dom.updateActionBtn.disabled = true;
        setBtn('Installing…', true);
        setUpdStatus('Starting download…');
        if (dom.updateProgressWrap) dom.updateProgressWrap.classList.remove('hidden');
        if (dom.updateProgressBar) dom.updateProgressBar.style.width = '0%';
        try {
            await invoke('install_update');
            if (dom.updateProgressBar) dom.updateProgressBar.style.width = '100%';
            updState = 'installed';
            setBtn('Restart now', true);
            setUpdStatus(`v${pendingVersion} installed. Restart to apply.`, 'ok');
        } catch (e) {
            updState = 'available';
            setBtn(`Install v${pendingVersion}`, true);
            setUpdStatus('Install failed: ' + (e && e.message ? e.message : e), 'error');
        } finally {
            dom.updateActionBtn.disabled = false;
        }
    };

    dom.updateActionBtn.addEventListener('click', () => {
        if (updState === 'idle') doCheck();
        else if (updState === 'available') doInstall();
        else if (updState === 'installed') window.__TAURI__.core.invoke('restart_app');
    });
} else if (dom.updateActionBtn) {
    dom.updateActionBtn.addEventListener('click', () => {
        toast('Updates are available in the desktop app only', 'error');
    });
}

// Modal Save & Close
dom.closeModalBtn.addEventListener('click', () => dom.editModal.classList.add('hidden'));
dom.saveEditBtn.addEventListener('click', saveEditedStation);

// Export/Import
dom.exportFavoritesBtn.addEventListener('click', exportFavorites);
dom.importBtn.addEventListener('click', () => dom.importFile.click());
dom.importFile.addEventListener('change', importStations);

// Settings
dom.compactModeCheckbox.addEventListener('change', () => toggleCompactMode());
dom.visualizerEnabledCheckbox.addEventListener('change', toggleVisualizer);
dom.visualizerColorPicker.addEventListener('input', changeVisualizerColor);
dom.eqEnabledCheckbox.addEventListener('change', toggleEq);
dom.eqPresetSelect.addEventListener('change', applyEqPreset);
if (dom.normalizeCheckbox) dom.normalizeCheckbox.addEventListener('change', toggleNormalization);
if (dom.recordSplitCheckbox) dom.recordSplitCheckbox.addEventListener('change', () => {
    state.settings.recordSplit = dom.recordSplitCheckbox.checked;
    saveSetting('recordSplit', state.settings.recordSplit);
});
if (dom.recordBtn) dom.recordBtn.addEventListener('click', toggleRecording);
dom.visualizerCanvas.addEventListener('click', cycleVisualizerStyle);
dom.enterCompactBtn.addEventListener('click', enterCompactMode);
dom.exitCompactBtn.addEventListener('click', exitCompactMode);
dom.alwaysOnTopBtn.addEventListener('click', toggleAlwaysOnTop);

// View switcher (narrow / wide)
if (dom.viewSwitch) {
    dom.viewSwitch.querySelectorAll('.view-opt').forEach(opt => {
        opt.addEventListener('click', () => toggleViewMode(opt.dataset.view === 'wide'));
    });
}
if (dom.viewModeSelect) {
    dom.viewModeSelect.addEventListener('change', () => {
        toggleViewMode(dom.viewModeSelect.value === 'wide');
    });
}

// Copy the current track title from the track card
if (dom.trackCopyBtn) {
    dom.trackCopyBtn.addEventListener('click', copyCurrentTrack);
}

// Open the current track on YouTube
if (dom.trackYoutubeBtn) {
    dom.trackYoutubeBtn.addEventListener('click', openTrackOnYouTube);
}

dom.visualizerStyleSelect.addEventListener('change', () => {
    state.settings.visualizerStyle = dom.visualizerStyleSelect.value;
    saveSetting('visualizerStyle', state.settings.visualizerStyle);
});

dom.visualizerSensitivityInput.addEventListener('input', () => {
    state.settings.visualizerSensitivity = parseFloat(dom.visualizerSensitivityInput.value);
    saveSetting('visualizerSensitivity', state.settings.visualizerSensitivity);
});

// Keyboard shortcuts: Space toggles play/stop (only when not typing in a field)
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
    }
});

// Initialize and load. A failure here (DB open, proxy handshake, …) would
// otherwise vanish into an unhandled rejection, so surface it.
init().catch((e) => {
    console.error('Initialization failed:', e);
    toast('Initialization failed: ' + (e && e.message ? e.message : e), 'error');
});
