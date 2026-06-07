// api.js — Radio Browser API layer
// Manages mirror-server failover and exposes fetch + filter-option helpers.

// Default mirror servers used until the live list is fetched at startup.
let apiServers = [
    'de1.api.radio-browser.info',
    'de2.api.radio-browser.info',
    'nl1.api.radio-browser.info',
    'at1.api.radio-browser.info'
];
let currentApiServer = 0;

// How long to wait on a single mirror before giving up and failing over. Some
// Radio Browser mirrors accept the connection but stall; without this the
// browser default (tens of seconds) would block the whole failover chain.
const API_TIMEOUT_MS = 5000;

// fetch() with an abort-based timeout so a hung mirror can't stall failover.
async function fetchWithTimeout(url, ms = API_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Fetch the live list of Radio Browser mirror servers and replace the defaults.
export async function loadApiServers() {
    try {
        const res = await fetchWithTimeout('https://all.api.radio-browser.info/json/servers');
        const servers = await res.json();
        const names = [...new Set(servers.map(s => s.name).filter(Boolean))];
        if (names.length > 0) {
            apiServers = names;
            currentApiServer = Math.floor(Math.random() * names.length);
        }
    } catch (e) {
        console.warn('Could not load API server list, using defaults:', e);
    }
}

// Fetch a Radio Browser JSON endpoint, failing over between mirrors on error.
export async function apiFetch(path) {
    let lastError;
    for (let i = 0; i < apiServers.length; i++) {
        const index = (currentApiServer + i) % apiServers.length;
        try {
            const res = await fetchWithTimeout(`https://${apiServers[index]}/json${path}`);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            currentApiServer = index;
            return await res.json();
        } catch (e) {
            lastError = e;
            console.warn(`API server ${apiServers[index]} failed:`, e.message);
        }
    }
    throw lastError || new Error('All API servers failed');
}

// Populate the country and tag <datalist> elements from live API data.
// Failures are non-fatal: the inputs still accept free text.
export async function loadFilterOptions() {
    const fill = (datalistId, names) => {
        const list = document.getElementById(datalistId);
        if (!list) return;
        // Build options with DOM APIs (not innerHTML): country/tag/language
        // names are community-submitted to Radio Browser, so HTML in a name
        // must never be parsed — that would be an XSS (→ RCE in Tauri) vector.
        list.replaceChildren();
        for (const n of names) {
            const opt = document.createElement('option');
            opt.value = n;
            list.appendChild(opt);
        }
    };

    try {
        const countries = await apiFetch('/countries');
        const names = countries
            .filter((c) => c.name && c.stationcount > 0)
            .sort((a, b) => b.stationcount - a.stationcount)
            .map((c) => c.name);
        fill('country-list', names);
    } catch (e) {
        console.warn('Could not load country list:', e);
    }

    try {
        const tags = await apiFetch('/tags');
        const names = tags
            .filter((t) => t.name && t.stationcount > 0)
            .sort((a, b) => b.stationcount - a.stationcount)
            .slice(0, 150)
            .map((t) => t.name);
        fill('tag-list', names);
    } catch (e) {
        console.warn('Could not load tag list:', e);
    }

    try {
        const languages = await apiFetch('/languages');
        const names = languages
            .filter((l) => l.name && l.stationcount > 0)
            .sort((a, b) => b.stationcount - a.stationcount)
            .slice(0, 150)
            .map((l) => l.name);
        fill('language-list', names);
    } catch (e) {
        console.warn('Could not load language list:', e);
    }
}
