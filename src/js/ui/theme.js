// theme.js — colour theme (system / dark / light) and the accent colour.

import { state } from '../core/state.js';
import { saveSetting } from '../core/db.js';

export const DEFAULT_ACCENT = '#ff5a36';
export const THEMES = ['system', 'dark', 'light'];

const prefersLight = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

// 'system' follows the OS; anything unrecognised falls back to dark.
export function resolveTheme(pref, systemIsLight) {
    if (pref === 'light' || pref === 'dark') return pref;
    if (pref === 'system') return systemIsLight ? 'light' : 'dark';
    return 'dark';
}

export function isValidColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function applyTheme() {
    const theme = resolveTheme(state.settings.theme, !!(prefersLight && prefersLight.matches));
    document.documentElement.dataset.theme = theme;
}

export function applyAccent() {
    const accent = isValidColor(state.settings.accent) ? state.settings.accent : DEFAULT_ACCENT;
    document.documentElement.style.setProperty('--accent', accent);
}

export function setTheme(pref) {
    state.settings.theme = THEMES.includes(pref) ? pref : 'system';
    saveSetting('theme', state.settings.theme);
    applyTheme();
}

export function setAccent(color) {
    if (!isValidColor(color)) return;
    state.settings.accent = color;
    saveSetting('accent', color);
    applyAccent();
}

// Re-resolve "System" when the OS flips between light and dark.
export function watchSystemTheme() {
    if (!prefersLight) return;
    const onChange = () => { if (state.settings.theme === 'system') applyTheme(); };
    if (prefersLight.addEventListener) prefersLight.addEventListener('change', onChange);
}
