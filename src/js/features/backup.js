// backup.js — one-file backup of everything the app stores: favourites, custom
// stations, hidden stations, track history and settings. Restoring merges into
// the current data (stations already present are kept) and overwrites settings,
// then reloads so every module starts from the restored state.

import { state } from '../core/state.js';
import { saveSetting, saveFavoritesBatch, saveCustomBatch, saveBlacklist, saveTrackHistoryEntry } from '../core/db.js';
import { toast } from '../ui/ui.js';
import { exportToJson } from './stations/io.js';
import { isBackup, mergeStations, buildBackup, restorableSettings } from '../core/backupFormat.js';

export async function exportBackup() {
    try {
        const stamp = new Date().toISOString().slice(0, 10);
        await exportToJson(buildBackup(state), `internet-radio-backup-${stamp}.json`);
        toast('Backup saved', 'success');
    } catch (e) {
        toast('Backup failed: ' + (e && e.message ? e.message : e), 'error');
    }
}

export async function restoreBackup(data) {
    if (!isBackup(data)) {
        toast('This file is not a backup of this app', 'error');
        return false;
    }
    try {
        await saveFavoritesBatch(mergeStations(state.favorites, data.favorites), state.favorites);
        await saveCustomBatch(mergeStations(state.customStations, data.customStations), state.customStations);

        const have = new Set(state.blacklist.map((b) => b.stationuuid));
        for (const entry of Array.isArray(data.blacklist) ? data.blacklist : []) {
            if (!entry || !entry.stationuuid || have.has(entry.stationuuid)) continue;
            have.add(entry.stationuuid);
            state.blacklist.push({ stationuuid: entry.stationuuid, name: entry.name || '' });
            await saveBlacklist(entry, state.blacklist);
        }

        const seen = new Set(state.trackHistory.map((h) => `${h.timestamp}|${h.title}`));
        // Oldest first so the newest 50 survive the store's trim.
        const history = (Array.isArray(data.trackHistory) ? data.trackHistory : []).slice().reverse();
        for (const entry of history) {
            if (!entry || !entry.title || seen.has(`${entry.timestamp}|${entry.title}`)) continue;
            state.trackHistory.unshift(entry);
            await saveTrackHistoryEntry(entry, state.trackHistory);
        }

        for (const [key, value] of Object.entries(restorableSettings(data.settings, state.settings))) {
            await saveSetting(key, value);
        }
        toast('Backup restored', 'success');
        // Give the toast a moment, then start clean from the restored data.
        setTimeout(() => location.reload(), 900);
        return true;
    } catch (e) {
        toast('Restore failed: ' + (e && e.message ? e.message : e), 'error');
        return false;
    }
}

export function importBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            await restoreBackup(JSON.parse(e.target.result));
        } catch (err) {
            toast('Restore failed: ' + (err && err.message ? err.message : err), 'error');
        }
    };
    reader.readAsText(file);
}
