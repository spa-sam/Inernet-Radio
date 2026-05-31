// Volume control and fade animation for the audio element.

import { state } from '../../core/state.js';
import { dom } from '../../core/dom.js';

export function setVolume(volume) {
    // An explicit volume change overrides any running fade animation
    cancelFade();
    volume = Math.max(0, Math.min(100, parseInt(volume) || 0));
    dom.volumeSlider.value = volume;
    dom.audioPlayer.volume = volume / 100;
    // Drive the slider fill gradient and the percentage label
    dom.volumeSlider.style.setProperty('--vol', volume + '%');
    dom.volumeValueLabel.textContent = volume + '%';
    dom.volumeBar.classList.toggle('muted', volume === 0);
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
    const start = dom.audioPlayer.volume;
    const delta = target - start;
    if (Math.abs(delta) < 0.005) {
        dom.audioPlayer.volume = target;
        if (onDone) onDone();
        return;
    }
    const startTime = performance.now();
    const FADE_DURATION = 600; // ms
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / FADE_DURATION);
        const eased = 1 - Math.pow(1 - t, 2); // ease-out
        dom.audioPlayer.volume = Math.max(0, Math.min(1, start + delta * eased));
        if (t < 1) {
            state.fadeRAF = requestAnimationFrame(step);
        } else {
            state.fadeRAF = null;
            dom.audioPlayer.volume = target;
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
