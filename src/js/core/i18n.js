// i18n.js — interface language (English / Russian).
//
// English is the source language and doubles as the lookup key: t('Play')
// returns 'Play' in English and the Russian entry otherwise, falling back to the
// key itself, so a missing translation degrades to English rather than to a
// blank. A key containing `{}` is a pattern: each `{}` matches a run of text
// and is substituted, in order, into the `{}` slots of the translation
// (t('Hid Jazz FM') → 'Скрыто: Jazz FM').
//
// Static markup is translated once by walking the DOM (applyTranslations), with
// each node's original text remembered so switching back to English restores it.
// Dynamic strings call t() explicitly. User data — station names, track titles —
// is never passed through the dictionary.

export const LANGUAGES = ['auto', 'en', 'ru'];

const RU = {
    // Header / tabs / statuses
    'Radio': 'Радио',
    'My Stations': 'Мои станции',
    'Settings': 'Настройки',
    'Sections': 'Разделы',
    'Interface view': 'Вид интерфейса',
    'Narrow view': 'Узкий вид',
    'Wide view': 'Широкий вид',
    'Pin on top': 'Поверх всех окон',
    'Compact mode': 'Компактный режим',
    'Enter compact mode': 'Включить компактный режим',
    'Exit compact mode': 'Выйти из компактного режима',
    'ON AIR': 'В ЭФИРЕ',
    'OFF AIR': 'НЕ В ЭФИРЕ',

    // Player
    'Now Playing': 'Сейчас играет',
    'LIVE': 'LIVE',
    'Choose a radio station': 'Выберите радиостанцию',
    '🔓 Unverified': '🔓 Не проверено',
    'TLS certificate could not be verified': 'Не удалось проверить TLS-сертификат',
    'Track': 'Трек',
    'Copy track name': 'Копировать название трека',
    'Copied': 'Скопировано',
    'Now playing': 'Сейчас играет',
    'Find track on YouTube': 'Найти трек на YouTube',
    'Find on YouTube': 'Найти на YouTube',
    'Spectrum': 'Спектр',
    'Previous': 'Назад',
    'Previous station': 'Предыдущая станция',
    'Next': 'Вперёд',
    'Next station': 'Следующая станция',
    'Play': 'Играть',
    'Stop': 'Стоп',
    'Play/Pause': 'Играть / Стоп',
    'Record stream': 'Записать поток',
    'Stop recording': 'Остановить запись',
    'Stop recording — {}': 'Остановить запись — {}',
    'Mute': 'Выключить звук',
    'Unmute': 'Включить звук',
    'Volume': 'Громкость',
    'Drag to resize': 'Потяните, чтобы изменить размер',
    'Connectivity': 'Доступность',

    // Connection status
    '⏳ Connecting…': '⏳ Подключение…',
    '⏳ Buffering…': '⏳ Буферизация…',
    '🔄 Reconnecting… ({})': '🔄 Переподключение… ({})',
    '⚠ Could not play this station': '⚠ Не удалось воспроизвести станцию',

    // Search
    'Search': 'Поиск',
    '★ Favorites': '★ Избранное',
    'Station list source': 'Источник списка станций',
    'Search radio stations': 'Поиск радиостанций',
    'Search radio stations...': 'Поиск радиостанций...',
    'Add as genre preset': 'Добавить как жанр',
    'Browse genres & collections': 'Жанры и коллекции',
    'Browse genres and collections': 'Жанры и коллекции',
    'Filters': 'Фильтры',
    'Country': 'Страна',
    'All countries': 'Все страны',
    'Tag / genre': 'Тег / жанр',
    'Any tag': 'Любой тег',
    'Quality (Min. bitrate)': 'Качество (мин. битрейт)',
    'Any': 'Любое',
    '64+ kbps': '64+ кбит/с',
    '128+ kbps (HQ)': '128+ кбит/с (HQ)',
    '192+ kbps (VHQ)': '192+ кбит/с (VHQ)',
    '320 kbps (Max)': '320 кбит/с (макс.)',
    'Codec': 'Кодек',
    'AAC / AAC+': 'AAC / AAC+',
    'Language': 'Язык станции',
    'Any language': 'Любой язык',
    'Sort by': 'Сортировка',
    'Popularity': 'Популярность',
    'Most voted': 'По голосам',
    'Trending': 'В тренде',
    'Bitrate': 'Битрейт',
    'Name (A–Z)': 'Название (А–Я)',
    'Suggestions': 'Подсказки',
    'Genres': 'Жанры',
    'Collections': 'Коллекции',
    'curated': 'подборка',
    'Search “{}”': 'Искать «{}»',
    'Reset filters': 'Сбросить фильтры',
    'Edit genres': 'Изменить жанры',
    'Edit genre presets': 'Изменить жанры',
    'Add genre (e.g. techno)': 'Добавить жанр (например, techno)',
    'Add genre preset': 'Добавить жанр',
    'Add': 'Добавить',
    'Reset': 'Сбросить',
    'Restore default genres': 'Вернуть жанры по умолчанию',
    'Remove genre': 'Удалить жанр',
    'Recently Played': 'Недавно слушали',
    'All Stations': 'Все станции',
    'Stations': 'Станции',
    'Find radio stations using the search above': 'Найдите радиостанции через поиск выше',
    'Searching…': 'Поиск…',
    'No stations found': 'Станции не найдены',
    'Failed to load stations': 'Не удалось загрузить станции',
    'Loading popular stations...': 'Загрузка популярных станций...',
    'Loading SomaFM...': 'Загрузка SomaFM...',
    'SomaFM returned no stations': 'SomaFM не вернул станции',
    'Failed to load SomaFM': 'Не удалось загрузить SomaFM',
    'Loading playlist…': 'Загрузка плейлиста…',
    'Playlist is empty': 'Плейлист пуст',
    'Failed to load playlist': 'Не удалось загрузить плейлист',
    'No saved stations': 'Нет сохранённых станций',
    'Offline — showing the last results': 'Нет сети — показаны последние результаты',
    'Retry': 'Повторить',
    'Remove {} from favorites': 'Убрать «{}» из избранного',
    'Add {} to favorites': 'Добавить «{}» в избранное',
    'Hide {}': 'Скрыть «{}»',
    'Hide station': 'Скрыть станцию',
    'Hid {}': 'Скрыто: {}',
    'Undo': 'Отменить',
    'Added to favorites': 'Добавлено в избранное',
    'Removed from favorites': 'Убрано из избранного',

    // My Stations
    'No active station': 'Нет активной станции',
    'Track History': 'История треков',
    'Clear': 'Очистить',
    'Clear track history': 'Очистить историю треков',
    'Track history cleared': 'История треков очищена',
    'History is empty': 'История пуста',
    'Add a custom station': 'Добавить свою станцию',
    'Station name': 'Название станции',
    'Stream URL': 'URL потока',
    'Stream URL (http://... or https://...)': 'URL потока (http://... или https://...)',
    'Genre (optional)': 'Жанр (необязательно)',
    'Genre': 'Жанр',
    'Preview': 'Проверить',
    'Add station': 'Добавить станцию',
    'My saved stations': 'Мои сохранённые станции',
    'No custom stations': 'Нет своих станций',
    'No custom stations yet': 'Своих станций пока нет',
    'Import / Export': 'Импорт / экспорт',
    'Export favorites': 'Экспорт избранного',
    'Import stations': 'Импорт станций',
    'Export': 'Экспорт',
    'Edit': 'Изменить',
    'Delete': 'Удалить',
    'Edit station': 'Изменить станцию',
    'Name': 'Название',
    'Save changes': 'Сохранить',
    'Close': 'Закрыть',
    'Enter a station name and URL': 'Введите название и URL станции',
    'Enter a name and URL': 'Введите название и URL',
    'Enter a stream URL': 'Введите URL потока',
    'Stream URL must start with http:// or https://': 'URL потока должен начинаться с http:// или https://',
    'Failed to play URL: {}': 'Не удалось воспроизвести URL: {}',
    'No favorite stations to export': 'Нет избранных станций для экспорта',
    'Stations imported: {}': 'Станций импортировано: {}',
    'Custom stations imported': 'Свои станции импортированы',
    'Favorites imported': 'Избранное импортировано',
    'Invalid file format': 'Неверный формат файла',
    'Export error: {}': 'Ошибка экспорта: {}',
    'File read error: {}': 'Ошибка чтения файла: {}',
    'Drop a file to import stations': 'Перетащите файл, чтобы импортировать станции',

    // Settings
    'Display': 'Отображение',
    'Narrow': 'Узкий',
    'Wide': 'Широкий',
    'Compact player mode': 'Компактный режим плеера',
    'Audio visualizer': 'Визуализатор звука',
    'Visualization mode': 'Режим визуализации',
    'Neon bars': 'Неоновые столбцы',
    'Neon peaks': 'Неоновые пики',
    'Oscilloscope wave': 'Осциллограф',
    'Circular equalizer': 'Круговой эквалайзер',
    'Mirror spectrum': 'Зеркальный спектр',
    'Dance pulse': 'Танцующий пульс',
    'Visualizer sensitivity': 'Чувствительность визуализатора',
    'Equalizer color': 'Цвет эквалайзера',
    'Appearance': 'Внешний вид',
    'Theme': 'Тема',
    'System': 'Как в системе',
    'Dark': 'Тёмная',
    'Light': 'Светлая',
    'Accent color': 'Акцентный цвет',
    'Interface language': 'Язык интерфейса',
    'Auto': 'Авто',
    'English': 'English',
    'Russian': 'Русский',
    'Sources': 'Источники',
    'Choose which catalogues the unified search includes. The dot shows whether each enabled source is reachable.':
        'Выберите каталоги для общего поиска. Точка показывает, доступен ли включённый источник.',
    'Equalizer': 'Эквалайзер',
    'Enable equalizer': 'Включить эквалайзер',
    'Preset': 'Пресет',
    'Flat': 'Ровный',
    'Bass boost': 'Усиление баса',
    'Treble boost': 'Усиление верхов',
    'Vocal': 'Вокал',
    'Rock': 'Рок',
    'Volume normalization (compressor)': 'Нормализация громкости (компрессор)',
    'Sleep timer': 'Таймер сна',
    'Stop playback after': 'Остановить через',
    'Off': 'Выкл.',
    '15 minutes': '15 минут',
    '30 minutes': '30 минут',
    '45 minutes': '45 минут',
    '1 hour': '1 час',
    '1.5 hours': '1,5 часа',
    '2 hours': '2 часа',
    'Or stop at time': 'Или остановить в',
    'Remaining': 'Осталось',
    'Alarm (wake to radio)': 'Будильник (радио)',
    'Start playback at a set time (daily)': 'Включать радио в заданное время (ежедневно)',
    'Alarm time': 'Время будильника',
    'Starts in': 'Сработает через',
    'Sleep timer: playback stopped': 'Таймер сна: воспроизведение остановлено',
    'Sleep timer: {} min': 'Таймер сна: {} мин',
    'Sleep timer: until {}': 'Таймер сна: до {}',
    'Alarm set for {}': 'Будильник установлен на {}',
    'Alarm — playback started': 'Будильник — воспроизведение запущено',
    'Recording': 'Запись',
    'Split recording into one file per track': 'Разделять запись на файлы по трекам',
    'Ask where to save each recording': 'Спрашивать, куда сохранять каждую запись',
    'Recordings folder': 'Папка для записей',
    'Choose…': 'Выбрать…',
    'Not set': 'Не задана',
    'Recording started': 'Запись начата',
    'Recording saved': 'Запись сохранена',
    'Recording failed: {}': 'Ошибка записи: {}',
    'Recording is only available in the desktop app': 'Запись доступна только в настольном приложении',
    'Start playing a station first': 'Сначала запустите станцию',
    'Insecure connection: TLS certificate not verified': 'Небезопасное соединение: TLS-сертификат не проверен',
    'Application': 'Приложение',
    'Keep playing in the tray when the window is closed': 'Оставлять играть в трее при закрытии окна',
    'Launch at system startup': 'Запускать при старте системы',
    'Song-change notifications': 'Уведомления о смене трека',
    'Notifications are blocked in system settings': 'Уведомления заблокированы в настройках системы',
    'Keyboard shortcuts': 'Горячие клавиши',
    'Play / stop': 'Играть / стоп',
    'Volume up / down': 'Громкость выше / ниже',
    'Previous / next station': 'Предыдущая / следующая станция',
    'Toggle favorite': 'В избранное / из избранного',
    'Focus the search box': 'Перейти к поиску',
    'Blacklisted stations': 'Скрытые станции',
    'Stations hidden from search results. Unhide to bring one back.':
        'Станции, скрытые из результатов поиска. Нажмите «Показать», чтобы вернуть.',
    'No hidden stations': 'Скрытых станций нет',
    'Unhide': 'Показать',
    'Backup': 'Резервная копия',
    'Save all your favorites, stations, history, genres and settings to one file, or restore them from one.':
        'Сохраните избранное, станции, историю, жанры и настройки в один файл или восстановите их из него.',
    'Export backup': 'Экспорт копии',
    'Import backup': 'Импорт копии',
    'Backup saved': 'Резервная копия сохранена',
    'Backup restored': 'Резервная копия восстановлена',
    'This file is not a backup of this app': 'Этот файл не является копией данных приложения',
    'Backup failed: {}': 'Не удалось создать копию: {}',
    'Restore failed: {}': 'Не удалось восстановить: {}',
    'About': 'О программе',
    'Internet Radio Player': 'Интернет-радио',
    'A modern radio player with CORS bypass and HTTPS metadata support.':
        'Современный радиоплеер с обходом CORS и поддержкой HTTPS-метаданных.',
    'Built with Tauri v2 + Rust + HTML5 Audio.': 'Создан на Tauri v2 + Rust + HTML5 Audio.',
    'Check for updates': 'Проверить обновления',
    'Checking…': 'Проверка…',
    'Restart now': 'Перезапустить',
    'Installing…': 'Установка…',
    'Updates are available in the desktop app only': 'Обновления доступны только в настольном приложении',
    'Initialization failed: {}': 'Ошибка инициализации: {}',
    'Genre is empty or already added': 'Жанр пуст или уже добавлен',
    'Added “{}” to genres': 'Жанр «{}» добавлен',
    'Install v{}': 'Установить v{}',
    'Update available: v{} (current v{})': 'Доступно обновление: v{} (сейчас v{})',
    'Downloading {}…': 'Загрузка {}…',
    'You are on the latest version (v{})': 'У вас последняя версия (v{})',
    'Starting download…': 'Начало загрузки…',
    'v{} installed. Restart to apply.': 'v{} установлена. Перезапустите для применения.',
    'Update check failed: {}': 'Не удалось проверить обновления: {}',
    'Install failed: {}': 'Не удалось установить: {}'
};

const DICTIONARIES = { ru: RU };

let current = 'en';
// Compiled `{}` patterns per language: [{ re, template }].
const patternCache = new Map();

// Resolve a preference ('auto' | 'en' | 'ru') to a concrete supported language.
export function resolveLanguage(pref) {
    if (pref === 'en' || pref === 'ru') return pref;
    const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
    return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
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
