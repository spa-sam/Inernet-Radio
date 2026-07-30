// Station list rendering and drag-and-drop reordering, plus the order-persist
// helpers shared by the favorites and custom lists.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { HEART_FILLED_SVG, HEART_OUTLINE_SVG } from '../../core/constants.js';
import { applyLogo } from '../../core/favicon.js';
import { saveSetting } from '../../core/db.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { addToBlacklist, removeFromBlacklist, renderBlacklist } from './blacklist.js';
import { selectStation } from '../player.js';
import { toast } from '../../ui/ui.js';

// --- List event delegation --------------------------------------------------
// Rows used to carry their own listeners: one for the row plus one per action
// button, plus a keydown handler — four per row. The search list pages in up to
// several thousand rows, so that ran into tens of thousands of listeners that
// all had to be torn down on the next render. Each container now gets exactly
// two listeners, and a row is mapped back to its station through the uuid
// already present in its dataset.

const ROW_SELECTOR = '.station-item, .recent-item';

// container -> { onSelect, onAction }
const listRegistry = new WeakMap();
// row element -> { station, index }. Keyed by the element rather than by
// stationuuid so nothing depends on those being unique, and so entries are
// collected along with the rows they describe.
const rowEntries = new WeakMap();
// container -> () => backing array, resolved at drop time (see setupDragReorder).
const dragListGetters = new WeakMap();

// Register what happens when a row in `container` is activated.
// `onSelect(entry, row)` fires for a click/Enter on the row itself;
// `onAction(action, entry, row, button)` for a click on a [data-action] button.
export function bindStationList(container, { onSelect, onAction } = {}) {
    listRegistry.set(container, { onSelect, onAction });

    if (container.dataset.listBound !== '1') {
        container.dataset.listBound = '1';
        container.addEventListener('click', onListClick);
        container.addEventListener('keydown', onListKeydown);
    }
}

// Record one rendered row so the delegated handlers can resolve it.
export function registerRow(row, station, index) {
    rowEntries.set(row, { station, index });
}

// Rows carry the index they had when they were rendered. Anything that changes
// the order or removes a row without re-rendering has to refresh them, or the
// next click reports a stale position and prev/next jumps elsewhere.
function reindexRows(container) {
    [...container.querySelectorAll('.station-item, .recent-item')].forEach((row, i) => {
        const entry = rowEntries.get(row);
        if (entry) entry.index = i;
    });
}

function resolveRow(e) {
    const container = e.currentTarget;
    const reg = listRegistry.get(container);
    if (!reg) return null;
    const row = e.target.closest(ROW_SELECTOR);
    if (!row || !container.contains(row)) return null;
    const entry = rowEntries.get(row);
    return entry ? { reg, row, entry } : null;
}

function onListClick(e) {
    const ctx = resolveRow(e);
    if (!ctx) return;
    const button = e.target.closest('[data-action]');
    if (button && ctx.row.contains(button)) {
        if (ctx.reg.onAction) ctx.reg.onAction(button.dataset.action, ctx.entry, ctx.row, button);
        return;
    }
    if (ctx.reg.onSelect) ctx.reg.onSelect(ctx.entry, ctx.row);
}

function onListKeydown(e) {
    const container = e.currentTarget;
    const row = e.target;
    // Only keys aimed at the row itself; the action buttons handle their own.
    if (!row.matches || !row.matches(ROW_SELECTOR)) return;

    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // Space is also the global play/stop shortcut — keep it from bubbling
        // to the document handler.
        e.stopPropagation();
        row.click();
        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const rows = [...container.children].filter((el) => el.getAttribute('role') === 'button');
        const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
            e.preventDefault();
            next.focus();
        }
    }
}

// Make a list row behave like a button for keyboard users: focusable, activated
// by Enter / Space, and navigable with the arrow keys within its container.
// Activation itself is handled by the container's delegated listeners.
export function makeRowActivatable(row, label) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', label);
}

