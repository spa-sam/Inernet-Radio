// Catalog loaders: Radio Browser top-clicked stations and SomaFM channels.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { apiFetch } from '../../services/api.js';
import { renderStations } from './render.js';

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
