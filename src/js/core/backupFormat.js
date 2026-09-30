// backupFormat.js — the backup file's shape and the merge rules for restoring
// it. No DOM or database access, so it is unit-tested.

export const BACKUP_FORMAT = 'internet-radio-backup';
export const BACKUP_VERSION = 1;

// Settings never written back by a restore: they describe this machine's
// window state rather than the user's library.
export const SKIP_SETTINGS = new Set(['compactMode']);

export function buildBackup(state) {
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        appVersion: state.appVersion || '',
        exportedAt: new Date().toISOString(),
        favorites: state.favorites,
        customStations: state.customStations,
        blacklist: state.blacklist,
        trackHistory: state.trackHistory,
        lastStation: state.lastStation,
        settings: state.settings
    };
}

// True for a parsed object that looks like one of our backups.
export function isBackup(data) {
    return !!data && typeof data === 'object' && !Array.isArray(data) && data.format === BACKUP_FORMAT;
}

const validStation = (s) => s && typeof s === 'object' && s.stationuuid && s.url && /^https?:/i.test(s.url);

// Merge the stations of `incoming` into `existing` by stationuuid. Returns the
// entries that were actually added.
export function mergeStations(existing, incoming) {
    const have = new Set(existing.map((s) => s.stationuuid));
    const added = [];
    for (const station of Array.isArray(incoming) ? incoming : []) {
        if (!validStation(station) || have.has(station.stationuuid)) continue;
        have.add(station.stationuuid);
        existing.push(station);
        added.push(station);
    }
    return added;
}
