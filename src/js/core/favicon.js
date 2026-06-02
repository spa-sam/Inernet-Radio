// favicon.js — centralized station-logo resolution with a persisted negative
// cache. Station favicons are remote URLs of varying reliability; once one
// fails to load we remember it so the lists never re-request it (avoiding
// repeated failed network hits while scrolling) and show the generated
// placeholder straight away. The cache survives restarts via settings.

import { state } from './state.js';
import { saveSetting } from './db.js';
import { generatePlaceholderLogo } from './util.js';

const MAX_FAILED = 1000; // cap the persisted set so it cannot grow unbounded

// Lazily-built Set of favicon URLs known to have failed to load.
let failed = null;
function failedSet() {
    if (!failed) failed = new Set(state.settings.faviconFailed || []);
    return failed;
}

// Record a favicon URL that failed to load and persist the updated set.
export function noteFaviconFailed(url) {
    if (!url) return;
    const set = failedSet();
    if (set.has(url)) return;
    set.add(url);
    // Drop the oldest entries first if the cache grows past its cap.
    while (set.size > MAX_FAILED) set.delete(set.values().next().value);
    state.settings.faviconFailed = [...set];
    saveSetting('faviconFailed', state.settings.faviconFailed);
}

// Whether a favicon URL is worth attempting (present and not known-bad).
export function isFaviconUsable(url) {
    return !!url && !failedSet().has(url);
}

// Best logo source for a station without triggering a network attempt for a
// known-bad favicon. Used where onerror cannot apply (e.g. CSS background).
export function resolveLogoSrc(station) {
    if (station && isFaviconUsable(station.favicon)) return station.favicon;
    return generatePlaceholderLogo(station ? station.name : '');
}

// Apply a station logo to an <img>: use the favicon when usable and fall back
// to the placeholder (recording the failure) on a load error.
export function applyLogo(imgEl, station) {
    const placeholder = generatePlaceholderLogo(station ? station.name : '');
    if (station && isFaviconUsable(station.favicon)) {
        const url = station.favicon;
        imgEl.src = url;
        imgEl.onerror = function () {
            noteFaviconFailed(url);
            this.src = placeholder;
            this.onerror = null;
        };
    } else {
        imgEl.src = placeholder;
        imgEl.onerror = null;
    }
}
