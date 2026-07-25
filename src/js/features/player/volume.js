// Volume control and fade animation for the audio element.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';
import { FADE_DURATION } from '../../core/constants.js';
import { saveSetting } from '../../core/db.js';

// Read/write the active output level (0..1). On the PCM path loudness lives on
// the master GainNode (the <audio> element is silent there); otherwise it is the
// <audio> element's own volume. This keeps volume/fade working on both paths.
function getOutputLevel() {
    if (state.workletActive && state.masterGain) return state.masterGain.gain.value;
    return dom.audioPlayer.volume;
}

export function setOutputLevel(v) {
    v = Math.max(0, Math.min(1, v));
    if (state.workletActive && state.masterGain) {
        state.masterGain.gain.value = v;
    } else {
        dom.audioPlayer.volume = v;
    }
}

// Apply a volume level (0..100) to the UI and the output. `persist` is false
// for programmatic restores so replaying the saved value is not written back.
export function setVolume(volume, persist = true) {
    // An explicit volume change overrides any running fade animation
    cancelFade();
    volume = Math.max(0, Math.min(100, parseInt(volume) || 0));
    dom.volumeSlider.value = volume;
    setOutputLevel(volume / 100);
    // Drive the slider fill gradient and the percentage label
    dom.volumeSlider.style.setProperty('--vol', volume + '%');
    dom.volumeValueLabel.textContent = volume + '%';
    dom.volumeBar.classList.toggle('muted', volume === 0);

    if (persist && state.settings.volume !== volume) {
        state.settings.volume = volume;
        saveSetting('volume', volume);
    }
}

// Restore the persisted volume at startup (and the pre-mute level, so
// unmuting after a restart returns to the level the user last chose).
export function restoreVolume() {
    const saved = parseInt(state.settings.volume, 10);
    const volume = Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 70;
    if (volume > 0) state.lastVolumeBeforeMute = volume;
    setVolume(volume, false);
}

// The user's chosen volume as a 0..1 gain (independent of any active fade)
export function targetVolume() {
    return Math.max(0, Math.min(100, parseInt(dom.volumeSlider.value) || 0)) / 100;
}

export function cancelFade() {
    if (state.fadeRAF) {
        cancelAnimationFrame(state.fadeRAF);
        state.fadeRAF = null;
    }
}

// Ramp audioPlayer.volume to `target` (0..1) over FADE_DURATION, then run onDone.
// onDone only fires on natural completion — a superseding fade cancels it.
export function fadeTo(target, onDone) {
    cancelFade();
    target = Math.max(0, Math.min(1, target));
    const start = getOutputLevel();
    const delta = target - start;
    if (Math.abs(delta) < 0.005) {
        setOutputLevel(target);
        if (onDone) onDone();
        return;
    }
    const startTime = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / FADE_DURATION);
        const eased = 1 - Math.pow(1 - t, 2); // ease-out
        setOutputLevel(start + delta * eased);
        if (t < 1) {
            state.fadeRAF = requestAnimationFrame(step);
        } else {
            state.fadeRAF = null;
            setOutputLevel(target);
            if (onDone) onDone();
        }
    };
    state.fadeRAF = requestAnimationFrame(step);
}

export function toggleMute() {
    const current = parseInt(dom.volumeSlider.value);
    if (current > 0) {
        state.lastVolumeBeforeMute = current;
        setVolume(0);
    } else {
        setVolume(state.lastVolumeBeforeMute > 0 ? state.lastVolumeBeforeMute : 70);
    }
}
