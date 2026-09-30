// Track history: the log of heard songs with a "find on YouTube" action.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { saveTrackHistoryEntry, clearTrackHistoryStore } from '../../core/db.js';
import { openYouTubeSearch, toast } from '../../ui/ui.js';
import { YOUTUBE_ICON_SVG } from '../../core/icons.js';
import { t } from '../../core/i18n.js';

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
        hint.textContent = t('History is empty');
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
        // Follow the OS locale — the UI itself is English, so a hard-coded
        // locale here was a leftover.
        const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        meta.textContent = [entry.stationName, time].filter(Boolean).join('  ·  ');

        info.append(titleEl, meta);

        const ytBtn = document.createElement('button');
        ytBtn.className = 'action-btn track-history-yt';
        ytBtn.title = t('Find on YouTube');
        ytBtn.setAttribute('aria-label', t(`Find "${entry.title}" on YouTube`));
        ytBtn.innerHTML = YOUTUBE_ICON_SVG;
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
