// Combined search dropdown shown under the search box. Three sections:
//   • Suggestions — the live text query + matching Radio Browser tags
//   • Genres      — the editable genre presets
//   • Collections — curated lists (SomaFM channels, M3U Radio genres)
// Picking a genre/tag runs the unified search; picking a collection loads it.

import { dom } from '../core/dom.js';
import { getGenrePresets, updateAddGenreButton, setActivePreset } from './presets.js';
import { searchStations, loadSomaFM, loadM3URadio, getM3UGenres } from './stations.js';

// Pick a genre/tag: reflect it into the search box (so the "+" add button can
// appear) and run the unified search. Avoids dispatching an input event so the
// debounced text search does not also fire.
function pickGenre(term) {
    dom.searchInput.value = term;
    updateAddGenreButton();
    searchStations('', term);
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function section(title) {
    const s = el('div', 'sd-section');
    s.appendChild(el('div', 'sd-title', title));
    return s;
}

function item(label, onClick, sub) {
    const b = el('button', 'sd-item');
    b.appendChild(el('span', 'sd-item-label', label));
    if (sub) b.appendChild(el('span', 'sd-item-sub', sub));
    b.addEventListener('click', () => { closeDropdown(); onClick(); });
    return b;
}

export function closeDropdown() {
    if (dom.searchDropdown) dom.searchDropdown.classList.add('hidden');
}

export function openDropdown() {
    if (!dom.searchDropdown) return;
    renderDropdown();
    dom.searchDropdown.classList.remove('hidden');
}

function toggleDropdown() {
    if (!dom.searchDropdown) return;
    if (dom.searchDropdown.classList.contains('hidden')) openDropdown();
    else closeDropdown();
}

// Suggestions: a "search for X" action plus matching tags from the live
// Radio Browser tag datalist (populated by loadFilterOptions).
function renderSuggestions(query) {
    const wrap = section('Suggestions');
    const q = (query || '').trim();
    if (q) {
        wrap.appendChild(item(`Search “${q}”`, () => searchStations(q)));
        const list = document.getElementById('tag-list');
        if (list) {
            const ql = q.toLowerCase();
            const tags = [...list.options]
                .map(o => o.value)
                .filter(v => v && v.toLowerCase().includes(ql))
                .slice(0, 6);
            for (const t of tags) wrap.appendChild(item(t, () => pickGenre(t), 'tag'));
        }
    } else {
        wrap.appendChild(el('div', 'sd-empty', 'Type to search, or pick a genre / collection below'));
    }
    return wrap;
}

function renderGenres() {
    const wrap = section('Genres');
    for (const { genre, label } of getGenrePresets()) {
        wrap.appendChild(item(label, () => pickGenre(genre)));
    }
    return wrap;
}

function renderCollections() {
    const wrap = section('Collections');
    wrap.appendChild(item('SomaFM', () => { setActivePreset(''); loadSomaFM(); }, 'curated'));

    const m3u = el('div', 'sd-m3u');
    m3u.appendChild(el('div', 'sd-empty', 'Loading M3U genres…'));
    wrap.appendChild(m3u);
    getM3UGenres()
        .then(genres => {
            m3u.replaceChildren();
            for (const g of genres) {
                m3u.appendChild(item(g.label, () => {
                    // Keep the genre name in the search box so it can be added
                    // as a preset via "+", and load its playlist.
                    dom.searchInput.value = g.label;
                    updateAddGenreButton();
                    setActivePreset('');
                    loadM3URadio(g.url);
                }, 'M3U'));
            }
        })
        .catch(() => m3u.replaceChildren(el('div', 'sd-empty', 'M3U genres unavailable')));
    return wrap;
}

export function renderDropdown() {
    const panel = dom.searchDropdown;
    if (!panel) return;
    panel.replaceChildren();
    panel.appendChild(renderSuggestions(dom.searchInput.value));
    panel.appendChild(renderGenres());
    panel.appendChild(renderCollections());
}

export function setupSearchDropdown() {
    if (!dom.searchDropdown) return;

    if (dom.searchDropdownBtn) {
        dom.searchDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });
    }
    dom.searchInput.addEventListener('focus', openDropdown);

    // Live-update only the Suggestions section while typing
    dom.searchInput.addEventListener('input', () => {
        if (dom.searchDropdown.classList.contains('hidden')) return;
        const first = dom.searchDropdown.querySelector('.sd-section');
        if (first) first.replaceWith(renderSuggestions(dom.searchInput.value));
    });

    // Close when clicking outside the search box
    document.addEventListener('click', (e) => {
        if (!dom.searchDropdown.classList.contains('hidden') && !e.target.closest('.search-box')) {
            closeDropdown();
        }
    });
}
