// ES-module imports — API layer and persistence layer
import { loadApiServers, apiFetch, loadFilterOptions } from './api.js';
import {
    db,
    openDatabase,
    loadAllDataFromDb,
    loadAllDataFromStorage,
    saveSetting,
    applySavedOrder
} from './db.js';

// DOM elements
const audioPlayer = document.getElementById('audio-player');
const playBtn = document.getElementById('play-btn');
const playIcon = playBtn.querySelector('.play-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const volumeSlider = document.getElementById('volume');
const volumeMuteBtn = document.getElementById('volume-mute');
const volumeBar = document.querySelector('.volume-bar');
const volumeValueLabel = document.getElementById('volume-value');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const stationsList = document.getElementById('stations-list');
const stationName = document.getElementById('station-name');
const stationLogo = document.getElementById('station-logo');
const nowPlayingTrack = document.getElementById('now-playing-track');
const metaGenre = document.getElementById('meta-genre');
const metaBitrate = document.getElementById('meta-bitrate');
const metaCodec = document.getElementById('meta-codec');
const metaCountry = document.getElementById('meta-country');
const visualizerCanvas = document.getElementById('visualizer');
const appContainer = document.getElementById('app-container');
const playerSection = document.querySelector('.player-section');

// Search Filters Panel elements
const filtersToggleBtn = document.getElementById('filters-toggle-btn');
const filtersPanel = document.getElementById('filters-panel');
const filterCountry = document.getElementById('filter-country');
const filterTag = document.getElementById('filter-tag');
const filterBitrate = document.getElementById('filter-bitrate');
const filterCodec = document.getElementById('filter-codec');

// Recently Played elements
const recentlyPlayedSection = document.getElementById('recently-played-section');
const recentlyPlayedList = document.getElementById('recently-played-list');

// Track history elements
const trackHistoryList = document.getElementById('track-history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// Custom stations elements
const customNameInput = document.getElementById('custom-name');
const customUrlInput = document.getElementById('custom-url');
const customGenreInput = document.getElementById('custom-genre');
const addCustomBtn = document.getElementById('add-custom-btn');
const previewBtn = document.getElementById('preview-btn');
const customStationsList = document.getElementById('custom-stations-list');
const currentStationInfo = document.getElementById('current-station-info');

// Edit Station Modal elements
const editModal = document.getElementById('edit-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveEditBtn = document.getElementById('save-edit-btn');
const editStationUuidInput = document.getElementById('edit-station-uuid');
const editStationNameInput = document.getElementById('edit-station-name');
const editStationUrlInput = document.getElementById('edit-station-url');
const editStationGenreInput = document.getElementById('edit-station-genre');

// Export/Import elements
const exportFavoritesBtn = document.getElementById('export-favorites-btn');
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');

// Settings elements
const compactModeCheckbox = document.getElementById('compact-mode');
const visualizerEnabledCheckbox = document.getElementById('visualizer-enabled');
const visualizerStyleSelect = document.getElementById('visualizer-style');
const visualizerSensitivityInput = document.getElementById('visualizer-sensitivity');
const visualizerColorPicker = document.getElementById('visualizer-color');
const eqEnabledCheckbox = document.getElementById('eq-enabled');
const eqPresetSelect = document.getElementById('eq-preset');
const eqBandsContainer = document.getElementById('eq-bands');
const normalizeCheckbox = document.getElementById('normalize-enabled');
const recordBtn = document.getElementById('record-btn');
const enterCompactBtn = document.getElementById('enter-compact-btn');
const exitCompactBtn = document.getElementById('exit-compact-btn');
const alwaysOnTopBtn = document.getElementById('always-on-top-btn');
const viewModeSelect = document.getElementById('view-mode-select');
const sleepTimerSelect = document.getElementById('sleep-timer-select');
const sleepTimerStatus = document.getElementById('sleep-timer-status');
const sleepTimerRemaining = document.getElementById('sleep-timer-remaining');

// Layout / header elements
const viewSwitch = document.getElementById('view-switch');
const brandStatus = document.getElementById('brand-status');
const stationSub = document.getElementById('station-sub');
const stationsCount = document.getElementById('stations-count');
const transportQuality = document.getElementById('transport-quality');
const liveTimer = document.getElementById('live-timer');
const trackCard = document.getElementById('track-card');
const trackCardThumb = document.getElementById('track-card-thumb');
const trackCopyBtn = document.getElementById('track-copy-btn');
const trackYoutubeBtn = document.getElementById('track-youtube-btn');

// Single source of truth for the displayed version (matches package.json)
const APP_VERSION = '1.0.0';

// Favorite (heart) icon markup, shared across the station lists
const HEART_FILLED_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`;
const HEART_OUTLINE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" fill="currentColor"/></svg>`;

// State
let isAlwaysOnTop = false;
let liveTimerInterval = null;
let liveTimerSeconds = 0;
let sleepTimerInterval = null;
let sleepTimerEnd = 0;
let currentStation = null;
let isPlaying = false;
let metadataInterval = null;
let favorites = [];
let customStations = [];
let blacklist = [];
let recentlyPlayed = [];
let trackHistory = [];
let lastStation = null;
let currentStationsList = [];
let currentStationIndex = -1;

// Infinite-scroll pagination state for the searchable station list. Only
// active for searchStations() results; finite lists (favorites, popular,
// SomaFM) set active=false so the scroll handler ignores them.
const STATIONS_PAGE_SIZE = 30;
let searchPage = { active: false, query: '', tag: '', offset: 0, loading: false, exhausted: false };

// HLS playback (hls.js)
let hls = null;
let proxyHlsLoader = null;

// Playback intent & auto-reconnect
let wantPlayback = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT = 3;

// Search-as-you-type debounce
let searchDebounce = null;

// Settings state
let settings = {
    compactMode: false,
    wideMode: false,
    visualizerEnabled: true,
    visualizerColor: '#ff5a36',
    visualizerStyle: 'bars',
    visualizerSensitivity: 1.0,
    eqEnabled: false,
    eqGains: [0, 0, 0, 0, 0],
    normalizeEnabled: false,
    favoritesOrder: [],
    customOrder: []
};

// Equalizer bands (gain in dB, range -12..+12). Shelf filters at the
// extremes and peaking filters in between, wired into the visualizer graph.
const EQ_BANDS = [
    { freq: 60, type: 'lowshelf', label: '60' },
    { freq: 250, type: 'peaking', label: '250' },
    { freq: 1000, type: 'peaking', label: '1K' },
    { freq: 4000, type: 'peaking', label: '4K' },
    { freq: 12000, type: 'highshelf', label: '12K' }
];

// Proxy Port (loaded from backend)
let proxyPort = 0;

// `db` is a live binding imported from db.js; direct uses below always see
// the current connection value set by openDatabase().

// Audio visualization
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let sourceNode = null;
let eqFilters = [];
let compressorNode = null;
let smoothedData = null;
let barPeaks = null; // Stores peak bar positions
let peakHold = null; // Hold time before peaks fall
let lastTrackTitle = '';

// Check if Tauri is available
const hasTauriApi = typeof window.__TAURI__ !== 'undefined';

// Initialize database and load persisted app data.
// Delegates to db.js (openDatabase / loadAllDataFromDb / loadAllDataFromStorage),
// then assigns the returned data to module-level state.
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

    favorites = data.favorites;
    customStations = data.customStations;
    blacklist = data.blacklist;
    recentlyPlayed = data.recentlyPlayed;
    trackHistory = data.trackHistory;
    settings = { ...settings, ...data.settings };
    if (data.lastStation !== null) lastStation = data.lastStation;

    // Apply any previously saved drag-and-drop ordering
    favorites = applySavedOrder(favorites, settings.favoritesOrder);
    customStations = applySavedOrder(customStations, settings.customOrder);
}

// Fetch proxy port from Rust backend
async function initProxy() {
    if (!hasTauriApi) return;
    try {
        const { invoke } = window.__TAURI__.core;
        proxyPort = await invoke('get_proxy_port');
        console.log('CORS Proxy server running on port:', proxyPort);
    } catch (e) {
        console.error('Failed to load proxy port:', e);
    }
}

// Helper to get proxied stream URL for bypassing CORS.
// When `raw` is true the proxy streams the response verbatim without
// resolving .pls/.m3u playlists (used for HLS manifests served to hls.js).
function getProxiedUrl(originalUrl, raw) {
    if (proxyPort > 0 && originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
        if (originalUrl.includes('localhost') || originalUrl.includes('127.0.0.1')) {
            return originalUrl;
        }
        let proxied = `http://127.0.0.1:${proxyPort}/stream?url=${encodeURIComponent(originalUrl)}`;
        if (raw) proxied += '&raw=1';
        return proxied;
    }
    return originalUrl;
}

// Initialize
async function init() {
    audioPlayer.volume = volumeSlider.value / 100;

    // Load proxy port first
    await initProxy();

    // Refresh the Radio Browser mirror list, then populate filter suggestions
    loadApiServers().then(() => loadFilterOptions());

    // Initialize database
    await initDatabase();

    // Request notification permission
    requestNotificationPermission();

    // Wire OS-level media controls once
    setupMediaSession();

    // Apply saved settings
    compactModeCheckbox.checked = settings.compactMode;
    visualizerEnabledCheckbox.checked = settings.visualizerEnabled;
    visualizerStyleSelect.value = settings.visualizerStyle || 'bars';
    visualizerSensitivityInput.value = settings.visualizerSensitivity || 1.0;
    visualizerColorPicker.value = settings.visualizerColor || '#ff5a36';
    viewModeSelect.value = settings.wideMode ? 'wide' : 'narrow';
    buildEqUi();
    if (normalizeCheckbox) normalizeCheckbox.checked = settings.normalizeEnabled;

    // Apply narrow / wide layout
    applyViewMode(settings.wideMode, true);

    // Apply compact mode with window resize
    if (settings.compactMode) {
        toggleCompactMode(true);
    }

    // Reflect initial OFF AIR state and sync the About version label
    updateBrandStatus();
    const aboutVersion = document.getElementById('about-version');
    if (aboutVersion) aboutVersion.textContent = 'v' + APP_VERSION;

    if (!settings.visualizerEnabled) {
        visualizerCanvas.classList.add('hidden');
    }

    // Initialize volume control
    setVolume(volumeSlider.value);

    // Render recently played
    renderRecentlyPlayed();

    // Restore last station UI (without playing)
    if (lastStation) {
        currentStation = lastStation;
        setStationName(lastStation.name);
        updateMetadata(lastStation);
        updateCurrentStationInfo();
        stationLogo.classList.remove('hidden');
        const restoredLogo = lastStation.favicon || generatePlaceholderLogo(lastStation.name);
        if (lastStation.favicon) {
            stationLogo.src = lastStation.favicon;
            stationLogo.onerror = function() {
                this.src = generatePlaceholderLogo(lastStation.name);
                this.onerror = null;
            };
        } else {
            stationLogo.src = restoredLogo;
        }
        if (trackCardThumb) trackCardThumb.style.backgroundImage = `url("${restoredLogo}")`;
    }

    // Load custom stations
    renderCustomStations();

    // Render track history
    renderTrackHistory();

    // Load the popular stations list
    loadPopularStations();
}

// Volume control
let lastVolumeBeforeMute = 70;

function setVolume(volume) {
    // An explicit volume change overrides any running fade animation
    cancelFade();
    volume = Math.max(0, Math.min(100, parseInt(volume) || 0));
    volumeSlider.value = volume;
    audioPlayer.volume = volume / 100;
    // Drive the slider fill gradient and the percentage label
    volumeSlider.style.setProperty('--vol', volume + '%');
    volumeValueLabel.textContent = volume + '%';
    volumeBar.classList.toggle('muted', volume === 0);
}

// Volume fade (smooth play / stop / sleep-timer transitions)
let fadeRAF = null;
const FADE_DURATION = 600; // ms

// The user's chosen volume as a 0..1 gain (independent of any active fade)
function targetVolume() {
    return Math.max(0, Math.min(100, parseInt(volumeSlider.value) || 0)) / 100;
}

function cancelFade() {
    if (fadeRAF) {
        cancelAnimationFrame(fadeRAF);
        fadeRAF = null;
    }
}

// Ramp audioPlayer.volume to `target` (0..1) over FADE_DURATION, then run onDone.
// onDone only fires on natural completion — a superseding fade cancels it.
function fadeTo(target, onDone) {
    cancelFade();
    target = Math.max(0, Math.min(1, target));
    const start = audioPlayer.volume;
    const delta = target - start;
    if (Math.abs(delta) < 0.005) {
        audioPlayer.volume = target;
        if (onDone) onDone();
        return;
    }
    const startTime = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / FADE_DURATION);
        const eased = 1 - Math.pow(1 - t, 2); // ease-out
        audioPlayer.volume = Math.max(0, Math.min(1, start + delta * eased));
        if (t < 1) {
            fadeRAF = requestAnimationFrame(step);
        } else {
            fadeRAF = null;
            audioPlayer.volume = target;
            if (onDone) onDone();
        }
    };
    fadeRAF = requestAnimationFrame(step);
}

