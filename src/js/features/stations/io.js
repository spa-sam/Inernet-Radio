// Import / export: write favorites or the current station to JSON, and import
// stations from JSON, M3U/M3U8, PLS or OPML files.

import { state } from '../../core/state.js';
import { hasTauriApi, getFaviconFromUrl } from '../../core/util.js';
import { saveCustomBatch, saveFavoritesBatch } from '../../core/db.js';
import { toast } from '../../ui/ui.js';
import { renderCustomStations } from './custom.js';

async function exportToJson(data, defaultFilename) {
    if (hasTauriApi) {
        try {
            const { save } = window.__TAURI__.dialog;
            const { writeTextFile } = window.__TAURI__.fs;

            const filePath = await save({
                defaultPath: defaultFilename,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (filePath) {
                await writeTextFile(filePath, JSON.stringify(data, null, 2));
            }
        } catch (error) {
            console.error('Export error:', error);
            toast('Export error: ' + error.message, 'error');
        }
    } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

export async function exportFavorites() {
    if (state.favorites.length === 0) {
        toast('No favorite stations to export', 'error');
        return;
    }
    await exportToJson(state.favorites, 'radio-favorites.json');
}

// Export the current playing station
export async function exportCurrentStation() {
    if (!state.currentStation) {
        toast('No active station', 'error');
        return;
    }
    await exportToJson([state.currentStation], `${state.currentStation.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
}

// Parse an M3U / M3U8 playlist into {name, url} entries
export function parseM3U(text) {
    const stations = [];
    let pendingName = '';
    let pendingLogo = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.toUpperCase().startsWith('#EXTINF:')) {
            const comma = line.indexOf(',');
            pendingName = comma >= 0 ? line.slice(comma + 1).trim() : '';
            // Many playlists carry a logo via `tvg-logo="..."` on the EXTINF line
            const logo = line.match(/tvg-logo="([^"]*)"/i);
            pendingLogo = logo ? logo[1] : '';
        } else if (!line.startsWith('#')) {
            stations.push({ name: pendingName || line, url: line, favicon: pendingLogo });
            pendingName = '';
            pendingLogo = '';
        }
    }
    return stations;
}

// Parse a PLS playlist into {name, url} entries
function parsePLS(text) {
    const files = {};
    const titles = {};
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const fileMatch = line.match(/^File(\d+)\s*=\s*(.+)$/i);
        const titleMatch = line.match(/^Title(\d+)\s*=\s*(.+)$/i);
        if (fileMatch) files[fileMatch[1]] = fileMatch[2].trim();
        else if (titleMatch) titles[titleMatch[1]] = titleMatch[2].trim();
    }
    return Object.keys(files).map(n => ({ name: titles[n] || files[n], url: files[n] }));
}

// Parse an OPML document into {name, url} entries
function parseOPML(text) {
    const stations = [];
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    doc.querySelectorAll('outline').forEach(outline => {
        const url = outline.getAttribute('url') || outline.getAttribute('xmlUrl') || outline.getAttribute('URL');
        const name = outline.getAttribute('text') || outline.getAttribute('title') || url;
        if (url && /^https?:/i.test(url)) {
            stations.push({ name: name, url: url });
        }
    });
    return stations;
}

// Add parsed {name, url} entries to the custom stations list
async function importPlaylistStations(entries) {
    const added = [];
    for (const entry of entries) {
        if (!entry.url || !/^https?:/i.test(entry.url)) continue;
        if (state.customStations.some(s => s.url === entry.url)) continue;

        const station = {
            stationuuid: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: entry.name || 'Imported station',
            url: entry.url,
            url_resolved: entry.url,
            tags: '',
            country: 'Imported',
            favicon: getFaviconFromUrl(entry.url),
            bitrate: 0,
            codec: ''
        };
        state.customStations.push(station);
        added.push(station);
    }
    await saveCustomBatch(added, state.customStations);
    renderCustomStations();
    toast(`Stations imported: ${added.length}`, 'success');
}

// Import the app's own JSON export format (favorites or custom stations)
async function importStationsJson(text) {
    const data = JSON.parse(text);

    if (!Array.isArray(data)) {
        toast('Invalid file format', 'error');
        return;
    }

    const isCustom = data.some(s => s.stationuuid && s.stationuuid.startsWith('custom_'));

    if (isCustom) {
        const added = [];
        for (const station of data) {
            if (!state.customStations.some(s => s.stationuuid === station.stationuuid)) {
                state.customStations.push(station);
                added.push(station);
            }
        }
        await saveCustomBatch(added, state.customStations);
        renderCustomStations();
        toast('Custom stations imported', 'success');
    } else {
        const added = [];
        for (const station of data) {
            if (!state.favorites.some(f => f.stationuuid === station.stationuuid)) {
                state.favorites.push(station);
                added.push(station);
            }
        }
        await saveFavoritesBatch(added, state.favorites);
        toast('Favorites imported', 'success');
    }
}

// Import stations from a JSON, M3U/M3U8, PLS or OPML file
export function importStations(event) {
    const file = event.target.files[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    const reader = new FileReader();

    reader.onload = (e) => {
        const text = e.target.result;
        try {
            if (ext === 'm3u' || ext === 'm3u8') {
                importPlaylistStations(parseM3U(text));
            } else if (ext === 'pls') {
                importPlaylistStations(parsePLS(text));
            } else if (ext === 'opml' || ext === 'xml') {
                importPlaylistStations(parseOPML(text));
            } else {
                importStationsJson(text);
            }
        } catch (error) {
            toast('File read error: ' + error.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}
