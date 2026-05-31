// stations.js — station discovery and management: search + infinite scroll,
// list rendering, favorites, blacklist, custom stations, recently played,
// track history, drag-reorder, and import / export (JSON, M3U, PLS, OPML).

import { state } from './state.js';
import { dom } from './dom.js';
import {
    HEART_FILLED_SVG, HEART_OUTLINE_SVG, STATIONS_PAGE_SIZE,
    M3U_CONTENTS_API, M3U_CACHE_TTL_MS
} from './constants.js';
import { hasTauriApi, generatePlaceholderLogo, getFaviconFromUrl } from './util.js';
import {
    saveSetting,
    saveFavorite,
    deleteFavorite,
    saveFavoritesBatch,
    saveBlacklist,
    saveRecentlyPlayed,
    saveTrackHistoryEntry,
    clearTrackHistoryStore,
    saveCustomStation,
    deleteCustomStation,
    updateCustomStation,
    saveCustomBatch
} from './db.js';
import { apiFetch } from './api.js';
import { selectStation, playStation, getProxiedUrl } from './player.js';
import { toast, setStationName, openYouTubeSearch } from './ui.js';

// --- Search -----------------------------------------------------------------

export async function searchStations(query, tag = '', append = false) {
    const tagVal = tag || (dom.filterTag ? dom.filterTag.value.trim() : '');

    if (!append) {
        dom.stationsList.innerHTML = '<div class="loading">Searching...</div>';
        clearActivePreset();
        state.searchPage = { active: true, query, tag: tagVal, offset: 0, loading: true, exhausted: false };
    } else {
        if (!state.searchPage.active || state.searchPage.loading || state.searchPage.exhausted) return;
        state.searchPage.loading = true;
    }

    const countryVal = dom.filterCountry.value;
    const bitrateVal = dom.filterBitrate.value;
    const codecVal = dom.filterCodec.value;
    const languageVal = dom.filterLanguage ? dom.filterLanguage.value.trim() : '';
    // Sort field maps directly to the Radio Browser `order` param. Everything
    // except an A–Z name sort reads best in descending order.
    const orderVal = dom.filterOrder ? dom.filterOrder.value : 'clickcount';
    const reverse = orderVal !== 'name';

    let path = `/stations/search?limit=${STATIONS_PAGE_SIZE}&offset=${state.searchPage.offset}&order=${orderVal}&reverse=${reverse}`;
    if (query) path += `&name=${encodeURIComponent(query)}`;
    if (tagVal) path += `&tag=${encodeURIComponent(tagVal)}`;
    if (countryVal) path += `&country=${encodeURIComponent(countryVal)}`;
    if (languageVal) path += `&language=${encodeURIComponent(languageVal)}`;
    if (bitrateVal && parseInt(bitrateVal) > 0) path += `&bitrateMin=${bitrateVal}`;
    if (codecVal) path += `&codec=${codecVal}`;

    try {
        const stations = await apiFetch(path);

        state.searchPage.loading = false;
        state.searchPage.offset += stations.length;
        if (stations.length < STATIONS_PAGE_SIZE) state.searchPage.exhausted = true;

        const filtered = filterBlacklisted(stations);

        if (!append) {
            if (filtered.length === 0) {
                dom.stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
                state.currentStationsList = [];
                return;
            }
            state.currentStationsList = filtered;
            renderStations(filtered);
        } else if (filtered.length) {
            state.currentStationsList = state.currentStationsList.concat(filtered);
            renderStations(filtered, dom.stationsList, true);
        }
    } catch (error) {
        state.searchPage.loading = false;
        console.error('Search error:', error);
        if (!append) dom.stationsList.innerHTML = '<div class="loading-hint">Failed to load stations</div>';
    }
}

// Fetch the next page when the user scrolls near the bottom of the list.
export function loadMoreStations() {
    if (!state.searchPage.active || state.searchPage.loading || state.searchPage.exhausted) return;
    searchStations(state.searchPage.query, state.searchPage.tag, true);
}

