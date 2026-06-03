// pcm-player.js — AudioWorkletProcessor that plays interleaved stereo f32 PCM
// pushed from the main thread. Used on macOS/WebKit, where audio decoded by the
// Rust backend is streamed in and played here so the Web Audio graph (EQ +
// analyser) is actually fed — unlike a network-backed <audio> element, which
// WebKit silences for Web Audio.
//
// The main thread posts { type:'pcm', samples:Float32Array } chunks (stereo,
// interleaved L,R,L,R…). A small jitter buffer absorbs network unevenness:
// playback waits until `prebufferFrames` are queued, and on underrun it goes
// silent and re-buffers rather than glitching continuously.

const RING_SECONDS = 8; // hard cap on buffered audio to bound memory

class PcmPlayer extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opt = (options && options.processorOptions) || {};
        this.prebufferFrames = opt.prebufferFrames || Math.floor(sampleRate * 0.4);
        this.maxFrames = sampleRate * RING_SECONDS;

        this.queue = [];        // array of Float32Array (interleaved stereo)
        this.queueFrames = 0;   // total frames currently queued
        this.head = null;       // chunk currently being read
        this.headPos = 0;       // sample index within head
        this.playing = false;   // false while (re)buffering

        this.port.onmessage = (e) => {
            const d = e.data;
            if (d.type === 'pcm') {
                this.queue.push(d.samples);
                this.queueFrames += d.samples.length >> 1; // stereo: 2 samples/frame
                // Drop oldest if we somehow overrun the cap (e.g. start burst).
                while (this.queueFrames > this.maxFrames && this.queue.length > 1) {
                    const dropped = this.queue.shift();
                    this.queueFrames -= dropped.length >> 1;
                }
            } else if (d.type === 'reset') {
                this.queue = [];
                this.queueFrames = 0;
                this.head = null;
                this.headPos = 0;
                this.playing = false;
            }
        };
    }

    process(inputs, outputs) {
        const out = outputs[0];
        const left = out[0];
        const right = out[1] || out[0];
        const frames = left.length; // 128

        // Wait until enough is buffered before (re)starting playback.
        if (!this.playing) {
            if (this.queueFrames < this.prebufferFrames) {
                left.fill(0);
                if (out[1]) right.fill(0);
                return true;
            }
            this.playing = true;
        }

        for (let i = 0; i < frames; i++) {
            if (!this.head || this.headPos >= this.head.length) {
                this.head = this.queue.shift() || null;
                this.headPos = 0;
                if (!this.head) {
                    // Underrun: output silence for the rest and re-buffer.
                    for (; i < frames; i++) {
                        left[i] = 0;
                        if (out[1]) right[i] = 0;
                    }
                    this.playing = false;
                    return true;
                }
            }
            const l = this.head[this.headPos];
            const r = this.head[this.headPos + 1];
            this.headPos += 2;
            this.queueFrames--;
            if (out[1]) {
                left[i] = l;
                right[i] = r;
            } else {
                left[i] = (l + r) * 0.5;
            }
        }
        return true;
    }
}

registerProcessor('pcm-player', PcmPlayer);
