// listener.js
// Microphone hit detection via Web Audio.
// Ported from legacy-python/listener.py. Equivalent semantics:
//   - THRESHOLD (peak amplitude over a block) gates what counts as a hit
//   - COOLDOWN prevents double-triggering on the tail of a single hit
//
// We use an AnalyserNode to sample peak amplitude at the audio-rate block boundary.
// getUserMedia requires a user gesture (button click) to prompt the permission dialog.

export const THRESHOLD = 0.15;
export const COOLDOWN = 0.15;   // seconds
const FFT_SIZE = 1024;          // matches BLOCKSIZE from Python

export class MicListener {
  /**
   * @param {AudioContext} audioCtx shared audio context
   * @param {Object} opts
   * @param {number} [opts.threshold]
   * @param {number} [opts.cooldown]
   */
  constructor(audioCtx, opts = {}) {
    this.ctx = audioCtx;
    this.threshold = opts.threshold ?? THRESHOLD;
    this.cooldown = opts.cooldown ?? COOLDOWN;

    this._stream = null;
    this._source = null;
    this._analyser = null;
    this._buffer = new Float32Array(FFT_SIZE);
    this._rafId = null;
    this._lastHitTime = 0;
    this._running = false;

    this._onHitListeners = new Set();
    this._onLevelListeners = new Set();  // continuous level monitoring (for UI meters, calibration)
  }

  /** Subscribe to hit events. Receives { time, volume }. */
  onHit(fn) {
    this._onHitListeners.add(fn);
    return () => this._onHitListeners.delete(fn);
  }

  /** Subscribe to continuous level (0..1). Called on every animation frame. */
  onLevel(fn) {
    this._onLevelListeners.add(fn);
    return () => this._onLevelListeners.delete(fn);
  }

  setThreshold(t) {
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new RangeError('Threshold must be between 0 and 1');
    }
    this.threshold = n;
  }

  /** Request mic access and start detecting. Throws if permission denied. */
  async start() {
    if (this._running) return;
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this._source = this.ctx.createMediaStreamSource(this._stream);
    this._analyser = this.ctx.createAnalyser();
    this._analyser.fftSize = FFT_SIZE;
    this._source.connect(this._analyser);
    // Note: we do NOT connect analyser -> destination, so we don't loopback.

    this._running = true;
    this._lastHitTime = 0;
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (this._source) { try { this._source.disconnect(); } catch {} }
    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop();
    }
    this._source = null;
    this._analyser = null;
    this._stream = null;
  }

  _tick = () => {
    if (!this._running || !this._analyser) return;
    this._analyser.getFloatTimeDomainData(this._buffer);

    // Peak amplitude across the block (matches np.max(np.abs(indata)))
    let peak = 0;
    for (let i = 0; i < this._buffer.length; i++) {
      const v = Math.abs(this._buffer[i]);
      if (v > peak) peak = v;
    }

    // Continuous level notifications
    for (const fn of this._onLevelListeners) {
      try { fn(peak); } catch (err) { console.error(err); }
    }

    const now = this.ctx.currentTime;
    if (peak > this.threshold && (now - this._lastHitTime) > this.cooldown) {
      this._lastHitTime = now;
      for (const fn of this._onHitListeners) {
        try { fn({ time: now, volume: peak }); }
        catch (err) { console.error('onHit listener threw:', err); }
      }
    }

    this._rafId = requestAnimationFrame(this._tick);
  };
}