export function clearActivePreset() {
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
}

// --- Favorites --------------------------------------------------------------

export function isFavorite(stationuuid) {
    return state.favorites.some(fav => fav.stationuuid === stationuuid);
}

export async function toggleFavorite(station, btn) {
    const index = state.favorites.findIndex(fav => fav.stationuuid === station.stationuuid);

    if (index === -1) {
        state.favorites.push(station);
        btn.classList.add('active');
        btn.innerHTML = HEART_FILLED_SVG;
        await saveFavorite(station, state.favorites);
    } else {
        state.favorites.splice(index, 1);
        btn.classList.remove('active');
        btn.innerHTML = HEART_OUTLINE_SVG;
        await deleteFavorite(station.stationuuid, state.favorites);
    }
}

export function showFavorites() {
    state.searchPage.active = false;
    if (state.favorites.length === 0) {
        dom.stationsList.innerHTML = '<div class="loading-hint">No saved stations</div>';
        state.currentStationsList = [];
        return;
    }
    state.currentStationsList = state.favorites;
    renderStations(state.favorites);
    setupDragReorder(dom.stationsList, state.favorites, saveFavoritesOrder);
}

// --- Blacklist --------------------------------------------------------------

export function isBlacklisted(stationuuid) {
    return state.blacklist.some(item => item.stationuuid === stationuuid);
}

export async function addToBlacklist(station) {
    if (!isBlacklisted(station.stationuuid)) {
        state.blacklist.push({ stationuuid: station.stationuuid, name: station.name });
        await saveBlacklist(station, state.blacklist);
    }
}

export function filterBlacklisted(stations) {
    return stations.filter(station => !isBlacklisted(station.stationuuid));
}

// --- Catalog loaders --------------------------------------------------------

export async function loadPopularStations() {
    state.searchPage.active = false;
    dom.stationsList.innerHTML = '<div class="loading">Loading popular stations...</div>';

    try {
        const stations = await apiFetch('/stations/topclick/20');
        state.currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('Load error:', error);
        dom.stationsList.innerHTML = '<div class="loading-hint">Find radio stations using the search above</div>';
    }
}

// Load SomaFM curated channels as stations
export async function loadSomaFM() {
    state.searchPage.active = false;
    dom.stationsList.innerHTML = '<div class="loading">Loading SomaFM...</div>';

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
            dom.stationsList.innerHTML = '<div class="loading-hint">SomaFM returned no stations</div>';
            state.currentStationsList = [];
            return;
        }

        state.currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('SomaFM load error:', error);
        dom.stationsList.innerHTML = '<div class="loading-hint">Failed to load SomaFM</div>';
    }
}

// --- M3U Radio (junguler/m3u-radio-music-playlists) -------------------------

