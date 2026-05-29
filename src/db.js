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
            country: 'Recently played'
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

        const settingsRows = await db.select('SELECT * FROM settings');
        settingsRows.forEach(row => {
            const s = result.settings;
            if (row.key === 'compactMode') s.compactMode = row.value === 'true';
            if (row.key === 'wideMode') s.wideMode = row.value === 'true';
            if (row.key === 'visualizerEnabled') s.visualizerEnabled = row.value === 'true';
            if (row.key === 'visualizerColor') s.visualizerColor = row.value;
            if (row.key === 'visualizerStyle') s.visualizerStyle = row.value;
            if (row.key === 'visualizerSensitivity') s.visualizerSensitivity = parseFloat(row.value);
            if (row.key === 'eqEnabled') s.eqEnabled = row.value === 'true';
            if (row.key === 'normalizeEnabled') s.normalizeEnabled = row.value === 'true';
            if (row.key === 'eqGains') {
                try {
                    const parsed = JSON.parse(row.value);
                    if (Array.isArray(parsed) && parsed.length === EQ_BAND_COUNT) s.eqGains = parsed;
                } catch (_) { /* keep caller's default */ }
            }
            if (row.key === 'favoritesOrder') {
                try { s.favoritesOrder = JSON.parse(row.value) || []; } catch (_) { /* keep */ }
            }
            if (row.key === 'customOrder') {
                try { s.customOrder = JSON.parse(row.value) || []; } catch (_) { /* keep */ }
            }
            if (row.key === 'lastStation') {
                try { result.lastStation = row.value ? JSON.parse(row.value) : null; } catch (_) { /* keep */ }
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
// Write a single setting to both storage backends atomically.
// The `db` live binding is read at call time, so this works whether
// the DB was opened before or after this module was imported.
// ------------------------------------------------------------------
export async function saveSetting(key, value) {
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

    if (!db) return;
    try {
        await db.execute(
            'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
            [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
        );
    } catch (e) {
        console.error('Save setting error:', e);
    }
}
