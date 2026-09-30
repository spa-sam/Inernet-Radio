// Unit tests for the pure parts of the language, theme, shortcut, backup and
// path helpers. Same conventions as parsers.test.js: built-in Node runner, with
// minimal window/navigator stubs for modules that probe them at load time.

import test from 'node:test';
import assert from 'node:assert/strict';

if (!('window' in globalThis)) globalThis.window = {};
if (!('navigator' in globalThis)) globalThis.navigator = { userAgent: 'node' };

const i18n = await import('../src/js/core/i18n.js');
const { actionForKey } = await import('../src/js/core/keymap.js');
const { resolveTheme, isValidColor } = await import('../src/js/ui/theme.js');
const backup = await import('../src/js/core/backupFormat.js');
const { joinPath } = await import('../src/js/core/util.js');

// --- i18n --------------------------------------------------------------------

test('English returns text untouched', () => {
    i18n.setLanguage('en');
    assert.equal(i18n.t('Play'), 'Play');
    assert.equal(i18n.t('Hid Jazz FM'), 'Hid Jazz FM');
});

test('Ukrainian translates exact keys and falls back to English for unknown text', () => {
    i18n.setLanguage('uk');
    assert.equal(i18n.t('Play'), 'Грати');
    assert.equal(i18n.t('Some station name'), 'Some station name');
    i18n.setLanguage('en');
});

test('Ukrainian patterns substitute captured text, in order', () => {
    i18n.setLanguage('uk');
    assert.equal(i18n.t('Hid Jazz FM'), 'Сховано: Jazz FM');
    assert.equal(i18n.t('Update available: v1.2.0 (current v1.1.0)'),
        'Доступне оновлення: v1.2.0 (зараз v1.1.0)');
    assert.equal(i18n.t('Remove Rock.FM (HD) from favorites'), 'Прибрати «Rock.FM (HD)» з обраного');
    i18n.setLanguage('en');
});

test('resolveLanguage honours an explicit choice and otherwise follows the system', () => {
    assert.equal(i18n.resolveLanguage('en'), 'en');
    assert.equal(i18n.resolveLanguage('uk'), 'uk');
    assert.ok(['en', 'uk'].includes(i18n.resolveLanguage('auto')));
    // Russian is not offered: a stale saved 'ru' is treated as "auto"
    assert.notEqual(i18n.resolveLanguage('ru'), 'ru');
    assert.ok(['en', 'uk'].includes(i18n.resolveLanguage('ru')));
});

test('every Ukrainian entry keeps the same number of {} slots as its key', () => {
    // Indirect check: translating a key built from filler text must not leave
    // a stray "{}" behind.
    i18n.setLanguage('uk');
    for (const sample of ['Hid x', 'Sleep timer: 15 min', 'Alarm set for 07:00', 'Stop recording — REC 00:01']) {
        assert.ok(!i18n.t(sample).includes('{}'), sample);
    }
    i18n.setLanguage('en');
});

// --- theme -------------------------------------------------------------------

test('resolveTheme follows the system only for "system"', () => {
    assert.equal(resolveTheme('light', false), 'light');
    assert.equal(resolveTheme('dark', true), 'dark');
    assert.equal(resolveTheme('system', true), 'light');
    assert.equal(resolveTheme('system', false), 'dark');
    assert.equal(resolveTheme('nonsense', true), 'dark');
});

test('isValidColor accepts only #rrggbb', () => {
    assert.ok(isValidColor('#ff5a36'));
    assert.ok(!isValidColor('#f53'));
    assert.ok(!isValidColor('red'));
    assert.ok(!isValidColor('url(javascript:1)'));
    assert.ok(!isValidColor(null));
});

// --- keyboard shortcuts ------------------------------------------------------

const idle = { typing: false, interactive: false };

test('shortcuts: plain keys map to actions when nothing is focused', () => {
    assert.equal(actionForKey({ key: ' ' }, idle), 'play');
    assert.equal(actionForKey({ key: 'ArrowUp' }, idle), 'volume-up');
    assert.equal(actionForKey({ key: 'ArrowDown' }, idle), 'volume-down');
    assert.equal(actionForKey({ key: 'ArrowRight' }, idle), 'next');
    assert.equal(actionForKey({ key: 'ArrowLeft' }, idle), 'prev');
    assert.equal(actionForKey({ key: 'm' }, idle), 'mute');
    assert.equal(actionForKey({ key: 'F' }, idle), 'favorite');
    assert.equal(actionForKey({ key: '/' }, idle), 'search');
});

test('shortcuts: typing in a field disables them all', () => {
    const typing = { typing: true, interactive: true };
    for (const key of [' ', 'm', 'n', '/', 'ArrowUp']) assert.equal(actionForKey({ key }, typing), null);
});

test('shortcuts: a focused control keeps Space and the arrows, but letters still work', () => {
    const onButton = { typing: false, interactive: true };
    assert.equal(actionForKey({ key: ' ' }, onButton), null);
    assert.equal(actionForKey({ key: 'ArrowUp' }, onButton), null);
    assert.equal(actionForKey({ key: 'm' }, onButton), 'mute');
});

