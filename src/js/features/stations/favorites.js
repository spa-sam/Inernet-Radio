// Favorites: star/unstar stations and show the saved list.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { HEART_FILLED_SVG, HEART_OUTLINE_SVG } from '../../core/icons.js';
import { saveFavorite, deleteFavorite } from '../../core/db.js';
import { renderStations, setupDragReorder, saveFavoritesOrder } from './render.js';
import { showEmpty } from '../../core/placeholders.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/ui.js';

export function isFavorite(stationuuid) {
    return state.favorites.some(fav => fav.stationuuid === stationuuid);
}

export async function toggleFavorite(station, btn) {
    const index = state.favorites.findIndex(fav => fav.stationuuid === station.stationuuid);

    if (index === -1) {
        state.favorites.push(station);
        btn.classList.add('active');
        btn.innerHTML = HEART_FILLED_SVG;
        // The icon alone carries the new state — keep the accessible name in sync.
        btn.setAttribute('aria-label', t(`Remove ${station.name} from favorites`));
        await saveFavorite(station, state.favorites);
    } else {
        state.favorites.splice(index, 1);
        btn.classList.remove('active');
        btn.innerHTML = HEART_OUTLINE_SVG;
        btn.setAttribute('aria-label', t(`Add ${station.name} to favorites`));
        await deleteFavorite(station.stationuuid, state.favorites);
    }
}

export function showFavorites() {
    state.searchPage.active = false;
    if (state.favorites.length === 0) {
        showEmpty(dom.stationsList, 'No saved stations');
        state.currentStationsList = [];
        return;
    }
    state.currentStationsList = state.favorites;
    renderStations(state.favorites);
    setupDragReorder(dom.stationsList, () => state.favorites, saveFavoritesOrder);
}

// Favourite / un-favourite whatever is playing (the "F" shortcut). Uses the
// heart button of the station's visible row when there is one, so its icon and
// accessible name update too.
export async function toggleCurrentFavorite() {
    const station = state.currentStation;
    if (!station || !station.stationuuid || station.stationuuid.startsWith('preview_')) return;
    const row = document.querySelector(`[data-stationuuid="${CSS.escape(station.stationuuid)}"] .favorite-btn`);
    await toggleFavorite(station, row || document.createElement('button'));
    toast(isFavorite(station.stationuuid) ? 'Added to favorites' : 'Removed from favorites', 'info', 1800);
}
