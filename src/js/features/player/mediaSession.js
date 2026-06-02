// OS-level media session integration (media keys, lock screen, system widget)
// and song-change desktop notifications.

import { state } from '../../core/state.js';
import { resolveLogoSrc } from '../../core/favicon.js';
import { playStation, stopStation, prevStation, nextStation } from './playback.js';

// Wire OS-level media controls (media keys, lock screen, system widget)
export function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => { if (state.currentStation) playStation(); });
    ms.setActionHandler('pause', stopStation);
    ms.setActionHandler('stop', stopStation);
    ms.setActionHandler('previoustrack', prevStation);
    ms.setActionHandler('nexttrack', nextStation);
}

// Update the metadata shown by the OS media controls
export function updateMediaSession(trackTitle) {
    if (!('mediaSession' in navigator) || !state.currentStation) return;
    const artwork = resolveLogoSrc(state.currentStation);
    navigator.mediaSession.metadata = new MediaMetadata({
        title: trackTitle || state.currentStation.name,
        artist: trackTitle ? state.currentStation.name : (state.currentStation.country || 'Internet Radio'),
        album: 'Internet Radio',
        artwork: [{ src: artwork, sizes: '512x512', type: artwork.startsWith('data:') ? 'image/svg+xml' : 'image/png' }]
    });
}

export function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }
}

export function showSongNotification(stationName, trackTitle) {
    if ('Notification' in window && Notification.permission === 'granted') {
        if (trackTitle && trackTitle !== state.lastTrackTitle) {
            state.lastTrackTitle = trackTitle;
            new Notification(stationName, {
                body: `Now playing: ${trackTitle}`,
                icon: resolveLogoSrc(state.currentStation),
                silent: true
            });
        }
    }
}
