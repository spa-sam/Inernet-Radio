// constants.js — shared constant values used across modules.

// Single source of truth for the displayed version (matches package.json)
export const APP_VERSION = '1.0.4';

// Favorite (heart) icon markup, shared across the station lists
export const HEART_FILLED_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`;
export const HEART_OUTLINE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" fill="currentColor"/></svg>`;

// Copy / confirmation icons for the track-name copy button
export const COPY_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>';
export const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>';

// Equalizer bands (gain in dB, range -12..+12). Shelf filters at the
// extremes and peaking filters in between, wired into the visualizer graph.
export const EQ_BANDS = [
    { freq: 60, type: 'lowshelf', label: '60' },
    { freq: 250, type: 'peaking', label: '250' },
    { freq: 1000, type: 'peaking', label: '1K' },
    { freq: 4000, type: 'peaking', label: '4K' },
    { freq: 12000, type: 'highshelf', label: '12K' }
];

// Preset gain curves, in band order [60, 250, 1K, 4K, 12K] (dB)
export const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    bass: [8, 5, 1, 0, 0],
    treble: [0, 0, 1, 5, 8],
    vocal: [-3, 0, 4, 4, 1],
    rock: [5, 2, -1, 3, 5]
};

// Infinite-scroll page size for the searchable station list
export const STATIONS_PAGE_SIZE = 30;

// Playback intent & auto-reconnect
export const MAX_RECONNECT = 3;

// Volume fade duration (ms) for smooth play / stop / sleep-timer transitions
export const FADE_DURATION = 600;
