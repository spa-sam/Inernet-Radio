// Station search against Radio Browser, with infinite-scroll paging.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { STATIONS_PAGE_SIZE } from '../../core/constants.js';
import { apiFetch } from '../../services/api.js';
import { filterBlacklisted } from './blacklist.js';
import { renderStations } from './render.js';

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
