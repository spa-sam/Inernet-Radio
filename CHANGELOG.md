# Changelog

## 1.1.0

- **Tray:** the tray menu now controls playback (play/stop, previous/next, mute); optionally keep playing in the tray when the window is closed; optional launch at system startup (starts hidden in the tray).
- **Keyboard:** `↑`/`↓` volume, `M` mute, `←`/`→` or `P`/`N` previous/next, `F` favourite, `/` search, alongside `Space`.
- **Appearance:** light theme, configurable accent colour, English/Russian interface language.
- **Backup:** export/import all favourites, stations, history and settings in one file; drag `.m3u`/`.pls`/`.opml`/`.json` files onto the window to import.
- **Recording:** optional recordings folder with one-click recording (no save dialog).
- **Notifications:** song-change notifications are now a setting; permission is requested only when turned on.
- **UI:** skeleton loaders, Retry on failed searches, "Reset filters", "Buffering…" status, visualizer pauses while the window is hidden.
- **Code:** shared icon module, empty/loading placeholders helper, unit tests for i18n, theme, shortcuts, backup and path helpers.
