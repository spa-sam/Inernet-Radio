// Station list rendering and drag-and-drop reordering, plus the order-persist
// helpers shared by the favorites and custom lists.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { HEART_FILLED_SVG, HEART_OUTLINE_SVG } from '../../core/constants.js';
import { applyLogo } from '../../core/favicon.js';
import { saveSetting } from '../../core/db.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { addToBlacklist } from './blacklist.js';
import { selectStation } from '../player.js';

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
        applyLogo(logo, station);

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

export function saveFavoritesOrder() {
    state.settings.favoritesOrder = state.favorites.map((f) => f.stationuuid);
    saveSetting('favoritesOrder', state.settings.favoritesOrder);
}

export function saveCustomOrder() {
    state.settings.customOrder = state.customStations.map((c) => c.stationuuid);
    saveSetting('customOrder', state.settings.customOrder);
}