// Return the genre list. Served from the cached copy in settings unless it is
// missing, stale (older than the TTL) or a refresh is forced. A live fetch hits
// the GitHub contents API once and is cached (per-IP rate limit, ~1 req/week).
export async function getM3UGenres(forceRefresh = false) {
    const cache = state.settings.m3uGenres;
    const fresh = cache && cache.fetchedAt && (Date.now() - cache.fetchedAt < M3U_CACHE_TTL_MS);
    if (!forceRefresh && fresh && Array.isArray(cache.list) && cache.list.length) {
        return cache.list;
    }
    try {
        const res = await fetch(M3U_CONTENTS_API);
        if (!res.ok) throw new Error('GitHub API ' + res.status);
        const items = await res.json();
        const list = (Array.isArray(items) ? items : [])
            // Genre/country files only — drop the huge ---everything-* aggregates
            .filter(it => it.type === 'file' && /\.m3u$/i.test(it.name) && !it.name.startsWith('---'))
            .map(it => ({
                label: it.name.replace(/\.m3u$/i, '').replace(/[_-]+/g, ' ').trim(),
                url: it.download_url
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
        state.settings.m3uGenres = { list, fetchedAt: Date.now() };
        saveSetting('m3uGenres', state.settings.m3uGenres);
        return list;
    } catch (e) {
        console.error('M3U genre list error:', e);
        // Fall back to a stale cache rather than failing outright
        if (cache && Array.isArray(cache.list)) return cache.list;
        throw e;
    }
}

// Fetch one genre playlist on demand (through the CORS proxy in raw mode so the
// .m3u text is returned verbatim), parse it and show it as a transient list.
// Nothing is written to the database — only favourites the user stars persist.
export async function loadM3URadio(rawUrl) {
    state.searchPage.active = false;
    dom.stationsList.innerHTML = '<div class="loading">Loading playlist…</div>';
    try {
        const text = await (await fetch(getProxiedUrl(rawUrl, true))).text();
        const stations = parseM3U(text)
            .filter(s => s.url && /^https?:/i.test(s.url))
            // Some genres hold thousands of entries; cap the rendered list so
            // the DOM stays responsive (favourites still persist individually).
            .slice(0, 500)
            .map(s => ({
                stationuuid: 'm3u_' + s.url,
                name: s.name,
                url: s.url,
                url_resolved: s.url,
                favicon: s.favicon || '',
                tags: '',
                country: 'M3U Radio',
                bitrate: 0,
                codec: '',
                hls: 0
            }));
        if (stations.length === 0) {
            dom.stationsList.innerHTML = '<div class="loading-hint">Playlist is empty</div>';
            state.currentStationsList = [];
            return;
        }
        state.currentStationsList = stations;
        renderStations(stations);
    } catch (error) {
        console.error('M3U load error:', error);
        dom.stationsList.innerHTML = '<div class="loading-hint">Failed to load playlist</div>';
    }
}

// --- List rendering ---------------------------------------------------------

export function renderStations(stations, container = dom.stationsList, append = false) {
    if (!append) container.innerHTML = '';

    const startIndex = append ? container.querySelectorAll('.station-item').length : 0;

    // Update the station count badge (only for the main list)
    if (container === dom.stationsList && dom.stationsCount) {
        const total = startIndex + stations.length;
        dom.stationsCount.textContent = total ? `${total} stations` : '';
    }

    stations.forEach((station, i) => {
        const index = startIndex + i;
        const item = document.createElement('div');
        item.className = 'station-item';
        item.dataset.stationuuid = station.stationuuid;
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
            state.currentStationIndex = index;
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
            state.currentStationIndex = index;
            selectStation(station, item);
        });
        container.appendChild(item);
    });
}

// Enable drag-and-drop reordering for a list of .station-item elements inside
// `container`. On drop, `list` is reordered to match the DOM and `persist` is
// called to save the new ordering. Container-level listeners are bound once.
export function setupDragReorder(container, list, persist) {
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
    state.settings.favoritesOrder = state.favorites.map((f) => f.stationuuid);
    saveSetting('favoritesOrder', state.settings.favoritesOrder);
}

function saveCustomOrder() {
    state.settings.customOrder = state.customStations.map((c) => c.stationuuid);
    saveSetting('customOrder', state.settings.customOrder);
}

// --- Recently played --------------------------------------------------------

export async function addToRecentlyPlayed(station) {
    if (!station || !station.stationuuid || station.stationuuid.startsWith('preview_')) return;

    state.recentlyPlayed = state.recentlyPlayed.filter(s => s.stationuuid !== station.stationuuid);
    state.recentlyPlayed.unshift(station);
    if (state.recentlyPlayed.length > 10) {
        state.recentlyPlayed.pop();
    }

    await saveRecentlyPlayed(station, state.recentlyPlayed);
    renderRecentlyPlayed();
}

export function renderRecentlyPlayed() {
    if (state.recentlyPlayed.length === 0) {
        dom.recentlyPlayedSection.classList.add('hidden');
        return;
    }

    dom.recentlyPlayedSection.classList.remove('hidden');
    dom.recentlyPlayedList.innerHTML = '';

    state.recentlyPlayed.forEach(station => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
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
            // Swap list context to recentlyPlayed
            state.currentStationsList = state.recentlyPlayed;
            state.currentStationIndex = state.recentlyPlayed.findIndex(s => s.stationuuid === station.stationuuid);
            selectStation(station, item);
        });

        dom.recentlyPlayedList.appendChild(item);
    });
}

