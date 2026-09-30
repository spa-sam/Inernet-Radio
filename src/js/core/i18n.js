// i18n.js — interface language (English / Ukrainian).
//
// English is the source language and doubles as the lookup key: t('Play')
// returns 'Play' in English and the Ukrainian entry otherwise, falling back to the
// key itself, so a missing translation degrades to English rather than to a
// blank. A key containing `{}` is a pattern: each `{}` matches a run of text
// and is substituted, in order, into the `{}` slots of the translation
// (t('Hid Jazz FM') → 'Сховано: Jazz FM').
//
// Static markup is translated once by walking the DOM (applyTranslations), with
// each node's original text remembered so switching back to English restores it.
// Dynamic strings call t() explicitly. User data — station names, track titles —
// is never passed through the dictionary.

export const LANGUAGES = ['auto', 'en', 'uk'];

const UK = {
    // Header / tabs / statuses
    'Radio': 'Радіо',
    'My Stations': 'Мої станції',
    'Settings': 'Налаштування',
    'Sections': 'Розділи',
    'Interface view': 'Вигляд інтерфейсу',
    'Narrow view': 'Вузький вигляд',
    'Wide view': 'Широкий вигляд',
    'Pin on top': 'Поверх усіх вікон',
    'Compact mode': 'Компактний режим',
    'Enter compact mode': 'Увімкнути компактний режим',
    'Exit compact mode': 'Вийти з компактного режиму',
    'ON AIR': 'В ЕФІРІ',
    'OFF AIR': 'НЕ В ЕФІРІ',

    // Player
    'Now Playing': 'Зараз грає',
    'LIVE': 'LIVE',
    'Choose a radio station': 'Оберіть радіостанцію',
    '🔓 Unverified': '🔓 Не перевірено',
    'TLS certificate could not be verified': 'Не вдалося перевірити TLS-сертифікат',
    'Track': 'Трек',
    'Copy track name': 'Копіювати назву треку',
    'Copied': 'Скопійовано',
    'Now playing': 'Зараз грає',
    'Find track on YouTube': 'Знайти трек на YouTube',
    'Find on YouTube': 'Знайти на YouTube',
    'Spectrum': 'Спектр',
    'Previous': 'Назад',
    'Previous station': 'Попередня станція',
    'Next': 'Далі',
    'Next station': 'Наступна станція',
    'Play': 'Грати',
    'Stop': 'Стоп',
    'Play/Pause': 'Грати / Стоп',
    'Record stream': 'Записати потік',
    'Stop recording': 'Зупинити запис',
    'Stop recording — {}': 'Зупинити запис — {}',
    'Mute': 'Вимкнути звук',
    'Unmute': 'Увімкнути звук',
    'Volume': 'Гучність',
    'Drag to resize': 'Потягніть, щоб змінити розмір',
    'Connectivity': 'Доступність',

    // Connection status
    '⏳ Connecting…': '⏳ Підключення…',
    '⏳ Buffering…': '⏳ Буферизація…',
    '🔄 Reconnecting… ({})': '🔄 Перепідключення… ({})',
    '⚠ Could not play this station': '⚠ Не вдалося відтворити станцію',

    // Search
    'Search': 'Пошук',
    '★ Favorites': '★ Обране',
    'Station list source': 'Джерело списку станцій',
    'Search radio stations': 'Пошук радіостанцій',
    'Search radio stations...': 'Пошук радіостанцій...',
    'Add as genre preset': 'Додати як жанр',
    'Browse genres & collections': 'Жанри та добірки',
    'Browse genres and collections': 'Жанри та добірки',
    'Filters': 'Фільтри',
    'Country': 'Країна',
    'All countries': 'Усі країни',
    'Tag / genre': 'Тег / жанр',
    'Any tag': 'Будь-який тег',
    'Quality (Min. bitrate)': 'Якість (мін. бітрейт)',
    'Any': 'Будь-яка',
    '64+ kbps': '64+ кбіт/с',
    '128+ kbps (HQ)': '128+ кбіт/с (HQ)',
    '192+ kbps (VHQ)': '192+ кбіт/с (VHQ)',
    '320 kbps (Max)': '320 кбіт/с (макс.)',
    'Codec': 'Кодек',
    'AAC / AAC+': 'AAC / AAC+',
    'Language': 'Мова станції',
    'Any language': 'Будь-яка мова',
    'Sort by': 'Сортування',
    'Popularity': 'Популярність',
    'Most voted': 'За голосами',
    'Trending': 'У тренді',
    'Bitrate': 'Бітрейт',
    'Name (A–Z)': 'Назва (А–Я)',
    'Reset filters': 'Скинути фільтри',
    'Suggestions': 'Підказки',
    'Genres': 'Жанри',
    'Collections': 'Добірки',
    'curated': 'добірка',
    'Search “{}”': 'Шукати «{}»',
    'Edit genres': 'Змінити жанри',
    'Edit genre presets': 'Змінити жанри',
    'Add genre (e.g. techno)': 'Додати жанр (наприклад, techno)',
    'Add genre preset': 'Додати жанр',
    'Add': 'Додати',
    'Reset': 'Скинути',
    'Restore default genres': 'Повернути жанри за замовчуванням',
    'Remove genre': 'Видалити жанр',
    'Recently Played': 'Нещодавно слухали',
    'All Stations': 'Усі станції',
    'Stations': 'Станції',
    'Find radio stations using the search above': 'Знайдіть радіостанції через пошук вище',
    'Searching…': 'Пошук…',
    'No stations found': 'Станцій не знайдено',
    'Failed to load stations': 'Не вдалося завантажити станції',
    'Loading popular stations...': 'Завантаження популярних станцій...',
    'Loading SomaFM...': 'Завантаження SomaFM...',
    'SomaFM returned no stations': 'SomaFM не повернув станцій',
    'Failed to load SomaFM': 'Не вдалося завантажити SomaFM',
    'Loading playlist…': 'Завантаження плейлиста…',
    'Playlist is empty': 'Плейлист порожній',
    'Failed to load playlist': 'Не вдалося завантажити плейлист',
    'No saved stations': 'Немає збережених станцій',
    'Retry': 'Повторити',
    'Remove {} from favorites': 'Прибрати «{}» з обраного',
    'Add {} to favorites': 'Додати «{}» до обраного',
    'Hide {}': 'Сховати «{}»',
    'Hide station': 'Сховати станцію',
    'Hid {}': 'Сховано: {}',
    'Undo': 'Скасувати',
    'Added to favorites': 'Додано до обраного',
    'Removed from favorites': 'Прибрано з обраного',

    // My Stations
    'No active station': 'Немає активної станції',
    'Track History': 'Історія треків',
    'Clear': 'Очистити',
    'Clear track history': 'Очистити історію треків',
    'Track history cleared': 'Історію треків очищено',
    'History is empty': 'Історія порожня',
    'Add a custom station': 'Додати власну станцію',
    'Station name': 'Назва станції',
    'Stream URL': 'URL потоку',
    'Stream URL (http://... or https://...)': 'URL потоку (http://... або https://...)',
    'Genre (optional)': 'Жанр (необов’язково)',
    'Genre': 'Жанр',
    'Preview': 'Перевірити',
    'Add station': 'Додати станцію',
    'My saved stations': 'Мої збережені станції',
    'No custom stations': 'Немає власних станцій',
    'No custom stations yet': 'Власних станцій поки немає',
    'Import / Export': 'Імпорт / експорт',
    'Export favorites': 'Експорт обраного',
    'Import stations': 'Імпорт станцій',
    'Export': 'Експорт',
    'Edit': 'Змінити',
    'Delete': 'Видалити',
    'Edit station': 'Змінити станцію',
    'Name': 'Назва',
    'Save changes': 'Зберегти',
    'Close': 'Закрити',
    'Enter a station name and URL': 'Введіть назву та URL станції',
    'Enter a name and URL': 'Введіть назву та URL',
    'Enter a stream URL': 'Введіть URL потоку',
    'Stream URL must start with http:// or https://': 'URL потоку має починатися з http:// або https://',
    'Failed to play URL: {}': 'Не вдалося відтворити URL: {}',
    'No favorite stations to export': 'Немає обраних станцій для експорту',
    'Stations imported: {}': 'Станцій імпортовано: {}',
    'Custom stations imported': 'Власні станції імпортовано',
    'Favorites imported': 'Обране імпортовано',
    'Invalid file format': 'Невірний формат файлу',
    'Export error: {}': 'Помилка експорту: {}',
    'File read error: {}': 'Помилка читання файлу: {}',
    'Drop a file to import stations': 'Перетягніть файл, щоб імпортувати станції',

    // Settings
    'Display': 'Відображення',
    'Narrow': 'Вузький',
    'Wide': 'Широкий',
    'Compact player mode': 'Компактний режим плеєра',
    'Audio visualizer': 'Візуалізатор звуку',
    'Visualization mode': 'Режим візуалізації',
    'Neon bars': 'Неонові стовпчики',
    'Neon peaks': 'Неонові піки',
    'Oscilloscope wave': 'Осцилограф',
    'Circular equalizer': 'Круговий еквалайзер',
    'Mirror spectrum': 'Дзеркальний спектр',
    'Dance pulse': 'Танцювальний пульс',
    'Visualizer sensitivity': 'Чутливість візуалізатора',
    'Equalizer color': 'Колір еквалайзера',
    'Appearance': 'Зовнішній вигляд',
    'Theme': 'Тема',
    'System': 'Як у системі',
    'Dark': 'Темна',
    'Light': 'Світла',
    'Accent color': 'Акцентний колір',
    'Interface language': 'Мова інтерфейсу',
    'Auto': 'Авто',
    'Sources': 'Джерела',
    'Choose which catalogues the unified search includes. The dot shows whether each enabled source is reachable.':
        'Оберіть каталоги для спільного пошуку. Крапка показує, чи доступне ввімкнене джерело.',
    'Equalizer': 'Еквалайзер',
    'Enable equalizer': 'Увімкнути еквалайзер',
    'Preset': 'Пресет',
    'Flat': 'Рівний',
    'Bass boost': 'Підсилення басів',
    'Treble boost': 'Підсилення верхів',
    'Vocal': 'Вокал',
    'Rock': 'Рок',
    'Volume normalization (compressor)': 'Нормалізація гучності (компресор)',
    'Sleep timer': 'Таймер сну',
    'Stop playback after': 'Зупинити через',
    'Off': 'Вимк.',
    '15 minutes': '15 хвилин',
    '30 minutes': '30 хвилин',
    '45 minutes': '45 хвилин',
    '1 hour': '1 година',
    '1.5 hours': '1,5 години',
    '2 hours': '2 години',
    'Or stop at time': 'Або зупинити о',
    'Remaining': 'Залишилось',
    'Alarm (wake to radio)': 'Будильник (радіо)',
    'Start playback at a set time (daily)': 'Вмикати радіо в заданий час (щодня)',
    'Alarm time': 'Час будильника',
    'Starts in': 'Спрацює через',
    'Sleep timer: playback stopped': 'Таймер сну: відтворення зупинено',
    'Sleep timer: {} min': 'Таймер сну: {} хв',
    'Sleep timer: until {}': 'Таймер сну: до {}',
    'Alarm set for {}': 'Будильник встановлено на {}',
    'Alarm — playback started': 'Будильник — відтворення запущено',
    'Recording': 'Запис',
    'Split recording into one file per track': 'Ділити запис на файли за треками',
    'Ask where to save each recording': 'Питати, куди зберігати кожен запис',
    'Recordings folder': 'Тека для записів',
    'Choose…': 'Обрати…',
    'Recording started': 'Запис розпочато',
    'Recording saved': 'Запис збережено',
    'Recording failed: {}': 'Помилка запису: {}',
    'Recording is only available in the desktop app': 'Запис доступний лише в настільному застосунку',
    'Start playing a station first': 'Спочатку увімкніть станцію',
    'Insecure connection: TLS certificate not verified': 'Небезпечне з’єднання: TLS-сертифікат не перевірено',
    'Application': 'Застосунок',
    'Keep playing in the tray when the window is closed': 'Продовжувати грати в треї після закриття вікна',
    'Launch at system startup': 'Запускати під час старту системи',
    'Song-change notifications': 'Сповіщення про зміну треку',
    'Notifications are blocked in system settings': 'Сповіщення заблоковано в налаштуваннях системи',
    'Keyboard shortcuts': 'Гарячі клавіші',
    'Play / stop': 'Грати / стоп',
    'Volume up / down': 'Гучність вище / нижче',
    'Previous / next station': 'Попередня / наступна станція',
    'Toggle favorite': 'В обране / з обраного',
    'Focus the search box': 'Перейти до пошуку',
    'Blacklisted stations': 'Приховані станції',
    'Stations hidden from search results. Unhide to bring one back.':
        'Станції, приховані з результатів пошуку. Натисніть «Показати», щоб повернути.',
    'No hidden stations': 'Прихованих станцій немає',
    'Unhide': 'Показати',
    'Backup': 'Резервна копія',
    'Save all your favorites, stations, history, genres and settings to one file, or restore them from one.':
        'Збережіть обране, станції, історію, жанри та налаштування в один файл або відновіть їх із нього.',
    'Export backup': 'Експорт копії',
    'Import backup': 'Імпорт копії',
    'Backup saved': 'Резервну копію збережено',
    'Backup restored': 'Резервну копію відновлено',
    'This file is not a backup of this app': 'Цей файл не є копією даних застосунку',
    'Backup failed: {}': 'Не вдалося створити копію: {}',
    'Restore failed: {}': 'Не вдалося відновити: {}',
    'About': 'Про застосунок',
    'Internet Radio Player': 'Інтернет-радіо',
    'A modern radio player with CORS bypass and HTTPS metadata support.':
        'Сучасний радіоплеєр з обходом CORS і підтримкою HTTPS-метаданих.',
    'Built with Tauri v2 + Rust + HTML5 Audio.': 'Створено на Tauri v2 + Rust + HTML5 Audio.',
    'Check for updates': 'Перевірити оновлення',
    'Checking…': 'Перевірка…',
    'Restart now': 'Перезапустити',
    'Installing…': 'Встановлення…',
    'Updates are available in the desktop app only': 'Оновлення доступні лише в настільному застосунку',
    'Initialization failed: {}': 'Помилка ініціалізації: {}',
    'Genre is empty or already added': 'Жанр порожній або вже доданий',
    'Added “{}” to genres': 'Жанр «{}» додано',
    'Install v{}': 'Встановити v{}',
    'Update available: v{} (current v{})': 'Доступне оновлення: v{} (зараз v{})',
    'Downloading {}…': 'Завантаження {}…',
    'You are on the latest version (v{})': 'У вас остання версія (v{})',
    'Starting download…': 'Початок завантаження…',
    'v{} installed. Restart to apply.': 'v{} встановлено. Перезапустіть, щоб застосувати.',
    'Update check failed: {}': 'Не вдалося перевірити оновлення: {}',
    'Install failed: {}': 'Не вдалося встановити: {}'
};

