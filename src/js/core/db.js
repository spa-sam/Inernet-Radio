// db.js — Repository / persistence layer
// Single source of truth for all database and localStorage reads/writes.
// Exports a live `db` binding so importers always see the current connection.

// Number of EQ frequency bands; kept in sync with EQ_BANDS in main.js.
const EQ_BAND_COUNT = 5;

// Live SQLite connection. Set by openDatabase(); importers read the live binding.
export let db = null;

// ------------------------------------------------------------------
// Reorder a station list to match a saved array of stationuuids.
// Items not present in the order array keep their position and are
// appended at the end so newly added stations always appear.
// ------------------------------------------------------------------
export function applySavedOrder(list, order) {
    if (!Array.isArray(order) || order.length === 0) return list;
    const pos = new Map(order.map((id, i) => [id, i]));
    return list.slice().sort((a, b) => {
        const pa = pos.has(a.stationuuid) ? pos.get(a.stationuuid) : Number.MAX_SAFE_INTEGER;
        const pb = pos.has(b.stationuuid) ? pos.get(b.stationuuid) : Number.MAX_SAFE_INTEGER;
        return pa - pb;
    });
}

// ------------------------------------------------------------------
// Open the SQLite database and ensure all tables exist.
// Returns true on success, false if the SQL plugin is unavailable.
// ------------------------------------------------------------------
export async function openDatabase(hasTauriApi) {
    if (!hasTauriApi) return false;
    try {
        let Database;
        if (window.__TAURI_PLUGIN_SQL__) {
            Database = window.__TAURI_PLUGIN_SQL__.default || window.__TAURI_PLUGIN_SQL__;
        } else if (window.__TAURI__?.sql) {
            Database = window.__TAURI__.sql.default || window.__TAURI__.sql.Database || window.__TAURI__.sql;
        }
        if (!Database) {
            console.warn('SQL plugin not available, using localStorage fallback');
            return false;
        }
        console.log('Loading database...');
        db = await Database.load('sqlite:radio.db');
        console.log('Database loaded');
        await createTables();
        return true;
    } catch (e) {
        console.error('Database init error:', e);
        return false;
    }
}

async function createTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stationuuid TEXT UNIQUE NOT NULL,
            name TEXT,
            url TEXT,
            url_resolved TEXT,
            favicon TEXT,
            country TEXT,
            codec TEXT,
            bitrate INTEGER,
            tags TEXT,
            data TEXT
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS custom_stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stationuuid TEXT UNIQUE NOT NULL,
            name TEXT,
            url TEXT,
            genre TEXT,
            data TEXT
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS blacklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stationuuid TEXT UNIQUE NOT NULL,
            name TEXT
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS recently_played (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stationuuid TEXT UNIQUE NOT NULL,
            name TEXT,
            url TEXT,
            favicon TEXT,
            timestamp INTEGER
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS track_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            station_name TEXT,
            favicon TEXT,
            timestamp INTEGER
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);
}

