// backupFormat.js — the backup file's shape and the merge rules for restoring
// it. No DOM or database access, so it is unit-tested.

export const BACKUP_FORMAT = 'internet-radio-backup';
export const BACKUP_VERSION = 1;

// Settings a restore never writes back, even though they are known keys. They
// describe this machine (window state, where files may be written, how the app
// starts) rather than the user's library, and a hand-edited backup must not be
// able to flip them: `recordDir` + `recordAskPath: false` would let a stream
// save files into any folder without a dialog.
export const SKIP_SETTINGS = new Set(['compactMode', 'recordDir', 'recordAskPath', 'closeToTray']);

// Keys that would change an object's prototype when used as a property name.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// The settings to restore from a backup: only keys the app itself defines
// (`defaults`), with a value of the same type as the default, and none of the
// machine-specific ones above. A backup is an untrusted file, so unknown keys
// are dropped rather than stored.
export function restorableSettings(incoming, defaults) {
    const out = {};
    if (!incoming || typeof incoming !== 'object') return out;
    for (const key of Object.keys(defaults)) {
        if (UNSAFE_KEYS.has(key) || SKIP_SETTINGS.has(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
        const value = incoming[key];
        const want = defaults[key];
        if (value === undefined || typeof value === 'function') continue;
        // null defaults (genrePresets, notifySongs) accept anything JSON.
        if (want !== null) {
            if (typeof value !== typeof want) continue;
            if (Array.isArray(want) !== Array.isArray(value)) continue;
        }
        out[key] = value;
    }
    return out;
}

// A station's logo URL must be plain http(s): it ends up in <img src> and in a
// CSS url(). Anything else (javascript:, file:, quotes that break out of the
// CSS string) is dropped so the placeholder logo is used instead.
export function safeFavicon(url) {
    if (typeof url !== 'string') return '';
    return /^https?:\/\/[^\s"'()<>\\]+$/i.test(url) ? url : '';
}

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

// A copy of an imported station with its logo URL made safe.
export const cleanStation = (s) => ({ ...s, favicon: safeFavicon(s.favicon) });

// Merge the stations of `incoming` into `existing` by stationuuid. Returns the
// entries that were actually added.
export function mergeStations(existing, incoming) {
    const have = new Set(existing.map((s) => s.stationuuid));
    const added = [];
    for (const station of Array.isArray(incoming) ? incoming : []) {
        if (!validStation(station) || have.has(station.stationuuid)) continue;
        have.add(station.stationuuid);
        const clean = cleanStation(station);
        existing.push(clean);
        added.push(clean);
    }
    return added;
}
