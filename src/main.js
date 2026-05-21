// Radio Browser API - mirror servers with automatic failover.
// Defaults are used until the live server list is fetched.
let apiServers = [
    'de1.api.radio-browser.info',
    'de2.api.radio-browser.info',
    'nl1.api.radio-browser.info',
    'at1.api.radio-browser.info'
];
let currentApiServer = 0;

// Fetch the live list of Radio Browser mirror servers
async function loadApiServers() {
    try {
        const res = await fetch('https://all.api.radio-browser.info/json/servers');
        const servers = await res.json();
        const names = [...new Set(servers.map(s => s.name).filter(Boolean))];
        if (names.length > 0) {
            apiServers = names;
            currentApiServer = Math.floor(Math.random() * names.length);
        }
    } catch (e) {
        console.warn('Could not load API server list, using defaults:', e);
    }
}

// Fetch a Radio Browser endpoint, failing over between mirrors on error
async function apiFetch(path) {
    let lastError;
    for (let i = 0; i < apiServers.length; i++) {
        const index = (currentApiServer + i) % apiServers.length;
        try {
            const res = await fetch(`https://${apiServers[index]}/json${path}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            currentApiServer = index;
            return await res.json();
        } catch (e) {
            lastError = e;
            console.warn(`API server ${apiServers[index]} failed:`, e.message);
        }
    }
    throw lastError || new Error('All API servers failed');
}

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

// Search Filters Panel elements
const filtersToggleBtn = document.getElementById('filters-toggle-btn');
const filtersPanel = document.getElementById('filters-panel');
const filterCountry = document.getElementById('filter-country');
const filterBitrate = document.getElementById('filter-bitrate');
const filterCodec = document.getElementById('filter-codec');

// Recently Played elements
const recentlyPlayedSection = document.getElementById('recently-played-section');
const recentlyPlayedList = document.getElementById('recently-played-list');

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
const enterCompactBtn = document.getElementById('enter-compact-btn');
const exitCompactBtn = document.getElementById('exit-compact-btn');
const alwaysOnTopBtn = document.getElementById('always-on-top-btn');
const viewModeSelect = document.getElementById('view-mode-select');

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

// State
let isAlwaysOnTop = false;
let liveTimerInterval = null;
let liveTimerSeconds = 0;
let currentStation = null;
let isPlaying = false;
let metadataInterval = null;
let favorites = [];
let customStations = [];
let blacklist = [];
let recentlyPlayed = [];
let lastStation = null;
let currentStationsList = [];
let currentStationIndex = -1;

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
    visualizerSensitivity: 1.0
};

// Proxy Port (loaded from backend)
let proxyPort = 0;

// Database
let db = null;

// Audio visualization
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let sourceNode = null;
let smoothedData = null;
let lastTrackTitle = '';

// Check if Tauri is available
const hasTauriApi = typeof window.__TAURI__ !== 'undefined';

// Initialize database
async function initDatabase() {
    if (!hasTauriApi) return;

    try {
        let Database;
        if (window.__TAURI_PLUGIN_SQL__) {
            Database = window.__TAURI_PLUGIN_SQL__.default || window.__TAURI_PLUGIN_SQL__;
        } else if (window.__TAURI__?.sql) {
            Database = window.__TAURI__.sql.default || window.__TAURI__.sql.Database || window.__TAURI__.sql;
        }

        if (!Database) {
            console.warn('SQL plugin not available, using localStorage fallback');
            loadFromLocalStorage();
            return;
        }

        console.log('Loading database...');
        db = await Database.load('sqlite:radio.db');
        console.log('Database loaded successfully');

        // Create tables
        await db.execute(`
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stationuuid TEXT UNIQUE NOT NULL,
                name TEXT,
                url TEXT,
                url_resolved TEXT,
                favicon TEXT,
                country TEXT,
                codec TEXT,
                bitrate INTEGER,
                tags TEXT,
                data TEXT
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS custom_stations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stationuuid TEXT UNIQUE NOT NULL,
                name TEXT,
                url TEXT,
                genre TEXT,
                data TEXT
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS blacklist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stationuuid TEXT UNIQUE NOT NULL,
                name TEXT
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS recently_played (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stationuuid TEXT UNIQUE NOT NULL,
                name TEXT,
                url TEXT,
                favicon TEXT,
                timestamp INTEGER
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        // Load data from database
        await loadDataFromDb();
        console.log('Data loaded from database');

    } catch (e) {
        console.error('Database init error:', e);
        console.log('Falling back to localStorage');
        loadFromLocalStorage();
    }
}

// Fallback to localStorage if SQL is not available
function loadFromLocalStorage() {
    try {
        favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
        customStations = JSON.parse(localStorage.getItem('customStations') || '[]');
        blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
        recentlyPlayed = JSON.parse(localStorage.getItem('recentlyPlayed') || '[]');
        lastStation = JSON.parse(localStorage.getItem('lastStation') || 'null');
        const savedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings = { ...settings, ...savedSettings };
    } catch (e) {
        console.error('localStorage load error:', e);
    }
}

// Load all data from database
async function loadDataFromDb() {
    if (!db) return;

    try {
        // Load favorites
        const favRows = await db.select('SELECT * FROM favorites');
        favorites = favRows.map(row => {
            const station = row.data ? JSON.parse(row.data) : {};
            return { ...station, stationuuid: row.stationuuid, name: row.name, url: row.url, favicon: row.favicon };
        });

        // Load custom stations
        const customRows = await db.select('SELECT * FROM custom_stations');
        customStations = customRows.map(row => {
            const station = row.data ? JSON.parse(row.data) : {};
            return { ...station, stationuuid: row.stationuuid, name: row.name, url: row.url, genre: row.genre };
        });

        // Load blacklist
        const blackRows = await db.select('SELECT * FROM blacklist');
        blacklist = blackRows.map(row => ({ stationuuid: row.stationuuid, name: row.name }));

        // Load recently played
        const recentRows = await db.select('SELECT * FROM recently_played ORDER BY timestamp DESC LIMIT 10');
        recentlyPlayed = recentRows.map(row => ({
            stationuuid: row.stationuuid,
            name: row.name,
            url: row.url,
            favicon: row.favicon,
            country: 'Нещодавно прослухані'
        }));

        // Load settings
        const settingsRows = await db.select('SELECT * FROM settings');
        settingsRows.forEach(row => {
            if (row.key === 'compactMode') settings.compactMode = row.value === 'true';
            if (row.key === 'wideMode') settings.wideMode = row.value === 'true';
            if (row.key === 'visualizerEnabled') settings.visualizerEnabled = row.value === 'true';
            if (row.key === 'visualizerColor') settings.visualizerColor = row.value;
            if (row.key === 'visualizerStyle') settings.visualizerStyle = row.value;
            if (row.key === 'visualizerSensitivity') settings.visualizerSensitivity = parseFloat(row.value);
            if (row.key === 'lastStation') lastStation = row.value ? JSON.parse(row.value) : null;
        });

    } catch (e) {
        console.error('Load data error:', e);
    }
}

// Save setting to database and localStorage
async function saveSetting(key, value) {
    try {
        if (key === 'lastStation') {
            localStorage.setItem('lastStation', JSON.stringify(value));
        } else {
            const savedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
            savedSettings[key] = value;
            localStorage.setItem('settings', JSON.stringify(savedSettings));
        }
    } catch (e) {
        console.error('localStorage save error:', e);
    }

    if (!db) return;
    try {
        await db.execute(
            'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
            [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
        );
    } catch (e) {
        console.error('Save setting error:', e);
    }
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

    // Refresh the Radio Browser mirror list in the background
    loadApiServers();

    // Initialize database
    await initDatabase();

    // Request notification permission
    requestNotificationPermission();

    // Apply saved settings
    compactModeCheckbox.checked = settings.compactMode;
    visualizerEnabledCheckbox.checked = settings.visualizerEnabled;
    visualizerStyleSelect.value = settings.visualizerStyle || 'bars';
    visualizerSensitivityInput.value = settings.visualizerSensitivity || 1.0;
    visualizerColorPicker.value = settings.visualizerColor || '#ff5a36';
    viewModeSelect.value = settings.wideMode ? 'wide' : 'narrow';

    // Apply narrow / wide layout
    applyViewMode(settings.wideMode, true);

    // Apply compact mode with window resize
    if (settings.compactMode) {
        toggleCompactMode(true);
    }

    // Reflect initial OFF AIR state
    updateBrandStatus();

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

    // Load the popular stations list
    loadPopularStations();
}

// Volume control
let lastVolumeBeforeMute = 70;

function setVolume(volume) {
    volume = Math.max(0, Math.min(100, parseInt(volume) || 0));
    volumeSlider.value = volume;
    audioPlayer.volume = volume / 100;
    // Drive the slider fill gradient and the percentage label
    volumeSlider.style.setProperty('--vol', volume + '%');
    volumeValueLabel.textContent = volume + '%';
    volumeBar.classList.toggle('muted', volume === 0);
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

function volumeUp() {
    setVolume(parseInt(volumeSlider.value) + 5);
}

function volumeDown() {
    setVolume(parseInt(volumeSlider.value) - 5);
}

// Search stations by name and filters
async function searchStations(query, tag = '') {
    stationsList.innerHTML = '<div class="loading">Пошук...</div>';
    clearActivePreset();

    const countryVal = filterCountry.value;
    const bitrateVal = filterBitrate.value;
    const codecVal = filterCodec.value;

    let path = `/stations/search?limit=30&order=clickcount&reverse=true`;
    if (query) path += `&name=${encodeURIComponent(query)}`;
    if (tag) path += `&tag=${encodeURIComponent(tag)}`;
    if (countryVal) path += `&country=${encodeURIComponent(countryVal)}`;
    if (bitrateVal && parseInt(bitrateVal) > 0) path += `&bitrateMin=${bitrateVal}`;
    if (codecVal) path += `&codec=${codecVal}`;

    try {
        const stations = await apiFetch(path);

        const filtered = filterBlacklisted(stations);
        if (filtered.length === 0) {
            stationsList.innerHTML = '<div class="loading-hint">Станцій не знайдено</div>';
            currentStationsList = [];
            return;
        }

        currentStationsList = filtered;
        renderStations(filtered);
    } catch (error) {
        console.error('Search error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Помилка завантаження станцій</div>';
    }
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
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`;
    } else {
        favorites.splice(index, 1);
        btn.classList.remove('active');
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" fill="currentColor"/></svg>`;
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
    if (favorites.length === 0) {
        stationsList.innerHTML = '<div class="loading-hint">Немає збережених станцій</div>';
        currentStationsList = [];
        return;
    }
    currentStationsList = favorites;
    renderStations(favorites);
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
    stationsList.innerHTML = '<div class="loading">Завантаження популярних станцій...</div>';

    try {
        const stations = await apiFetch('/stations/topclick/20');
        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('Load error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Знайдіть радіостанції через пошук вище</div>';
    }
}

// Load SomaFM curated channels as stations
async function loadSomaFM() {
    stationsList.innerHTML = '<div class="loading">Завантаження SomaFM...</div>';

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
            stationsList.innerHTML = '<div class="loading-hint">SomaFM не повернув станцій</div>';
            currentStationsList = [];
            return;
        }

        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('SomaFM load error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Не вдалося завантажити SomaFM</div>';
    }
}

// Render stations list
function renderStations(stations, container = stationsList) {
    container.innerHTML = '';

    // Update the station count badge (only for the main list)
    if (container === stationsList && stationsCount) {
        stationsCount.textContent = stations.length ? `${stations.length} stations` : '';
    }

    stations.forEach((station, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
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
        country.textContent = station.country || 'Невідомо';

        const actions = document.createElement('div');
        actions.className = 'list-actions';

        // Favorite button
        const favBtn = document.createElement('button');
        favBtn.className = 'action-btn favorite-btn';
        if (isFavorite(station.stationuuid)) {
            favBtn.classList.add('active');
            favBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`;
        } else {
            favBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" fill="currentColor"/></svg>`;
        }
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(station, favBtn);
        });

        // Blacklist button
        const blacklistBtn = document.createElement('button');
        blacklistBtn.className = 'action-btn blacklist-btn';
        blacklistBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
        blacklistBtn.title = 'Приховати станцію';
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
        nowPlayingTrack.textContent = '⏳ Підключення…';
        nowPlayingTrack.classList.add('status-line');
    } else if (state === 'buffering') {
        nowPlayingTrack.textContent = '⏳ Буферизація…';
        nowPlayingTrack.classList.add('status-line');
    } else if (state === 'reconnecting') {
        nowPlayingTrack.textContent = `🔄 Перепідключення… (${reconnectAttempts}/${MAX_RECONNECT})`;
        nowPlayingTrack.classList.add('status-line');
    } else if (state === 'error') {
        nowPlayingTrack.textContent = '⚠ Не вдалося відтворити станцію';
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
                body: `Зараз грає: ${trackTitle}`,
                icon: currentStation.favicon || generatePlaceholderLogo(stationName),
                silent: true
            });
        }
    }
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

function setupAudioVisualization() {
    if (!settings.visualizerEnabled) return;

    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            smoothedData = new Float32Array(analyser.frequencyBinCount);
        }

        if (sourceNode) {
            sourceNode.disconnect();
        }

        sourceNode = audioContext.createMediaElementSource(audioPlayer);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
    } catch (error) {
        console.error('Audio visualization setup error:', error);
    }
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

    if (style === 'bars') {
        const numBars = 24;
        const barWidth = width / numBars;
        const gap = 3;
        const smoothing = 0.65;
        const usableDataLength = Math.floor(dataArray.length * 0.6);

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

            const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
            grad.addColorStop(0, baseColor);
            grad.addColorStop(1, adjustBrightness(baseColor, 1.4));

            ctx.fillStyle = grad;

            const x = i * barWidth + gap / 2;
            const w = barWidth - gap;
            const y = height - barHeight;

            ctx.beginPath();
            ctx.roundRect(x, y, w, barHeight, [4, 4, 0, 0]);
            ctx.fill();
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
        const radius = Math.min(centerX, centerY) * 0.45;
        const numBars = 48;
        const usableDataLength = Math.floor(dataArray.length * 0.7);

        ctx.shadowBlur = 6;
        ctx.shadowColor = baseColor;

        for (let i = 0; i < numBars; i++) {
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = dataArray[freqIndex] * sensitivity;
            const barHeight = (value / 255) * 20;

            const angle = (i / numBars) * Math.PI * 2;

            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;

            const x2 = centerX + Math.cos(angle) * (radius + barHeight);
            const y2 = centerY + Math.sin(angle) * (radius + barHeight);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.strokeStyle = baseColor;
            ctx.stroke();
        }

        ctx.shadowBlur = 0; 
    }

    animationId = requestAnimationFrame(drawVisualization);
}

function startVisualization() {
    if (!settings.visualizerEnabled) return;

    if (!audioContext) {
        setupAudioVisualization();
    }

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
    updatePlayButton();
    startMetadataPolling();
    startVisualization();
    startLiveTimer();
    addToRecentlyPlayed(currentStation);
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
        onError(new Error('hls.js не завантажено (немає src/hls.min.js)'));
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
        onError(new Error('HLS не підтримується'));
    }
}

