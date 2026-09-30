// shortcuts.js — in-app keyboard shortcuts and the tray-menu actions.
//
//   Space        play / stop          M   mute            F   favourite
//   ↑ / ↓        volume ±5            N / →   next        P / ←   previous
//   /            focus the search box
//
// Letters and "/" work wherever focus is, unless a text field has it. Space and
// the arrow keys are left alone while a control that already uses them has
// focus (buttons, sliders, tabs, station rows), so they never double-fire.

import { dom } from '../core/dom.js';
import { hasTauriApi } from '../core/util.js';
import { actionForKey } from '../core/keymap.js';
import { togglePlay, nextStation, prevStation, toggleMute, setVolume } from './player.js';
import { toggleCurrentFavorite } from './stations.js';

const VOLUME_STEP = 5;

function focusContext(el) {
    const typing = !!(el.isContentEditable ||
        (el.closest && el.closest('input:not([type="range"]):not([type="checkbox"]):not([type="color"]), select, textarea')));
    const interactive = !!(el.closest &&
        el.closest('input, select, textarea, button, a, summary, [role="button"], [role="tab"], [role="slider"], [tabindex]'));
    return { typing, interactive };
}

export function runAction(action) {
    switch (action) {
        case 'play': case 'play_pause': togglePlay(); break;
        case 'next': nextStation(); break;
        case 'prev': prevStation(); break;
        case 'mute': toggleMute(); break;
        case 'favorite': toggleCurrentFavorite(); break;
        case 'volume-up': setVolume((parseInt(dom.volumeSlider.value, 10) || 0) + VOLUME_STEP); break;
        case 'volume-down': setVolume((parseInt(dom.volumeSlider.value, 10) || 0) - VOLUME_STEP); break;
        case 'search': {
            const tab = document.getElementById('tabbtn-radio');
            if (tab) tab.click();
            dom.searchInput.focus();
            dom.searchInput.select();
            break;
        }
        default: break;
    }
}

export function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || !e.target) return;
        const action = actionForKey(e, focusContext(e.target));
        if (!action) return;
        e.preventDefault();
        runAction(action);
    });

    // Tray menu → the same actions.
    if (hasTauriApi && window.__TAURI__.event) {
        window.__TAURI__.event.listen('tray-action', (event) => runAction(event.payload))
            .catch((e) => console.warn('tray-action listener failed:', e));
    }
}
