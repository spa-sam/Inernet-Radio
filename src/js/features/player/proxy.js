// Stream-proxy wiring: fetch the local CORS proxy port from the Rust backend
// and build proxied stream URLs.

import { state } from '../../core/state.js';
import { hasTauriApi } from '../../core/util.js';

// Fetch proxy port from the Rust backend
export async function initProxy() {
    if (!hasTauriApi) return;
    try {
        const { invoke } = window.__TAURI__.core;
        state.proxyPort = await invoke('get_proxy_port');
        console.log('CORS Proxy server running on port:', state.proxyPort);
    } catch (e) {
        console.error('Failed to load proxy port:', e);
    }
}

// Helper to get a proxied stream URL for bypassing CORS. When `raw` is true the
// proxy streams the response verbatim without resolving .pls/.m3u playlists
// (used for HLS manifests served to hls.js).
export function getProxiedUrl(originalUrl, raw) {
    if (state.proxyPort > 0 && originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
        if (originalUrl.includes('localhost') || originalUrl.includes('127.0.0.1')) {
            return originalUrl;
        }
        let proxied = `http://127.0.0.1:${state.proxyPort}/stream?url=${encodeURIComponent(originalUrl)}`;
        if (raw) proxied += '&raw=1';
        return proxied;
    }
    return originalUrl;
}
