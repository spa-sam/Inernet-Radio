// audio.js — Web Audio graph: source -> EQ chain -> compressor -> analyser.
// The graph is created once on first playback and is independent of the
// visualizer, so the equalizer works even when the visualizer is off.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { EQ_BANDS, EQ_PRESETS } from '../core/constants.js';
import { saveSetting } from '../core/db.js';

// Build the audio graph once. createMediaElementSource can only be called
// once per media element, hence the idempotent guard.
export function ensureAudioGraph() {
    if (state.audioContext) return;

    try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;
        state.analyser.smoothingTimeConstant = 0.8;
        state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);
        state.smoothedData = new Float32Array(state.analyser.frequencyBinCount);

        state.sourceNode = state.audioContext.createMediaElementSource(dom.audioPlayer);

        state.eqFilters = EQ_BANDS.map((band) => {
            const filter = state.audioContext.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.freq;
            filter.Q.value = 1;
            filter.gain.value = 0;
            return filter;
        });

        state.compressorNode = state.audioContext.createDynamicsCompressor();

        let node = state.sourceNode;
        state.eqFilters.forEach((filter) => {
            node.connect(filter);
            node = filter;
        });
        node.connect(state.compressorNode);
        state.compressorNode.connect(state.analyser);
        state.analyser.connect(state.audioContext.destination);

        applyEqGains();
        applyNormalization();
    } catch (error) {
        console.error('Audio graph setup error:', error);
    }
}

// Prepare the graph for playback. On WebKit (macOS WKWebView) the
// MediaElementAudioSourceNode must exist and the context must be running
// *before* the media element starts playing, otherwise WebKit routes audio
// straight to the output and the EQ/compressor chain is bypassed. Chromium
// (WebView2 on Windows) is lenient about ordering, but calling this early is
// safe on both. Must run inside a user-gesture call stack so resume() sticks.
export function prepareAudioGraph() {
    ensureAudioGraph();
    if (state.audioContext && state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }
}

// Drive the compressor as a loudness leveller. When disabled it is configured
// transparently (ratio 1), so it can stay wired into the graph permanently.
export function applyNormalization() {
    const compressor = state.compressorNode;
    if (!compressor) return;
    if (state.settings.normalizeEnabled) {
        compressor.threshold.value = -24;
        compressor.knee.value = 30;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
    } else {
        compressor.threshold.value = 0;
        compressor.knee.value = 0;
        compressor.ratio.value = 1;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
    }
}

// Push the current equalizer settings onto the filter chain. When the EQ is
// disabled every band is forced flat (0 dB), so the chain stays transparent.
export function applyEqGains() {
    if (!state.eqFilters.length) return;
    state.eqFilters.forEach((filter, i) => {
        const gain = state.settings.eqEnabled ? (state.settings.eqGains[i] || 0) : 0;
        filter.gain.value = gain;
    });
}

// Build the per-band sliders once and reflect the saved EQ state.
export function buildEqUi() {
    if (!dom.eqBandsContainer) return;

    // Migrate saved gains whose band count differs from the current set
    // (e.g. upgrading from the older 5-band EQ): reset to flat.
    if (!Array.isArray(state.settings.eqGains) ||
        state.settings.eqGains.length !== EQ_BANDS.length) {
        state.settings.eqGains = EQ_BANDS.map(() => 0);
        saveSetting('eqGains', state.settings.eqGains);
    }

    dom.eqBandsContainer.innerHTML = '';

    EQ_BANDS.forEach((band, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'eq-band';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'custom-slider eq-slider';
        slider.min = '-12';
        slider.max = '12';
        slider.step = '1';
        slider.value = String(state.settings.eqGains[i] || 0);
        slider.dataset.band = String(i);
        slider.addEventListener('input', onEqSliderInput);

        const label = document.createElement('span');
        label.className = 'eq-band-label';
        label.textContent = band.label;

        wrap.appendChild(slider);
        wrap.appendChild(label);
        dom.eqBandsContainer.appendChild(wrap);
    });

    dom.eqEnabledCheckbox.checked = state.settings.eqEnabled;
    updateEqDisabledState();
}

// Dim and disable the band sliders/preset when the EQ is switched off.
export function updateEqDisabledState() {
    const off = !state.settings.eqEnabled;
    dom.eqBandsContainer.classList.toggle('disabled', off);
    dom.eqPresetSelect.disabled = off;
    dom.eqBandsContainer.querySelectorAll('.eq-slider').forEach((s) => { s.disabled = off; });
}

function onEqSliderInput(e) {
    const i = parseInt(e.target.dataset.band, 10);
    state.settings.eqGains[i] = parseInt(e.target.value, 10);
    applyEqGains();
    saveSetting('eqGains', state.settings.eqGains);
}

export function toggleEq() {
    state.settings.eqEnabled = dom.eqEnabledCheckbox.checked;
    saveSetting('eqEnabled', state.settings.eqEnabled);
    updateEqDisabledState();
    applyEqGains();
}

export function applyEqPreset() {
    const preset = EQ_PRESETS[dom.eqPresetSelect.value];
    if (!preset) return;
    state.settings.eqGains = preset.slice();
    dom.eqBandsContainer.querySelectorAll('.eq-slider').forEach((s, i) => {
        s.value = String(state.settings.eqGains[i]);
    });
    applyEqGains();
    saveSetting('eqGains', state.settings.eqGains);
}

export function toggleNormalization() {
    state.settings.normalizeEnabled = dom.normalizeCheckbox.checked;
    saveSetting('normalizeEnabled', state.settings.normalizeEnabled);
    applyNormalization();
}
