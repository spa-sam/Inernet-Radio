# Changelog

## 1.1.2

- **Performance:** the `/tags` and `/languages` filter lists are now capped server-side (`order=stationcount&limit=150&hidebroken=true`) instead of downloading the full lists and slicing — a smaller payload and a faster startup.
- **Dependencies:** Rust crates updated (Tauri 2.12.5 and its plugins, `rustls`, `tokio`, `minisign-verify` 0.3); `symphonia` deliberately kept on 0.5.
- **Tooling:** `.cargo/audit.toml` documents the known, non-reachable transitive advisories (the `rsa`/MySQL path is never compiled; unmaintained GTK/zbus crates from the Tauri stack) so a future `cargo audit` stays green.

## 1.1.1

- **Language:** Russian removed; Ukrainian added (Settings → Interface language).
- **Security:** the proxy refuses redirects to local/link-local addresses and bounds HTTP header size; recordings are limited to absolute audio-file paths; backup restore only applies known settings and never machine-specific ones; imported logo URLs are validated; stricter CSP; `rustls` updated.
- **Dependencies:** Tauri plugins updated (dialog 2.8, fs 2.6, sql 2.5, window-state 2.5), plus `serde`, `serde_json` and `getrandom`.

## 1.1.0

- **Tray:** the tray menu now controls playback (play/stop, previous/next, mute); optionally keep playing in the tray when the window is closed; optional launch at system startup (starts hidden in the tray).
- **Keyboard:** `↑`/`↓` volume, `M` mute, `←`/`→` or `P`/`N` previous/next, `F` favourite, `/` search, alongside `Space`.
- **Appearance:** light theme, configurable accent colour, English/Ukrainian interface language.
- **Backup:** export/import all favourites, stations, history and settings in one file; drag `.m3u`/`.pls`/`.opml`/`.json` files onto the window to import.
- **Recording:** optional recordings folder with one-click recording (no save dialog).
- **Notifications:** song-change notifications are now a setting; permission is requested only when turned on.
- **UI:** skeleton loaders, Retry on failed searches, "Reset filters", "Buffering…" status, visualizer pauses while the window is hidden.
- **Code:** shared icon module, empty/loading placeholders helper, unit tests for i18n, theme, shortcuts, backup and path helpers.