function toggleMute() {
    const current = parseInt(volumeSlider.value);
    if (current > 0) {
        lastVolumeBeforeMute = current;
        setVolume(0);
    } else {
        setVolume(lastVolumeBeforeMute > 0 ? lastVolumeBeforeMute : 70);
    }
}

// Search stations by name and filters
async function searchStations(query, tag = '', append = false) {
    const tagVal = tag || (filterTag ? filterTag.value.trim() : '');

    if (!append) {
        stationsList.innerHTML = '<div class="loading">Searching...</div>';
        clearActivePreset();
        searchPage = { active: true, query, tag: tagVal, offset: 0, loading: true, exhausted: false };
    } else {
        if (!searchPage.active || searchPage.loading || searchPage.exhausted) return;
        searchPage.loading = true;
    }

    const countryVal = filterCountry.value;
    const bitrateVal = filterBitrate.value;
    const codecVal = filterCodec.value;

    let path = `/stations/search?limit=${STATIONS_PAGE_SIZE}&offset=${searchPage.offset}&order=clickcount&reverse=true`;
    if (query) path += `&name=${encodeURIComponent(query)}`;
    if (tagVal) path += `&tag=${encodeURIComponent(tagVal)}`;
    if (countryVal) path += `&country=${encodeURIComponent(countryVal)}`;
    if (bitrateVal && parseInt(bitrateVal) > 0) path += `&bitrateMin=${bitrateVal}`;
    if (codecVal) path += `&codec=${codecVal}`;

    try {
        const stations = await apiFetch(path);

        searchPage.loading = false;
        searchPage.offset += stations.length;
        if (stations.length < STATIONS_PAGE_SIZE) searchPage.exhausted = true;

        const filtered = filterBlacklisted(stations);

        if (!append) {
            if (filtered.length === 0) {
                stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
                currentStationsList = [];
                return;
            }
            currentStationsList = filtered;
            renderStations(filtered);
        } else if (filtered.length) {
            currentStationsList = currentStationsList.concat(filtered);
            renderStations(filtered, stationsList, true);
        }
    } catch (error) {
        searchPage.loading = false;
        console.error('Search error:', error);
        if (!append) stationsList.innerHTML = '<div class="loading-hint">Failed to load stations</div>';
    }
}

// Fetch the next page when the user scrolls near the bottom of the list.
function loadMoreStations() {
    if (!searchPage.active || searchPage.loading || searchPage.exhausted) return;
    searchStations(searchPage.query, searchPage.tag, true);
}

// Clear active preset
function clearActivePreset() {
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
}

// Check if station is favorite
function isFavorite(stationuuid) {
    return favorites.some(fav => fav.stationuuid === stationuuid);
}

