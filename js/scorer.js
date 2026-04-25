// ============================================================================
// scorer.js
// ----------------------------------------------------------------------------
// Timing classifier and statistics.
//
// The scorer is deliberately separated from the engine so it can be unit-tested
// without any Web Audio dependencies: feed it expected times and hit times,
// read out judgments and stats.
//
// Algorithm overview --------------------------------------------------------
//
// We start with a list of EXPECTED beat times (in audio-clock seconds). Each
// expected beat begins life as 'pending'. Two things can happen to it:
//
//   1. A microphone hit arrives close enough in time that we pair them up.
//      The expected beat becomes 'judged' with a delta (signed offset).
//
//   2. Time advances past the expected beat by more than MAX_PAIR_WINDOW
//      without any hit pairing with it. We sweep periodically and mark such
//      stale beats as 'missed'.
//
// Pairing rule: when a hit arrives at time t, walk all PENDING expected beats
// and choose the one whose time is closest to t. If that closest beat is
// within MAX_PAIR_WINDOW (200ms by default), we pair them. Otherwise the hit
// is recorded as an "extra" (it doesn't count toward score; it's tracked so
// the UI can flag it).
//
// Why closest-match? It's the simplest correct rule for sparse patterns
// (quarter notes, dotted patterns) and stays correct for dense patterns until
// the user is half a sub-beat off. For 16th notes at 80 BPM that means the
// user can be up to ~93ms off and still pair correctly, which is well past
// the GOOD window. For very dense fast patterns the calibration step (Day 5)
// reduces baseline lateness so closest-match continues to work.
//
// Window sizes --------------------------------------------------------------
//
//   PERFECT: |delta| <= 30ms
//     30ms is roughly the threshold below which two attacks fuse into a
//     single percept for most listeners. Hits inside this window sound
//     simultaneous with the click.
//
//   GOOD:    |delta| <= 80ms
//     Audibly imperfect but still musical. Most listeners won't call out a
//     drummer playing inside this window unless they're being picky.
//
//   MISS:    everything else
//
// These are tunable via the constructor for the calibration step.
// ============================================================================

export const PERFECT_WINDOW = 0.030;   // seconds
export const GOOD_WINDOW    = 0.080;   // seconds
export const PAIR_WINDOW    = 0.200;   // seconds (max delta to pair a hit)

/**
 * Classify an absolute timing delta (seconds) into 'perfect' | 'good' | 'miss'.
 */
export function classify(absDeltaSec) {
  if (absDeltaSec <= PERFECT_WINDOW) return 'perfect';
  if (absDeltaSec <= GOOD_WINDOW)    return 'good';
  return 'miss';
}

export class Scorer {
  /**
   * @param {number[]} expectedTimes - audio-clock seconds when hits are expected
   * @param {object}   [opts]
   * @param {number}   [opts.pairWindow]  - max distance to pair a hit (sec)
   * @param {number}   [opts.perfect]     - perfect window (sec)
   * @param {number}   [opts.good]        - good window (sec)
   * @param {number}   [opts.latencyOffset] - subtracted from incoming hit times
   */
  constructor(expectedTimes, opts = {}) {
    this.pairWindow    = opts.pairWindow    ?? PAIR_WINDOW;
    this.perfectWindow = opts.perfect       ?? PERFECT_WINDOW;
    this.goodWindow    = opts.good          ?? GOOD_WINDOW;
    this.latencyOffset = opts.latencyOffset ?? 0;

    // Each expected beat: { time, status, delta, hitTime, hitVolume, judgment }
    //   status:    'pending' | 'judged' | 'missed'
    //   delta:     signed seconds (hit - expected); negative = early
    //   judgment:  'perfect' | 'good' | 'miss' (set when judged or missed)
    this.expected = expectedTimes.map((t) => ({
      time: t,
      status: 'pending',
      delta: null,
      hitTime: null,
      hitVolume: null,
      judgment: null,
    }));

    // Hits that did not pair with any expected beat (user tapped extra).
    this.extras = [];
  }

  /**
   * Update the latency offset (seconds). Hits arriving after this is set will
   * have offset subtracted from their reported time before pairing.
   *
   * Used by the calibration step: if the user is consistently 40ms late on
   * average through no fault of their own (browser audio output delay), we
   * subtract 40ms from each hit before classifying.
   */
  setLatencyOffset(seconds) {
    this.latencyOffset = seconds;
  }

