// constants.js — shared constant values used across modules.

// Note: the app version is not hard-coded here. It is read at startup from the
// Tauri runtime (Cargo.toml is the single source of truth) into state.appVersion.

// Icon markup lives in icons.js; re-exported here for existing importers.
export { HEART_FILLED_SVG, HEART_OUTLINE_SVG, COPY_ICON_SVG, CHECK_ICON_SVG } from './icons.js';

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
//
// Two limits, because the two failure modes differ. A station that never
// started is probably dead — give up quickly and say so. A station that was
// playing and dropped is usually a transient network/server hiccup, and giving
// up after ~14 s left unattended sessions (sleep timer, wake-to-radio alarm)
// silent for the rest of the night; keep retrying for a few minutes instead.
export const MAX_RECONNECT = 3;
export const MAX_RECONNECT_LIVE = 12;
export const RECONNECT_BASE_MS = 2000;
export const RECONNECT_MAX_MS = 30000;

// Volume fade duration (ms) for smooth play / stop / sleep-timer transitions
export const FADE_DURATION = 600;

// M3U Radio source (junguler/m3u-radio-music-playlists). The genre list is
// fetched from the GitHub contents API and cached; genre playlists are pulled
// on demand. CACHE_TTL controls how long the cached genre list stays valid.
export const M3U_CONTENTS_API =
    'https://api.github.com/repos/junguler/m3u-radio-music-playlists/contents';
export const M3U_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
