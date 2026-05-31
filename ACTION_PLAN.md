# Action Plan — Internet Radio

План покращень та доповнень. Узгоджено з користувачем.

## Рішення по обсягу

- Історія треків — **залишається як є** (ручне додавання, навмисно).
- Тести — Rust-юніт-тести для чистих парсерів **додано** (раунд 2); рішення «не пишемо» переглянуто.
- Мова інтерфейсу — **повністю англійська** (прибрати україномовні рядки UI).
- Тема — **тільки поточна** (без світлої теми та кастомного акценту UI).
- Гарячі клавіші — **тільки `Пробіл`** (плей/стоп). Прибрати `←/→`, `↑/↓`, `Ctrl+K`.

---

## 1. Виправлення / технічний борг

- [x] Безпечне відкриття URL: замінити `cmd /C start` на безпечний механізм (`tauri-plugin-opener` або `ShellExecute`). `src-tauri/src/main.rs` `open_url`.
- [x] TLS: лишити приймання невалідних сертифікатів, але додати лог/прапорець. `src-tauri/src/main.rs`.
- [x] Прибрати дубль persistence (localStorage ↔ SQLite): SQLite — єдине джерело істини, localStorage пише лише як фолбек коли БД недоступна (`writeLocal`/`saveSetting` у `db.js` no-op при відкритій БД). Лоадер налаштувань узагальнено (нові ключі підхоплюються автоматично).
- [x] Живі ICY-метадані через проксі: метадані треку вирізаються прямо в потоці відтворення (`pipe_with_icy` у `main.rs`) і шлються подією `stream-metadata`. Прибрано опитування `get_stream_metadata` кожні 10 с (лишився один разовий запит при під'єднанні для миттєвого показу). Фронт слухає подію через `setupStreamMetadataListener` у `player.js`.

## 2. Нові аудіофункції

- [x] **Плавне затихання/наростання** для плей/стоп **і** для sleep-timer (fade-in / fade-out гучності).
- [x] **Еквалайзер** через Web Audio `BiquadFilterNode` (вбудувати в наявний audio-граф візуалізатора).
- [x] **Запис ефіру** у файл (паралельний запис у Rust-проксі).
- [x] **Нормалізація гучності / буфер** для нестабільних потоків.

## 3. UX / інтерфейс

- [x] **Перевести весь UI на англійську** (HTML + рядки в `main.js`, `lang="en"`).
- [x] **Пагінація / нескінченний скрол** списку станцій (зараз ліміт 30).
- [x] **Drag-and-drop** впорядкування обраних і власних станцій.
- [x] **Автодоповнення країн і тегів** з API замість фіксованого списку.
- [x] Гарячі клавіші: залишити тільки `Пробіл`.

## 4. Архітектура / якість

- [x] Розбити `main.js` на ES-модулі: виокремлено `api.js` (Radio Browser layer) та `db.js` (repository layer); main.js імпортує обидва.
- [x] Винести SQL у repository, прибрати дубль localStorage↔SQLite: єдиний `saveSetting` у `db.js`, `loadAllDataFromDb`/`loadAllDataFromStorage` повертають дані замість мутації глобалів.
- [x] CI (GitHub Actions): `cargo clippy`, `cargo fmt --check`, збірка під Windows.

---

## Раунд 2 — доповнення

- [x] **Юніт-тести Rust-парсерів** (`#[cfg(test)]` у `main.rs`): `parse_url`, `resolve_location`, `is_playlist`, `first_stream_url`, `parse_stream_title`, `parse_status_code`, `sanitize_filename`, `segment_path`.
- [x] **Індикатор запису**: подія `recording-progress` (час + байти) → `REC mm:ss · X.X MB` у транспорт-панелі та tooltip кнопки.
- [x] **Авторозбиття запису по треках**: чекбокс «Split recording per track»; `record_split` ріже файл при зміні `StreamTitle` (фолбек на один файл без ICY).
- [x] **Виправлено дозволи запису**: `start/stop/is_recording` додані у `build.rs` і `capabilities/default.json` (раніше «command not found»).
- [x] **Будильник (wake-to-radio)**: щоденний запуск відтворення о заданій годині (`ui.js`), persisted `alarmEnabled`/`alarmTime`.
- [x] **Розширені фільтри пошуку**: мова (`/languages` + datalist) і сортування (`order`/`reverse`) додані до наявних country/tag/bitrate/codec.
- [x] **Авто-оновлення через GitHub Releases**: `tauri-plugin-updater` зареєстровано на desktop; команда `check_for_updates` + кнопка в About. Конфіг у `tauri.conf.json` → `plugins.updater` (endpoint `https://github.com/spa-sam/Inernet-Radio/releases/latest/download/latest.json` + `pubkey`), `bundle.createUpdaterArtifacts: true`. Реліз публікує workflow `.github/workflows/release.yml` (`tauri-action`) на push тегу `v*`.
  - Ключ підпису: `~/.tauri/internet-radio.key` (приватний — поза репо), публічний — у конфізі.
  - Секрети GitHub: `TAURI_SIGNING_PRIVATE_KEY` (вміст файлу ключа), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  - Випуск нової версії: підняти `version` у `tauri.conf.json` + `package.json`, потім `git tag vX.Y.Z && git push origin vX.Y.Z`.
  - Локальний `npm run tauri build` тепер потребує env `TAURI_SIGNING_PRIVATE_KEY` (через `createUpdaterArtifacts`).
- [x] **macOS у релізі**: `release.yml` розширено в matrix `windows-latest` + `macos-latest` (`--target universal-apple-darwin`); `bundle.targets: "all"`. Обидві платформи кладуться в один реліз, `latest.json` обʼєднує цілі.
  - Apple-нотаризація поки **не налаштована** → macOS Gatekeeper попереджатиме при першому запуску (правою → Open). Додамо за наявності Apple Developer ID (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
- [x] **Двокроковий апдейтер**: `check_for_updates` лише перевіряє; `install_update` качає з подіями `update-progress`; `restart_app` перезапускає. Одна кнопка в About проходить Check → Install vX (прогрес-бар) → Restart now.
- [x] **Джерело «M3U Radio»** (`junguler/m3u-radio-music-playlists`): пресет із випадаючим списком жанрів. Список жанрів тягнеться з GitHub contents API і кешується в БД (TTL 7 днів, кнопка ↻). Вміст жанру тягнеться на льоту через CORS-проксі (raw), парситься (`parseM3U`, тепер із `tvg-logo`), показується тимчасово (до 500), у БД не пишеться — лише обране. Без нового Rust/дозволів.

## Порядок виконання

1. Англійська локалізація UI (самодостатнє, видиме).
2. Плавне затихання/наростання + спрощення гарячих клавіш.
3. Безпечне `open_url` + TLS-лог.
4. Еквалайзер.
5. Пагінація списку + автодоповнення фільтрів.
6. Drag-and-drop впорядкування.
7. Запис ефіру + нормалізація.
8. Рефакторинг у модулі + repository.
9. CI.