// Toggle favorite
async function toggleFavorite(station, btn) {
    const index = favorites.findIndex(fav => fav.stationuuid === station.stationuuid);

    if (index === -1) {
        favorites.push(station);
        btn.classList.add('active');
        btn.innerHTML = HEART_FILLED_SVG;
    } else {
        favorites.splice(index, 1);
        btn.classList.remove('active');
        btn.innerHTML = HEART_OUTLINE_SVG;
    }

    localStorage.setItem('favorites', JSON.stringify(favorites));

    if (db) {
        try {
            if (index === -1) {
                await db.execute(
                    `INSERT OR REPLACE INTO favorites (stationuuid, name, url, url_resolved, favicon, country, data)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [station.stationuuid, station.name, station.url, station.url_resolved || '',
                     station.favicon || '', station.country || '', JSON.stringify(station)]
                );
            } else {
                await db.execute('DELETE FROM favorites WHERE stationuuid = $1', [station.stationuuid]);
            }
        } catch (e) { console.error('Save favorite error:', e); }
    }
}

// Show favorites
function showFavorites() {
    searchPage.active = false;
    if (favorites.length === 0) {
        stationsList.innerHTML = '<div class="loading-hint">No saved stations</div>';
        currentStationsList = [];
        return;
    }
    currentStationsList = favorites;
    renderStations(favorites);
    setupDragReorder(stationsList, favorites, saveFavoritesOrder);
}

// Check if station is blacklisted
function isBlacklisted(stationuuid) {
    return blacklist.some(item => item.stationuuid === stationuuid);
}

// Add to blacklist
async function addToBlacklist(station) {
    if (!isBlacklisted(station.stationuuid)) {
        blacklist.push({ stationuuid: station.stationuuid, name: station.name });
        localStorage.setItem('blacklist', JSON.stringify(blacklist));
        if (db) {
            try {
                await db.execute(
                    'INSERT OR REPLACE INTO blacklist (stationuuid, name) VALUES ($1, $2)',
                    [station.stationuuid, station.name]
                );
            } catch (e) { console.error('Save blacklist error:', e); }
        }
    }
}

// Filter out blacklisted stations
function filterBlacklisted(stations) {
    return stations.filter(station => !isBlacklisted(station.stationuuid));
}

// Load popular stations on start
async function loadPopularStations() {
    searchPage.active = false;
    stationsList.innerHTML = '<div class="loading">Loading popular stations...</div>';

    try {
        const stations = await apiFetch('/stations/topclick/20');
        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('Load error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Find radio stations using the search above</div>';
    }
}

// Load SomaFM curated channels as stations
async function loadSomaFM() {
    searchPage.active = false;
    stationsList.innerHTML = '<div class="loading">Loading SomaFM...</div>';

    try {
        const res = await fetch('https://somafm.com/channels.json');
        const data = await res.json();
        const stations = (data.channels || []).map(ch => {
            // Pick the best available playlist (a .pls the proxy can resolve)
            const playlists = ch.playlists || [];
            const best = playlists.find(p => p.quality === 'highest') || playlists[0] || {};
            return {
                stationuuid: 'somafm_' + ch.id,
                name: ch.title,
                url: best.url,
                url_resolved: best.url,
                favicon: ch.image || ch.xlimage || '',
                tags: ch.genre || '',
                country: 'SomaFM',
                bitrate: 0,
                codec: '',
                hls: 0
            };
        }).filter(s => s.url);

        if (stations.length === 0) {
            stationsList.innerHTML = '<div class="loading-hint">SomaFM returned no stations</div>';
            currentStationsList = [];
            return;
        }

        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('SomaFM load error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Failed to load SomaFM</div>';
    }
}

// Render stations list
function renderStations(stations, container = stationsList, append = false) {
    if (!append) container.innerHTML = '';

    const startIndex = append ? container.querySelectorAll('.station-item').length : 0;

    // Update the station count badge (only for the main list)
    if (container === stationsList && stationsCount) {
        const total = startIndex + stations.length;
        stationsCount.textContent = total ? `${total} stations` : '';
    }

    stations.forEach((station, i) => {
        const index = startIndex + i;
        const item = document.createElement('div');
        item.className = 'station-item';
        item.dataset.stationuuid = station.stationuuid;
        if (currentStation && currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
            currentStationIndex = index;
        }

        const logo = document.createElement('img');
        logo.className = 'station-item-logo';
        if (station.favicon) {
            logo.src = station.favicon;
            logo.onerror = function() {
                this.src = generatePlaceholderLogo(station.name);
                this.onerror = null;
            };
        } else {
            logo.src = generatePlaceholderLogo(station.name);
        }

        const info = document.createElement('div');
        info.className = 'station-item-info';

        const name = document.createElement('div');
        name.className = 'station-item-name';
        name.textContent = station.name;

        const country = document.createElement('div');
        country.className = 'station-item-country';
        country.textContent = station.country || 'Unknown';

        const actions = document.createElement('div');
        actions.className = 'list-actions';

        // Favorite button
        const favBtn = document.createElement('button');
        favBtn.className = 'action-btn favorite-btn';
        if (isFavorite(station.stationuuid)) {
            favBtn.classList.add('active');
            favBtn.innerHTML = HEART_FILLED_SVG;
        } else {
            favBtn.innerHTML = HEART_OUTLINE_SVG;
        }
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(station, favBtn);
        });

        // Blacklist button
        const blacklistBtn = document.createElement('button');
        blacklistBtn.className = 'action-btn blacklist-btn';
        blacklistBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
        blacklistBtn.title = 'Hide station';
        blacklistBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToBlacklist(station);
            item.remove();
        });

        info.appendChild(name);
        info.appendChild(country);
        item.appendChild(logo);
        item.appendChild(info);
        actions.appendChild(favBtn);
        actions.appendChild(blacklistBtn);
        item.appendChild(actions);

        item.addEventListener('click', () => {
            currentStationIndex = index;
            selectStation(station, item);
        });
        container.appendChild(item);
    });
}

// Enable drag-and-drop reordering for a list of .station-item elements inside
// `container`. On drop, `list` is reordered to match the DOM and `persist` is
// called to save the new ordering. Container-level listeners are bound once.
function setupDragReorder(container, list, persist) {
    container.querySelectorAll('.station-item').forEach((item) => {
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.dataset.stationuuid || '');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
    });

    if (container.dataset.dragBound === '1') return;
    container.dataset.dragBound = '1';

    container.addEventListener('dragover', (e) => {
        const dragging = container.querySelector('.dragging');
        if (!dragging) return; // ignore drags that did not originate here
        e.preventDefault();
        const after = getDragAfterElement(container, e.clientY);
        if (after == null) container.appendChild(dragging);
        else container.insertBefore(dragging, after);
    });

    container.addEventListener('drop', (e) => {
        if (!container.querySelector('.station-item')) return;
        e.preventDefault();
        const order = [...container.querySelectorAll('.station-item')]
            .map((el) => el.dataset.stationuuid);
        const pos = new Map(order.map((id, i) => [id, i]));
        list.sort((a, b) => (pos.get(a.stationuuid) ?? 0) - (pos.get(b.stationuuid) ?? 0));
        persist();
    });
}

// Find the item the dragged element should be inserted before, based on the
// pointer's vertical position.
function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.station-item:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const child of items) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
    }
    return closest.element;
}

function saveFavoritesOrder() {
    settings.favoritesOrder = favorites.map((f) => f.stationuuid);
    saveSetting('favoritesOrder', settings.favoritesOrder);
}

function saveCustomOrder() {
    settings.customOrder = customStations.map((c) => c.stationuuid);
    saveSetting('customOrder', settings.customOrder);
}

// Navigate to next station
function nextStation() {
    if (currentStationsList.length === 0) return;

    currentStationIndex = (currentStationIndex + 1) % currentStationsList.length;
    const station = currentStationsList[currentStationIndex];
    const items = stationsList.querySelectorAll('.station-item');

    if (items[currentStationIndex]) {
        selectStation(station, items[currentStationIndex]);
    }
}

// Navigate to previous station
function prevStation() {
    if (currentStationsList.length === 0) return;

    currentStationIndex = currentStationIndex <= 0
        ? currentStationsList.length - 1
        : currentStationIndex - 1;
    const station = currentStationsList[currentStationIndex];
    const items = stationsList.querySelectorAll('.station-item');

    if (items[currentStationIndex]) {
        selectStation(station, items[currentStationIndex]);
    }
}

// Update metadata display
function updateMetadata(station) {
    const tags = station.tags ? station.tags.split(',')[0].trim() : '';
    if (tags) {
        metaGenre.textContent = tags;
        metaGenre.classList.remove('hidden');
    } else {
        metaGenre.classList.add('hidden');
    }

    if (station.bitrate && station.bitrate > 0) {
        metaBitrate.textContent = station.bitrate + ' kbps';
        metaBitrate.classList.remove('hidden');
    } else {
        metaBitrate.classList.add('hidden');
    }

    if (station.codec) {
        metaCodec.textContent = station.codec;
        metaCodec.classList.remove('hidden');
    } else {
        metaCodec.classList.add('hidden');
    }

    if (station.country) {
        metaCountry.textContent = station.country;
        metaCountry.classList.remove('hidden');
    } else {
        metaCountry.classList.add('hidden');
    }

    // Secondary info lines used by the wide layout
    updateStationDetails(station);
}

// Clear metadata display
function clearMetadata() {
    metaGenre.classList.add('hidden');
    metaBitrate.classList.add('hidden');
    metaCodec.classList.add('hidden');
    metaCountry.classList.add('hidden');
    nowPlayingTrack.textContent = '';
}

// Set the station name, enabling marquee scrolling when it overflows
function applyMarquee(el) {
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

function setStationName(text) {
    stationName.textContent = text;
    applyMarquee(stationName);
}

// Show connection / playback status in the now-playing line
function setConnectionState(state) {
    nowPlayingTrack.classList.remove('status-line', 'status-error');
    if (state === 'connecting') {
        nowPlayingTrack.textContent = '⏳ Connecting…';
        nowPlayingTrack.classList.add('status-line');
    } else if (state === 'buffering') {
        nowPlayingTrack.textContent = '⏳ Buffering…';
        nowPlayingTrack.classList.add('status-line');
    } else if (state === 'reconnecting') {
        nowPlayingTrack.textContent = `🔄 Reconnecting… (${reconnectAttempts}/${MAX_RECONNECT})`;
        nowPlayingTrack.classList.add('status-line');
    } else if (state === 'error') {
        nowPlayingTrack.textContent = '⚠ Could not play this station';
        nowPlayingTrack.classList.add('status-error');
    } else if (state === 'playing') {
        nowPlayingTrack.textContent = lastTrackTitle ? '♪ ' + lastTrackTitle : '';
    }
    // Scroll the track line if it overflows its card
    applyMarquee(nowPlayingTrack);
}

// Schedule an automatic reconnect after the stream drops
function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (reconnectAttempts >= MAX_RECONNECT) {
        wantPlayback = false;
        isPlaying = false;
        updatePlayButton();
        stopVisualization();
        setConnectionState('error');
        return;
    }
    reconnectAttempts++;
    setConnectionState('reconnecting');
    reconnectTimer = setTimeout(() => {
        if (wantPlayback && currentStation) {
            playStation();
        }
    }, 2500);
}

// Handle an unexpected stream interruption
function handleStreamDrop(reason) {
    if (!wantPlayback) return;
    console.warn('Stream interrupted:', reason);
    stopMetadataPolling();
    scheduleReconnect();
}

// Fetch ICY metadata from Rust backend
async function fetchStreamMetadata(url) {
    if (!hasTauriApi) return;

    try {
        const { invoke } = window.__TAURI__.core;
        const metadata = await invoke('get_stream_metadata', { url });

        if (metadata && metadata.title) {
            const cleanTitle = metadata.title.trim();
            nowPlayingTrack.textContent = '♪ ' + cleanTitle;
            applyMarquee(nowPlayingTrack);
            showSongNotification(currentStation.name, cleanTitle);
            updateMediaSession(cleanTitle);
        }
    } catch (error) {
        console.error('Metadata fetch error:', error);
    }
}

// Start metadata polling
function startMetadataPolling() {
    stopMetadataPolling();

    if (currentStation && hasTauriApi) {
        const streamUrl = currentStation.url_resolved || currentStation.url;
        fetchStreamMetadata(streamUrl);

        metadataInterval = setInterval(() => {
            if (isPlaying && currentStation) {
                fetchStreamMetadata(streamUrl);
            }
        }, 10000);
    }
}

// Stop metadata polling
function stopMetadataPolling() {
    if (metadataInterval) {
        clearInterval(metadataInterval);
        metadataInterval = null;
    }
}

// Wire OS-level media controls (media keys, lock screen, system widget)
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => { if (currentStation) playStation(); });
    ms.setActionHandler('pause', stopStation);
    ms.setActionHandler('stop', stopStation);
    ms.setActionHandler('previoustrack', prevStation);
    ms.setActionHandler('nexttrack', nextStation);
}

// Update the metadata shown by the OS media controls
function updateMediaSession(trackTitle) {
    if (!('mediaSession' in navigator) || !currentStation) return;
    const artwork = currentStation.favicon || generatePlaceholderLogo(currentStation.name);
    navigator.mediaSession.metadata = new MediaMetadata({
        title: trackTitle || currentStation.name,
        artist: trackTitle ? currentStation.name : (currentStation.country || 'Internet Radio'),
        album: 'Internet Radio',
        artwork: [{ src: artwork, sizes: '512x512', type: artwork.startsWith('data:') ? 'image/svg+xml' : 'image/png' }]
    });
}

// Request Notification Permission
function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
}

// Show Windows System Notification
function showSongNotification(stationName, trackTitle) {
    if ('Notification' in window && Notification.permission === 'granted') {
        if (trackTitle && trackTitle !== lastTrackTitle) {
            lastTrackTitle = trackTitle;
            new Notification(stationName, {
                body: `Now playing: ${trackTitle}`,
                icon: currentStation.favicon || generatePlaceholderLogo(stationName),
                silent: true
            });
        }
    }
}

// Non-blocking toast notification (replaces native alert)
let toastContainer = null;
function toast(message, type = 'info', duration = 3200) {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    toastContainer.appendChild(el);

    setTimeout(() => {
        el.classList.add('toast-out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
}

// Helper function to adjust color brightness
function adjustBrightness(hexColor, factor) {
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const newR = Math.min(255, Math.round(r * factor));
    const newG = Math.min(255, Math.round(g * factor));
    const newB = Math.min(255, Math.round(b * factor));

    return `rgb(${newR}, ${newG}, ${newB})`;
}

// Build the audio graph once: source -> EQ filter chain -> analyser ->
// destination. The graph is created the first time playback starts and is
// independent of the visualizer, so the equalizer works even when the
// visualizer is turned off. createMediaElementSource can only be called once
// per media element, hence the idempotent guard.
function ensureAudioGraph() {
    if (audioContext) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        smoothedData = new Float32Array(analyser.frequencyBinCount);

        sourceNode = audioContext.createMediaElementSource(audioPlayer);

        eqFilters = EQ_BANDS.map((band) => {
            const filter = audioContext.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.freq;
            filter.Q.value = 1;
            filter.gain.value = 0;
            return filter;
        });

        compressorNode = audioContext.createDynamicsCompressor();

        let node = sourceNode;
        eqFilters.forEach((filter) => {
            node.connect(filter);
            node = filter;
        });
        node.connect(compressorNode);
        compressorNode.connect(analyser);
        analyser.connect(audioContext.destination);

        applyEqGains();
        applyNormalization();
    } catch (error) {
        console.error('Audio graph setup error:', error);
    }
}

// Drive the compressor as a loudness leveller. When disabled it is configured
// transparently (ratio 1), so it can stay wired into the graph permanently.
function applyNormalization() {
    if (!compressorNode) return;
    if (settings.normalizeEnabled) {
        compressorNode.threshold.value = -24;
        compressorNode.knee.value = 30;
        compressorNode.ratio.value = 6;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.25;
    } else {
        compressorNode.threshold.value = 0;
        compressorNode.knee.value = 0;
        compressorNode.ratio.value = 1;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.25;
    }
}

// Push the current equalizer settings onto the filter chain. When the EQ is
// disabled every band is forced flat (0 dB), so the chain stays transparent.
function applyEqGains() {
    if (!eqFilters.length) return;
    eqFilters.forEach((filter, i) => {
        const gain = settings.eqEnabled ? (settings.eqGains[i] || 0) : 0;
        filter.gain.value = gain;
    });
}

function drawVisualization() {
    if (!settings.visualizerEnabled || !analyser) return;

    const ctx = visualizerCanvas.getContext('2d');
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;

    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, width, height);

    const baseColor = settings.visualizerColor || '#00b894';
    const sensitivity = settings.visualizerSensitivity || 1.0;
    const style = settings.visualizerStyle || 'bars';

    if (style === 'bars' || style === 'peaks') {
        const numBars = 24;
        const barWidth = width / numBars;
        const gap = 3;
        const smoothing = 0.65;
        const usableDataLength = Math.floor(dataArray.length * 0.6);

        // Explicitly disable any blur left over from other presets
        ctx.shadowBlur = 0;

        // Initialise peaks and hold if missing or the bar count changed
        if (style === 'peaks' && (!barPeaks || barPeaks.length !== numBars)) {
            barPeaks = new Float32Array(numBars).fill(height);
            peakHold = new Int32Array(numBars).fill(0);
        }

        for (let i = 0; i < numBars; i++) {
            const startFreq = Math.floor((i / numBars) * usableDataLength);
            const endFreq = Math.floor(((i + 1) / numBars) * usableDataLength);

            let sum = 0;
            let count = Math.max(1, endFreq - startFreq);
            for (let j = startFreq; j < endFreq && j < usableDataLength; j++) {
                sum += dataArray[j];
            }
            const value = (sum / count) * sensitivity;

            if (smoothedData) {
                smoothedData[i] = smoothedData[i] * smoothing + value * (1 - smoothing);
            }

            const barHeight = Math.max(3, (smoothedData[i] / 255) * height);

            // Draw the main bar (crisp, no shadow)
            ctx.fillStyle = baseColor;

            const x = i * barWidth + gap / 2;
            const w = barWidth - gap;
            const y = height - barHeight;

            ctx.beginPath();
            ctx.roundRect(x, y, w, barHeight, [2, 2, 0, 0]);
            ctx.fill();

            // Peak effect (hold then fall)
            if (style === 'peaks') {
                const peakY = height - barHeight - 4; // Position above the bar

                if (peakY < barPeaks[i]) {
                    barPeaks[i] = peakY;
                    peakHold[i] = 30; // Hold time before the peak falls
                } else {
                    if (peakHold[i] > 0) {
                        peakHold[i]--;
                    } else {
                        barPeaks[i] += 1.5; // Slightly faster fall for sharpness
                    }
                }

                if (barPeaks[i] > height - 4) barPeaks[i] = height - 4;

                // Draw the peak in the same colour as the bar
                ctx.fillStyle = baseColor; 
                ctx.beginPath();
                ctx.roundRect(x, barPeaks[i], w, 2, [0, 0, 0, 0]);
                ctx.fill();
            }
        }
    } else if (style === 'wave') {
        analyser.getByteTimeDomainData(dataArray);

        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = baseColor;
        ctx.shadowBlur = 8;
        ctx.shadowColor = baseColor;

        const sliceWidth = width / dataArray.length;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height / 2) + ((v - 1.0) * (height / 2) * (sensitivity - 1.0));

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.shadowBlur = 0; 
    } else if (style === 'circle') {
        const centerX = width / 2;
        const centerY = height / 2;
        const radiusX = (width / 2) * 0.8;
        const radiusY = (height / 2) * 0.6;
        const numBars = 64;
        // Use the lower/mid part of the data where most activity is
        const usableDataLength = Math.floor(dataArray.length * 0.55);

        ctx.shadowBlur = 10;
        ctx.shadowColor = baseColor;

        for (let i = 0; i < numBars; i++) {
            // Use a denser frequency mapping
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = dataArray[freqIndex] * sensitivity;
            const barHeight = (value / 255) * 25;

            const angle = (i / numBars) * Math.PI * 2;

            const x1 = centerX + Math.cos(angle) * radiusX;
            const y1 = centerY + Math.sin(angle) * radiusY;

            const x2 = centerX + Math.cos(angle) * (radiusX + barHeight);
            const y2 = centerY + Math.sin(angle) * (radiusY + barHeight);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.strokeStyle = baseColor;
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
    } else if (style === 'mirror') {
        const numBars = 32;
        const barWidth = width / numBars;
        const usableDataLength = Math.floor(dataArray.length * 0.6);
        const centerY = height / 2;

        for (let i = 0; i < numBars; i++) {
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = (dataArray[freqIndex] / 255) * (height / 2) * sensitivity;
            
            const x = i * barWidth;
            const w = barWidth - 2;
            
            ctx.fillStyle = baseColor;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(x, centerY - value, w, value);
            
            ctx.fillStyle = adjustBrightness(baseColor, 0.6);
            ctx.globalAlpha = 0.4;
            ctx.fillRect(x, centerY, w, value);
            ctx.globalAlpha = 1.0;
        }
    } else if (style === 'dance') {
        const numBars = 20;
        const barWidth = width / numBars;
        const gap = 4;
        const centerY = height / 2;
        const usableDataLength = Math.floor(dataArray.length * 0.5);

        // Measure bass intensity to pulse the "stage"
        let bassSum = 0;
        for (let j = 0; j < 5; j++) bassSum += dataArray[j];
        const bassInten = (bassSum / (5 * 255)) * sensitivity;
        
        // Draw a soft background glow pulsing with the bass
        if (bassInten > 0.4) {
            const glow = ctx.createRadialGradient(width/2, centerY, 10, width/2, centerY, width/2);
            glow.addColorStop(0, adjustBrightness(baseColor, 0.3));
            glow.addColorStop(1, 'transparent');
            ctx.globalAlpha = bassInten * 0.2;
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, width, height);
            ctx.globalAlpha = 1.0;
        }

        for (let i = 0; i < numBars; i++) {
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = (dataArray[freqIndex] / 255) * (height / 2.5) * sensitivity;
            
            const x = i * barWidth + gap / 2;
            const w = barWidth - gap;
            const yTop = centerY - value - 2;
            const barHeight = (value * 2) + 4;

            // Gradient effect from centre to edges
            const grad = ctx.createLinearGradient(0, centerY - value, 0, centerY + value);
            grad.addColorStop(0, adjustBrightness(baseColor, 1.5));
            grad.addColorStop(0.5, baseColor);
            grad.addColorStop(1, adjustBrightness(baseColor, 1.5));

            ctx.fillStyle = grad;
            ctx.shadowBlur = 12 * (value / (height/2));
            ctx.shadowColor = baseColor;
            
            ctx.beginPath();
            ctx.roundRect(x, yTop, w, barHeight, [w/2, w/2, w/2, w/2]);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }

    animationId = requestAnimationFrame(drawVisualization);
}

function startVisualization() {
    if (!settings.visualizerEnabled) return;

    ensureAudioGraph();

    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }

    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;

    drawVisualization();
}

function stopVisualization() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (smoothedData) {
        smoothedData.fill(0);
    }

    const ctx = visualizerCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
}

// Select and play station
function selectStation(station, itemElement) {
    currentStation = station;
    lastStation = station;
    saveSetting('lastStation', station);

    setStationName(station.name);
    updateMetadata(station);
    updateCurrentStationInfo();

    stationLogo.classList.remove('hidden');
    const logoSrc = station.favicon || generatePlaceholderLogo(station.name);
    if (station.favicon) {
        stationLogo.src = station.favicon;
        stationLogo.onerror = function() {
            this.src = generatePlaceholderLogo(station.name);
            this.onerror = null;
        };
    } else {
        stationLogo.src = logoSrc;
    }
    if (trackCardThumb) trackCardThumb.style.backgroundImage = `url("${logoSrc}")`;

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

// Shared playback success / error handlers
function onPlaySuccess() {
    isPlaying = true;
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    // Fade the audio in from silence to the user's chosen volume
    fadeTo(targetVolume());
    updatePlayButton();
    startMetadataPolling();
    // Build the audio graph (and resume it) so the equalizer applies even
    // when the visualizer is disabled.
    ensureAudioGraph();
    if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    startVisualization();
    startLiveTimer();
    addToRecentlyPlayed(currentStation);
    reportStationClick(currentStation);
    updateMediaSession();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
}

function onPlayError(error) {
    console.error('Play error:', error);
    if (wantPlayback) {
        scheduleReconnect();
    } else {
        isPlaying = false;
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
    if (proxyHlsLoader) return proxyHlsLoader;
    const BaseLoader = Hls.DefaultConfig.loader;
    proxyHlsLoader = class ProxyHlsLoader extends BaseLoader {
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
    return proxyHlsLoader;
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
        hls = new Hls({
            enableWorker: false,
            loader: getProxyHlsLoader()
        });
        hls.loadSource(url);
        hls.attachMedia(audioPlayer);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            audioPlayer.play().then(onSuccess).catch(onError);
        });
        hls.on(Hls.Events.ERROR, (evt, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
            } else {
                onError(new Error('HLS: ' + data.details));
            }
        });
    } else if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (e.g. Safari)
        audioPlayer.src = getProxiedUrl(url);
        audioPlayer.play().then(onSuccess).catch(onError);
    } else {
        onError(new Error('HLS is not supported'));
    }
}

// Play current station
function playStation() {
    if (!currentStation) return;

    // Stop any active recording when switching to a new station
    if (isRecording) stopRecording();

    wantPlayback = true;
    lastTrackTitle = '';
    clearTimeout(reconnectTimer);
    setConnectionState('connecting');

    // Start silent so playback can fade in once the stream begins
    cancelFade();
    audioPlayer.volume = 0;

    // Tear down any previous HLS instance before switching streams
    if (hls) {
        hls.destroy();
        hls = null;
    }

    const streamUrl = currentStation.url_resolved || currentStation.url;

    if (isHlsStream(currentStation, streamUrl)) {
        playHlsStation(streamUrl);
    } else {
        // Route stream URL through local CORS proxy
        audioPlayer.src = getProxiedUrl(streamUrl);
        audioPlayer.play().then(onPlaySuccess).catch(onPlayError);
    }
}

// Stop playback
function stopStation() {
    wantPlayback = false;
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    stopMetadataPolling();
    if (isRecording) stopRecording();

    // Cut the stream and tear everything down once the fade-out finishes
    const finalize = () => {
        audioPlayer.pause();
        if (hls) {
            hls.destroy();
            hls = null;
        }
        audioPlayer.src = '';
        // Leave the element at the user's level for the next play
        audioPlayer.volume = targetVolume();
        stopVisualization();
    };

    isPlaying = false;
    updatePlayButton();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    stopLiveTimer();
    nowPlayingTrack.textContent = '';
    nowPlayingTrack.classList.remove('marquee');
    if (previewBtn) {
        previewBtn.textContent = 'Preview';
    }

    // Smoothly fade the audio out before stopping (visualizer keeps animating)
    fadeTo(0, finalize);
}

// Toggle play/pause
async function togglePlay() {
    if (isPlaying) {
        stopStation();
    } else if (currentStation) {
        playStation();
    } else {
        await searchStations('', 'pop');
        if (currentStationsList.length > 0) {
            const firstItem = document.querySelector('.station-item');
            selectStation(currentStationsList[0], firstItem);
        }
    }
}

// Update play button appearance
function updatePlayButton() {
    if (isPlaying) {
        playIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z" fill="currentColor"/></svg>`;
        playBtn.classList.add('playing');
    } else {
        playIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
        playBtn.classList.remove('playing');
    }
    // Drive the LIVE badges and the "ON AIR" indicator
    appContainer.classList.toggle('playing', isPlaying);
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

// Recently played functions
async function addToRecentlyPlayed(station) {
    if (!station || !station.stationuuid || station.stationuuid.startsWith('preview_')) return;

    recentlyPlayed = recentlyPlayed.filter(s => s.stationuuid !== station.stationuuid);
    recentlyPlayed.unshift(station);
    if (recentlyPlayed.length > 10) {
        recentlyPlayed.pop();
    }

    localStorage.setItem('recentlyPlayed', JSON.stringify(recentlyPlayed));

    if (db) {
        try {
            await db.execute('DELETE FROM recently_played WHERE stationuuid = $1', [station.stationuuid]);
            await db.execute(
                'INSERT INTO recently_played (stationuuid, name, url, favicon, timestamp) VALUES ($1, $2, $3, $4, $5)',
                [station.stationuuid, station.name, station.url, station.favicon || '', Date.now()]
            );
        } catch (e) {
            console.error('Save recently played error:', e);
        }
    }

    renderRecentlyPlayed();
}

function renderRecentlyPlayed() {
    if (recentlyPlayed.length === 0) {
        recentlyPlayedSection.classList.add('hidden');
        return;
    }

    recentlyPlayedSection.classList.remove('hidden');
    recentlyPlayedList.innerHTML = '';

    recentlyPlayed.forEach(station => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        if (currentStation && currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
        }

        const logo = document.createElement('img');
        logo.className = 'recent-item-logo';
        logo.src = station.favicon || generatePlaceholderLogo(station.name);
        logo.onerror = function() {
            this.src = generatePlaceholderLogo(station.name);
            this.onerror = null;
        };

        const nameSpan = document.createElement('span');
        nameSpan.textContent = station.name;

        item.appendChild(logo);
        item.appendChild(nameSpan);

        item.addEventListener('click', () => {
            // Find in current lists or swap list context to recentlyPlayed
            currentStationsList = recentlyPlayed;
            currentStationIndex = recentlyPlayed.findIndex(s => s.stationuuid === station.stationuuid);
            selectStation(station, item);
        });

        recentlyPlayedList.appendChild(item);
    });
}

// Track history: log a heard track title (ICY metadata)
async function addToTrackHistory(title, station) {
    if (!title) return;
    // Skip consecutive duplicates (the same song is polled several times)
    if (trackHistory.length > 0 && trackHistory[0].title === title) return;

    const entry = {
        title,
        stationName: station ? station.name : '',
        favicon: station ? (station.favicon || '') : '',
        timestamp: Date.now()
    };
    trackHistory.unshift(entry);
    if (trackHistory.length > 50) trackHistory.pop();

    localStorage.setItem('trackHistory', JSON.stringify(trackHistory));

    if (db) {
        try {
            await db.execute(
                'INSERT INTO track_history (title, station_name, favicon, timestamp) VALUES ($1, $2, $3, $4)',
                [entry.title, entry.stationName, entry.favicon, entry.timestamp]
            );
            // Keep only the newest 50 rows
            await db.execute(
                'DELETE FROM track_history WHERE id NOT IN (SELECT id FROM track_history ORDER BY timestamp DESC LIMIT 50)'
            );
        } catch (e) {
            console.error('Save track history error:', e);
        }
    }

    renderTrackHistory();
}

function renderTrackHistory() {
    if (!trackHistoryList) return;

    if (trackHistory.length === 0) {
        trackHistoryList.replaceChildren();
        const hint = document.createElement('div');
        hint.className = 'loading-hint';
        hint.textContent = 'History is empty';
        trackHistoryList.appendChild(hint);
        return;
    }

    trackHistoryList.replaceChildren();
    trackHistory.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'track-history-item';

        const info = document.createElement('div');
        info.className = 'track-history-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'track-history-title';
        titleEl.textContent = entry.title;

        const meta = document.createElement('div');
        meta.className = 'track-history-meta';
        const time = new Date(entry.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        meta.textContent = [entry.stationName, time].filter(Boolean).join('  ·  ');

        info.append(titleEl, meta);

        const ytBtn = document.createElement('button');
        ytBtn.className = 'action-btn track-history-yt';
        ytBtn.title = 'Find on YouTube';
        ytBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z" fill="currentColor"/></svg>`;
        ytBtn.addEventListener('click', () => openYouTubeSearch(entry.title));

        item.append(info, ytBtn);
        trackHistoryList.appendChild(item);
    });
}

async function clearTrackHistory() {
    trackHistory = [];
    localStorage.setItem('trackHistory', '[]');
    if (db) {
        try { await db.execute('DELETE FROM track_history'); }
        catch (e) { console.error('Clear track history error:', e); }
    }
    renderTrackHistory();
    toast('Track history cleared', 'success');
}

// Try to get favicon from domain
function getFaviconFromUrl(streamUrl) {
    try {
        const urlObj = new URL(streamUrl);
        return `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
    } catch (e) {
        return '';
    }
}

// Generate placeholder logo with first letter
function generatePlaceholderLogo(name) {
    const letter = (name || 'R').charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const color = `hsl(${hue}, 60%, 45%)`;
    const lightColor = `hsl(${hue}, 60%, 65%)`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${lightColor}"/>
                <stop offset="100%" style="stop-color:${color}"/>
            </linearGradient>
        </defs>
        <rect width="64" height="64" rx="8" fill="url(#grad)"/>
        <text x="32" y="44" font-family="'Outfit', sans-serif" font-size="32" font-weight="bold" fill="white" text-anchor="middle">${letter}</text>
    </svg>`;

    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Preview custom station URL
function previewCustomUrl() {
    if (isPlaying && currentStation && currentStation.stationuuid && currentStation.stationuuid.startsWith('preview_')) {
        stopStation();
        previewBtn.textContent = 'Preview';
        return;
    }

    const url = customUrlInput.value.trim();
    if (!url) {
        toast('Enter a stream URL', 'error');
        return;
    }

    const name = customNameInput.value.trim() || 'Preview';
    const favicon = getFaviconFromUrl(url);

    const tempStation = {
        stationuuid: 'preview_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: customGenreInput.value.trim(),
        country: 'Preview',
        favicon: favicon
    };

    currentStation = tempStation;
    setStationName(name + ' (Test)');

    stationLogo.classList.remove('hidden');
    if (favicon) {
        stationLogo.src = favicon;
        stationLogo.onerror = function() {
            this.src = generatePlaceholderLogo(name);
            this.onerror = null;
        };
    } else {
        stationLogo.src = generatePlaceholderLogo(name);
    }

    updateCurrentStationInfo();

    // Tear down any previous HLS instance
    if (hls) {
        hls.destroy();
        hls = null;
    }

    // Start silent so the preview can fade in
    cancelFade();
    audioPlayer.volume = 0;

    const onPreviewOk = () => {
        isPlaying = true;
        fadeTo(targetVolume());
        updatePlayButton();
        ensureAudioGraph();
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        startVisualization();
        previewBtn.textContent = 'Stop';
    };
    const onPreviewError = (error) => {
        console.error('Preview error:', error);
        toast('Failed to play URL: ' + (error && error.message ? error.message : error), 'error');
        isPlaying = false;
        updatePlayButton();
        previewBtn.textContent = 'Preview';
    };

    if (isHlsStream(tempStation, url)) {
        playHlsStation(url, onPreviewOk, onPreviewError);
    } else {
        audioPlayer.src = getProxiedUrl(url);
        audioPlayer.play().then(onPreviewOk).catch(onPreviewError);
    }
}

// Add custom station
async function addCustomStation() {
    const name = customNameInput.value.trim();
    const url = customUrlInput.value.trim();
    const genre = customGenreInput.value.trim();

    if (!name || !url) {
        toast('Enter a station name and URL', 'error');
        return;
    }

    const station = {
        stationuuid: 'custom_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: genre,
        country: 'Custom station',
        favicon: getFaviconFromUrl(url),
        bitrate: 0,
        codec: ''
    };

    customStations.push(station);
    localStorage.setItem('customStations', JSON.stringify(customStations));

    if (db) {
        try {
            await db.execute(
                'INSERT OR REPLACE INTO custom_stations (stationuuid, name, url, genre, data) VALUES ($1, $2, $3, $4, $5)',
                [station.stationuuid, station.name, station.url, genre, JSON.stringify(station)]
            );
        } catch (e) { console.error('Save custom station error:', e); }
    }

    customNameInput.value = '';
    customUrlInput.value = '';
    customGenreInput.value = '';

    renderCustomStations();
}

// Remove custom station
async function removeCustomStation(stationuuid) {
    customStations = customStations.filter(s => s.stationuuid !== stationuuid);
    localStorage.setItem('customStations', JSON.stringify(customStations));
    if (db) {
        try {
            await db.execute('DELETE FROM custom_stations WHERE stationuuid = $1', [stationuuid]);
        } catch (e) { console.error('Delete custom station error:', e); }
    }
    renderCustomStations();
}

// Open Edit custom station modal
function openEditModal(station) {
    editStationUuidInput.value = station.stationuuid;
    editStationNameInput.value = station.name;
    editStationUrlInput.value = station.url;
    editStationGenreInput.value = station.tags || station.genre || '';
    editModal.classList.remove('hidden');
}

// Save edited custom station
async function saveEditedStation() {
    const uuid = editStationUuidInput.value;
    const name = editStationNameInput.value.trim();
    const url = editStationUrlInput.value.trim();
    const genre = editStationGenreInput.value.trim();

    if (!name || !url) {
        toast('Enter a name and URL', 'error');
        return;
    }

    const index = customStations.findIndex(s => s.stationuuid === uuid);
    if (index !== -1) {
        customStations[index].name = name;
        customStations[index].url = url;
        customStations[index].url_resolved = url;
        customStations[index].tags = genre;
        customStations[index].genre = genre;
        customStations[index].favicon = getFaviconFromUrl(url);

        localStorage.setItem('customStations', JSON.stringify(customStations));

        if (db) {
            try {
                await db.execute(
                    'UPDATE custom_stations SET name = $1, url = $2, genre = $3, data = $4 WHERE stationuuid = $5',
                    [name, url, genre, JSON.stringify(customStations[index]), uuid]
                );
            } catch (e) { console.error('Update custom station error:', e); }
        }

        renderCustomStations();
        updateCurrentStationInfo();

        if (currentStation && currentStation.stationuuid === uuid) {
            setStationName(name);
            currentStation = customStations[index];
            if (isPlaying) {
                playStation();
            }
        }
    }

    editModal.classList.add('hidden');
}

// Render custom stations list
function renderCustomStations() {
    if (customStations.length === 0) {
        customStationsList.innerHTML = '<div class="loading-hint">No custom stations</div>';
        return;
    }

    customStationsList.innerHTML = '';

    customStations.forEach((station, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        if (currentStation && currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
        }

        const logo = document.createElement('img');
        logo.className = 'station-item-logo';
        if (station.favicon) {
            logo.src = station.favicon;
            logo.onerror = function() {
                this.src = generatePlaceholderLogo(station.name);
                this.onerror = null;
            };
        } else {
            logo.src = generatePlaceholderLogo(station.name);
        }

        const info = document.createElement('div');
        info.className = 'station-item-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'station-item-name';
        nameEl.textContent = station.name;

        const urlEl = document.createElement('div');
        urlEl.className = 'station-item-country';
        urlEl.textContent = station.url.substring(0, 40) + (station.url.length > 40 ? '...' : '');

        const actions = document.createElement('div');
        actions.className = 'list-actions';

        // Favorite
        const favoriteBtn = document.createElement('button');
        favoriteBtn.className = 'action-btn favorite-btn' + (isFavorite(station.stationuuid) ? ' active' : '');
        if (isFavorite(station.stationuuid)) {
            favoriteBtn.innerHTML = HEART_FILLED_SVG;
        } else {
            favoriteBtn.innerHTML = HEART_OUTLINE_SVG;
        }
        favoriteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(station, favoriteBtn);
        });

        // Edit
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit-btn';
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
        editBtn.title = 'Edit';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(station);
        });

        // Delete
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn delete-btn';
        deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCustomStation(station.stationuuid);
        });

        info.appendChild(nameEl);
        info.appendChild(urlEl);
        item.appendChild(logo);
        item.appendChild(info);
        actions.appendChild(favoriteBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(actions);

        item.addEventListener('click', () => {
            currentStationsList = customStations;
            currentStationIndex = index;
            selectStation(station, item);
        });

        item.dataset.stationuuid = station.stationuuid;
        customStationsList.appendChild(item);
    });

    setupDragReorder(customStationsList, customStations, saveCustomOrder);
}

