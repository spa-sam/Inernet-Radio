// constants.js — shared constant values used across modules.

// Single source of truth for the displayed version (matches package.json)
export const APP_VERSION = '1.0.16';

// Favorite (heart) icon markup, shared across the station lists
export const HEART_FILLED_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/></svg>`;
export const HEART_OUTLINE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" fill="currentColor"/></svg>`;

// Copy / confirmation icons for the track-name copy button
export const COPY_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>';
export const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>';

// Equalizer bands (gain in dB, range -12..+12). Ten ISO octave centres with
// shelf filters at the extremes and peaking filters in between, wired into the
// audio graph. Changing the band count auto-migrates saved gains (see audio.js).
export const EQ_BANDS = [
    { freq: 31, type: 'lowshelf', label: '31' },
    { freq: 62, type: 'peaking', label: '62' },
    { freq: 125, type: 'peaking', label: '125' },
    { freq: 250, type: 'peaking', label: '250' },
    { freq: 500, type: 'peaking', label: '500' },
    { freq: 1000, type: 'peaking', label: '1K' },
    { freq: 2000, type: 'peaking', label: '2K' },
    { freq: 4000, type: 'peaking', label: '4K' },
    { freq: 8000, type: 'peaking', label: '8K' },
    { freq: 16000, type: 'highshelf', label: '16K' }
];

// Preset gain curves, in band order [31,62,125,250,500,1K,2K,4K,8K,16K] (dB)
export const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [8, 7, 5, 3, 1, 0, 0, 0, 0, 0],
    treble: [0, 0, 0, 0, 0, 1, 3, 5, 7, 8],
    vocal: [-3, -2, 0, 2, 4, 4, 3, 1, 0, -1],
    rock: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5]
};

// Default genre preset chips (the editable row on the Radio tab). `genre` is
// the Radio Browser tag sent with the search; `label` is the chip text. Users
// can add / remove / reorder these — the live list lives in settings.genrePresets.
export const DEFAULT_GENRE_PRESETS = [
    { genre: 'pop', label: 'Pop' },
    { genre: 'dance', label: 'Dance' },
    { genre: 'rock', label: 'Rock' },
    { genre: 'rap', label: 'Rap' },
    { genre: 'ambient', label: 'Ambient' },
    { genre: 'chill', label: 'Chill' },
    { genre: 'classical', label: 'Classic' },
    { genre: 'jazz', label: 'Jazz' },
    { genre: 'news', label: 'News' }
];

// Station sources that feed the unified search. Each can be toggled on/off in
// Settings; `local` sources are filtered in-memory, the rest hit the network.
// `custom` and `somafm`/`m3u` are local once cached; `radioBrowser` is paged.
export const SOURCES = [
    { id: 'radioBrowser', label: 'Radio Browser', note: '' },
    { id: 'somafm', label: 'SomaFM', note: '' },
    { id: 'm3u', label: 'M3U Radio', note: 'heavy — downloads a large index' },
    { id: 'custom', label: 'My Stations', note: '' }
];

// Infinite-scroll page size for the searchable station list
export const STATIONS_PAGE_SIZE = 30;

// Playback intent & auto-reconnect. Reconnect delay grows exponentially
// (RECONNECT_BASE_MS, then ×2 each attempt) and is capped at RECONNECT_MAX_MS,
// so an unstable server is not hammered with fixed-interval retries.
export const MAX_RECONNECT = 3;
export const RECONNECT_BASE_MS = 2000;
export const RECONNECT_MAX_MS = 10000;

// Volume fade duration (ms) for smooth play / stop / sleep-timer transitions
export const FADE_DURATION = 600;

// M3U Radio source (junguler/m3u-radio-music-playlists). The genre list is
// fetched from the GitHub contents API and cached; genre playlists are pulled
// on demand. CACHE_TTL controls how long the cached genre list stays valid.
export const M3U_CONTENTS_API =
    'https://api.github.com/repos/junguler/m3u-radio-music-playlists/contents';
export const M3U_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
