// Blacklist: hide unwanted stations from search results. Hiding a station used
// to be a one-way trap — there was no UI to see or reverse it, so a misclick
// on the "hide" button (right next to the favorite heart) permanently lost a
// station with no recovery path. Now paired with an Undo action on the toast
// (render.js) and a management list here, in Settings.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { saveBlacklist, deleteFromBlacklist } from '../../core/db.js';
import { t } from '../../core/i18n.js';

export function isBlacklisted(stationuuid) {
    return state.blacklist.some(item => item.stationuuid === stationuuid);
}

export async function addToBlacklist(station) {
    if (!isBlacklisted(station.stationuuid)) {
        state.blacklist.push({ stationuuid: station.stationuuid, name: station.name });
        await saveBlacklist(station, state.blacklist);
    }
}

export async function removeFromBlacklist(stationuuid) {
    state.blacklist = state.blacklist.filter(item => item.stationuuid !== stationuuid);
    await deleteFromBlacklist(stationuuid, state.blacklist);
}

export function filterBlacklisted(stations) {
    return stations.filter(station => !isBlacklisted(station.stationuuid));
}

// Settings → "Blacklisted stations": lets a user see what's hidden and undo
// it, instead of the hide action being permanent with no way back.
export function renderBlacklist() {
    if (!dom.blacklistList) return;
    dom.blacklistList.replaceChildren();

    if (state.blacklist.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'loading-hint';
        hint.textContent = t('No hidden stations');
        dom.blacklistList.appendChild(hint);
        return;
    }

    for (const entry of state.blacklist) {
        const row = document.createElement('div');
        row.className = 'blacklist-item';

        const name = document.createElement('span');
        name.className = 'blacklist-item-name';
        name.textContent = entry.name || entry.stationuuid;

        const unhideBtn = document.createElement('button');
        unhideBtn.type = 'button';
        unhideBtn.className = 'unhide-btn';
        unhideBtn.textContent = t('Unhide');
        unhideBtn.setAttribute('aria-label', t(`Unhide ${entry.name || 'station'}`));
        unhideBtn.addEventListener('click', async () => {
            await removeFromBlacklist(entry.stationuuid);
            renderBlacklist();
        });

        row.append(name, unhideBtn);
        dom.blacklistList.appendChild(row);
    }
}