  /**
   * Accept a microphone hit. Returns the resulting judgment.
   *
   * @param {number} hitTime  - audio-clock seconds when the hit arrived
   * @param {number} [volume] - peak volume of the hit, if available
   * @returns {{type: 'judged'|'extra', ...}}
   */
  acceptHit(hitTime, volume = null) {
    const adjusted = hitTime - this.latencyOffset;

    // Find the pending expected beat closest to `adjusted`.
    let bestIdx = -1;
    let bestAbsDelta = Infinity;
    let bestSignedDelta = 0;
    for (let i = 0; i < this.expected.length; i++) {
      const e = this.expected[i];
      if (e.status !== 'pending') continue;
      const delta = adjusted - e.time;
      const abs = Math.abs(delta);
      if (abs < bestAbsDelta) {
        bestAbsDelta = abs;
        bestSignedDelta = delta;
        bestIdx = i;
      }
    }

    // If nothing close enough, it's an extra.
    if (bestIdx === -1 || bestAbsDelta > this.pairWindow) {
      const extra = { time: adjusted, volume };
      this.extras.push(extra);
      return { type: 'extra', ...extra };
    }

    // Pair them up. Mutate the expected beat in place so the engine can read it.
    const e = this.expected[bestIdx];
    e.status = 'judged';
    e.delta = bestSignedDelta;
    e.hitTime = adjusted;
    e.hitVolume = volume;
    e.judgment = this._classify(bestAbsDelta);

    return {
      type: 'judged',
      index: bestIdx,
      time: e.time,
      hitTime: adjusted,
      delta: bestSignedDelta,
      judgment: e.judgment,
      volume,
    };
  }

  /**
   * Sweep for stale beats and mark them missed. Should be called periodically
   * from the engine tick (e.g. every 50ms).
   *
   * @param {number} currentTime - audio-clock seconds
   * @returns {Array} newly-missed beats { index, time, ... }
   */
  sweep(currentTime) {
    const newlyMissed = [];
    for (let i = 0; i < this.expected.length; i++) {
      const e = this.expected[i];
      if (e.status === 'pending' && (currentTime - e.time) > this.pairWindow) {
        e.status = 'missed';
        e.judgment = 'miss';
        newlyMissed.push({ index: i, time: e.time });
      }
    }
    return newlyMissed;
  }

  /**
   * True once every expected beat has been judged or missed AND we're past the
   * last expected beat by at least pairWindow seconds.
   */
  isComplete(currentTime) {
    if (this.expected.length === 0) return true;
    const last = this.expected[this.expected.length - 1];
    return (currentTime - last.time) > this.pairWindow;
  }

  /**
   * Aggregate stats. Computed on demand so the engine doesn't have to
   * maintain running counters.
   */
  getStats() {
    let perfect = 0, good = 0, miss = 0;
    let sumDelta = 0, sumAbsDelta = 0, judgedCount = 0;

    for (const e of this.expected) {
      if (e.judgment === 'perfect') perfect++;
      else if (e.judgment === 'good') good++;
      else if (e.judgment === 'miss') miss++;

      if (e.delta !== null) {
        sumDelta    += e.delta;
        sumAbsDelta += Math.abs(e.delta);
        judgedCount++;
      }
    }

    const total = this.expected.length;
    const meanDelta    = judgedCount > 0 ? sumDelta    / judgedCount : 0;
    const meanAbsDelta = judgedCount > 0 ? sumAbsDelta / judgedCount : 0;
    const accuracy     = total > 0 ? (perfect + good) / total : 0;

    // Standard deviation of delta (consistency measure).
    let stdDelta = 0;
    if (judgedCount >= 2) {
      let sumSq = 0;
      for (const e of this.expected) {
        if (e.delta !== null) {
          const d = e.delta - meanDelta;
          sumSq += d * d;
        }
      }
      stdDelta = Math.sqrt(sumSq / judgedCount);
    }

    return {
      total,
      judgedCount,
      perfect,
      good,
      miss,
      extras: this.extras.length,
      meanDelta,       // signed seconds; positive = late, negative = early
      meanAbsDelta,    // unsigned seconds; how far off on average
      stdDelta,        // seconds; consistency (lower = more consistent)
      accuracy,        // 0..1
    };
  }

  // -------- private --------

  _classify(absDelta) {
    if (absDelta <= this.perfectWindow) return 'perfect';
    if (absDelta <= this.goodWindow)    return 'good';
    return 'miss';
  }
}