// ------------------------------------------------------------------
// Load all persisted data from SQLite.
// Returns a plain data object; the caller assigns to its own state.
// ------------------------------------------------------------------
export async function loadAllDataFromDb() {
    const result = {
        favorites: [],
        customStations: [],
        blacklist: [],
        recentlyPlayed: [],
        trackHistory: [],
        settings: {},
        lastStation: null
    };

    try {
        const favRows = await db.select('SELECT * FROM favorites');
        result.favorites = favRows.map(row => {
            const station = row.data ? JSON.parse(row.data) : {};
            return { ...station, stationuuid: row.stationuuid, name: row.name, url: row.url, favicon: row.favicon };
        });

        const customRows = await db.select('SELECT * FROM custom_stations');
        result.customStations = customRows.map(row => {
            const station = row.data ? JSON.parse(row.data) : {};
            return { ...station, stationuuid: row.stationuuid, name: row.name, url: row.url, genre: row.genre };
        });

        const blackRows = await db.select('SELECT * FROM blacklist');
        result.blacklist = blackRows.map(row => ({ stationuuid: row.stationuuid, name: row.name }));

        const recentRows = await db.select(
            'SELECT * FROM recently_played ORDER BY timestamp DESC LIMIT 10'
        );
        result.recentlyPlayed = recentRows.map(row => ({
            stationuuid: row.stationuuid,
            name: row.name,
            url: row.url,
            favicon: row.favicon,
            // No real country is stored for recents; leave empty so the player
            // doesn't show a misleading "Recently played" country pill.
            country: ''
        }));

        const historyRows = await db.select(
            'SELECT * FROM track_history ORDER BY timestamp DESC LIMIT 50'
        );
        result.trackHistory = historyRows.map(row => ({
            title: row.title,
            stationName: row.station_name,
            favicon: row.favicon,
            timestamp: row.timestamp
        }));

        // Settings are stored as TEXT. Values written by saveSetting are either
        // String(scalar) ("true", "0.5", "bars", "#ff5a36") or JSON for
        // objects/arrays. Parse generically: JSON.parse recovers booleans,
        // numbers, arrays and objects, while plain strings (e.g. a hex colour)
        // fail to parse and are kept verbatim. New keys load automatically.
        const settingsRows = await db.select('SELECT * FROM settings');
        settingsRows.forEach(row => {
            let value = row.value;
            try { value = JSON.parse(row.value); } catch (_) { /* keep raw string */ }

            if (row.key === 'lastStation') {
                result.lastStation = value && typeof value === 'object' ? value : null;
            } else if (row.key === 'eqGains') {
                // Guard against a malformed array breaking the equalizer UI.
                if (Array.isArray(value) && value.length === EQ_BAND_COUNT) {
                    result.settings.eqGains = value;
                }
            } else {
                result.settings[row.key] = value;
            }
        });
    } catch (e) {
        console.error('Load data error:', e);
    }

    return result;
}

// ------------------------------------------------------------------
// Load all persisted data from localStorage (fallback path).
// ------------------------------------------------------------------
export function loadAllDataFromStorage() {
    const result = {
        favorites: [],
        customStations: [],
        blacklist: [],
        recentlyPlayed: [],
        trackHistory: [],
        settings: {},
        lastStation: null
    };
    try {
        result.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
        result.customStations = JSON.parse(localStorage.getItem('customStations') || '[]');
        result.blacklist = JSON.parse(localStorage.getItem('blacklist') || '[]');
        result.recentlyPlayed = JSON.parse(localStorage.getItem('recentlyPlayed') || '[]');
        result.trackHistory = JSON.parse(localStorage.getItem('trackHistory') || '[]');
        result.lastStation = JSON.parse(localStorage.getItem('lastStation') || 'null');
        result.settings = JSON.parse(localStorage.getItem('settings') || '{}');
    } catch (e) {
        console.error('localStorage load error:', e);
    }
    return result;
}

// ------------------------------------------------------------------
// Persist a single setting. SQLite is the source of truth; when it is
// open the value is written there only. localStorage is used solely as a
// fallback when no database is available. The `db` live binding is read
// at call time, so this works whether the DB was opened before or after
// this module was imported.
// ------------------------------------------------------------------
export async function saveSetting(key, value) {
    if (db) {
        try {
            await db.execute(
                'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
                [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
            );
        } catch (e) {
            console.error('Save setting error:', e);
        }
        return;
    }

    // Fallback path: no database, mirror into localStorage.
    try {
        if (key === 'lastStation') {
            localStorage.setItem('lastStation', JSON.stringify(value));
        } else {
            const savedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
            savedSettings[key] = value;
            localStorage.setItem('settings', JSON.stringify(savedSettings));
        }
    } catch (e) {
        console.error('localStorage save error:', e);
    }
}

// ==================================================================
// Repository layer.
// All collection mutations are persisted here so callers never touch
// localStorage or SQL directly. SQLite is the single source of truth;
// localStorage is written only as a fallback when no database is open
// (e.g. running in a plain browser without the Tauri SQL plugin).
// ==================================================================

// Write a JSON snapshot of a collection to localStorage. No-op when a
// database is open — SQLite then owns the data and a stale localStorage
// mirror would only risk diverging.
function writeLocal(key, value) {
    if (db) return;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error('localStorage save error:', e);
    }
}

// Run a SQLite statement, ignoring it when no DB is open. Errors are logged
// with `label` so callers stay terse.
async function execDb(sql, params, label) {
    if (!db) return;
    try {
        await db.execute(sql, params);
    } catch (e) {
        console.error(label + ' error:', e);
    }
}

