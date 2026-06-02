// util.js — pure helper functions with no shared mutable state.

// Whether the Tauri runtime API is available (desktop app vs plain browser).
export const hasTauriApi = typeof window.__TAURI__ !== 'undefined';

// Try to get favicon from a stream's domain
export function getFaviconFromUrl(streamUrl) {
    try {
        const urlObj = new URL(streamUrl);
        return `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
    } catch {
        return '';
    }
}

// Generate a placeholder logo (data URI) showing the station's first letter
export function generatePlaceholderLogo(name) {
    const safeName = name || 'R';
    const letter = safeName.charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < safeName.length; i++) {
        hash = safeName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const color = `hsl(${hue}, 60%, 45%)`;
    const lightColor = `hsl(${hue}, 60%, 65%)`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${lightColor}"/>
                <stop offset="100%" style="stop-color:${color}"/>
            </linearGradient>
        </defs>
        <rect width="64" height="64" rx="8" fill="url(#grad)"/>
        <text x="32" y="44" font-family="'Outfit', sans-serif" font-size="32" font-weight="bold" fill="white" text-anchor="middle">${letter}</text>
    </svg>`;

    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Strip characters illegal in filenames and cap the length
export function sanitizeFilename(name) {
    return (name || 'recording').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

// Map a station codec to a sensible file extension for a saved capture
export function recordingExtension(station) {
    const codec = (station && station.codec ? station.codec : '').toUpperCase();
    if (codec.includes('AAC')) return 'aac';
    if (codec.includes('OGG') || codec.includes('VORBIS') || codec.includes('OPUS')) return 'ogg';
    if (codec.includes('FLAC')) return 'flac';
    return 'mp3';
}

// Format a number of seconds as HH:MM:SS
export function formatTimer(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Adjust a hex colour's brightness by a multiplicative factor -> rgb() string
export function adjustBrightness(hexColor, factor) {
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const newR = Math.min(255, Math.round(r * factor));
    const newG = Math.min(255, Math.round(g * factor));
    const newB = Math.min(255, Math.round(b * factor));

    return `rgb(${newR}, ${newG}, ${newB})`;
}
