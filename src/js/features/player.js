// player feature barrel — re-exports the focused playback modules so the rest
// of the app keeps importing from a single './features/player.js' entry point.
//
//   proxy.js        — CORS proxy port + proxied stream URLs
//   volume.js       — volume control and fade animation
//   connection.js   — connection-state UI and auto-reconnect
//   metadata.js     — ICY metadata fetch + live update / recording listeners
//   mediaSession.js — OS media session and song notifications
//   recording.js    — stream recording start/stop and the REC button
//   playback.js     — core playback engine, selection, navigation, live timer

export * from './player/proxy.js';
export * from './player/volume.js';
export * from './player/connection.js';
export * from './player/metadata.js';
export * from './player/mediaSession.js';
export * from './player/recording.js';
export * from './player/playback.js';
