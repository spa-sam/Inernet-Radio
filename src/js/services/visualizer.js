// visualizer.js — canvas spectrum / waveform rendering driven by the analyser.

import { state } from '../core/state.js';
import { dom } from '../core/dom.js';
import { adjustBrightness } from '../core/util.js';
import { saveSetting } from '../core/db.js';
import { ensureAudioGraph } from './audio.js';

// Synthetic spectrum used as a fallback when the AnalyserNode returns no data.
// (WebKit/Safari silences the analyser for cross-origin media even with CORS,
// so on macOS the real bytes are all zero. Windows/Chromium has real data and
// never hits this path.) Produces an animated, bass-heavy spectrum.
function fillSyntheticSpectrum(arr) {
    const t = performance.now() / 1000;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
        const f = i / n;                       // 0 (low) .. 1 (high)
        const envelope = Math.pow(1 - f, 1.6); // louder lows, quieter highs
        const wobble =
            0.55 +
            0.30 * Math.sin(t * 2.1 + i * 0.35) +
            0.18 * Math.sin(t * 3.7 + i * 0.13) +
            0.12 * Math.sin(t * 5.3 + i * 0.07);
        const v = Math.max(0, Math.min(1, envelope * wobble));
        arr[i] = Math.round(v * 230);
    }
}

// Synthetic waveform (centred at 128) for the 'wave' style fallback.
function fillSyntheticWave(arr) {
    const t = performance.now() / 1000;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
        const x = i / n;
        const v = Math.sin(x * Math.PI * 4 + t * 4) * 0.4
                + Math.sin(x * Math.PI * 9 + t * 7) * 0.2;
        arr[i] = Math.round(128 + v * 110);
    }
}

