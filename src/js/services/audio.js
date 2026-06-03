// audio.js — Web Audio graph: source -> EQ chain -> compressor -> analyser.
// The graph is created once on first playback and is independent of the
// visualizer, so the equalizer works even when the visualizer is off.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { EQ_BANDS, EQ_PRESETS } from '../core/constants.js';
import { saveSetting } from '../core/db.js';

// Build the processing graph once, WITHOUT a source node:
//   eqFilters[0] → … → eqFilters[n] → compressor → analyser → masterGain → out
// The source is attached separately (a MediaElementSource on the <audio> path,
// or an AudioWorkletNode on the PCM path) so both can feed the same chain head
// (eqFilters[0]). masterGain stays at 1 on the <audio> path (where loudness is
// controlled via dom.audioPlayer.volume) and carries volume on the PCM path.
export function ensureAudioGraph() {
    if (state.audioContext) return;

    try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;
        state.analyser.smoothingTimeConstant = 0.8;
        state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);
        state.smoothedData = new Float32Array(state.analyser.frequencyBinCount);

        state.eqFilters = EQ_BANDS.map((band) => {
            const filter = state.audioContext.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.freq;
            filter.Q.value = 1;
            filter.gain.value = 0;
            return filter;
        });

        state.compressorNode = state.audioContext.createDynamicsCompressor();
        state.masterGain = state.audioContext.createGain();
        state.masterGain.gain.value = 1;

        let node = state.eqFilters[0];
        for (let i = 1; i < state.eqFilters.length; i++) {
            node.connect(state.eqFilters[i]);
            node = state.eqFilters[i];
        }
        node.connect(state.compressorNode);
        state.compressorNode.connect(state.analyser);
        state.analyser.connect(state.masterGain);
        state.masterGain.connect(state.audioContext.destination);

        applyEqGains();
        applyNormalization();
    } catch (error) {
        console.error('Audio graph setup error:', error);
    }
}

// Attach the <audio> element as the graph source (Chromium / non-PCM path).
// createMediaElementSource can only be called once per element, hence the guard.
export function ensureMediaElementSource() {
    if (!state.audioContext || state.sourceNode) return;
    try {
        state.sourceNode = state.audioContext.createMediaElementSource(dom.audioPlayer);
        state.sourceNode.connect(state.eqFilters[0]);
    } catch (error) {
        console.error('MediaElementSource setup error:', error);
    }
}

// Load the PCM worklet module once (idempotent).
export async function ensurePcmWorklet() {
    ensureAudioGraph();
    if (state.workletReady) return;
    await state.audioContext.audioWorklet.addModule('worklets/pcm-player.js');
    state.workletReady = true;
}

// Create a fresh AudioWorkletNode for the PCM path and wire it into the chain
// head. Returns the node so the caller can push PCM to its port. Any previous
// worklet node is disconnected first.
export function connectPcmWorklet() {
    if (state.workletNode) {
        try { state.workletNode.disconnect(); } catch { /* already gone */ }
        state.workletNode = null;
    }
    state.workletNode = new AudioWorkletNode(state.audioContext, 'pcm-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { prebufferFrames: Math.floor(state.audioContext.sampleRate * 0.4) }
    });
    state.workletNode.connect(state.eqFilters[0]);
    return state.workletNode;
}

// Tear down the PCM worklet source (on stop / switching away from PCM path).
export function disconnectPcmWorklet() {
    if (state.workletNode) {
        try { state.workletNode.port.postMessage({ type: 'reset' }); } catch { /* noop */ }
        try { state.workletNode.disconnect(); } catch { /* noop */ }
        state.workletNode = null;
    }
    state.workletActive = false;
}

// Prepare the graph for playback. On WebKit (macOS WKWebView) the
// MediaElementAudioSourceNode must exist and the context must be running
// *before* the media element starts playing, otherwise WebKit routes audio
// straight to the output and the EQ/compressor chain is bypassed. Chromium
// (WebView2 on Windows) is lenient about ordering, but calling this early is
// safe on both. Must run inside a user-gesture call stack so resume() sticks.
export function prepareAudioGraph() {
    ensureAudioGraph();
    // The <audio> element is the source on this path.
    ensureMediaElementSource();
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