// --- Track history ----------------------------------------------------------

export async function addToTrackHistory(title, station) {
    if (!title) return;
    // Skip consecutive duplicates (the same song is polled several times)
    if (state.trackHistory.length > 0 && state.trackHistory[0].title === title) return;

    const entry = {
        title,
        stationName: station ? station.name : '',
        favicon: station ? (station.favicon || '') : '',
        timestamp: Date.now()
    };
    state.trackHistory.unshift(entry);
    if (state.trackHistory.length > 50) state.trackHistory.pop();

    await saveTrackHistoryEntry(entry, state.trackHistory);
    renderTrackHistory();
}

export function renderTrackHistory() {
    if (!dom.trackHistoryList) return;

    if (state.trackHistory.length === 0) {
        dom.trackHistoryList.replaceChildren();
        const hint = document.createElement('div');
        hint.className = 'loading-hint';
        hint.textContent = 'History is empty';
        dom.trackHistoryList.appendChild(hint);
        return;
    }

    dom.trackHistoryList.replaceChildren();
    state.trackHistory.forEach(entry => {
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
        dom.trackHistoryList.appendChild(item);
    });
}

export async function clearTrackHistory() {
    state.trackHistory = [];
    await clearTrackHistoryStore();
    renderTrackHistory();
    toast('Track history cleared', 'success');
}

// --- Custom stations --------------------------------------------------------

export async function addCustomStation() {
    const name = dom.customNameInput.value.trim();
    const url = dom.customUrlInput.value.trim();
    const genre = dom.customGenreInput.value.trim();

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

    state.customStations.push(station);
    await saveCustomStation(station, state.customStations, genre);

    dom.customNameInput.value = '';
    dom.customUrlInput.value = '';
    dom.customGenreInput.value = '';

    renderCustomStations();
}

export async function removeCustomStation(stationuuid) {
    state.customStations = state.customStations.filter(s => s.stationuuid !== stationuuid);
    await deleteCustomStation(stationuuid, state.customStations);
    renderCustomStations();
}

// Open the Edit custom station modal
export function openEditModal(station) {
    dom.editStationUuidInput.value = station.stationuuid;
    dom.editStationNameInput.value = station.name;
    dom.editStationUrlInput.value = station.url;
    dom.editStationGenreInput.value = station.tags || station.genre || '';
    dom.editModal.classList.remove('hidden');
}

export async function saveEditedStation() {
    const uuid = dom.editStationUuidInput.value;
    const name = dom.editStationNameInput.value.trim();
    const url = dom.editStationUrlInput.value.trim();
    const genre = dom.editStationGenreInput.value.trim();

    if (!name || !url) {
        toast('Enter a name and URL', 'error');
        return;
    }

    const index = state.customStations.findIndex(s => s.stationuuid === uuid);
    if (index !== -1) {
        const station = state.customStations[index];
        station.name = name;
        station.url = url;
        station.url_resolved = url;
        station.tags = genre;
        station.genre = genre;
        station.favicon = getFaviconFromUrl(url);

        await updateCustomStation(station, state.customStations, genre);

        renderCustomStations();
        updateCurrentStationInfo();

        if (state.currentStation && state.currentStation.stationuuid === uuid) {
            setStationName(name);
            state.currentStation = station;
            if (state.isPlaying) {
                playStation();
            }
        }
    }

    dom.editModal.classList.add('hidden');
}