const FAVORITE_COLUMNS =
    'INSERT OR REPLACE INTO favorites (stationuuid, name, url, url_resolved, favicon, country, data) VALUES ($1, $2, $3, $4, $5, $6, $7)';

function favoriteRow(station) {
    return [
        station.stationuuid, station.name, station.url, station.url_resolved || '',
        station.favicon || '', station.country || '', JSON.stringify(station)
    ];
}

const CUSTOM_INSERT =
    'INSERT OR REPLACE INTO custom_stations (stationuuid, name, url, genre, data) VALUES ($1, $2, $3, $4, $5)';

function customRow(station, genre) {
    return [station.stationuuid, station.name, station.url, genre ?? (station.genre || ''), JSON.stringify(station)];
}

// --- Favorites -----------------------------------------------------
export async function saveFavorite(station, favorites) {
    writeLocal('favorites', favorites);
    await execDb(FAVORITE_COLUMNS, favoriteRow(station), 'Save favorite');
}

export async function deleteFavorite(stationuuid, favorites) {
    writeLocal('favorites', favorites);
    await execDb('DELETE FROM favorites WHERE stationuuid = $1', [stationuuid], 'Delete favorite');
}

export async function saveFavoritesBatch(newStations, favorites) {
    writeLocal('favorites', favorites);
    for (const station of newStations) {
        await execDb(FAVORITE_COLUMNS, favoriteRow(station), 'Import favorite');
    }
}

// --- Blacklist -----------------------------------------------------
export async function saveBlacklist(station, blacklist) {
    writeLocal('blacklist', blacklist);
    await execDb(
        'INSERT OR REPLACE INTO blacklist (stationuuid, name) VALUES ($1, $2)',
        [station.stationuuid, station.name],
        'Save blacklist'
    );
}

// --- Recently played ----------------------------------------------
export async function saveRecentlyPlayed(station, recentlyPlayed) {
    writeLocal('recentlyPlayed', recentlyPlayed);
    if (!db) return;
    await execDb('DELETE FROM recently_played WHERE stationuuid = $1', [station.stationuuid], 'Save recently played');
    await execDb(
        'INSERT INTO recently_played (stationuuid, name, url, favicon, timestamp) VALUES ($1, $2, $3, $4, $5)',
        [station.stationuuid, station.name, station.url, station.favicon || '', Date.now()],
        'Save recently played'
    );
}

// --- Track history -------------------------------------------------
export async function saveTrackHistoryEntry(entry, trackHistory) {
    writeLocal('trackHistory', trackHistory);
    if (!db) return;
    await execDb(
        'INSERT INTO track_history (title, station_name, favicon, timestamp) VALUES ($1, $2, $3, $4)',
        [entry.title, entry.stationName, entry.favicon, entry.timestamp],
        'Save track history'
    );
    // Keep only the newest 50 rows
    await execDb(
        'DELETE FROM track_history WHERE id NOT IN (SELECT id FROM track_history ORDER BY timestamp DESC LIMIT 50)',
        [],
        'Trim track history'
    );
}

export async function clearTrackHistoryStore() {
    writeLocal('trackHistory', []);
    await execDb('DELETE FROM track_history', [], 'Clear track history');
}

// --- Custom stations ----------------------------------------------
export async function saveCustomStation(station, customStations, genre) {
    writeLocal('customStations', customStations);
    await execDb(CUSTOM_INSERT, customRow(station, genre), 'Save custom station');
}

export async function deleteCustomStation(stationuuid, customStations) {
    writeLocal('customStations', customStations);
    await execDb('DELETE FROM custom_stations WHERE stationuuid = $1', [stationuuid], 'Delete custom station');
}

export async function updateCustomStation(station, customStations, genre) {
    writeLocal('customStations', customStations);
    await execDb(
        'UPDATE custom_stations SET name = $1, url = $2, genre = $3, data = $4 WHERE stationuuid = $5',
        [station.name, station.url, genre ?? (station.genre || ''), JSON.stringify(station), station.stationuuid],
        'Update custom station'
    );
}

export async function saveCustomBatch(newStations, customStations) {
    writeLocal('customStations', customStations);
    for (const station of newStations) {
        await execDb(CUSTOM_INSERT, customRow(station), 'Import custom station');
    }
}
