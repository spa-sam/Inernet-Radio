// Radio Browser API base URL
const API_BASE = 'https://all.api.radio-browser.info/json';

// DOM elements
const audioPlayer = document.getElementById('audio-player');
const playBtn = document.getElementById('play-btn');
const playIcon = playBtn.querySelector('.play-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const volumeSlider = document.getElementById('volume');
const volumeUpBtn = document.getElementById('volume-up');
const volumeDownBtn = document.getElementById('volume-down');
const volumeSectionsContainer = document.getElementById('volume-sections');
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

// Custom stations elements
const customNameInput = document.getElementById('custom-name');
const customUrlInput = document.getElementById('custom-url');
const customGenreInput = document.getElementById('custom-genre');
const addCustomBtn = document.getElementById('add-custom-btn');
const customStationsList = document.getElementById('custom-stations-list');

// Export/Import elements
const exportFavoritesBtn = document.getElementById('export-favorites-btn');
const exportCurrentBtn = document.getElementById('export-current-btn');
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');

// Settings elements
const compactModeCheckbox = document.getElementById('compact-mode');
const visualizerEnabledCheckbox = document.getElementById('visualizer-enabled');
const visualizerColorPicker = document.getElementById('visualizer-color');
const enterCompactBtn = document.getElementById('enter-compact-btn');
const exitCompactBtn = document.getElementById('exit-compact-btn');
const alwaysOnTopBtn = document.getElementById('always-on-top-btn');

// State
let isAlwaysOnTop = false;
let currentStation = null;
let isPlaying = false;
let metadataInterval = null;
let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
let customStations = JSON.parse(localStorage.getItem('customStations') || '[]');
let currentStationsList = [];
let currentStationIndex = -1;

// Settings state
let settings = JSON.parse(localStorage.getItem('settings') || '{"compactMode":false,"visualizerEnabled":true,"visualizerColor":"#00b894"}');

// Audio visualization
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let sourceNode = null;

// Check if Tauri is available
const hasTauriApi = typeof window.__TAURI__ !== 'undefined';

// Initialize
function init() {
    audioPlayer.volume = volumeSlider.value / 100;

    // Apply saved settings
    compactModeCheckbox.checked = settings.compactMode;
    visualizerEnabledCheckbox.checked = settings.visualizerEnabled;
    visualizerColorPicker.value = settings.visualizerColor || '#00b894';

    // Apply compact mode with window resize
    if (settings.compactMode) {
        toggleCompactMode(true);
    }

    if (!settings.visualizerEnabled) {
        visualizerCanvas.classList.add('hidden');
    }

    // Initialize volume sections
    initVolumeSections();
    updateVolumeSections(volumeSlider.value);

    // Load custom stations
    renderCustomStations();
}

// Volume sections
function initVolumeSections() {
    volumeSectionsContainer.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
        const section = document.createElement('div');
        section.className = 'volume-section';
        section.dataset.level = i;
        section.addEventListener('click', () => {
            setVolume(i * 10);
        });
        volumeSectionsContainer.appendChild(section);
    }
}

function updateVolumeSections(volume) {
    const activeLevel = Math.ceil(volume / 10);
    const sections = volumeSectionsContainer.querySelectorAll('.volume-section');

    sections.forEach((section, index) => {
        const level = index + 1;
        // Remove all active classes
        section.className = 'volume-section';

        if (level <= activeLevel) {
            section.classList.add('active-' + level);
        }
    });
}

function setVolume(volume) {
    volume = Math.max(0, Math.min(100, volume));
    volumeSlider.value = volume;
    audioPlayer.volume = volume / 100;
    updateVolumeSections(volume);
}

function volumeUp() {
    const currentVolume = parseInt(volumeSlider.value);
    setVolume(currentVolume + 10);
}

function volumeDown() {
    const currentVolume = parseInt(volumeSlider.value);
    setVolume(currentVolume - 10);
}

