// ============================================================================
// calibration.js
// ----------------------------------------------------------------------------
// One-shot latency calibration. The user taps along to a steady metronome
// for ~8 beats; we measure their average timing offset and save it as the
// scorer's latency offset for all future runs.
//
// Why this exists ----------------------------------------------------------
//
// Browser audio output and microphone input both have hardware/OS-level
// latency that varies widely between machines (Bluetooth headphones add
// huge offsets, USB mics add small ones, on-board audio is in between).
// Without compensation the user shows up systematically late at the scorer,
// and a perfectly-timed drummer scores GOOD instead of PERFECT.
//
// Approach -----------------------------------------------------------------
//
// Reuse the existing Scorer class with a fresh set of expected beats (a
// 60 BPM 4/4 measure of 8 hits) and no offset applied. After capture, take
// the MEDIAN of the per-hit deltas - more robust than mean against the
// occasional missed/double tap.
//
// Why median, not mean?
//   The user might miss a beat or accidentally double-tap. Those produce
//   wild outliers in the deltas array. Median ignores them by definition;
//   mean would be dragged. We additionally require at least 4 successfully
//   paired hits before trusting the result.
//
// Why 60 BPM?
//   Slow enough that anyone can keep up. At 60 BPM beats are 1s apart, so
//   the scorer's 200ms pair window has comfortable margin even if the user
//   is off by a sizable amount - we still pair hits with the right beat.
// ============================================================================

import { Scorer } from './scorer.js';

const CALIB_BPM = 60;
const CALIB_BEATS = 8;
const CALIB_LEAD_BEATS = 4;       // 1 measure of countdown clicks
const CALIB_PAIR_WINDOW = 0.40;   // seconds; tight enough to reject wild taps
const CALIB_TICK_MS = 50;
const CALIB_TAIL_SEC = 0.40;

export const CALIB_CONFIG = Object.freeze({
  bpm: CALIB_BPM,
  beats: CALIB_BEATS,
  leadBeats: CALIB_LEAD_BEATS,
});

export class CalibrationRunner {
  /**
   * @param {object} deps
   * @param {AudioContext}      deps.audioCtx
   * @param {Metronome}         deps.metronome
   * @param {MicListener}       deps.micListener
   */
  constructor({ audioCtx, metronome, micListener }) {
    this.ctx = audioCtx;
    this.metronome = metronome;
    this.mic = micListener;
    this.state = 'idle';   // 'idle' | 'countdown' | 'capturing' | 'complete'

    this._scorer = null;
    this._tickHandle = null;
    this._unsubMic = null;
    this._captureStartTime = 0;
    this._captureEndTime = 0;
    this._completionFired = false;

    this._listeners = new Set();
    this._completeListeners = new Set();
  }

  /** Subscribe to ticks/state transitions. Returns unsubscribe fn. */
  onUpdate(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Subscribe to one-shot completion. Receives result object. */
  onComplete(fn) {
    this._completeListeners.add(fn);
    return () => this._completeListeners.delete(fn);
  }

  /** Begin calibration. Throws if mic permission is denied. */
  async start() {
    if (this.state !== 'idle' && this.state !== 'complete') {
      throw new Error(`Cannot start calibration from state "${this.state}"`);
    }
    this._completionFired = false;

    // 1. Wire up mic
    await this.mic.start();
    this._unsubMic = this.mic.onHit(({ time }) => this._onHit(time));

    // 2. Configure metronome and compute schedule
    this.metronome.setBpm(CALIB_BPM);
    this.metronome.setBeatsPerMeasure(4);
    const now = this.ctx.currentTime;
    const secondsPerBeat = 60 / CALIB_BPM;
    this._captureStartTime = now + 0.1 + CALIB_LEAD_BEATS * secondsPerBeat;

    const expectedTimes = [];
    for (let i = 0; i < CALIB_BEATS; i++) {
      expectedTimes.push(this._captureStartTime + i * secondsPerBeat);
    }
    this._captureEndTime = expectedTimes[expectedTimes.length - 1] + CALIB_TAIL_SEC;

    // 3. Score with no latency offset and a tight pair window
    this._scorer = new Scorer(expectedTimes, {
      pairWindow: CALIB_PAIR_WINDOW,
      latencyOffset: 0,
    });

    // 4. Start clicking - the lead beats will be audible to the user
    this.metronome.start();
    this._setState('countdown');
    this._tickHandle = setInterval(() => this._tick(), CALIB_TICK_MS);
  }

  /** Stop everything. Idempotent. */
  stop() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    if (this._unsubMic) {
      this._unsubMic();
      this._unsubMic = null;
    }
    try { this.metronome.stop(); } catch {}
    try { this.mic.stop(); } catch {}
    if (this.state !== 'complete') this._setState('idle');
  }

  // -------- private --------

  _onHit(t) {
    if (this.state !== 'capturing') return;
    if (!this._scorer) return;
    if (t < this._captureStartTime - 0.05) return;
    const result = this._scorer.acceptHit(t);
    this._notify({ kind: 'hit', result, ...this._snapshot() });
  }

  _tick() {
    const now = this.ctx.currentTime;

    if (this.state === 'countdown' && now >= this._captureStartTime - 0.02) {
      this._setState('capturing');
    }

    if (this.state === 'capturing' && this._scorer) {
      this._scorer.sweep(now);
      if (!this._completionFired && now >= this._captureEndTime) {
        this._completionFired = true;
        this._finalize();
        return;
      }
    }

    this._notify({ kind: 'tick', ...this._snapshot() });
  }

  _finalize() {
    this._setState('complete');
    try { this.metronome.stop(); } catch {}

    const deltas = [];
    for (const e of this._scorer.expected) {
      if (e.delta !== null) deltas.push(e.delta);
    }

    let result;
    if (deltas.length < 4) {
      // Not enough usable data to trust a number. Caller should prompt for retry.
      result = {
        ok: false,
        reason: deltas.length === 0 ? 'no-hits' : 'too-few-hits',
        sampleCount: deltas.length,
      };
    } else {
      const sorted = [...deltas].sort((a, b) => a - b);
      const median = medianOf(sorted);
      // Mean absolute deviation from median = consistency signal. If it's
      // wildly high (>120ms), the calibration result is unreliable.
      const meanAbsDev = deltas.reduce((s, d) => s + Math.abs(d - median), 0) / deltas.length;
      const reliable = meanAbsDev <= 0.120;
      result = {
        ok: reliable,
        reason: reliable ? null : 'inconsistent',
        sampleCount: deltas.length,
        offsetSec: median,
        meanAbsDevSec: meanAbsDev,
        deltas,
      };
    }

    for (const fn of this._completeListeners) {
      try { fn(result); } catch (err) { console.error(err); }
    }
  }

  _snapshot() {
    return {
      state: this.state,
      currentTime: this.ctx.currentTime,
      captureStartTime: this._captureStartTime,
      captureEndTime: this._captureEndTime,
      capturedCount: this._scorer ? this._scorer.getStats().judgedCount : 0,
      targetCount: CALIB_BEATS,
      expected: this._scorer ? this._scorer.expected : [],
    };
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this._notify({ kind: 'state', state: s });
  }

  _notify(payload) {
    for (const fn of this._listeners) {
      try { fn(payload); }
      catch (err) { console.error('calibration listener threw:', err); }
    }
  }
}

function medianOf(sortedArr) {
  const n = sortedArr.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  // Even n: average the two middles. Odd n: pick the middle.
  return n % 2 === 0 ? (sortedArr[mid - 1] + sortedArr[mid]) / 2 : sortedArr[mid];
}
