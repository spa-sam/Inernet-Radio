// Recently played: track the last stations and render the quick-access strip.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { saveRecentlyPlayed } from '../../core/db.js';
import { applyLogo } from '../../core/favicon.js';
import { selectStation } from '../player.js';

export async function addToRecentlyPlayed(station) {
    if (!station || !station.stationuuid || station.stationuuid.startsWith('preview_')) return;

    state.recentlyPlayed = state.recentlyPlayed.filter(s => s.stationuuid !== station.stationuuid);
    state.recentlyPlayed.unshift(station);
    if (state.recentlyPlayed.length > 10) {
        state.recentlyPlayed.pop();
    }

    await saveRecentlyPlayed(station, state.recentlyPlayed);
    renderRecentlyPlayed();
}

export function renderRecentlyPlayed() {
    if (state.recentlyPlayed.length === 0) {
        dom.recentlyPlayedSection.classList.add('hidden');
        return;
    }

    dom.recentlyPlayedSection.classList.remove('hidden');
    dom.recentlyPlayedList.innerHTML = '';

    state.recentlyPlayed.forEach(station => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        if (state.currentStation && state.currentStation.stationuuid === station.stationuuid) {
            item.classList.add('active');
        }

        const logo = document.createElement('img');
        logo.className = 'recent-item-logo';
        applyLogo(logo, station);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = station.name;

        item.appendChild(logo);
        item.appendChild(nameSpan);

        item.addEventListener('click', () => {
            // Swap list context to recentlyPlayed
            state.currentStationsList = state.recentlyPlayed;
            state.currentStationIndex = state.recentlyPlayed.findIndex(s => s.stationuuid === station.stationuuid);
            selectStation(station, item);
        });

        dom.recentlyPlayedList.appendChild(item);
    });
}
