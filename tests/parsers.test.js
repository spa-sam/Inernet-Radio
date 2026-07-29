// Unit tests for the frontend's pure helpers, run with the built-in Node test
// runner (`npm test`) — no test framework, matching the dependency-free setup.
//
// util.js reads `window` / `navigator` at module scope to detect the Tauri
// runtime and the WebKit engine, so minimal stubs are installed before it is
// imported. Everything tested here is otherwise DOM-free.

import test from 'node:test';
import assert from 'node:assert/strict';

if (!('window' in globalThis)) globalThis.window = {};
// Node ≥21 already exposes a read-only `navigator`; only stub it when missing.
if (!('navigator' in globalThis)) globalThis.navigator = { userAgent: 'node' };

const { parseM3U, parsePLS, hasStationNames } = await import('../src/js/core/playlist.js');
const { applySavedOrder } = await import('../src/js/core/db.js');
const { EQ_BANDS, EQ_PRESETS } = await import('../src/js/core/constants.js');
const {
    formatTimer, sanitizeFilename, recordingExtension, getFaviconFromUrl, adjustBrightness
} = await import('../src/js/core/util.js');

// --- playlist parsing -------------------------------------------------------

test('parseM3U reads EXTINF names and tvg-logo', () => {
    const text = [
        '#EXTM3U',
        '#EXTINF:-1 tvg-logo="http://x/logo.png",Jazz FM',
        'http://stream.fm/jazz',
        '#EXTINF:-1,Rock FM',
        'https://stream.fm/rock'
    ].join('\n');
    assert.deepEqual(parseM3U(text), [
        { name: 'Jazz FM', url: 'http://stream.fm/jazz', favicon: 'http://x/logo.png' },
        { name: 'Rock FM', url: 'https://stream.fm/rock', favicon: '' }
    ]);
});

test('parseM3U falls back to the URL when there is no EXTINF', () => {
    const entries = parseM3U('http://stream.fm/live\r\n');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'http://stream.fm/live');
});

test('parseM3U ignores comments and blank lines', () => {
    assert.deepEqual(parseM3U('#EXTM3U\n\n#SOMETHING\n'), []);
});

// Guards the M3U search index against the repo's "lite" aggregates, which are
// bare URL lists — every station would end up named after its own stream URL.
test('hasStationNames rejects a playlist whose entries are named after their URL', () => {
    const bare = parseM3U('http://a.fm/1\nhttp://b.fm/2\nhttp://c.fm/3\n');
    assert.equal(hasStationNames(bare), false);
    assert.equal(hasStationNames([]), false);
});

test('hasStationNames accepts a playlist that is mostly named', () => {
    const mixed = parseM3U(
        '#EXTINF:-1,Alpha\nhttp://a.fm/1\n' +
        '#EXTINF:-1,Beta\nhttp://b.fm/2\n' +
        'http://c.fm/3\n'
    );
    assert.equal(hasStationNames(mixed), true);
});

test('parsePLS pairs FileN with TitleN', () => {
    const text = '[playlist]\nFile1=http://a.fm/1\nTitle1=Alpha\nFile2=http://b.fm/2\n';
    assert.deepEqual(parsePLS(text), [
        { name: 'Alpha', url: 'http://a.fm/1' },
        { name: 'http://b.fm/2', url: 'http://b.fm/2' }
    ]);
});

// --- persistence helpers ----------------------------------------------------

test('applySavedOrder reorders known ids and appends unknown ones', () => {
    const list = [{ stationuuid: 'a' }, { stationuuid: 'b' }, { stationuuid: 'c' }];
    const ordered = applySavedOrder(list, ['c', 'a']);
    assert.deepEqual(ordered.map(s => s.stationuuid), ['c', 'a', 'b']);
});

test('applySavedOrder returns the list untouched without a saved order', () => {
    const list = [{ stationuuid: 'a' }, { stationuuid: 'b' }];
    assert.equal(applySavedOrder(list, []), list);
    assert.equal(applySavedOrder(list, null), list);
});

// --- equalizer configuration ------------------------------------------------

test('every EQ preset covers exactly the configured bands', () => {
    // A mismatch here is what silently discarded saved EQ curves on load.
    for (const [name, gains] of Object.entries(EQ_PRESETS)) {
        assert.equal(gains.length, EQ_BANDS.length, `preset "${name}" band count`);
    }
});

// --- misc helpers -----------------------------------------------------------

test('formatTimer pads hours, minutes and seconds', () => {
    assert.equal(formatTimer(0), '00:00:00');
    assert.equal(formatTimer(61), '00:01:01');
    assert.equal(formatTimer(3661), '01:01:01');
});

test('sanitizeFilename strips path characters and caps the length', () => {
    assert.equal(sanitizeFilename('AC/DC: Back?'), 'AC_DC_ Back_');
    assert.equal(sanitizeFilename(''), 'recording');
    assert.equal(sanitizeFilename('x'.repeat(200)).length, 80);
});

test('recordingExtension maps codecs to container extensions', () => {
    assert.equal(recordingExtension({ codec: 'AAC+' }), 'aac');
    assert.equal(recordingExtension({ codec: 'OGG' }), 'ogg');
    assert.equal(recordingExtension({ codec: 'FLAC' }), 'flac');
    assert.equal(recordingExtension({ codec: 'MP3' }), 'mp3');
    assert.equal(recordingExtension(null), 'mp3');
});

test('getFaviconFromUrl derives the host favicon and tolerates junk', () => {
    assert.equal(getFaviconFromUrl('https://radio.fm:8000/live'), 'https://radio.fm/favicon.ico');
    assert.equal(getFaviconFromUrl('not a url'), '');
});

test('adjustBrightness expands short hex and clamps at 255', () => {
    assert.equal(adjustBrightness('#0f0', 1), 'rgb(0, 255, 0)');
    assert.equal(adjustBrightness('#808080', 10), 'rgb(255, 255, 255)');
});
