// Track history: the log of heard songs with a "find on YouTube" action.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { saveTrackHistoryEntry, clearTrackHistoryStore } from '../../core/db.js';
import { openYouTubeSearch, toast } from '../../ui/ui.js';

export async function addToTrackHistory(title, station) {
    if (!title) return;
    // Skip consecutive duplicates (the same song is polled several times)
    if (state.trackHistory.length > 0 && state.trackHistory[0].title === title) return;

    const entry = {
        title,
        stationName: station ? station.name : '',
        favicon: station ? (station.favicon || '') : '',
        timestamp: Date.now()
    };
    state.trackHistory.unshift(entry);
    if (state.trackHistory.length > 50) state.trackHistory.pop();

    await saveTrackHistoryEntry(entry, state.trackHistory);
    renderTrackHistory();
}

export function renderTrackHistory() {
    if (!dom.trackHistoryList) return;

    if (state.trackHistory.length === 0) {
        dom.trackHistoryList.replaceChildren();
        const hint = document.createElement('div');
        hint.className = 'loading-hint';
        hint.textContent = 'History is empty';
        dom.trackHistoryList.appendChild(hint);
        return;
    }

    dom.trackHistoryList.replaceChildren();
    state.trackHistory.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'track-history-item';

        const info = document.createElement('div');
        info.className = 'track-history-info';

        const titleEl = document.createElement('div');
        titleEl.className = 'track-history-title';
        titleEl.textContent = entry.title;

        const meta = document.createElement('div');
        meta.className = 'track-history-meta';
        const time = new Date(entry.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        meta.textContent = [entry.stationName, time].filter(Boolean).join('  ·  ');

        info.append(titleEl, meta);

        const ytBtn = document.createElement('button');
        ytBtn.className = 'action-btn track-history-yt';
        ytBtn.title = 'Find on YouTube';
        ytBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z" fill="currentColor"/></svg>`;
        ytBtn.addEventListener('click', () => openYouTubeSearch(entry.title));

        item.append(info, ytBtn);
        dom.trackHistoryList.appendChild(item);
    });
}

export async function clearTrackHistory() {
    state.trackHistory = [];
    await clearTrackHistoryStore();
    renderTrackHistory();
    toast('Track history cleared', 'success');
}
