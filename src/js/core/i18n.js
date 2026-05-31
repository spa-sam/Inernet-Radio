// i18n.js — lightweight UI localization (English / Ukrainian).
//
// Two kinds of strings are handled:
//  1. Static markup — elements carry data-i18n / data-i18n-placeholder / data-i18n-title
//     attributes and applyI18n() fills them in.
//  2. Dynamic strings — produced in JS (toasts, status lines); call t(key, params).
//
// The full UI wiring (language switch, data-i18n attributes) is added with the
// localization feature; this module is the standalone foundation.

const STORAGE_KEY = 'uiLang';

// Translation tables. The English value doubles as the fallback, so any key
// missing from a non-English table degrades gracefully.
const STRINGS = {
    en: {},
    uk: {}
};

let currentLang = 'en';

// Resolve the initial language from a previously saved choice.
try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'uk') currentLang = saved;
} catch (_) { /* localStorage unavailable — stay on default */ }

export function getLang() {
    return currentLang;
}

// Translate a key for the active language. Unknown keys return the English
// value if present, otherwise the key itself. `params` interpolates {name}.
export function t(key, params) {
    const table = STRINGS[currentLang] || STRINGS.en;
    let str = table[key];
    if (str === undefined) str = STRINGS.en[key];
    if (str === undefined) str = key;
    if (params) {
        str = str.replace(/\{(\w+)\}/g, (m, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? params[name] : m);
    }
    return str;
}

// Register / extend translation tables (used by the feature wiring).
export function registerStrings(lang, table) {
    STRINGS[lang] = Object.assign(STRINGS[lang] || {}, table);
}

// Apply translations to all tagged elements in the document.
export function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
        el.title = t(el.getAttribute('data-i18n-title'));
    });
}

// Switch language, persist the choice, and re-apply translations.
export function setLang(lang) {
    if (lang !== 'en' && lang !== 'uk') return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
    document.documentElement.lang = lang;
    applyI18n();
}
