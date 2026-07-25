// playlist.js — pure playlist parsers (no DOM, no shared state), so they can be
// exercised by the unit tests as well as by the import flow in features/stations/io.js.
// OPML stays in io.js because it needs the browser's DOMParser.

// Parse an M3U / M3U8 playlist into {name, url, favicon} entries
export function parseM3U(text) {
    const stations = [];
    let pendingName = '';
    let pendingLogo = '';
    for (const raw of String(text).split(/\r?\n/)) {
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
export function parsePLS(text) {
    const files = {};
    const titles = {};
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        const fileMatch = line.match(/^File(\d+)\s*=\s*(.+)$/i);
        const titleMatch = line.match(/^Title(\d+)\s*=\s*(.+)$/i);
        if (fileMatch) files[fileMatch[1]] = fileMatch[2].trim();
        else if (titleMatch) titles[titleMatch[1]] = titleMatch[2].trim();
    }
    return Object.keys(files).map(n => ({ name: titles[n] || files[n], url: files[n] }));
}