// ============================================================================
// Suggestions engine
// ----------------------------------------------------------------------------
// Generates short, plain-English practice tips from a finished scorer's data.
// A small rule-based engine over the stats; not ML, deliberately.
//
// Rules (applied in order; up to 3 returned):
//
//   1. Strong rushing  (mean delta < -25ms): "you're ahead of the click"
//   2. Strong dragging (mean delta > +25ms): "you're behind the click"
//   3. Drift trend  (linear slope > threshold): "you're speeding up / slowing"
//   4. Inconsistency (std > 40ms):              "tempo too fast for you"
//   5. High miss rate (>25%):                   "slow it down significantly"
//   6. Excellent (perfect rate > 70%):          "push the BPM up"
//   7. Default:                                 "solid, keep at it"
// ============================================================================

export function generateSuggestions(scorer) {
  const stats = scorer.getStats();
  const tips = [];

  if (stats.total === 0) return tips;

  const meanMs = stats.meanDelta * 1000;   // ms
  const stdMs  = stats.stdDelta  * 1000;   // ms

  // Rule 1 / 2: directional bias
  if (meanMs > 25) {
    tips.push({
      severity: 'medium',
      text: `You're playing about ${Math.round(meanMs)}ms behind the click on average. ` +
            `Try anticipating the beat slightly - feel it before you hear it. ` +
            `Counting "1 and 2 and..." out loud helps you internalize the pulse.`,
    });
  } else if (meanMs < -25) {
    tips.push({
      severity: 'medium',
      text: `You're rushing - playing about ${Math.round(-meanMs)}ms ahead of the click on average. ` +
            `Relax your shoulders and let the click lead you. ` +
            `Try the same exercise at this BPM until your average lands within ±20ms.`,
    });
  }

  // Rule 3: drift (compute simple linear regression slope on judged hits)
  const drift = computeDriftPerBeatMs(scorer);
  if (drift !== null && Math.abs(drift) > 4) {
    tips.push({
      severity: 'medium',
      text: drift > 0
        ? `Your timing drifts ${drift.toFixed(1)}ms later per beat - you're slowing down. ` +
          `Stay engaged with the click for the whole exercise, not just the start.`
        : `Your timing drifts ${(-drift).toFixed(1)}ms earlier per beat - you're speeding up. ` +
          `This usually means muscle tension. Loosen your grip and breathe.`,
    });
  }

  // Rule 4: inconsistency
  if (stats.judgedCount >= 4 && stdMs > 40) {
    tips.push({
      severity: 'medium',
      text: `Your timing varies by ±${Math.round(stdMs)}ms. Inconsistency usually means the tempo ` +
            `is too fast for current control. Try this exercise 10-20 BPM slower until your spread tightens.`,
    });
  }

  // Rule 5: miss rate
  const missRate = stats.miss / stats.total;
  if (missRate > 0.25) {
    tips.push({
      severity: 'high',
      text: `${Math.round(missRate * 100)}% of beats were missed entirely. ` +
            `Slow the tempo down by 30% and focus on hitting every single beat before pushing it back up.`,
    });
  }

  // Rule 6: excellent run
  const perfectRate = stats.perfect / stats.total;
  if (perfectRate > 0.7 && missRate < 0.1) {
    tips.push({
      severity: 'positive',
      text: `Excellent timing - over ${Math.round(perfectRate * 100)}% perfect hits. ` +
            `Try this exercise 10 BPM faster to keep challenging yourself.`,
    });
  }

  // Rule 7: extras (user is double-hitting or triggering on bleed)
  if (stats.extras > stats.total * 0.2) {
    tips.push({
      severity: 'low',
      text: `Detected ${stats.extras} unpaired hits. Either you're double-tapping, or the mic is ` +
            `picking up bleed. Move the mic closer to the drum and avoid loose contact.`,
    });
  }

  // Default if nothing flagged
  if (tips.length === 0) {
    tips.push({
      severity: 'positive',
      text: `Solid run. Keep practicing at this tempo to lock it in, then nudge the BPM higher.`,
    });
  }

  return tips.slice(0, 3);
}

/**
 * Compute the linear-regression slope of delta vs. beat-index, in ms per beat.
 * Returns null if we don't have enough judged hits to be meaningful (<4).
 *
 * Positive slope = getting later as the exercise progresses (slowing down).
 * Negative slope = getting earlier (speeding up).
 *
 * Derivation: with x = beat index and y = delta in ms,
 *   slope = sum((x - meanX) * (y - meanY)) / sum((x - meanX)^2)
 */
function computeDriftPerBeatMs(scorer) {
  const points = [];
  scorer.expected.forEach((e, idx) => {
    if (e.delta !== null) points.push({ x: idx, y: e.delta * 1000 });
  });
  if (points.length < 4) return null;

  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) * (p.x - meanX);
  }
  if (den === 0) return null;
  return num / den;   // ms per beat-index
}