// Play current station
function playStation() {
    if (!currentStation) return;

    wantPlayback = true;
    lastTrackTitle = '';
    clearTimeout(reconnectTimer);
    setConnectionState('connecting');

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
    audioPlayer.pause();
    if (hls) {
        hls.destroy();
        hls = null;
    }
    audioPlayer.src = '';
    isPlaying = false;
    updatePlayButton();
    stopMetadataPolling();
    stopVisualization();
    stopLiveTimer();
    nowPlayingTrack.textContent = '';
    nowPlayingTrack.classList.remove('marquee');
    if (previewBtn) {
        previewBtn.textContent = 'Прослухати';
    }
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
        previewBtn.textContent = 'Прослухати';
        return;
    }

    const url = customUrlInput.value.trim();
    if (!url) {
        alert('Введіть URL потоку');
        return;
    }

    const name = customNameInput.value.trim() || 'Прослуховування';
    const favicon = getFaviconFromUrl(url);

    const tempStation = {
        stationuuid: 'preview_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: customGenreInput.value.trim(),
        country: 'Прослуховування',
        favicon: favicon
    };

    currentStation = tempStation;
    setStationName(name + ' (Тест)');

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

    const onPreviewOk = () => {
        isPlaying = true;
        updatePlayButton();
        startVisualization();
        previewBtn.textContent = 'Зупинити';
    };
    const onPreviewError = (error) => {
        console.error('Preview error:', error);
        alert('Помилка відтворення URL: ' + (error && error.message ? error.message : error));
        isPlaying = false;
        updatePlayButton();
        previewBtn.textContent = 'Прослухати';
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
        alert('Введіть назву та URL станції');
        return;
    }

    const station = {
        stationuuid: 'custom_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: genre,
        country: 'Власна станція',
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
        alert('Введіть назву та URL');
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
        customStationsList.innerHTML = '<div class="loading-hint">Власних станцій немає</div>';
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
            favoriteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`;
        } else {
            favoriteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" fill="currentColor"/></svg>`;
        }
        favoriteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(station, favoriteBtn);
        });

        // Edit
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit-btn';
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
        editBtn.title = 'Редагувати';
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

        customStationsList.appendChild(item);
    });
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
            alert('Помилка експорту: ' + error.message);
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
        alert('Немає обраних станцій для експорту');
        return;
    }
    await exportToJson(favorites, 'radio-favorites.json');
}

