// metronome.js
// Web Audio metronome using the lookahead-scheduler pattern.
// Ported from legacy-python/metronome.py with equivalent BPM validation (20-300).
//
// Key difference from Python: we schedule beats using AudioContext.currentTime
// so timing is sample-accurate regardless of JS event-loop jitter. The scheduler
// runs on a setInterval tick (lookahead ~ 25ms) and queues beats up to
// SCHEDULE_AHEAD_TIME seconds in advance.

const SCHEDULE_AHEAD_TIME = 0.1;   // seconds of lookahead
const LOOKAHEAD_INTERVAL = 25;      // ms between scheduler ticks
const MIN_BPM = 20;
const MAX_BPM = 300;

export class Metronome {
  /**
   * @param {AudioContext} audioCtx  - shared audio context
   * @param {AudioBuffer}  clickBuf  - regular beat sample
   * @param {AudioBuffer}  accentBuf - accent (downbeat) sample
   */
  constructor(audioCtx, clickBuf, accentBuf) {
    this.ctx = audioCtx;
    this.clickBuf = clickBuf;
    this.accentBuf = accentBuf || clickBuf; // fall back to regular click
    this.bpm = 120;
    this.beatsPerMeasure = 4;      // time signature numerator (4/4, 3/4, etc.)
    this.isRunning = false;

    this._nextNoteTime = 0;         // AudioContext time of next beat
    this._currentBeat = 0;          // 0-indexed within a measure
    this._timerId = null;

    // Listeners: callbacks that get { beatIndex, measureBeat, time } on each scheduled beat
    this._onBeatListeners = new Set();
  }

  /**
   * Validate and set BPM. Matches Python's 20-300 range.
   * Throws if out of range or non-numeric.
   */
  setBpm(bpm) {
    const n = Number(bpm);
    if (!Number.isFinite(n) || n < MIN_BPM || n > MAX_BPM) {
      throw new RangeError(`BPM must be between ${MIN_BPM} and ${MAX_BPM}`);
    }
    this.bpm = n;
    return n;
  }

  setBeatsPerMeasure(n) {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > 16) {
      throw new RangeError('Beats per measure must be 1-16');
    }
    this.beatsPerMeasure = v;
  }

  onBeat(fn) {
    this._onBeatListeners.add(fn);
    return () => this._onBeatListeners.delete(fn);
  }

  start() {
    if (this.isRunning) return;
    // User-gesture requirement: caller must have resumed ctx already
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.isRunning = true;
    this._currentBeat = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.05; // small offset
    this._scheduler();
    this._timerId = setInterval(() => this._scheduler(), LOOKAHEAD_INTERVAL);
  }

  stop() {
    this.isRunning = false;
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
  }

  _scheduler() {
    while (this._nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_TIME) {
      this._scheduleBeat(this._currentBeat, this._nextNoteTime);
      this._advance();
    }
  }

  _scheduleBeat(beatIndex, when) {
    const isAccent = beatIndex === 0;
    const src = this.ctx.createBufferSource();
    src.buffer = isAccent ? this.accentBuf : this.clickBuf;
    src.connect(this.ctx.destination);
    src.start(when);

    // Notify listeners on a timer so UI updates align with audio playback.
    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    setTimeout(() => {
      for (const fn of this._onBeatListeners) {
        try { fn({ beatIndex, measureBeat: beatIndex, time: when, isAccent }); }
        catch (err) { console.error('onBeat listener threw:', err); }
      }
    }, delayMs);
  }

  _advance() {
    const secondsPerBeat = 60.0 / this.bpm;
    this._nextNoteTime += secondsPerBeat;
    this._currentBeat = (this._currentBeat + 1) % this.beatsPerMeasure;
  }
}

export const METRONOME_LIMITS = { MIN_BPM, MAX_BPM };