export function renderCustomStations() {
    if (state.customStations.length === 0) {
        dom.customStationsList.innerHTML = '<div class="loading-hint">No custom stations</div>';
        return;
    }

    dom.customStationsList.innerHTML = '';

    state.customStations.forEach((station, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
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
            state.currentStationsList = state.customStations;
            state.currentStationIndex = index;
            selectStation(station, item);
        });

        item.dataset.stationuuid = station.stationuuid;
        dom.customStationsList.appendChild(item);
    });

    setupDragReorder(dom.customStationsList, state.customStations, saveCustomOrder);
}

// Update current station info in the Custom tab
export function updateCurrentStationInfo() {
    if (!dom.currentStationInfo) return;

    if (!state.currentStation) {
        dom.currentStationInfo.innerHTML = '<div class="current-station-empty">No active station</div>';
        return;
    }

    const s = state.currentStation;
    const genre = s.tags ? s.tags.split(',')[0] : '';
    const fallbackLogo = generatePlaceholderLogo(s.name);
    const logoSrc = s.favicon || fallbackLogo;

    // Build the form with DOM APIs (not innerHTML) so station names/URLs
    // from the public Radio Browser catalog cannot inject markup (XSS).
    dom.currentStationInfo.replaceChildren();
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
    dom.currentStationInfo.appendChild(form);
}

// --- Export / import --------------------------------------------------------

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

export async function exportFavorites() {
    if (state.favorites.length === 0) {
        toast('No favorite stations to export', 'error');
        return;
    }
    await exportToJson(state.favorites, 'radio-favorites.json');
}

// Export the current playing station
async function exportCurrentStation() {
    if (!state.currentStation) {
        toast('No active station', 'error');
        return;
    }
    await exportToJson([state.currentStation], `${state.currentStation.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
}

// Parse an M3U / M3U8 playlist into {name, url} entries
function parseM3U(text) {
    const stations = [];
    let pendingName = '';
    let pendingLogo = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.toUpperCase().startsWith('#EXTINF:')) {
            const comma = line.indexOf(',');
            pendingName = comma >= 0 ? line.slice(comma + 1).trim() : '';
            // Many playlists carry a logo via `tvg-logo="..."` on the EXTINF line
            const logo = line.match(/tvg-logo="([^"]*)"/i);
            pendingLogo = logo ? logo[1] : '';
        } else if (!line.startsWith('#')) {
            stations.push({ name: pendingName || line, url: line, favicon: pendingLogo });
            pendingName = '';
            pendingLogo = '';
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
    const added = [];
    for (const entry of entries) {
        if (!entry.url || !/^https?:/i.test(entry.url)) continue;
        if (state.customStations.some(s => s.url === entry.url)) continue;

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
        state.customStations.push(station);
        added.push(station);
    }
    await saveCustomBatch(added, state.customStations);
    renderCustomStations();
    toast(`Stations imported: ${added.length}`, 'success');
}

// Import the app's own JSON export format (favorites or custom stations)
async function importStationsJson(text) {
    const data = JSON.parse(text);

    if (!Array.isArray(data)) {
        toast('Invalid file format', 'error');
        return;
    }

    const isCustom = data.some(s => s.stationuuid && s.stationuuid.startsWith('custom_'));

    if (isCustom) {
        const added = [];
        for (const station of data) {
            if (!state.customStations.some(s => s.stationuuid === station.stationuuid)) {
                state.customStations.push(station);
                added.push(station);
            }
        }
        await saveCustomBatch(added, state.customStations);
        renderCustomStations();
        toast('Custom stations imported', 'success');
    } else {
        const added = [];
        for (const station of data) {
            if (!state.favorites.some(f => f.stationuuid === station.stationuuid)) {
                state.favorites.push(station);
                added.push(station);
            }
        }
        await saveFavoritesBatch(added, state.favorites);
        toast('Favorites imported', 'success');
    }
}

// Import stations from a JSON, M3U/M3U8, PLS or OPML file
export function importStations(event) {
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