// Export current playing station
async function exportCurrentStation() {
    if (!currentStation) {
        alert('Немає активної станції');
        return;
    }
    await exportToJson([currentStation], `${currentStation.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
}

// Update current station info in Custom tab
function updateCurrentStationInfo() {
    if (!currentStationInfo) return;

    if (!currentStation) {
        currentStationInfo.innerHTML = '<div class="current-station-empty">Немає активної станції</div>';
        return;
    }

    const s = currentStation;
    const genre = s.tags ? s.tags.split(',')[0] : '';
    const logoSrc = s.favicon || generatePlaceholderLogo(s.name);
    const fallbackLogo = generatePlaceholderLogo(s.name);

    currentStationInfo.innerHTML = `
        <div class="current-station-form">
            <img src="${logoSrc}" class="current-station-logo" onerror="this.src='${fallbackLogo}'; this.onerror=null;">
            <input type="text" value="${s.name}" readonly placeholder="Назва">
            <input type="text" value="${s.url_resolved || s.url}" readonly placeholder="URL потоку">
            <input type="text" value="${genre}" readonly placeholder="Жанр">
            <button class="btn-export" onclick="exportCurrentStation()">Експортувати</button>
        </div>
    `;
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
            name: entry.name || 'Імпортована станція',
            url: entry.url,
            url_resolved: entry.url,
            tags: '',
            country: 'Імпортовано',
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
    alert(`Імпортовано станцій: ${added}`);
}

// Import the app's own JSON export format (favorites or custom stations)
function importStationsJson(text) {
    const data = JSON.parse(text);

    if (!Array.isArray(data)) {
        alert('Неправильний формат файлу');
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
        alert('Власні станції імпортовано');
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
        alert('Обрані станції імпортовано');
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
            alert('Помилка читання файлу: ' + error.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
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

    // The compact widget is its own layout: drop the wide class while active
    // so the two-column rules cannot leak into the mini player.
    if (settings.compactMode) {
        appContainer.classList.add('compact');
        appContainer.classList.remove('wide');
    } else {
        appContainer.classList.remove('compact');
        appContainer.classList.toggle('wide', settings.wideMode);
    }

    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();

            if (settings.compactMode) {
                await appWindow.setMinSize(new window.__TAURI__.window.LogicalSize(380, 150));
                await appWindow.setSize(new window.__TAURI__.window.LogicalSize(420, 160));
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

function changeVisualizerColor() {
    settings.visualizerColor = visualizerColorPicker.value;
    saveSetting('visualizerColor', settings.visualizerColor);
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
            await appWindow.setSize(new LogicalSize(size.w, size.h));
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

// Reflect playing / stopped state on the brand "ON AIR" badge
function updateBrandStatus() {
    if (!brandStatus) return;
    brandStatus.textContent = isPlaying ? 'v0.7 · ON AIR' : 'v0.7 · OFF AIR';
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

    // Brief "copied" confirmation on the button
    trackCopyBtn.classList.add('copied');
    trackCopyBtn.innerHTML = CHECK_ICON_SVG;
    trackCopyBtn.title = 'Скопійовано';
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
        trackCopyBtn.classList.remove('copied');
        trackCopyBtn.innerHTML = COPY_ICON_SVG;
        trackCopyBtn.title = 'Копіювати назву треку';
    }, 1400);
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
[filterCountry, filterBitrate, filterCodec].forEach(sel => {
    sel.addEventListener('change', () => {
        const activePreset = document.querySelector('.preset-btn.active');
        const tag = activePreset && !['favorites', 'somafm'].includes(activePreset.dataset.genre)
            ? activePreset.dataset.genre : '';
        searchStations(searchInput.value.trim(), tag);
    });
});

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

visualizerStyleSelect.addEventListener('change', () => {
    settings.visualizerStyle = visualizerStyleSelect.value;
    saveSetting('visualizerStyle', settings.visualizerStyle);
});

visualizerSensitivityInput.addEventListener('input', () => {
    settings.visualizerSensitivity = parseFloat(visualizerSensitivityInput.value);
    saveSetting('visualizerSensitivity', settings.visualizerSensitivity);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + K focuses the search field from anywhere
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch(e.key) {
        case ' ':
            e.preventDefault();
            togglePlay();
            break;
        case 'ArrowRight':
            nextStation();
            break;
        case 'ArrowLeft':
            prevStation();
            break;
        case 'ArrowUp':
            e.preventDefault();
            volumeUp();
            break;
        case 'ArrowDown':
            e.preventDefault();
            volumeDown();
            break;
    }
});

// Initialize and load
init();