const DICTIONARIES = { uk: UK };

let current = 'en';
// Compiled `{}` patterns per language: [{ re, template }].
const patternCache = new Map();

// Resolve a preference ('auto' | 'en' | 'uk') to a concrete supported language.
// Anything else (including a value saved by an older build) counts as 'auto',
// and "auto" follows the system language, falling back to English.
export function resolveLanguage(pref) {
    if (pref === 'en' || pref === 'uk') return pref;
    const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
    return nav.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

export function getLanguage() {
    return current;
}

export function setLanguage(pref) {
    current = resolveLanguage(pref);
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = current;
    }
    return current;
}

function patternsFor(lang) {
    if (patternCache.has(lang)) return patternCache.get(lang);
    const list = [];
    const dict = DICTIONARIES[lang] || {};
    for (const key of Object.keys(dict)) {
        if (!key.includes('{}')) continue;
        const source = key.split('{}')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('(.+?)');
        list.push({ re: new RegExp('^' + source + '$', 's'), template: dict[key] });
    }
    patternCache.set(lang, list);
    return list;
}

// Translate one string. Strings with no entry come back unchanged.
export function t(text) {
    if (current === 'en' || typeof text !== 'string' || !text) return text;
    const dict = DICTIONARIES[current];
    if (!dict) return text;
    if (Object.prototype.hasOwnProperty.call(dict, text)) return dict[text];
    for (const { re, template } of patternsFor(current)) {
        const m = re.exec(text);
        if (m) {
            let i = 1;
            return template.replace(/\{\}/g, () => (m[i++] !== undefined ? m[i - 1] : ''));
        }
    }
    return text;
}

