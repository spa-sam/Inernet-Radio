// Custom stations: add / edit / delete user stations, render the custom list,
// and the "current station" info panel on the Custom tab.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { HEART_FILLED_SVG, HEART_OUTLINE_SVG, EDIT_ICON_SVG, TRASH_ICON_SVG } from '../../core/icons.js';
import { getFaviconFromUrl, newCustomStationId } from '../../core/util.js';
import { applyLogo } from '../../core/favicon.js';
import { saveCustomStation, deleteCustomStation, updateCustomStation } from '../../core/db.js';
import { toast, setStationName, openModal, closeModal } from '../../ui/ui.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import {
    setupDragReorder,
    saveCustomOrder,
    makeRowActivatable,
    bindStationList,
    registerRow
} from './render.js';
import { exportCurrentStation } from './io.js';
import { selectStation, playStation } from '../player.js';
import { showEmpty } from '../../core/placeholders.js';
import { t } from '../../core/i18n.js';

export async function addCustomStation() {
    const name = dom.customNameInput.value.trim();
    const url = dom.customUrlInput.value.trim();
    const genre = dom.customGenreInput.value.trim();

    if (!name || !url) {
        toast('Enter a station name and URL', 'error');
        return;
    }
    if (!/^https?:/i.test(url)) {
        toast('Stream URL must start with http:// or https://', 'error');
        return;
    }

    const station = {
        stationuuid: newCustomStationId(),
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
    openModal(dom.editModal);
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
    if (!/^https?:/i.test(url)) {
        toast('Stream URL must start with http:// or https://', 'error');
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

    closeModal(dom.editModal);
}

export function renderCustomStations() {
    if (state.customStations.length === 0) {
        showEmpty(dom.customStationsList, 'No custom stations');
        return;
    }

    dom.customStationsList.innerHTML = '';

    bindStationList(dom.customStationsList, {
        onSelect: ({ station, index }, row) => {
            state.currentStationsList = state.customStations;
            state.currentStationIndex = index;
            selectStation(station, row);
        },
        onAction: (action, { station }, row, button) => {
            if (action === 'favorite') toggleFavorite(station, button);
            else if (action === 'edit') openEditModal(station);
            else if (action === 'delete') removeCustomStation(station.stationuuid);
        }
    });

    state.customStations.forEach((station, index) => {
        const item = document.createElement('div');
        item.className = 'station-item';
        item.dataset.stationuuid = station.stationuuid;
        makeRowActivatable(item, `Play ${station.name}`);
        registerRow(item, station, index);
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
            item.setAttribute('aria-current', 'true');
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
        favoriteBtn.setAttribute('aria-label',
            isFavorite(station.stationuuid)
                ? t(`Remove ${station.name} from favorites`)
                : t(`Add ${station.name} to favorites`));
        favoriteBtn.dataset.action = 'favorite';

        // Edit
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit-btn';
        editBtn.innerHTML = EDIT_ICON_SVG;
        editBtn.title = t('Edit');
        editBtn.setAttribute('aria-label', t(`Edit ${station.name}`));
        editBtn.dataset.action = 'edit';

        // Delete
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn delete-btn';
        deleteBtn.innerHTML = TRASH_ICON_SVG;
        deleteBtn.title = t('Delete');
        deleteBtn.setAttribute('aria-label', t(`Delete ${station.name}`));
        deleteBtn.dataset.action = 'delete';

        info.appendChild(nameEl);
        info.appendChild(urlEl);
        item.appendChild(logo);
        item.appendChild(info);
        actions.appendChild(favoriteBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(actions);
        dom.customStationsList.appendChild(item);
    });

    setupDragReorder(dom.customStationsList, () => state.customStations, saveCustomOrder);
}

// Update current station info in the Custom tab
export function updateCurrentStationInfo() {
    if (!dom.currentStationInfo) return;

    if (!state.currentStation) {
        dom.currentStationInfo.innerHTML = `<div class="current-station-empty">${t('No active station')}</div>`;
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
    exportButton.textContent = t('Export');
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
