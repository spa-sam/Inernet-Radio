// Source registry for the unified search. Owns the enabled/disabled state of
// each station source, local (in-memory) search over the cached SomaFM and M3U
// catalogues plus the user's custom stations, and lightweight connectivity
// checks shown in Settings. Radio Browser paging stays in search.js.

import { state } from '../core/state.js';
import { saveSetting } from '../core/db.js';
import { M3U_CONTENTS_API, M3U_CACHE_TTL_MS } from '../core/constants.js';
import { fetchSomaStations } from './stations/catalog.js';
import { fetchM3UStations } from './stations/m3u.js';

const SOMA_TTL_MS = 24 * 60 * 60 * 1000;      // SomaFM channel cache: 1 day
const M3U_INDEX_CAP = 8000;                    // bound the aggregated M3U index

// --- Enabled state ----------------------------------------------------------

export function isSourceEnabled(id) {
    return !!(state.settings.sources && state.settings.sources[id]);
}

export function setSourceEnabled(id, on) {
    const sources = { ...(state.settings.sources || {}), [id]: !!on };
    state.settings.sources = sources;
    saveSetting('sources', sources);
}

// --- Caches -----------------------------------------------------------------

function fresh(cache, ttl) {
    return cache && cache.fetchedAt && Array.isArray(cache.list) && (Date.now() - cache.fetchedAt < ttl);
}

async function ensureSomaCache() {
    const cache = state.settings.somaCache;
    if (fresh(cache, SOMA_TTL_MS)) return cache.list;
    try {
        const list = await fetchSomaStations();
        state.settings.somaCache = { list, fetchedAt: Date.now() };
        saveSetting('somaCache', state.settings.somaCache);
        return list;
    } catch (e) {
        console.warn('SomaFM cache refresh failed:', e);
        return (cache && cache.list) || [];
    }
}

// Build (or reuse) a flat index of M3U Radio stations for text search. Uses the
// repo's aggregate "everything" file (one request) rather than fetching every
// genre playlist; falls back to a stale cache on failure.
async function ensureM3UIndex() {
    const cache = state.settings.m3uIndex;
    if (fresh(cache, M3U_CACHE_TTL_MS)) return cache.list;
    try {
        const res = await fetch(M3U_CONTENTS_API);
        if (!res.ok) throw new Error('GitHub API ' + res.status);
        const items = await res.json();
        // The aggregate playlists are the "---"-prefixed files the genre picker
        // hides; prefer one mentioning "everything", else the first aggregate.
        const aggregates = (Array.isArray(items) ? items : [])
            .filter(it => it.type === 'file' && /\.m3u$/i.test(it.name) && it.name.startsWith('---'));
        const pick = aggregates.find(it => /everything/i.test(it.name)) || aggregates[0];
        if (!pick || !pick.download_url) throw new Error('no aggregate playlist found');
        const list = await fetchM3UStations(pick.download_url, M3U_INDEX_CAP);
        state.settings.m3uIndex = { list, fetchedAt: Date.now() };
        saveSetting('m3uIndex', state.settings.m3uIndex);
        return list;
    } catch (e) {
        console.warn('M3U index refresh failed:', e);
        return (cache && cache.list) || [];
    }
}

// --- Local search -----------------------------------------------------------

// Does a station match a free-text query and/or a tag/genre?
function matches(station, q, tag) {
    const name = (station.name || '').toLowerCase();
    const tags = (station.tags || '').toLowerCase();
    if (q && !(name.includes(q) || tags.includes(q))) return false;
    if (tag && !(tags.includes(tag) || name.includes(tag))) return false;
    return true;
}

// Search the enabled in-memory sources (custom + cached SomaFM + cached M3U).
// Each source is capped so a broad query cannot flood the list. Returns an
// array of stations tagged with `__source` for optional badging.
export async function localSearch(query, tag, perSourceCap = 100) {
    const q = (query || '').trim().toLowerCase();
    const t = (tag || '').trim().toLowerCase();
    if (!q && !t) return [];

    const out = [];

    if (isSourceEnabled('custom')) {
        for (const s of state.customStations) {
            if (matches(s, q, t)) out.push({ ...s, __source: 'custom' });
            if (out.length >= perSourceCap) break;
        }
    }

    if (isSourceEnabled('somafm')) {
        const list = await ensureSomaCache();
        let n = 0;
        for (const s of list) {
            if (matches(s, q, t)) { out.push({ ...s, __source: 'somafm' }); n++; }
            if (n >= perSourceCap) break;
        }
    }

    if (isSourceEnabled('m3u')) {
        const list = await ensureM3UIndex();
        let n = 0;
        for (const s of list) {
            if (matches(s, q, t)) { out.push({ ...s, __source: 'm3u' }); n++; }
            if (n >= perSourceCap) break;
        }
    }

    return out;
}

// --- Connectivity -----------------------------------------------------------

async function pingUrl(url, ms = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// Returns true (reachable), false (unreachable) or null (not applicable/local).
export async function checkConnectivity(id) {
    switch (id) {
        case 'radioBrowser':
            return pingUrl('https://all.api.radio-browser.info/json/stats');
        case 'somafm':
            return pingUrl('https://somafm.com/channels.json');
        case 'm3u':
            return pingUrl(M3U_CONTENTS_API);
        case 'custom':
            return null; // local — always available
        default:
            return null;
    }
}
