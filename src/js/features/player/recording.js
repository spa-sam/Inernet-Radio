// Stream recording: start/stop via the Tauri backend and the REC button state.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { hasTauriApi, sanitizeFilename, recordingExtension } from '../../core/util.js';
import { toast } from '../../ui/ui.js';

export async function toggleRecording() {
    if (!hasTauriApi) {
        toast('Recording is only available in the desktop app', 'error');
        return;
    }
    if (state.isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

export async function startRecording() {
    if (!state.currentStation) {
        toast('Start playing a station first', 'error');
        return;
    }
    const { invoke } = window.__TAURI__.core;
    const { save } = window.__TAURI__.dialog;

    const ext = recordingExtension(state.currentStation);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const defaultName = `${sanitizeFilename(state.currentStation.name)}_${stamp}.${ext}`;

    try {
        const path = await save({
            defaultPath: defaultName,
            filters: [{ name: 'Audio', extensions: [ext] }]
        });
        if (!path) return;

        const url = state.currentStation.url_resolved || state.currentStation.url;
        const split = !!state.settings.recordSplit;
        await invoke('start_recording', { url, path, split });
        state.isRecording = true;
        updateRecordButton();
        // Reveal the REC indicator; progress events keep its text updated.
        if (dom.recStatus) {
            if (dom.recStatusText) dom.recStatusText.textContent = 'REC 00:00:00 · 0.0 MB';
            dom.recStatus.classList.remove('hidden');
        }
        toast('Recording started', 'info');
    } catch (error) {
        console.error('Recording start error:', error);
        toast('Recording failed: ' + (error && error.message ? error.message : error), 'error');
    }
}

export async function stopRecording() {
    if (!state.isRecording) return;
    const { invoke } = window.__TAURI__.core;
    try {
        await invoke('stop_recording');
    } catch (error) {
        console.error('Recording stop error:', error);
    }
    clearRecordingUi();
    toast('Recording saved', 'info');
}

// Tear the recording UI down after a backend-reported failure. No stop_recording
// call: the backend task has already ended, and the caller shows the error.
export function abortRecording() {
    if (!state.isRecording) return;
    clearRecordingUi();
}

function clearRecordingUi() {
    state.isRecording = false;
    updateRecordButton();
    if (dom.recStatus) dom.recStatus.classList.add('hidden');
}

function updateRecordButton() {
    if (!dom.recordBtn) return;
    dom.recordBtn.classList.toggle('recording', state.isRecording);
    dom.recordBtn.title = state.isRecording ? 'Stop recording' : 'Record stream';
}
