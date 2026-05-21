# Internet Radio

Internet radio player built with Rust + Tauri 2.

## Features

- Search radio stations via Radio Browser API
- Play/Stop streaming audio
- Volume control
- Display station info and logo
- Popular stations on startup
- Dark studio theme with an orange accent
- Audio spectrum visualizer with a LIVE elapsed-time counter
- Favorites, custom stations, playlist import/export

## Interface views

The header has a segmented switch (top-right) to change layout:

- **Narrow** — single-column layout, compact player card. Window ~500 px wide.
- **Wide** — two-column studio layout: large player on the left, search and
  station list on the right. Window ~1180 px wide.

The chosen view is saved and restored on the next launch. Switching also
resizes the window automatically. A separate compact widget mode (mini
always-on-top player) is still available from the player card controls.

Keyboard: `Space` play/stop, `←`/`→` previous/next station, `Ctrl+K` focus search.

## Requirements

- Node.js (v18+)
- Rust (rustup)
- Tauri prerequisites: https://tauri.app/start/prerequisites/

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## API

Uses [Radio Browser API](https://api.radio-browser.info/) - free, open-source database with 30,000+ radio stations.