function drawVisualization() {
    if (!state.settings.visualizerEnabled || !state.analyser) return;

    const canvas = dom.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const dataArray = state.dataArray;

    state.analyser.getByteFrequencyData(dataArray);

    // Detect a "dead" analyser (all zeros while playing — the WebKit/macOS
    // case) and switch to the synthetic animation. Real data resets it, so
    // Windows always shows the true spectrum.
    if (state.isPlaying) {
        let sum = 0;
        for (let k = 0; k < dataArray.length; k++) sum += dataArray[k];
        if (sum === 0) {
            state.vizZeroFrames = (state.vizZeroFrames || 0) + 1;
            if (state.vizZeroFrames > 30) state.vizFake = true;
        } else {
            state.vizZeroFrames = 0;
            state.vizFake = false;
        }
    }
    if (state.vizFake) fillSyntheticSpectrum(dataArray);

    ctx.clearRect(0, 0, width, height);

    const baseColor = state.settings.visualizerColor || '#00b894';
    const sensitivity = state.settings.visualizerSensitivity || 1.0;
    const style = state.settings.visualizerStyle || 'bars';

    if (style === 'bars' || style === 'peaks') {
        const numBars = 24;
        const barWidth = width / numBars;
        const gap = 3;
        const smoothing = 0.65;
        const usableDataLength = Math.floor(dataArray.length * 0.6);

        // Explicitly disable any blur left over from other presets
        ctx.shadowBlur = 0;

        // Initialise peaks and hold if missing or the bar count changed
        if (style === 'peaks' && (!state.barPeaks || state.barPeaks.length !== numBars)) {
            state.barPeaks = new Float32Array(numBars).fill(height);
            state.peakHold = new Int32Array(numBars).fill(0);
        }

        for (let i = 0; i < numBars; i++) {
            const startFreq = Math.floor((i / numBars) * usableDataLength);
            const endFreq = Math.floor(((i + 1) / numBars) * usableDataLength);

            let sum = 0;
            let count = Math.max(1, endFreq - startFreq);
            for (let j = startFreq; j < endFreq && j < usableDataLength; j++) {
                sum += dataArray[j];
            }
            const value = (sum / count) * sensitivity;

            if (state.smoothedData) {
                state.smoothedData[i] = state.smoothedData[i] * smoothing + value * (1 - smoothing);
            }

            const barHeight = Math.max(3, (state.smoothedData[i] / 255) * height);

            // Draw the main bar (crisp, no shadow)
            ctx.fillStyle = baseColor;

            const x = i * barWidth + gap / 2;
            const w = barWidth - gap;
            const y = height - barHeight;

            ctx.beginPath();
            ctx.roundRect(x, y, w, barHeight, [2, 2, 0, 0]);
            ctx.fill();

            // Peak effect (hold then fall)
            if (style === 'peaks') {
                const peakY = height - barHeight - 4; // Position above the bar

                if (peakY < state.barPeaks[i]) {
                    state.barPeaks[i] = peakY;
                    state.peakHold[i] = 30; // Hold time before the peak falls
                } else {
                    if (state.peakHold[i] > 0) {
                        state.peakHold[i]--;
                    } else {
                        state.barPeaks[i] += 1.5; // Slightly faster fall for sharpness
                    }
                }

                if (state.barPeaks[i] > height - 4) state.barPeaks[i] = height - 4;

                // Draw the peak in the same colour as the bar
                ctx.fillStyle = baseColor;
                ctx.beginPath();
                ctx.roundRect(x, state.barPeaks[i], w, 2, [0, 0, 0, 0]);
                ctx.fill();
            }
        }
    } else if (style === 'wave') {
        state.analyser.getByteTimeDomainData(dataArray);
        if (state.vizFake) fillSyntheticWave(dataArray);

        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = baseColor;
        ctx.shadowBlur = 8;
        ctx.shadowColor = baseColor;

        const sliceWidth = width / dataArray.length;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height / 2) + ((v - 1.0) * (height / 2) * (sensitivity - 1.0));

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
    } else if (style === 'circle') {
        const centerX = width / 2;
        const centerY = height / 2;
        const radiusX = (width / 2) * 0.8;
        const radiusY = (height / 2) * 0.6;
        const numBars = 64;
        // Use the lower/mid part of the data where most activity is
        const usableDataLength = Math.floor(dataArray.length * 0.55);

        ctx.shadowBlur = 10;
        ctx.shadowColor = baseColor;

        for (let i = 0; i < numBars; i++) {
            // Use a denser frequency mapping
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = dataArray[freqIndex] * sensitivity;
            const barHeight = (value / 255) * 25;

            const angle = (i / numBars) * Math.PI * 2;

            const x1 = centerX + Math.cos(angle) * radiusX;
            const y1 = centerY + Math.sin(angle) * radiusY;

            const x2 = centerX + Math.cos(angle) * (radiusX + barHeight);
            const y2 = centerY + Math.sin(angle) * (radiusY + barHeight);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.strokeStyle = baseColor;
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
    } else if (style === 'mirror') {
        const numBars = 32;
        const barWidth = width / numBars;
        const usableDataLength = Math.floor(dataArray.length * 0.6);
        const centerY = height / 2;

        for (let i = 0; i < numBars; i++) {
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = (dataArray[freqIndex] / 255) * (height / 2) * sensitivity;

            const x = i * barWidth;
            const w = barWidth - 2;

            ctx.fillStyle = baseColor;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(x, centerY - value, w, value);

            ctx.fillStyle = adjustBrightness(baseColor, 0.6);
            ctx.globalAlpha = 0.4;
            ctx.fillRect(x, centerY, w, value);
            ctx.globalAlpha = 1.0;
        }
    } else if (style === 'dance') {
        const numBars = 20;
        const barWidth = width / numBars;
        const gap = 4;
        const centerY = height / 2;
        const usableDataLength = Math.floor(dataArray.length * 0.5);

        // Measure bass intensity to pulse the "stage"
        let bassSum = 0;
        for (let j = 0; j < 5; j++) bassSum += dataArray[j];
        const bassInten = (bassSum / (5 * 255)) * sensitivity;

        // Draw a soft background glow pulsing with the bass
        if (bassInten > 0.4) {
            const glow = ctx.createRadialGradient(width / 2, centerY, 10, width / 2, centerY, width / 2);
            glow.addColorStop(0, adjustBrightness(baseColor, 0.3));
            glow.addColorStop(1, 'transparent');
            ctx.globalAlpha = bassInten * 0.2;
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, width, height);
            ctx.globalAlpha = 1.0;
        }

        for (let i = 0; i < numBars; i++) {
            const freqIndex = Math.floor((i / numBars) * usableDataLength);
            const value = (dataArray[freqIndex] / 255) * (height / 2.5) * sensitivity;

            const x = i * barWidth + gap / 2;
            const w = barWidth - gap;
            const yTop = centerY - value - 2;
            const barHeight = (value * 2) + 4;

            // Gradient effect from centre to edges
            const grad = ctx.createLinearGradient(0, centerY - value, 0, centerY + value);
            grad.addColorStop(0, adjustBrightness(baseColor, 1.5));
            grad.addColorStop(0.5, baseColor);
            grad.addColorStop(1, adjustBrightness(baseColor, 1.5));

            ctx.fillStyle = grad;
            ctx.shadowBlur = 12 * (value / (height / 2));
            ctx.shadowColor = baseColor;

            ctx.beginPath();
            ctx.roundRect(x, yTop, w, barHeight, [w / 2, w / 2, w / 2, w / 2]);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }

    state.animationId = requestAnimationFrame(drawVisualization);
}