export function renderStations(stations, container = dom.stationsList, append = false) {
    if (!append) container.innerHTML = '';

    const startIndex = append ? container.querySelectorAll('.station-item').length : 0;

    // Update the station count badge (only for the main list)
    if (container === dom.stationsList && dom.stationsCount) {
        const total = startIndex + stations.length;
        dom.stationsCount.textContent = total ? `${total} stations` : '';
    }

    bindStationList(container, {
        onSelect: ({ station, index }, row) => {
            state.currentStationIndex = index;
            selectStation(station, row);
        },
        onAction: (action, { station }, row, button) => {
            if (action === 'favorite') {
                toggleFavorite(station, button);
            } else if (action === 'blacklist') {
                addToBlacklist(station);
                row.remove();
                // Drop it from the playback list too. Leaving it there let
                // prev/next land on a station the user had just hidden, and
                // desynced the row count from the array that the next appended
                // page derives its start index from.
                const i = state.currentStationsList.indexOf(station);
                if (i !== -1) {
                    state.currentStationsList.splice(i, 1);
                    if (state.currentStationIndex > i) state.currentStationIndex--;
                }
                reindexRows(container);
                renderBlacklist();
                // Hiding used to be permanent with no way back (short of the
                // Settings list below). An immediate Undo covers the common
                // case: a misclick right next to the favorite heart.
                toast(`Hid ${station.name}`, 'info', 6000, {
                    label: 'Undo',
                    onClick: () => {
                        removeFromBlacklist(station.stationuuid);
                        renderBlacklist();
                    }
                });
            }
        }
    });

    stations.forEach((station, i) => {
        const index = startIndex + i;
        const item = document.createElement('div');
        item.className = 'station-item';
        item.dataset.stationuuid = station.stationuuid;
        makeRowActivatable(item, `Play ${station.name}`);
        registerRow(item, station, index);
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
            item.setAttribute('aria-current', 'true');
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
        favBtn.dataset.action = 'favorite';
        favBtn.setAttribute('aria-label',
            isFavorite(station.stationuuid)
                ? `Remove ${station.name} from favorites`
                : `Add ${station.name} to favorites`);

        // Blacklist button
        const blacklistBtn = document.createElement('button');
        blacklistBtn.className = 'action-btn blacklist-btn';
        blacklistBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
        blacklistBtn.title = 'Hide station';
        blacklistBtn.dataset.action = 'blacklist';
        blacklistBtn.setAttribute('aria-label', `Hide ${station.name}`);

        info.appendChild(name);
        info.appendChild(country);
        item.appendChild(logo);
        item.appendChild(info);
        actions.appendChild(favBtn);
        actions.appendChild(blacklistBtn);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

// Enable drag-and-drop reordering for a list of .station-item elements inside
// `container`. On drop, `list` is reordered to match the DOM and `persist` is
// called to save the new ordering. Container-level listeners are bound once.
export function setupDragReorder(container, getList, persist) {
    // `draggable` is an attribute, so it has to be set per row; the handlers
    // themselves are delegated like the rest.
    container.querySelectorAll('.station-item').forEach((item) => {
        item.draggable = true;
    });

    // The handlers are bound once, so they must not close over the array
    // itself: removeCustomStation() replaces state.customStations wholesale, and
    // a captured reference would then sort a detached array while persist() read
    // the live one — the new order was written, then silently lost on the next
    // render. Take a getter instead and resolve it at drop time.
    dragListGetters.set(container, getList);

    if (container.dataset.dragBound === '1') return;
    container.dataset.dragBound = '1';

    container.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.station-item');
        if (!item || !container.contains(item)) return;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.stationuuid || '');
    });

    container.addEventListener('dragend', (e) => {
        const item = e.target.closest('.station-item');
        if (item) item.classList.remove('dragging');
    });

    container.addEventListener('dragover', (e) => {
        const dragging = container.querySelector('.dragging');
        if (!dragging) return; // ignore drags that did not originate here
        e.preventDefault();
        const after = getDragAfterElement(container, e.clientY);
        if (after == null) container.appendChild(dragging);
        else container.insertBefore(dragging, after);
    });

    container.addEventListener('drop', (e) => {
        const rows = [...container.querySelectorAll('.station-item')];
        if (rows.length === 0) return;
        e.preventDefault();

        const list = dragListGetters.get(container)();
        const pos = new Map(rows.map((el, i) => [el.dataset.stationuuid, i]));
        list.sort((a, b) => (pos.get(a.stationuuid) ?? 0) - (pos.get(b.stationuuid) ?? 0));

        // Nothing re-renders after a drop, so refresh the row indices in place.
        reindexRows(container);

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
