// Blacklist: hide unwanted stations from search results.

import { state } from '../../core/state.js';
import { saveBlacklist } from '../../core/db.js';

export function isBlacklisted(stationuuid) {
    return state.blacklist.some(item => item.stationuuid === stationuuid);
}

export async function addToBlacklist(station) {
    if (!isBlacklisted(station.stationuuid)) {
        state.blacklist.push({ stationuuid: station.stationuuid, name: station.name });
        await saveBlacklist(station, state.blacklist);
    }
}

export function filterBlacklisted(stations) {
    return stations.filter(station => !isBlacklisted(station.stationuuid));
}