// Export/Import
async function exportToJson(data, defaultFilename) {
    if (hasTauriApi) {
        try {
            const { save } = window.__TAURI__.dialog;
            const { writeTextFile } = window.__TAURI__.fs;

            const filePath = await save({
                defaultPath: defaultFilename,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (filePath) {
                await writeTextFile(filePath, JSON.stringify(data, null, 2));
            }
        } catch (error) {
            console.error('Export error:', error);
            toast('Export error: ' + error.message, 'error');
        }
    } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

async function exportFavorites() {
    if (favorites.length === 0) {
        toast('No favorite stations to export', 'error');
        return;
    }
    await exportToJson(favorites, 'radio-favorites.json');
}

// Export current playing station
async function exportCurrentStation() {
    if (!currentStation) {
        toast('No active station', 'error');
        return;
    }
    await exportToJson([currentStation], `${currentStation.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
}

// Update current station info in Custom tab
function updateCurrentStationInfo() {
    if (!currentStationInfo) return;

    if (!currentStation) {
        currentStationInfo.innerHTML = '<div class="current-station-empty">No active station</div>';
        return;
    }

    const s = currentStation;
    const genre = s.tags ? s.tags.split(',')[0] : '';
    const fallbackLogo = generatePlaceholderLogo(s.name);
    const logoSrc = s.favicon || fallbackLogo;

    // Build the form with DOM APIs (not innerHTML) so station names/URLs
    // from the public Radio Browser catalog cannot inject markup (XSS).
    currentStationInfo.replaceChildren();
    const form = document.createElement('div');
    form.className = 'current-station-form';

    const logo = document.createElement('img');
    logo.className = 'current-station-logo';
    logo.src = logoSrc;
    logo.onerror = function () { this.src = fallbackLogo; this.onerror = null; };

    const makeField = (value, placeholder) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.placeholder = placeholder;
        input.value = value || '';
        return input;
    };

    const exportButton = document.createElement('button');
    exportButton.className = 'btn-export';
    exportButton.textContent = 'Export';
    exportButton.addEventListener('click', exportCurrentStation);

    form.append(
        logo,
        makeField(s.name, 'Name'),
        makeField(s.url_resolved || s.url, 'Stream URL'),
        makeField(genre, 'Genre'),
        exportButton
    );
    currentStationInfo.appendChild(form);
}

// Parse an M3U / M3U8 playlist into {name, url} entries
function parseM3U(text) {
    const stations = [];
    let pendingName = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.toUpperCase().startsWith('#EXTINF:')) {
            const comma = line.indexOf(',');
            pendingName = comma >= 0 ? line.slice(comma + 1).trim() : '';
        } else if (!line.startsWith('#')) {
            stations.push({ name: pendingName || line, url: line });
            pendingName = '';
        }
    }
    return stations;
}

// Parse a PLS playlist into {name, url} entries
function parsePLS(text) {
    const files = {};
    const titles = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const fileMatch = line.match(/^File(\d+)\s*=\s*(.+)$/i);
        const titleMatch = line.match(/^Title(\d+)\s*=\s*(.+)$/i);
        if (fileMatch) files[fileMatch[1]] = fileMatch[2].trim();
        else if (titleMatch) titles[titleMatch[1]] = titleMatch[2].trim();
    }
    return Object.keys(files).map(n => ({ name: titles[n] || files[n], url: files[n] }));
}

// Parse an OPML document into {name, url} entries
function parseOPML(text) {
    const stations = [];
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    doc.querySelectorAll('outline').forEach(outline => {
        const url = outline.getAttribute('url') || outline.getAttribute('xmlUrl') || outline.getAttribute('URL');
        const name = outline.getAttribute('text') || outline.getAttribute('title') || url;
        if (url && /^https?:/i.test(url)) {
            stations.push({ name: name, url: url });
        }
    });
    return stations;
}

// Add parsed {name, url} entries to the custom stations list
async function importPlaylistStations(entries) {
    let added = 0;
    for (const entry of entries) {
        if (!entry.url || !/^https?:/i.test(entry.url)) continue;
        if (customStations.some(s => s.url === entry.url)) continue;

        const station = {
            stationuuid: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: entry.name || 'Imported station',
            url: entry.url,
            url_resolved: entry.url,
            tags: '',
            country: 'Imported',
            favicon: getFaviconFromUrl(entry.url),
            bitrate: 0,
            codec: ''
        };
        customStations.push(station);
        added++;

        if (db) {
            try {
                await db.execute(
                    'INSERT OR REPLACE INTO custom_stations (stationuuid, name, url, genre, data) VALUES ($1, $2, $3, $4, $5)',
                    [station.stationuuid, station.name, station.url, '', JSON.stringify(station)]
                );
            } catch (e) { console.error('Import playlist error:', e); }
        }
    }
    localStorage.setItem('customStations', JSON.stringify(customStations));
    renderCustomStations();
    toast(`Stations imported: ${added}`, 'success');
}

// Import the app's own JSON export format (favorites or custom stations)
function importStationsJson(text) {
    const data = JSON.parse(text);

    if (!Array.isArray(data)) {
        toast('Invalid file format', 'error');
        return;
    }

    const isCustom = data.some(s => s.stationuuid && s.stationuuid.startsWith('custom_'));

    if (isCustom) {
        for (const station of data) {
            if (!customStations.some(s => s.stationuuid === station.stationuuid)) {
                customStations.push(station);
                if (db) {
                    db.execute(
                        'INSERT OR REPLACE INTO custom_stations (stationuuid, name, url, genre, data) VALUES ($1, $2, $3, $4, $5)',
                        [station.stationuuid, station.name, station.url, station.tags || '', JSON.stringify(station)]
                    ).catch(e => console.error('Import custom error:', e));
                }
            }
        }
        localStorage.setItem('customStations', JSON.stringify(customStations));
        renderCustomStations();
        toast('Custom stations imported', 'success');
    } else {
        for (const station of data) {
            if (!favorites.some(f => f.stationuuid === station.stationuuid)) {
                favorites.push(station);
                if (db) {
                    db.execute(
                        'INSERT OR REPLACE INTO favorites (stationuuid, name, url, url_resolved, favicon, country, data) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                        [station.stationuuid, station.name, station.url, station.url_resolved || '', station.favicon || '', station.country || '', JSON.stringify(station)]
                    ).catch(e => console.error('Import favorite error:', e));
                }
            }
        }
        localStorage.setItem('favorites', JSON.stringify(favorites));
        toast('Favorites imported', 'success');
    }
}

// Import stations from a JSON, M3U/M3U8, PLS or OPML file
function importStations(event) {
    const file = event.target.files[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    const reader = new FileReader();

    reader.onload = (e) => {
        const text = e.target.result;
        try {
            if (ext === 'm3u' || ext === 'm3u8') {
                importPlaylistStations(parseM3U(text));
            } else if (ext === 'pls') {
                importPlaylistStations(parsePLS(text));
            } else if (ext === 'opml' || ext === 'xml') {
                importPlaylistStations(parseOPML(text));
            } else {
                importStationsJson(text);
            }
        } catch (error) {
            toast('File read error: ' + error.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
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

// Settings
async function toggleCompactMode(forceCompact = null) {
    if (forceCompact !== null) {
        settings.compactMode = forceCompact;
        compactModeCheckbox.checked = forceCompact;
    } else {
        settings.compactMode = compactModeCheckbox.checked;
    }
    saveSetting('compactMode', settings.compactMode);

    // The compact widget reuses the wide studio player card; only the
    // header and the search / stations sidebar are hidden (via CSS).
    if (settings.compactMode) {
        appContainer.classList.add('compact', 'wide');
    } else {
        appContainer.classList.remove('compact');
        appContainer.classList.toggle('wide', settings.wideMode);
    }

    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();

            if (settings.compactMode) {
                // Fit the widget height to the player card. Apply the compact
                // width first, wait for the webview to reflow, then shrink the
                // window so its content area matches the card exactly. The
                // title-bar height self-calibrates — no window getters needed.
                const W = window.__TAURI__.window;
                await appWindow.setMinSize(new W.LogicalSize(380, 420));
                const reflowed = waitForWindowResize();
                await appWindow.setSize(new W.LogicalSize(470, 740));
                await reflowed;
                const cardHeight = playerSection.getBoundingClientRect().height;
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
    applyMarquee(stationName);
    applyMarquee(nowPlayingTrack);
}

function enterCompactMode() {
    toggleCompactMode(true);
}

function exitCompactMode() {
    toggleCompactMode(false);
}

async function toggleAlwaysOnTop() {
    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();
            isAlwaysOnTop = !isAlwaysOnTop;
            await appWindow.setAlwaysOnTop(isAlwaysOnTop);
            alwaysOnTopBtn.classList.toggle('active', isAlwaysOnTop);
        } catch (e) {
            console.error('Failed to toggle always on top:', e);
        }
    }
}

function toggleVisualizer() {
    settings.visualizerEnabled = visualizerEnabledCheckbox.checked;
    saveSetting('visualizerEnabled', settings.visualizerEnabled);

    if (settings.visualizerEnabled) {
        visualizerCanvas.classList.remove('hidden');
        if (isPlaying) {
            startVisualization();
        }
    } else {
        visualizerCanvas.classList.add('hidden');
        stopVisualization();
    }
}

// Preset gain curves, in band order [60, 250, 1K, 4K, 12K] (dB)
const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    bass: [8, 5, 1, 0, 0],
    treble: [0, 0, 1, 5, 8],
    vocal: [-3, 0, 4, 4, 1],
    rock: [5, 2, -1, 3, 5]
};

// Build the per-band sliders once and reflect the saved EQ state.
function buildEqUi() {
    if (!eqBandsContainer) return;
    eqBandsContainer.innerHTML = '';

    EQ_BANDS.forEach((band, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'eq-band';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'custom-slider eq-slider';
        slider.min = '-12';
        slider.max = '12';
        slider.step = '1';
        slider.value = String(settings.eqGains[i] || 0);
        slider.dataset.band = String(i);
        slider.addEventListener('input', onEqSliderInput);

        const label = document.createElement('span');
        label.className = 'eq-band-label';
        label.textContent = band.label;

        wrap.appendChild(slider);
        wrap.appendChild(label);
        eqBandsContainer.appendChild(wrap);
    });

    eqEnabledCheckbox.checked = settings.eqEnabled;
    updateEqDisabledState();
}

// Dim and disable the band sliders/preset when the EQ is switched off.
function updateEqDisabledState() {
    const off = !settings.eqEnabled;
    eqBandsContainer.classList.toggle('disabled', off);
    eqPresetSelect.disabled = off;
    eqBandsContainer.querySelectorAll('.eq-slider').forEach((s) => { s.disabled = off; });
}

function onEqSliderInput(e) {
    const i = parseInt(e.target.dataset.band, 10);
    settings.eqGains[i] = parseInt(e.target.value, 10);
    applyEqGains();
    saveSetting('eqGains', settings.eqGains);
}

function toggleEq() {
    settings.eqEnabled = eqEnabledCheckbox.checked;
    saveSetting('eqEnabled', settings.eqEnabled);
    updateEqDisabledState();
    applyEqGains();
}

function applyEqPreset() {
    const preset = EQ_PRESETS[eqPresetSelect.value];
    if (!preset) return;
    settings.eqGains = preset.slice();
    eqBandsContainer.querySelectorAll('.eq-slider').forEach((s, i) => {
        s.value = String(settings.eqGains[i]);
    });
    applyEqGains();
    saveSetting('eqGains', settings.eqGains);
}

function toggleNormalization() {
    settings.normalizeEnabled = normalizeCheckbox.checked;
    saveSetting('normalizeEnabled', settings.normalizeEnabled);
    applyNormalization();
}

// --- Stream recording -------------------------------------------------------

let isRecording = false;

function sanitizeFilename(name) {
    return (name || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

// Map a station codec to a sensible file extension for the saved capture.
function recordingExtension(station) {
    const codec = (station && station.codec ? station.codec : '').toUpperCase();
    if (codec.includes('AAC')) return 'aac';
    if (codec.includes('OGG') || codec.includes('VORBIS') || codec.includes('OPUS')) return 'ogg';
    if (codec.includes('FLAC')) return 'flac';
    return 'mp3';
}

async function toggleRecording() {
    if (!hasTauriApi) {
        toast('Recording is only available in the desktop app', 'error');
        return;
    }
    if (isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if (!currentStation) {
        toast('Start playing a station first', 'error');
        return;
    }
    const { invoke } = window.__TAURI__.core;
    const { save } = window.__TAURI__.dialog;

    const ext = recordingExtension(currentStation);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const defaultName = `${sanitizeFilename(currentStation.name)}_${stamp}.${ext}`;

    try {
        const path = await save({
            defaultPath: defaultName,
            filters: [{ name: 'Audio', extensions: [ext] }]
        });
        if (!path) return;

        const url = currentStation.url_resolved || currentStation.url;
        await invoke('start_recording', { url, path });
        isRecording = true;
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
    isRecording = false;
    updateRecordButton();
    toast('Recording saved', 'info');
}

function updateRecordButton() {
    if (!recordBtn) return;
    recordBtn.classList.toggle('recording', isRecording);
    recordBtn.title = isRecording ? 'Stop recording' : 'Record stream';
}

function changeVisualizerColor() {
    settings.visualizerColor = visualizerColorPicker.value;
    saveSetting('visualizerColor', settings.visualizerColor);
}

function cycleVisualizerStyle() {
    const styles = ['bars', 'peaks', 'wave', 'circle', 'mirror', 'dance'];
    let currentIndex = styles.indexOf(settings.visualizerStyle || 'bars');
    let nextIndex = (currentIndex + 1) % styles.length;
    let nextStyle = styles[nextIndex];

    settings.visualizerStyle = nextStyle;
    visualizerStyleSelect.value = nextStyle;
    saveSetting('visualizerStyle', nextStyle);
}

// Target window size for the current (non-compact) layout
function getNormalWindowSize() {
    return settings.wideMode
        ? { w: 1180, h: 760, minW: 920, minH: 600 }
        : { w: 500, h: 760, minW: 420, minH: 560 };
}

// Apply narrow / wide layout to the UI (and resize the window)
async function applyViewMode(wide, isInit = false) {
    settings.wideMode = wide;
    appContainer.classList.toggle('wide', wide);

    // Sync the header segmented switch and the settings dropdown
    if (viewSwitch) {
        viewSwitch.querySelectorAll('.view-opt').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.view === (wide ? 'wide' : 'narrow'));
        });
    }
    if (viewModeSelect) viewModeSelect.value = wide ? 'wide' : 'narrow';

    if (!isInit) saveSetting('wideMode', wide);

    // Resize the window unless the compact widget is active
    if (hasTauriApi && !settings.compactMode) {
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
    applyMarquee(stationName);
    applyMarquee(nowPlayingTrack);
}

function toggleViewMode(wide) {
    if (settings.wideMode === wide) return;
    applyViewMode(wide);
}

// Resize the visualizer canvas backing store to match its new CSS box
function refreshVisualizerSize() {
    requestAnimationFrame(() => {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
        if (!isPlaying) stopVisualization();
    });
}

// LIVE elapsed-time counter shown on the transport bar
function formatTimer(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function startLiveTimer() {
    stopLiveTimer();
    liveTimerSeconds = 0;
    if (liveTimer) liveTimer.textContent = formatTimer(0);
    liveTimerInterval = setInterval(() => {
        liveTimerSeconds++;
        if (liveTimer) liveTimer.textContent = formatTimer(liveTimerSeconds);
    }, 1000);
}

function stopLiveTimer() {
    if (liveTimerInterval) {
        clearInterval(liveTimerInterval);
        liveTimerInterval = null;
    }
}

// Sleep timer: stop playback automatically after the chosen number of minutes
function startSleepTimer(minutes) {
    cancelSleepTimer();
    if (!minutes || minutes <= 0) return;

    sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    sleepTimerStatus.classList.remove('hidden');
    updateSleepTimerDisplay();

    sleepTimerInterval = setInterval(() => {
        if (Date.now() >= sleepTimerEnd) {
            cancelSleepTimer();
            if (isPlaying) stopStation();
            toast('Sleep timer: playback stopped', 'info');
        } else {
            updateSleepTimerDisplay();
        }
    }, 1000);

    toast(`Sleep timer: ${minutes} min`, 'success');
}

function cancelSleepTimer() {
    if (sleepTimerInterval) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
    }
    sleepTimerEnd = 0;
    if (sleepTimerStatus) sleepTimerStatus.classList.add('hidden');
}

function updateSleepTimerDisplay() {
    if (!sleepTimerRemaining) return;
    const remainingMs = Math.max(0, sleepTimerEnd - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    sleepTimerRemaining.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Reflect playing / stopped state on the brand "ON AIR" badge
function updateBrandStatus() {
    if (!brandStatus) return;
    brandStatus.textContent = `v${APP_VERSION} · ${isPlaying ? 'ON AIR' : 'OFF AIR'}`;
}

// Fill the secondary info lines (sub-title + stream quality)
function updateStationDetails(station) {
    if (!station) {
        if (stationSub) stationSub.textContent = '';
        if (transportQuality) transportQuality.textContent = '—';
        return;
    }
    const genre = station.tags ? station.tags.split(',')[0].trim() : '';
    const country = station.country || '';
    if (stationSub) {
        stationSub.textContent = [country, genre].filter(Boolean).join('  ·  ');
    }
    if (transportQuality) {
        const bitrate = station.bitrate && station.bitrate > 0 ? station.bitrate + ' KBPS' : '';
        const codec = station.codec || '';
        transportQuality.textContent = [bitrate, codec].filter(Boolean).join(' · ') || 'LIVE STREAM';
    }
}

// Heart icon markup (filled when favorited, outline when not)
// Copy / confirmation icons for the track-name copy button
const COPY_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>';
let copyResetTimer = null;

// Copy the current track title (falls back to the station name) to clipboard
async function copyCurrentTrack() {
    if (!trackCopyBtn) return;
    const trackText = (nowPlayingTrack.textContent || '').replace(/^[\s♪•]+/, '').trim();
    const text = trackText || (currentStation ? currentStation.name : '');
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
    if (trackText) addToTrackHistory(trackText, currentStation);

    // Brief "copied" confirmation on the button
    trackCopyBtn.classList.add('copied');
    trackCopyBtn.innerHTML = CHECK_ICON_SVG;
    trackCopyBtn.title = 'Copied';
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
        trackCopyBtn.classList.remove('copied');
        trackCopyBtn.innerHTML = COPY_ICON_SVG;
        trackCopyBtn.title = 'Copy track name';
    }, 1400);
}

// Open a YouTube search for an arbitrary query in the default browser
async function openYouTubeSearch(query) {
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
function openTrackOnYouTube() {
    const trackText = (nowPlayingTrack.textContent || '').replace(/^[\s♪•]+/, '').trim();
    const query = trackText || (currentStation ? currentStation.name : '');
    openYouTubeSearch(query);
}

// Event listeners
playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', prevStation);
nextBtn.addEventListener('click', nextStation);

volumeSlider.addEventListener('input', (e) => {
    setVolume(e.target.value);
});

volumeMuteBtn.addEventListener('click', toggleMute);

searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    searchStations(query);
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        clearTimeout(searchDebounce);
        const query = searchInput.value.trim();
        searchStations(query);
    }
});

// Search-as-you-type with debounce
searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        const query = searchInput.value.trim();
        if (query.length >= 2) {
            searchStations(query);
        } else if (query.length === 0) {
            loadPopularStations();
        }
    }, 500);
});

// Toggle the search filters panel
filtersToggleBtn.addEventListener('click', () => {
    const willShow = filtersPanel.classList.contains('hidden');
    filtersPanel.classList.toggle('hidden', !willShow);
    filtersToggleBtn.classList.toggle('active', willShow);
});

// Re-run search when a filter changes (keeps results in sync with the panel)
[filterCountry, filterTag, filterBitrate, filterCodec].forEach(sel => {
    sel.addEventListener('change', () => {
        // A typed tag takes priority; otherwise fall back to the active preset
        let tag = filterTag.value.trim();
        if (!tag) {
            const activePreset = document.querySelector('.preset-btn.active');
            tag = activePreset && !['favorites', 'somafm'].includes(activePreset.dataset.genre)
                ? activePreset.dataset.genre : '';
        }
        searchStations(searchInput.value.trim(), tag);
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
stationsList.addEventListener('scroll', onListScroll);
const radioLayoutEl = document.querySelector('.radio-layout');
if (radioLayoutEl) radioLayoutEl.addEventListener('scroll', onListScroll);

// Re-evaluate the station name marquee when the window is resized
window.addEventListener('resize', () => {
    applyMarquee(stationName);
    applyMarquee(nowPlayingTrack);
});

// Handle audio stream lifecycle events
audioPlayer.addEventListener('error', () => {
    handleStreamDrop('audio error');
});

audioPlayer.addEventListener('ended', () => {
    handleStreamDrop('stream ended');
});

audioPlayer.addEventListener('waiting', () => {
    if (wantPlayback && isPlaying) {
        setConnectionState('buffering');
    }
});

audioPlayer.addEventListener('playing', () => {
    reconnectAttempts = 0;
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

        clearActivePreset();
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
addCustomBtn.addEventListener('click', addCustomStation);
previewBtn.addEventListener('click', previewCustomUrl);

// Track history
if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearTrackHistory);

// Sleep timer
if (sleepTimerSelect) {
    sleepTimerSelect.addEventListener('change', () => {
        startSleepTimer(parseInt(sleepTimerSelect.value, 10));
    });
}

// Modal Save & Close
closeModalBtn.addEventListener('click', () => editModal.classList.add('hidden'));
saveEditBtn.addEventListener('click', saveEditedStation);

// Export/Import
exportFavoritesBtn.addEventListener('click', exportFavorites);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', importStations);

// Settings
compactModeCheckbox.addEventListener('change', () => toggleCompactMode());
visualizerEnabledCheckbox.addEventListener('change', toggleVisualizer);
visualizerColorPicker.addEventListener('input', changeVisualizerColor);
eqEnabledCheckbox.addEventListener('change', toggleEq);
eqPresetSelect.addEventListener('change', applyEqPreset);
if (normalizeCheckbox) normalizeCheckbox.addEventListener('change', toggleNormalization);
if (recordBtn) recordBtn.addEventListener('click', toggleRecording);
visualizerCanvas.addEventListener('click', cycleVisualizerStyle);
enterCompactBtn.addEventListener('click', enterCompactMode);
exitCompactBtn.addEventListener('click', exitCompactMode);
alwaysOnTopBtn.addEventListener('click', toggleAlwaysOnTop);

// View switcher (narrow / wide)
if (viewSwitch) {
    viewSwitch.querySelectorAll('.view-opt').forEach(opt => {
        opt.addEventListener('click', () => toggleViewMode(opt.dataset.view === 'wide'));
    });
}
if (viewModeSelect) {
    viewModeSelect.addEventListener('change', () => {
        toggleViewMode(viewModeSelect.value === 'wide');
    });
}

// Copy the current track title from the track card
if (trackCopyBtn) {
    trackCopyBtn.addEventListener('click', copyCurrentTrack);
}

// Open the current track on YouTube
if (trackYoutubeBtn) {
    trackYoutubeBtn.addEventListener('click', openTrackOnYouTube);
}

visualizerStyleSelect.addEventListener('change', () => {
    settings.visualizerStyle = visualizerStyleSelect.value;
    saveSetting('visualizerStyle', settings.visualizerStyle);
});

visualizerSensitivityInput.addEventListener('input', () => {
    settings.visualizerSensitivity = parseFloat(visualizerSensitivityInput.value);
    saveSetting('visualizerSensitivity', settings.visualizerSensitivity);
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
