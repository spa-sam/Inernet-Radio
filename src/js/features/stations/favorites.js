// Favorites: star/unstar stations and show the saved list.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { HEART_FILLED_SVG, HEART_OUTLINE_SVG } from '../../core/constants.js';
import { saveFavorite, deleteFavorite } from '../../core/db.js';
import { renderStations, setupDragReorder, saveFavoritesOrder } from './render.js';

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
