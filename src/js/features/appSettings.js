// appSettings.js — desktop-app behaviour settings: keep playing in the tray on
// close, launch at login, song-change notifications, and the recordings folder.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { hasTauriApi } from '../core/util.js';
import { saveSetting } from '../core/db.js';
import { toast } from '../ui/ui.js';
import { requestNotificationPermission, notificationsEnabled } from './player.js';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

export async function initAppSettings() {
    if (dom.notifySongsCheckbox) dom.notifySongsCheckbox.checked = notificationsEnabled();
    if (dom.recordAskPathCheckbox) dom.recordAskPathCheckbox.checked = state.settings.recordAskPath !== false;
    updateRecordDirLabel();

    const desktopOnly = document.querySelectorAll('[data-desktop-only]');
    if (!hasTauriApi) {
        desktopOnly.forEach((el) => el.classList.add('hidden'));
        return;
    }

    if (dom.closeToTrayCheckbox) dom.closeToTrayCheckbox.checked = !!state.settings.closeToTray;
    // The backend starts with the window closing for real; push the saved choice.
    try { await invoke('set_close_to_tray', { enabled: !!state.settings.closeToTray }); } catch (e) {
        console.warn('set_close_to_tray failed:', e);
    }
    if (dom.autostartCheckbox) {
        try { dom.autostartCheckbox.checked = await invoke('is_autostart_enabled'); } catch (e) {
            console.warn('is_autostart_enabled failed:', e);
            dom.autostartCheckbox.disabled = true;
        }
    }
}

export async function toggleCloseToTray() {
    const enabled = dom.closeToTrayCheckbox.checked;
    state.settings.closeToTray = enabled;
    saveSetting('closeToTray', enabled);
    if (!hasTauriApi) return;
    try { await invoke('set_close_to_tray', { enabled }); } catch (e) {
        console.warn('set_close_to_tray failed:', e);
    }
}

export async function toggleAutostart() {
    const enabled = dom.autostartCheckbox.checked;
    try {
        await invoke('set_autostart', { enabled });
    } catch (e) {
        dom.autostartCheckbox.checked = !enabled;
        toast(String(e && e.message ? e.message : e), 'error');
    }
}

export function toggleNotifySongs() {
    const enabled = dom.notifySongsCheckbox.checked;
    state.settings.notifySongs = enabled;
    saveSetting('notifySongs', enabled);
    if (!enabled) return;
    requestNotificationPermission();
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        toast('Notifications are blocked in system settings', 'error');
    }
}

// --- Recording folder -------------------------------------------------------

export function toggleRecordAskPath() {
    state.settings.recordAskPath = dom.recordAskPathCheckbox.checked;
    saveSetting('recordAskPath', state.settings.recordAskPath);
    updateRecordDirLabel();
}

export async function chooseRecordDir() {
    if (!hasTauriApi) return;
    try {
        const dir = await window.__TAURI__.dialog.open({ directory: true, multiple: false });
        if (!dir) return;
        state.settings.recordDir = dir;
        saveSetting('recordDir', dir);
        updateRecordDirLabel();
    } catch (e) {
        console.warn('Folder picker failed:', e);
    }
}

export function updateRecordDirLabel() {
    if (dom.recordDirLabel) dom.recordDirLabel.textContent = state.settings.recordDir || '—';
}
