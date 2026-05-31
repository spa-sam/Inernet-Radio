// Unified station search. Combines instant in-memory results from the enabled
// local sources (custom + cached SomaFM + cached M3U, via sources.js) with the
// paged Radio Browser catalogue, de-duplicated into a single list. Infinite
// scroll only pages the Radio Browser portion.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { STATIONS_PAGE_SIZE } from '../../core/constants.js';
import { apiFetch } from '../../services/api.js';
import { filterBlacklisted } from './blacklist.js';
import { renderStations } from './render.js';
import { localSearch, isSourceEnabled } from '../sources.js';
import { setActivePreset } from '../presets.js';

// Stable key for de-duplicating the same stream coming from several sources.
function dedupKey(s) {
    return ((s.url_resolved || s.url || s.name || '') + '').trim().toLowerCase();
}

// Keep only stations not already shown (tracked in state.searchPage.seen).
function dedupe(stations) {
    const seen = state.searchPage.seen;
    const out = [];
    for (const s of stations) {
        const k = dedupKey(s);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(s);
    }
    return out;
}

export async function searchStations(query, tag = '', append = false) {
    const tagVal = tag || (dom.filterTag ? dom.filterTag.value.trim() : '');
    const rbEnabled = isSourceEnabled('radioBrowser');

    if (!append) {
        dom.stationsList.innerHTML = '<div class="loading">Searching…</div>';
        // Highlight the matching genre chip when searching by tag; clear otherwise.
        setActivePreset(tagVal);
        state.searchPage = {
            active: true, query, tag: tagVal,
            offset: 0, loading: true, exhausted: !rbEnabled,
            seen: new Set()
        };

        // 1) Instant local results from the enabled in-memory sources.
        let local = [];
        try {
            local = dedupe(filterBlacklisted(await localSearch(query, tagVal)));
        } catch (e) {
            console.warn('Local search failed:', e);
        }
        state.currentStationsList = local;
        if (local.length) renderStations(local);
        else dom.stationsList.innerHTML = '';

        // 2) Radio Browser, paged and appended after the local results.
        if (rbEnabled) {
            await fetchRadioBrowserPage();
        } else if (local.length === 0) {
            dom.stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
        }
    } else {
        if (!state.searchPage.active || state.searchPage.loading || state.searchPage.exhausted) return;
        state.searchPage.loading = true;
        await fetchRadioBrowserPage();
    }
}

// Fetch the next Radio Browser page using the current searchPage state and the
// filter panel, then append the de-duplicated, un-blacklisted results.
async function fetchRadioBrowserPage() {
    const { query, tag: tagVal } = state.searchPage;

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

        const fresh = dedupe(filterBlacklisted(stations));
        if (fresh.length) {
            state.currentStationsList = state.currentStationsList.concat(fresh);
            renderStations(fresh, dom.stationsList, true);
        }
        if (state.currentStationsList.length === 0) {
            dom.stationsList.innerHTML = '<div class="loading-hint">No stations found</div>';
        }
    } catch (error) {
        state.searchPage.loading = false;
        console.error('Search error:', error);
        if (state.currentStationsList.length === 0) {
            dom.stationsList.innerHTML = '<div class="loading-hint">Failed to load stations</div>';
        }
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
