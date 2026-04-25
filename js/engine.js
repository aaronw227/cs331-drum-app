// ============================================================================
// engine.js
// ----------------------------------------------------------------------------
// The play-along engine. Orchestrates the metronome, mic listener, and scorer
// for a single exercise run.
//
// Lifecycle ------------------------------------------------------------------
//
//   load(exercise, opts)
//     Sets the exercise and computes the BPM-to-time conversion. Does not
//     start audio.
//
//   start()
//     1. Resumes the audio context (browser requires a user gesture to do
//        this; the caller is responsible for that gesture).
//     2. Starts the microphone listener and subscribes to its hit events.
//     3. Picks a startTime in the near future, leaving room for a one-measure
//        countdown of metronome clicks.
//     4. Builds the array of expected hit times relative to startTime.
//     5. Constructs a Scorer with those times.
//     6. Starts the metronome (which will click immediately, providing the
//        countdown audibly).
//     7. Begins a 50ms tick that:
//          - transitions countdown -> playing as time crosses startTime,
//          - sweeps the scorer for missed beats,
//          - emits 'tick' updates to UI subscribers,
//          - detects completion and notifies listeners.
//
//   stop()
//     Tears everything down and unsubscribes mic listeners.
//
// Why a one-measure countdown? -----------------------------------------------
//
//   Drummers count themselves in. Without a countdown, the user has to start
//   tapping at exactly t=0, which is impossibly tight. One measure of clicks
//   gives them a feel for the pulse before they need to play.
//
// Events the engine emits to UI subscribers (via onUpdate) ------------------
//
//   { kind: 'tick',     state, currentTime, stats, expected, startTime, endTime }
//   { kind: 'hit',      result, ...snapshot }   - mic hit was judged or extra
//   { kind: 'miss',     missed, ...snapshot }   - one or more pending beats expired
//   { kind: 'state',    state }                 - state transition (countdown -> playing -> complete)
//
// On completion, all subscribers to onComplete receive:
//
//   { stats, suggestions, exercise, expected, extras }
// ============================================================================

import { Scorer, generateSuggestions } from './scorer.js';

const COUNTDOWN_MEASURES = 1;
const COMPLETION_TAIL_SEC = 0.250;   // wait this long after last beat to finalize
const TICK_INTERVAL_MS = 50;
const SAFETY_OFFSET_SEC = 0.10;      // delay startTime so scheduling has headroom

export class PlayAlongEngine {
  /**
   * @param {object} deps
   * @param {AudioContext} deps.audioCtx
   * @param {Metronome}    deps.metronome
   * @param {MicListener}  deps.micListener
   */
  constructor({ audioCtx, metronome, micListener }) {
    this.ctx = audioCtx;
    this.metronome = metronome;
    this.mic = micListener;

    this.exercise = null;
    this.tempoBpm = 120;
    this.secondsPerBeat = 60 / 120;

    this.scorer = null;
    this.state = 'idle';   // 'idle' | 'countdown' | 'playing' | 'complete'
    this.startTime = 0;
    this.endTime = 0;

    // Subscribers
    this._listeners = new Set();
    this._completeListeners = new Set();

    // Internal handles
    this._tickHandle = null;
    this._unsubMicHit = null;
    this._completionFired = false;
  }