export function startVisualization() {
    if (!state.settings.visualizerEnabled) return;

    ensureAudioGraph();

    if (state.audioContext && state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }

    dom.visualizerCanvas.width = dom.visualizerCanvas.offsetWidth;
    dom.visualizerCanvas.height = dom.visualizerCanvas.offsetHeight;

    drawVisualization();
}

export function stopVisualization() {
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }

    if (state.smoothedData) {
        state.smoothedData.fill(0);
    }
    // Re-evaluate the analyser (real vs synthetic) on the next playback.
    state.vizZeroFrames = 0;
    state.vizFake = false;

    const ctx = dom.visualizerCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, dom.visualizerCanvas.width, dom.visualizerCanvas.height);
}

// Resize the visualizer canvas backing store to match its new CSS box
export function refreshVisualizerSize() {
    requestAnimationFrame(() => {
        dom.visualizerCanvas.width = dom.visualizerCanvas.offsetWidth;
        dom.visualizerCanvas.height = dom.visualizerCanvas.offsetHeight;
        if (!state.isPlaying) stopVisualization();
    });
}

export function toggleVisualizer() {
    state.settings.visualizerEnabled = dom.visualizerEnabledCheckbox.checked;
    saveSetting('visualizerEnabled', state.settings.visualizerEnabled);

    if (state.settings.visualizerEnabled) {
        dom.visualizerCanvas.classList.remove('hidden');
        if (state.isPlaying) {
            startVisualization();
        }
    } else {
        dom.visualizerCanvas.classList.add('hidden');
        stopVisualization();
    }
}

export function changeVisualizerColor() {
    state.settings.visualizerColor = dom.visualizerColorPicker.value;
    saveSetting('visualizerColor', state.settings.visualizerColor);
}

export function cycleVisualizerStyle() {
    const styles = ['bars', 'peaks', 'wave', 'circle', 'mirror', 'dance'];
    const currentIndex = styles.indexOf(state.settings.visualizerStyle || 'bars');
    const nextStyle = styles[(currentIndex + 1) % styles.length];

    state.settings.visualizerStyle = nextStyle;
    dom.visualizerStyleSelect.value = nextStyle;
    saveSetting('visualizerStyle', nextStyle);
}