// --- DOM translation --------------------------------------------------------

const ATTRS = ['placeholder', 'title', 'aria-label'];
// Text nodes and attributes already seen, with their English original.
const textOriginals = new WeakMap();
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'TEXTAREA']);

function translateTextNode(node) {
    let original = textOriginals.get(node);
    if (original === undefined) {
        original = node.nodeValue;
        textOriginals.set(node, original);
    } else if (node.nodeValue !== original && node.nodeValue !== translateKeepingSpace(original)) {
        // The text was rewritten by the app since we last saw it: take the new
        // value as the original instead of clobbering it.
        original = node.nodeValue;
        textOriginals.set(node, original);
    }
    const next = translateKeepingSpace(original);
    if (node.nodeValue !== next) node.nodeValue = next;
}

// Translate the trimmed text and keep the surrounding whitespace, so markup
// indentation around a label survives.
function translateKeepingSpace(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    const collapsed = trimmed.replace(/\s+/g, ' ');
    const out = t(collapsed);
    if (out === collapsed) return raw;
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const trail = raw.slice(raw.trimEnd().length);
    return lead + out + trail;
}

// Translate the static text and title/placeholder/aria-label attributes under
// `root`. Safe to call repeatedly and when switching language in either
// direction.
export function applyTranslations(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const batch = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) batch.push(n);

    for (const node of batch) {
        if (node.nodeType === Node.TEXT_NODE) {
            const parent = node.parentElement;
            if (parent && !SKIP_TAGS.has(parent.tagName.toUpperCase()) && !parent.closest('[data-no-i18n]')) {
                translateTextNode(node);
            }
        } else if (!SKIP_TAGS.has(node.tagName.toUpperCase()) && !node.closest('[data-no-i18n]')) {
            for (const attr of ATTRS) {
                if (!node.hasAttribute(attr)) continue;
                const base = 'i18n' + attr.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
                const current = node.getAttribute(attr);
                // The app may have rewritten the attribute since we last saw it
                // (play/stop labels, recording title): then that value is the new
                // English original rather than something to overwrite.
                if (node.dataset[base + 'Orig'] === undefined ||
                    (current !== node.dataset[base + 'Shown'] && current !== node.dataset[base + 'Orig'])) {
                    node.dataset[base + 'Orig'] = current;
                }
                const next = t(node.dataset[base + 'Orig']);
                node.dataset[base + 'Shown'] = next;
                if (current !== next) node.setAttribute(attr, next);
            }
        }
    }
}