  /**
   * Subscribe to engine updates. Returns an unsubscribe function.
   * @param {Function} fn  receives an event payload (see file header)
   */
  onUpdate(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Subscribe to a one-shot completion event.
   * @param {Function} fn  receives { stats, suggestions, exercise, expected, extras }
   */
  onComplete(fn) {
    this._completeListeners.add(fn);
    return () => this._completeListeners.delete(fn);
  }

  /**
   * Load an exercise. Must be called before start().
   * @param {object} exercise   from exercises.js
   * @param {object} [opts]
   * @param {number} [opts.bpm] - override the exercise's default BPM
   */
  load(exercise, opts = {}) {
    if (!exercise) throw new Error('load() requires an exercise object');
    this.exercise = exercise;
    this.tempoBpm = opts.bpm ?? exercise.bpm;
    this.secondsPerBeat = 60 / this.tempoBpm;

    // Push tempo and time signature to the metronome up-front so the
    // countdown clicks at the correct rate.
    this.metronome.setBpm(this.tempoBpm);
    this.metronome.setBeatsPerMeasure(exercise.timeSignature[0]);
  }

  /**
   * Start the run. Caller must have already done a user-gesture audio unlock.
   * Throws if the mic permission is denied.
   */
  async start() {
    if (!this.exercise) throw new Error('No exercise loaded; call load() first');
    if (this.state !== 'idle' && this.state !== 'complete') {
      throw new Error(`Cannot start from state "${this.state}"`);
    }

    this._completionFired = false;

    // 1. Wire up mic
    await this.mic.start();
    this._unsubMicHit = this.mic.onHit(({ time, volume }) => this._onMicHit(time, volume));

    // 2. Compute schedule
    const now = this.ctx.currentTime;
    const beatsPerMeasure = this.exercise.timeSignature[0];
    const countdownDuration = COUNTDOWN_MEASURES * beatsPerMeasure * this.secondsPerBeat;
    this.startTime = now + SAFETY_OFFSET_SEC + countdownDuration;

    const expectedTimes = this.exercise.pattern.map(
      (p) => this.startTime + p * this.secondsPerBeat
    );
    this.scorer = new Scorer(expectedTimes);
    this.endTime = expectedTimes[expectedTimes.length - 1] + COMPLETION_TAIL_SEC;

    // 3. Start metronome (immediate). It will play through the countdown and
    //    keep clicking for the duration of the exercise.
    this.metronome.start();

    // 4. Enter countdown state and begin ticking
    this._setState('countdown');
    this._tickHandle = setInterval(() => this._tick(), TICK_INTERVAL_MS);
  }

  /**
   * Hard-stop the run. Tears down audio and unsubscribes from the mic.
   * Idempotent.
   */
  stop() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    if (this._unsubMicHit) {
      this._unsubMicHit();
      this._unsubMicHit = null;
    }
    this.metronome.stop();
    this.mic.stop();
    if (this.state !== 'complete') this._setState('idle');
  }

  // ---------- private ----------

  _onMicHit(t, volume) {
    if (!this.scorer) return;
    if (this.state === 'idle' || this.state === 'complete') return;

    // Ignore hits that occur during the countdown - the user is allowed to
    // tap to find the pulse without it counting against them.
    if (t < this.startTime - 0.05) return;

    const result = this.scorer.acceptHit(t, volume);
    this._notify({ kind: 'hit', result, ...this._snapshot() });
  }

  _tick() {
    const now = this.ctx.currentTime;

    // Countdown -> playing transition.
    if (this.state === 'countdown' && now >= this.startTime - 0.02) {
      this._setState('playing');
    }

    if (this.state === 'playing' && this.scorer) {
      // Mark beats that have aged out as missed.
      const newlyMissed = this.scorer.sweep(now);
      if (newlyMissed.length > 0) {
        this._notify({ kind: 'miss', missed: newlyMissed, ...this._snapshot() });
      }

      // Detect completion. Fires once.
      if (!this._completionFired && now >= this.endTime) {
        this._completionFired = true;
        this._setState('complete');

        const stats = this.scorer.getStats();
        const suggestions = generateSuggestions(this.scorer);

        this._notify({ kind: 'complete', ...this._snapshot() });

        for (const fn of this._completeListeners) {
          try {
            fn({
              stats,
              suggestions,
              exercise: this.exercise,
              expected: this.scorer.expected,
              extras: this.scorer.extras,
            });
          } catch (err) {
            console.error('onComplete listener threw:', err);
          }
        }

        // Stop the metronome - mic stays alive briefly so any late tail-hits
        // can still be processed. Caller is responsible for calling stop()
        // when they're done with the post-game UI.
        this.metronome.stop();
        return;
      }
    }

    // Periodic UI tick
    this._notify({ kind: 'tick', ...this._snapshot() });
  }

  _snapshot() {
    return {
      state: this.state,
      currentTime: this.ctx.currentTime,
      startTime: this.startTime,
      endTime: this.endTime,
      stats: this.scorer ? this.scorer.getStats() : null,
      expected: this.scorer ? this.scorer.expected : [],
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
      catch (err) { console.error('engine listener threw:', err); }
    }
  }
}
