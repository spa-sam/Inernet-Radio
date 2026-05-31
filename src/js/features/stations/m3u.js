// M3U Radio (junguler/m3u-radio-music-playlists): genre list from the GitHub
// contents API and on-demand loading of a single genre playlist.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { M3U_CONTENTS_API, M3U_CACHE_TTL_MS } from '../../core/constants.js';
import { saveSetting } from '../../core/db.js';
import { getProxiedUrl } from '../player.js';
import { parseM3U } from './io.js';
import { renderStations } from './render.js';

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

// Fetch a .m3u playlist (through the CORS proxy in raw mode) and map its
// entries to station objects. `limit` caps the result (0 = no cap). Shared by
// the browse view (loadM3URadio) and the unified-search index (sources.js).
export async function fetchM3UStations(rawUrl, limit = 500) {
    const res = await fetch(getProxiedUrl(rawUrl, true));
    // The local proxy returns 502 when it cannot resolve the upstream; treat
    // any non-OK response as a failure rather than parsing the error body.
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let entries = parseM3U(text).filter(s => s.url && /^https?:/i.test(s.url));
    // Some genres hold thousands of entries; cap so the DOM stays responsive
    // (favourites still persist individually).
    if (limit) entries = entries.slice(0, limit);
    return entries.map(s => ({
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
}

export async function loadM3URadio(rawUrl) {
    state.searchPage.active = false;
    dom.stationsList.innerHTML = '<div class="loading">Loading playlist…</div>';
    try {
        const stations = await fetchM3UStations(rawUrl);
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
