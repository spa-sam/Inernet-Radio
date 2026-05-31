// Editable genre preset chips on the Radio tab. The three source chips
// (Favorites, SomaFM, M3U Radio) are fixed in markup; the genre chips after
// them are rendered from settings.genrePresets and can be added, removed and
// reordered by the user. Clicking a chip is handled by the delegated listener
// in main.js — this module owns rendering, persistence and drag-reorder.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { saveSetting } from '../core/db.js';
import { DEFAULT_GENRE_PRESETS } from '../core/constants.js';

// Reserved genres that belong to the fixed source chips, not user genres.
const RESERVED = ['favorites', 'somafm', 'm3u'];

// Current genre presets, falling back to the defaults until the user edits.
export function getGenrePresets() {
    const p = state.settings.genrePresets;
    return (Array.isArray(p) && p.length) ? p : DEFAULT_GENRE_PRESETS.map(x => ({ ...x }));
}

function persist(list) {
    state.settings.genrePresets = list;
    saveSetting('genrePresets', list);
}

// Render the genre chips into dom.presetGenres. In edit mode chips become
// draggable and show a remove (✕) affordance (revealed via CSS).
export function renderGenrePresets() {
    const host = dom.presetGenres;
    if (!host) return;
    const editing = host.classList.contains('editing');

    host.replaceChildren();
    for (const { genre, label } of getGenrePresets()) {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.dataset.genre = genre;
        btn.draggable = editing;

        const text = document.createElement('span');
        text.className = 'preset-label';
        text.textContent = label;
        btn.appendChild(text);

        const del = document.createElement('span');
        del.className = 'preset-del';
        del.textContent = '✕';
        del.title = 'Remove genre';
        btn.appendChild(del);

        host.appendChild(btn);
    }
}

// Add a genre by its label. The Radio Browser tag is the lowercased label.
// Returns false if empty, reserved or already present.
export function addGenrePreset(rawLabel) {
    const label = (rawLabel || '').trim();
    if (!label) return false;
    const genre = label.toLowerCase();
    const list = getGenrePresets();
    if (RESERVED.includes(genre) || list.some(p => p.genre === genre)) return false;
    persist([...list, { genre, label }]);
    renderGenrePresets();
    return true;
}

export function removeGenrePreset(genre) {
    persist(getGenrePresets().filter(p => p.genre !== genre));
    renderGenrePresets();
}

// Highlight the genre chip matching `genre` (and clear the others). An empty
// value clears all — used when the current view is not a genre search.
export function setActivePreset(genre) {
    if (!dom.presetGenres) return;
    const g = (genre || '').trim().toLowerCase();
    dom.presetGenres.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', !!g && b.dataset.genre === g);
    });
}

// Show the search-box "+" only when the current query is a genre worth adding:
// non-empty, not reserved, and not already a preset.
export function updateAddGenreButton() {
    if (!dom.addGenreBtn || !dom.searchInput) return;
    const val = dom.searchInput.value.trim().toLowerCase();
    const canAdd = !!val && !RESERVED.includes(val) && !getGenrePresets().some(p => p.genre === val);
    dom.addGenreBtn.classList.toggle('hidden', !canAdd);
}

export function resetGenrePresets() {
    persist(DEFAULT_GENRE_PRESETS.map(x => ({ ...x })));
    renderGenrePresets();
}

// Find the chip the dragged element should be inserted before, given the
// pointer position. Chips wrap across rows, so pick the first chip on the
// pointer's row whose horizontal centre is past the pointer.
function getChipAfter(host, x, y) {
    const chips = [...host.querySelectorAll('.preset-btn:not(.dragging)')];
    for (const el of chips) {
        const box = el.getBoundingClientRect();
        if (y <= box.bottom && x < box.left + box.width / 2) return el;
    }
    return null;
}

// Bind drag-reorder once. Reorder only takes effect in edit mode.
export function setupPresetDrag() {
    const host = dom.presetGenres;
    if (!host || host.dataset.dragBound === '1') return;
    host.dataset.dragBound = '1';

    let dragEl = null;
    host.addEventListener('dragstart', (e) => {
        const btn = e.target.closest('.preset-btn');
        if (!btn || !host.classList.contains('editing')) return;
        dragEl = btn;
        btn.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    host.addEventListener('dragend', () => {
        if (dragEl) dragEl.classList.remove('dragging');
        dragEl = null;
    });
    host.addEventListener('dragover', (e) => {
        if (!dragEl) return;
        e.preventDefault();
        const after = getChipAfter(host, e.clientX, e.clientY);
        if (after == null) host.appendChild(dragEl);
        else host.insertBefore(dragEl, after);
    });
    host.addEventListener('drop', (e) => {
        if (!dragEl) return;
        e.preventDefault();
        const order = [...host.querySelectorAll('.preset-btn')].map(b => b.dataset.genre);
        const map = new Map(getGenrePresets().map(p => [p.genre, p]));
        persist(order.map(g => map.get(g)).filter(Boolean));
    });
}
