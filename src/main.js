// Radio Browser API base URL
const API_BASE = 'https://all.api.radio-browser.info/json';

// DOM elements
const audioPlayer = document.getElementById('audio-player');
const playBtn = document.getElementById('play-btn');
const playIcon = playBtn.querySelector('.play-icon');
const volumeSlider = document.getElementById('volume');
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

// State
let currentStation = null;
let isPlaying = false;
let metadataInterval = null;

// Check if Tauri is available
const hasTauriApi = typeof window.__TAURI__ !== 'undefined';

// Initialize volume
audioPlayer.volume = volumeSlider.value / 100;

// Search stations
async function searchStations(query) {
    stationsList.innerHTML = '<div class="loading">Searching...</div>';

    try {
        const url = API_BASE + '/stations/byname/' + encodeURIComponent(query) + '?limit=30&order=clickcount&reverse=true';
        const response = await fetch(url);
        const stations = await response.json();

        if (stations.length === 0) {
            stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
            return;
        }

        renderStations(stations);
    } catch (error) {
        console.error('Search error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Error searching stations</div>';
    }
}

// Load popular stations on start
async function loadPopularStations() {
    stationsList.innerHTML = '<div class="loading">Loading popular stations...</div>';

    try {
        const response = await fetch(API_BASE + '/stations/topclick/20');
        const stations = await response.json();
        renderStations(stations);
    } catch (error) {
        console.error('Load error:', error);
        stationsList.innerHTML = '<div class="loading-hint">Search for radio stations above</div>';
    }
}

// Render stations list
function renderStations(stations) {
    stationsList.innerHTML = '';

    stations.forEach(station => {
        const item = document.createElement('div');
        item.className = 'station-item';
        if (currentStation && currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
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

        info.appendChild(name);
        info.appendChild(country);
        item.appendChild(logo);
        item.appendChild(info);

        item.addEventListener('click', () => selectStation(station, item));
        stationsList.appendChild(item);
    });
}

// Update metadata display
function updateMetadata(station) {
    // Genre/tags
    const tags = station.tags ? station.tags.split(',')[0].trim() : '';
    if (tags) {
        metaGenre.textContent = tags;
        metaGenre.classList.remove('hidden');
    } else {
        metaGenre.classList.add('hidden');
    }

    // Bitrate
    if (station.bitrate && station.bitrate > 0) {
        metaBitrate.textContent = station.bitrate + ' kbps';
        metaBitrate.classList.remove('hidden');
    } else {
        metaBitrate.classList.add('hidden');
    }

    // Codec
    if (station.codec) {
        metaCodec.textContent = station.codec;
        metaCodec.classList.remove('hidden');
    } else {
        metaCodec.classList.add('hidden');
    }

    // Country
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

        // Poll every 10 seconds
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

// Select and play station
function selectStation(station, itemElement) {
    currentStation = station;

    // Update UI
    stationName.textContent = station.name;
    updateMetadata(station);

    if (station.favicon) {
        stationLogo.src = station.favicon;
        stationLogo.classList.remove('hidden');
        stationLogo.onerror = function() { stationLogo.classList.add('hidden'); };
    } else {
        stationLogo.classList.add('hidden');
    }

    // Update active state in list
    document.querySelectorAll('.station-item').forEach(item => {
        item.classList.remove('active');
    });
    itemElement.classList.add('active');

    // Enable play button
    playBtn.disabled = false;

    // Auto play
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

// Event listeners
playBtn.addEventListener('click', togglePlay);

volumeSlider.addEventListener('input', (e) => {
    audioPlayer.volume = e.target.value / 100;
});

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
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;

        // Update tab buttons
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById('tab-' + tabId).classList.add('active');
    });
});

// Load popular stations on start
loadPopularStations();
