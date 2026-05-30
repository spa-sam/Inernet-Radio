// main.js — application orchestrator.
// Wires the modules together: loads persisted data into shared state, applies
// saved settings, renders the initial UI, and binds all DOM event listeners.
// All behaviour lives in the feature modules; this file only coordinates.

import { state } from './state.js';
import { dom } from './dom.js';
import { APP_VERSION } from './constants.js';
import { hasTauriApi, generatePlaceholderLogo } from './util.js';
import { loadApiServers, loadFilterOptions } from './api.js';
import {
    openDatabase,
    loadAllDataFromDb,
    loadAllDataFromStorage,
    saveSetting,
    applySavedOrder
} from './db.js';
import { buildEqUi, toggleEq, applyEqPreset, toggleNormalization } from './audio.js';
import { toggleVisualizer, changeVisualizerColor, cycleVisualizerStyle } from './visualizer.js';
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
} from './player.js';
import {
    searchStations,
    loadMoreStations,
    loadPopularStations,
    loadSomaFM,
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
} from './stations.js';
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
    setAlarm,
    initAlarm,
    copyCurrentTrack,
    openTrackOnYouTube,
    toast
} from './ui.js';

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

    // Apply compact mode with window resize
    if (state.settings.compactMode) {
        toggleCompactMode(true);
    }

    // Reflect initial OFF AIR state and sync the About version label
    updateBrandStatus();
    if (dom.aboutVersion) dom.aboutVersion.textContent = 'v' + APP_VERSION;

    if (!state.settings.visualizerEnabled) {
        dom.visualizerCanvas.classList.add('hidden');
    }

    // Initialize volume control
    setVolume(dom.volumeSlider.value);

    // Render recently played
    renderRecentlyPlayed();

    // Restore last station UI (without playing)
    if (state.lastStation) {
        state.currentStation = state.lastStation;
        setStationName(state.lastStation.name);
        updateMetadata(state.lastStation);
        updateCurrentStationInfo();
        dom.stationLogo.classList.remove('hidden');
        const restoredLogo = state.lastStation.favicon || generatePlaceholderLogo(state.lastStation.name);
        if (state.lastStation.favicon) {
            dom.stationLogo.src = state.lastStation.favicon;
            dom.stationLogo.onerror = function() {
                this.src = generatePlaceholderLogo(state.lastStation.name);
                this.onerror = null;
            };
        } else {
            dom.stationLogo.src = restoredLogo;
        }
        if (dom.trackCardThumb) dom.trackCardThumb.style.backgroundImage = `url("${restoredLogo}")`;
    }

    // Load custom stations
    renderCustomStations();

    // Render track history
    renderTrackHistory();

    // Load the popular stations list
    loadPopularStations();
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
            const activePreset = document.querySelector('.preset-btn.active');
            tag = activePreset && !['favorites', 'somafm'].includes(activePreset.dataset.genre)
                ? activePreset.dataset.genre : '';
        }
        searchStations(dom.searchInput.value.trim(), tag);
    });
});

// Infinite scroll: load the next page when the list nears the bottom. The
// scrolling element differs between layouts (the whole radio-layout in narrow
// view, the list itself in wide view), so listen on both.
function onListScroll(e) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        loadMoreStations();
    }
}
dom.stationsList.addEventListener('scroll', onListScroll);
if (dom.radioLayout) dom.radioLayout.addEventListener('scroll', onListScroll);

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
    });
});

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const genre = btn.dataset.genre;

        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (genre === 'favorites') {
            showFavorites();
        } else if (genre === 'somafm') {
            loadSomaFM();
        } else {
            searchStations('', genre);
        }
    });
});

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

// Initialize and load
init();
