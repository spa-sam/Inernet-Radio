// Custom stations: add / edit / delete user stations, render the custom list,
// and the "current station" info panel on the Custom tab.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { HEART_FILLED_SVG, HEART_OUTLINE_SVG } from '../../core/constants.js';
import { getFaviconFromUrl } from '../../core/util.js';
import { applyLogo } from '../../core/favicon.js';
import { saveCustomStation, deleteCustomStation, updateCustomStation } from '../../core/db.js';
import { toast, setStationName } from '../../ui/ui.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { setupDragReorder, saveCustomOrder } from './render.js';
import { exportCurrentStation } from './io.js';
import { selectStation, playStation } from '../player.js';

export async function addCustomStation() {
    const name = dom.customNameInput.value.trim();
    const url = dom.customUrlInput.value.trim();
    const genre = dom.customGenreInput.value.trim();

    if (!name || !url) {
        toast('Enter a station name and URL', 'error');
        return;
    }

    const station = {
        stationuuid: 'custom_' + Date.now(),
        name: name,
        url: url,
        url_resolved: url,
        tags: genre,
        country: 'Custom station',
        favicon: getFaviconFromUrl(url),
        bitrate: 0,
        codec: ''
    };

    state.customStations.push(station);
    await saveCustomStation(station, state.customStations, genre);

    dom.customNameInput.value = '';
    dom.customUrlInput.value = '';
    dom.customGenreInput.value = '';

    renderCustomStations();
}

export async function removeCustomStation(stationuuid) {
    state.customStations = state.customStations.filter(s => s.stationuuid !== stationuuid);
    await deleteCustomStation(stationuuid, state.customStations);
    renderCustomStations();
}

// Open the Edit custom station modal
export function openEditModal(station) {
    dom.editStationUuidInput.value = station.stationuuid;
    dom.editStationNameInput.value = station.name;
    dom.editStationUrlInput.value = station.url;
    dom.editStationGenreInput.value = station.tags || station.genre || '';
    dom.editModal.classList.remove('hidden');
}

export async function saveEditedStation() {
    const uuid = dom.editStationUuidInput.value;
    const name = dom.editStationNameInput.value.trim();
    const url = dom.editStationUrlInput.value.trim();
    const genre = dom.editStationGenreInput.value.trim();

    if (!name || !url) {
        toast('Enter a name and URL', 'error');
        return;
    }

    const index = state.customStations.findIndex(s => s.stationuuid === uuid);
    if (index !== -1) {
        const station = state.customStations[index];
        station.name = name;
        station.url = url;
        station.url_resolved = url;
        station.tags = genre;
        station.genre = genre;
        station.favicon = getFaviconFromUrl(url);

        await updateCustomStation(station, state.customStations, genre);

        renderCustomStations();
        updateCurrentStationInfo();

        if (state.currentStation && state.currentStation.stationuuid === uuid) {
            setStationName(name);
            state.currentStation = station;
            if (state.isPlaying) {
                playStation();
            }
        }
    }

    dom.editModal.classList.add('hidden');
}

export function renderCustomStations() {
    if (state.customStations.length === 0) {
        dom.customStationsList.innerHTML = '<div class="loading-hint">No custom stations</div>';
        return;
    }

    dom.customStationsList.innerHTML = '';

    state.customStations.forEach((station, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
        }

        const logo = document.createElement('img');
        logo.className = 'station-item-logo';
        applyLogo(logo, station);

        const info = document.createElement('div');
        info.className = 'station-item-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'station-item-name';
        nameEl.textContent = station.name;

        const urlEl = document.createElement('div');
        urlEl.className = 'station-item-country';
        urlEl.textContent = station.url.substring(0, 40) + (station.url.length > 40 ? '...' : '');

        const actions = document.createElement('div');
        actions.className = 'list-actions';

        // Favorite
        const favoriteBtn = document.createElement('button');
        favoriteBtn.className = 'action-btn favorite-btn' + (isFavorite(station.stationuuid) ? ' active' : '');
        if (isFavorite(station.stationuuid)) {
            favoriteBtn.innerHTML = HEART_FILLED_SVG;
        } else {
            favoriteBtn.innerHTML = HEART_OUTLINE_SVG;
        }
        favoriteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(station, favoriteBtn);
        });

        // Edit
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit-btn';
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>`;
        editBtn.title = 'Edit';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(station);
        });

        // Delete
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn delete-btn';
        deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>`;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCustomStation(station.stationuuid);
        });

        info.appendChild(nameEl);
        info.appendChild(urlEl);
        item.appendChild(logo);
        item.appendChild(info);
        actions.appendChild(favoriteBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(actions);

        item.addEventListener('click', () => {
            state.currentStationsList = state.customStations;
            state.currentStationIndex = index;
            selectStation(station, item);
        });

        item.dataset.stationuuid = station.stationuuid;
        dom.customStationsList.appendChild(item);
    });

    setupDragReorder(dom.customStationsList, state.customStations, saveCustomOrder);
}

// Update current station info in the Custom tab
export function updateCurrentStationInfo() {
    if (!dom.currentStationInfo) return;

    if (!state.currentStation) {
        dom.currentStationInfo.innerHTML = '<div class="current-station-empty">No active station</div>';
        return;
    }

    const s = state.currentStation;
    const genre = s.tags ? s.tags.split(',')[0] : '';

    // Build the form with DOM APIs (not innerHTML) so station names/URLs
    // from the public Radio Browser catalog cannot inject markup (XSS).
    dom.currentStationInfo.replaceChildren();
    const form = document.createElement('div');
    form.className = 'current-station-form';

    const logo = document.createElement('img');
    logo.className = 'current-station-logo';
    applyLogo(logo, s);

    const makeField = (value, placeholder) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.placeholder = placeholder;
        input.value = value || '';
        return input;
    };

    const exportButton = document.createElement('button');
    exportButton.className = 'btn-export';
    exportButton.textContent = 'Export';
    exportButton.addEventListener('click', exportCurrentStation);

    form.append(
        logo,
        makeField(s.name, 'Name'),
        makeField(s.url_resolved || s.url, 'Stream URL'),
        makeField(genre, 'Genre'),
        exportButton
    );
    dom.currentStationInfo.appendChild(form);
}