test('shortcuts: modifier combinations are left to the OS / browser', () => {
    assert.equal(actionForKey({ key: 'm', ctrlKey: true }, idle), null);
    assert.equal(actionForKey({ key: 'f', metaKey: true }, idle), null);
    assert.equal(actionForKey({ key: 'n', altKey: true }, idle), null);
});

// --- backup ------------------------------------------------------------------

const station = (id, url = 'https://x/stream') => ({ stationuuid: id, name: id, url });

test('isBackup recognises only its own format', () => {
    assert.ok(backup.isBackup({ format: backup.BACKUP_FORMAT }));
    assert.ok(!backup.isBackup([]));
    assert.ok(!backup.isBackup(null));
    assert.ok(!backup.isBackup({ format: 'something-else' }));
});

test('mergeStations adds new valid stations and skips duplicates and bad URLs', () => {
    const existing = [station('a')];
    const added = backup.mergeStations(existing, [
        station('a'),
        station('b'),
        station('b'),
        station('c', 'javascript:alert(1)'),
        { name: 'no id', url: 'https://x' },
        null
    ]);
    assert.deepEqual(added.map((s) => s.stationuuid), ['b']);
    assert.deepEqual(existing.map((s) => s.stationuuid), ['a', 'b']);
});

test('mergeStations tolerates a non-array payload', () => {
    assert.deepEqual(backup.mergeStations([], undefined), []);
    assert.deepEqual(backup.mergeStations([], { not: 'an array' }), []);
});

test('buildBackup captures every collection and the settings', () => {
    const state = {
        appVersion: '1.1.0', favorites: [station('a')], customStations: [], blacklist: [],
        trackHistory: [], lastStation: null, settings: { volume: 40 }
    };
    const b = backup.buildBackup(state);
    assert.equal(b.format, backup.BACKUP_FORMAT);
    assert.equal(b.settings.volume, 40);
    assert.equal(b.favorites.length, 1);
    assert.ok(!Number.isNaN(Date.parse(b.exportedAt)));
});

test('restorableSettings keeps only known keys of the right type', () => {
    const defaults = { volume: 70, theme: 'dark', eqGains: [0], genrePresets: null, sources: { a: true } };
    const out = backup.restorableSettings({
        volume: 40, theme: 5, eqGains: 'x', genrePresets: [{ genre: 'rock' }],
        sources: { a: false }, evil: 1, recordDir: '/etc', closeToTray: true
    }, defaults);
    assert.deepEqual(out, { volume: 40, genrePresets: [{ genre: 'rock' }], sources: { a: false } });
});

test('restorableSettings never restores machine-specific or prototype keys', () => {
    const defaults = { recordDir: '', recordAskPath: true, closeToTray: false, compactMode: false, ['__proto__x']: 1 };
    const incoming = JSON.parse('{"recordDir":"/x","recordAskPath":false,"closeToTray":true,"compactMode":true,"__proto__":{"polluted":1}}');
    const out = backup.restorableSettings(incoming, defaults);
    assert.deepEqual(out, {});
    assert.equal({}.polluted, undefined);
    assert.deepEqual(backup.restorableSettings(null, defaults), {});
});

test('safeFavicon accepts plain http(s) URLs only', () => {
    assert.equal(backup.safeFavicon('https://x.fm/logo.png'), 'https://x.fm/logo.png');
    assert.equal(backup.safeFavicon('javascript:alert(1)'), '');
    assert.equal(backup.safeFavicon('file:///etc/passwd'), '');
    assert.equal(backup.safeFavicon('https://x.fm/a") , url("https://evil'), '');
    assert.equal(backup.safeFavicon(42), '');
});

test('mergeStations cleans the favicon of imported stations', () => {
    const existing = [];
    backup.mergeStations(existing, [{ stationuuid: 'a', name: 'A', url: 'https://x/s', favicon: "javascript:1" }]);
    assert.equal(existing[0].favicon, '');
});

test('cssUrl percent-encodes anything that could break out of url("")', async () => {
    const { cssUrl } = await import('../src/js/core/favicon.js');
    const css = cssUrl('https://x/a") , url("https://evil/b c');
    assert.ok(css.startsWith('url("') && css.endsWith('")'));
    const inner = css.slice(5, -2);
    assert.ok(!/["'() ]/.test(inner), inner);
});

// --- paths -------------------------------------------------------------------

test('joinPath keeps the separator style of the folder', () => {
    assert.equal(joinPath('/home/me/Music', 'a.mp3'), '/home/me/Music/a.mp3');
    assert.equal(joinPath('/home/me/Music/', 'a.mp3'), '/home/me/Music/a.mp3');
    assert.equal(joinPath('C:\\Users\\me\\Music', 'a.mp3'), 'C:\\Users\\me\\Music\\a.mp3');
    assert.equal(joinPath('C:\\Users\\me\\Music\\', 'a.mp3'), 'C:\\Users\\me\\Music\\a.mp3');
});
