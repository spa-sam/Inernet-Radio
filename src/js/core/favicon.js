// favicon.js — centralized station-logo resolution with a persisted negative
// cache. Station favicons are remote URLs of varying reliability; once one
// fails to load we remember it so the lists never re-request it (avoiding
// repeated failed network hits while scrolling) and show the generated
// placeholder straight away. The cache survives restarts via settings.

import { loadCache, saveCache } from './db.js';
import { generatePlaceholderLogo } from './util.js';

const MAX_FAILED = 1000; // cap the persisted set so it cannot grow unbounded

// Set of favicon URLs known to have failed to load. Filled once at startup by
// initFaviconCache(); the lookups below are synchronous because they run during
// list rendering.
let failed = new Set();

// Persisting on every single failure rewrote the whole array each time; a short
// debounce coalesces the burst that a freshly scrolled list produces.
let saveTimer = null;
function persistFailed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCache('faviconFailed', [...failed]), 500);
}

// Load the persisted negative cache. Called once during startup.
export async function initFaviconCache() {
    const stored = await loadCache('faviconFailed');
    if (Array.isArray(stored)) failed = new Set(stored);
}

// Record a favicon URL that failed to load and persist the updated set.
export function noteFaviconFailed(url) {
    if (!url) return;
    if (failed.has(url)) return;
    failed.add(url);
    // Drop the oldest entries first if the cache grows past its cap.
    while (failed.size > MAX_FAILED) failed.delete(failed.values().next().value);
    persistFailed();
}

// Whether a favicon URL is worth attempting (present and not known-bad).
export function isFaviconUsable(url) {
    return !!url && !failed.has(url);
}

// Best logo source for a station without triggering a network attempt for a
// known-bad favicon. Used where onerror cannot apply (e.g. CSS background).
// Wrap a URL for a CSS background-image. URLs here come from the station
// database, so anything that could close the string or the url() is percent-
// encoded rather than trusted.
export function cssUrl(src) {
    return `url("${String(src).replace(/["'()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}")`;
}

export function resolveLogoSrc(station) {
    if (station && isFaviconUsable(station.favicon)) return station.favicon;
    return generatePlaceholderLogo(station ? station.name : '');
}

// Apply a station logo to an <img>: use the favicon when usable and fall back
// to the placeholder (recording the failure) on a load error.
export function applyLogo(imgEl, station) {
    // Station lists page in thousands of rows. Deferring the fetch to the point
    // the row scrolls into view, and the decode off the main thread, keeps a
    // long list from stalling on artwork the user never scrolls to. Images
    // already in view are unaffected — the browser loads those immediately.
    imgEl.loading = 'lazy';
    imgEl.decoding = 'async';

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