// Search stations by name
async function searchStations(query) {
    stationsList.innerHTML = '<div class="loading">Searching...</div>';
    clearActivePreset();

    try {
        const url = API_BASE + '/stations/byname/' + encodeURIComponent(query) + '?limit=30&order=clickcount&reverse=true';
        const response = await fetch(url);
        const stations = await response.json();

        if (stations.length === 0) {
            stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
            currentStationsList = [];
            return;
        }

        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('Search error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Error searching stations</div>';
    }
}

// Search stations by tag/genre
async function searchByTag(tag) {
    stationsList.innerHTML = '<div class="loading">Loading ' + tag + ' stations...</div>';

    try {
        const url = API_BASE + '/stations/bytag/' + encodeURIComponent(tag) + '?limit=30&order=clickcount&reverse=true';
        const response = await fetch(url);
        const stations = await response.json();

        if (stations.length === 0) {
            stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
            currentStationsList = [];
            return;
        }

        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('Search error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Error searching stations</div>';
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
function toggleFavorite(station, btn) {
    const index = favorites.findIndex(fav => fav.stationuuid === station.stationuuid);

    if (index === -1) {
        favorites.push(station);
        btn.classList.add('active');
        btn.textContent = '❤';
    } else {
        favorites.splice(index, 1);
        btn.classList.remove('active');
        btn.textContent = '♡';
    }

    localStorage.setItem('favorites', JSON.stringify(favorites));
}

// Show favorites
function showFavorites() {
    if (favorites.length === 0) {
        stationsList.innerHTML = '<div class="loading-hint">No favorite stations yet</div>';
        currentStationsList = [];
        return;
    }
    currentStationsList = favorites;
    renderStations(favorites);
}

// Load popular stations on start
async function loadPopularStations() {
    stationsList.innerHTML = '<div class="loading">Loading popular stations...</div>';

    try {
        const response = await fetch(API_BASE + '/stations/topclick/20');
        const stations = await response.json();
        currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('Load error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Search for radio stations above</div>';
    }
}

// Render stations list
function renderStations(stations, container = stationsList) {
    container.innerHTML = '';

    stations.forEach((station, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        if (currentStation && currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
            currentStationIndex = index;
        }

        const logoSrc = station.favicon || '';

        const logo = document.createElement('img');
        logo.className = 'station-item-logo';
        logo.src = logoSrc || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
        logo.onerror = function() { this.style.display = 'none'; };

        const info = document.createElement('div');
        info.className = 'station-item-info';

        const name = document.createElement('div');
        name.className = 'station-item-name';
        name.textContent = station.name;

        const country = document.createElement('div');
        country.className = 'station-item-country';
        country.textContent = station.country || 'Unknown';

        // Favorite button
        const favBtn = document.createElement('button');
        favBtn.className = 'favorite-btn';
        if (isFavorite(station.stationuuid)) {
            favBtn.classList.add('active');
            favBtn.textContent = '❤';
        } else {
            favBtn.textContent = '♡';
        }
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(station, favBtn);
        });

        info.appendChild(name);
        info.appendChild(country);
        item.appendChild(logo);
        item.appendChild(info);
        item.appendChild(favBtn);

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
}

// Clear metadata display
function clearMetadata() {
    metaGenre.classList.add('hidden');
    metaBitrate.classList.add('hidden');
    metaCodec.classList.add('hidden');
    metaCountry.classList.add('hidden');
    nowPlayingTrack.textContent = '';
}

// Fetch ICY metadata from Rust backend
async function fetchStreamMetadata(url) {
    if (!hasTauriApi) return;

    try {
        const { invoke } = window.__TAURI__.core;
        const metadata = await invoke('get_stream_metadata', { url });

        if (metadata && metadata.title) {
            nowPlayingTrack.textContent = '♪ ' + metadata.title;
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

// Audio Visualization
let smoothedData = null;

// Helper function to adjust color brightness
function adjustBrightness(hexColor, factor) {
    // Parse hex color
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Apply brightness factor
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

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Number of bars to display
    const numBars = 24;
    const barWidth = width / numBars;
    const gap = 2;
    const smoothing = 0.6;

    // Get base color from settings
    const baseColor = settings.visualizerColor || '#00b894';

    // Only use lower ~60% of frequency data (skip inaudible high frequencies)
    const usableDataLength = Math.floor(dataArray.length * 0.6);

    for (let i = 0; i < numBars; i++) {
        // Linear distribution across usable frequencies
        const startFreq = Math.floor((i / numBars) * usableDataLength);
        const endFreq = Math.floor(((i + 1) / numBars) * usableDataLength);

        // Average the frequency range
        let sum = 0;
        let count = Math.max(1, endFreq - startFreq);
        for (let j = startFreq; j < endFreq && j < usableDataLength; j++) {
            sum += dataArray[j];
        }
        const value = sum / count;

        // Smooth the value
        if (smoothedData) {
            smoothedData[i] = smoothedData[i] * smoothing + value * (1 - smoothing);
        }

        const barHeight = Math.max(2, (smoothedData[i] / 255) * height);

        // Use selected color with brightness based on height
        const brightness = 0.7 + (barHeight / height) * 0.3;
        ctx.fillStyle = adjustBrightness(baseColor, brightness);

        // Draw sharp bar
        const x = Math.floor(i * barWidth + gap / 2);
        const w = Math.floor(barWidth - gap);
        const y = Math.floor(height - barHeight);

        ctx.fillRect(x, y, w, barHeight);
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

    // Reset smoothed data
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

    stationName.textContent = station.name;
    updateMetadata(station);

    if (station.favicon) {
        stationLogo.src = station.favicon;
        stationLogo.classList.remove('hidden');
        stationLogo.onerror = function() { stationLogo.classList.add('hidden'); };
    } else {
        stationLogo.classList.add('hidden');
    }

    document.querySelectorAll('.station-item').forEach(item => {
        item.classList.remove('active');
    });
    itemElement.classList.add('active');

    playBtn.disabled = false;
    playStation();
}

// Play current station
function playStation() {
    if (!currentStation) return;

    nowPlayingTrack.textContent = '';

    audioPlayer.src = currentStation.url_resolved || currentStation.url;
    audioPlayer.play()
        .then(() => {
            isPlaying = true;
            updatePlayButton();
            startMetadataPolling();
            startVisualization();
        })
        .catch(error => {
            console.error('Play error:', error);
            isPlaying = false;
            updatePlayButton();
        });
}

// Stop playback
function stopStation() {
    audioPlayer.pause();
    audioPlayer.src = '';
    isPlaying = false;
    updatePlayButton();
    stopMetadataPolling();
    stopVisualization();
    nowPlayingTrack.textContent = '';
}

// Toggle play/pause
function togglePlay() {
    if (isPlaying) {
        stopStation();
    } else {
        playStation();
    }
}

// Update play button appearance
function updatePlayButton() {
    if (isPlaying) {
        playIcon.textContent = '⏹';
        playBtn.classList.add('playing');
    } else {
        playIcon.textContent = '▶';
        playBtn.classList.remove('playing');
    }
}

// Custom Stations
function addCustomStation() {
    const name = customNameInput.value.trim();
    const url = customUrlInput.value.trim();
    const genre = customGenreInput.value.trim();

    if (!name || !url) {
        alert('Please enter station name and URL');
        return;
    }

    const station = {
        stationuuid: 'custom_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: genre,
        country: 'Custom',
        favicon: '',
        bitrate: 0,
        codec: ''
    };

    customStations.push(station);
    localStorage.setItem('customStations', JSON.stringify(customStations));

    customNameInput.value = '';
    customUrlInput.value = '';
    customGenreInput.value = '';

    renderCustomStations();
}

function removeCustomStation(stationuuid) {
    customStations = customStations.filter(s => s.stationuuid !== stationuuid);
    localStorage.setItem('customStations', JSON.stringify(customStations));
    renderCustomStations();
}

function renderCustomStations() {
    if (customStations.length === 0) {
        customStationsList.innerHTML = '<div class="loading-hint">No custom stations yet</div>';
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
        logo.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
        logo.style.display = 'none';

        const info = document.createElement('div');
        info.className = 'station-item-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'station-item-name';
        nameEl.textContent = station.name;

        const urlEl = document.createElement('div');
        urlEl.className = 'station-item-country';
        urlEl.textContent = station.url.substring(0, 40) + '...';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'favorite-btn';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCustomStation(station.stationuuid);
        });

        info.appendChild(nameEl);
        info.appendChild(urlEl);
        item.appendChild(logo);
        item.appendChild(info);
        item.appendChild(deleteBtn);

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
            alert('Export error: ' + error.message);
        }
    } else {
        // Fallback for browser
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
        alert('No favorites to export');
        return;
    }
    await exportToJson(favorites, 'radio-favorites.json');
}

async function exportCurrent() {
    if (currentStationsList.length === 0) {
        alert('No stations to export');
        return;
    }
    await exportToJson(currentStationsList, 'radio-stations.json');
}

function importStations(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (!Array.isArray(data)) {
                alert('Invalid file format');
                return;
            }

            // Check if it's custom stations or favorites
            const isCustom = data.some(s => s.stationuuid && s.stationuuid.startsWith('custom_'));

            if (isCustom) {
                customStations = [...customStations, ...data];
                localStorage.setItem('customStations', JSON.stringify(customStations));
                renderCustomStations();
                alert('Custom stations imported successfully');
            } else {
                favorites = [...favorites, ...data];
                localStorage.setItem('favorites', JSON.stringify(favorites));
                alert('Favorites imported successfully');
            }
        } catch (error) {
            alert('Error reading file: ' + error.message);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Settings
async function toggleCompactMode(forceCompact = null) {
    // If forceCompact is provided, use it; otherwise use checkbox state
    if (forceCompact !== null) {
        settings.compactMode = forceCompact;
        compactModeCheckbox.checked = forceCompact;
    } else {
        settings.compactMode = compactModeCheckbox.checked;
    }
    localStorage.setItem('settings', JSON.stringify(settings));

    if (settings.compactMode) {
        appContainer.classList.add('compact');
    } else {
        appContainer.classList.remove('compact');
    }

    // Resize window via Tauri API
    if (hasTauriApi) {
        try {
            const { getCurrentWindow } = window.__TAURI__.window;
            const appWindow = getCurrentWindow();

            if (settings.compactMode) {
                // Compact size - widget-like, fits the player card
                await appWindow.setSize(new window.__TAURI__.window.LogicalSize(380, 165));
                await appWindow.setMinSize(new window.__TAURI__.window.LogicalSize(350, 155));
            } else {
                // Normal size
                await appWindow.setMinSize(new window.__TAURI__.window.LogicalSize(400, 500));
                await appWindow.setSize(new window.__TAURI__.window.LogicalSize(500, 600));
            }
        } catch (e) {
            console.error('Failed to resize window:', e);
        }
    }
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
    localStorage.setItem('settings', JSON.stringify(settings));

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
    localStorage.setItem('settings', JSON.stringify(settings));
}

// Event listeners
playBtn.addEventListener('click', togglePlay);
prevBtn.addEventListener('click', prevStation);
nextBtn.addEventListener('click', nextStation);

volumeSlider.addEventListener('input', (e) => {
    setVolume(e.target.value);
});

volumeUpBtn.addEventListener('click', volumeUp);
volumeDownBtn.addEventListener('click', volumeDown);

searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
        searchStations(query);
    }
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
            searchStations(query);
        }
    }
});

// Handle audio errors
audioPlayer.addEventListener('error', () => {
    console.error('Audio error');
    isPlaying = false;
    updatePlayButton();
    stopMetadataPolling();
    stopVisualization();
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
        } else {
            searchByTag(genre);
        }
    });
});

// Custom stations
addCustomBtn.addEventListener('click', addCustomStation);

// Export/Import
exportFavoritesBtn.addEventListener('click', exportFavorites);
exportCurrentBtn.addEventListener('click', exportCurrent);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', importStations);

// Settings
compactModeCheckbox.addEventListener('change', () => toggleCompactMode());
visualizerEnabledCheckbox.addEventListener('change', toggleVisualizer);
visualizerColorPicker.addEventListener('input', changeVisualizerColor);
enterCompactBtn.addEventListener('click', enterCompactMode);
exitCompactBtn.addEventListener('click', exitCompactMode);
alwaysOnTopBtn.addEventListener('click', toggleAlwaysOnTop);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

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
    }
});

// Initialize and load
init();
loadPopularStations();
