// ============================================================================
// exercises.js
// ----------------------------------------------------------------------------
// The exercise library. Each exercise is a plain JS object with everything the
// engine needs to run a practice session: tempo, time signature, and the
// pattern of beat positions where the user is expected to play.
//
// Why a JavaScript module instead of a JSON file?
//   1. ES module imports work without fetch(), so the data ships alongside the
//      code with no extra HTTP round-trip and no CORS friction during dev.
//   2. We can colocate small helper functions (lookups, validation) with the
//      data, which keeps the module self-contained.
//   3. The objects are still plain data, so migrating to JSON later (e.g. for a
//      content-editing tool) is a one-line change.
//
// Pattern format -------------------------------------------------------------
//
//   pattern: number[]   - positions where a hit is expected, measured in BEATS
//                         from the start of the exercise (not within a measure).
//                         "Beats" here means quarter notes (or whatever the
//                         denominator of the time signature is set to elsewhere
//                         in the project; we treat the denominator as a quarter
//                         note for the MVP).
//
//   Examples in 4/4:
//     quarter notes, 1 measure:    [0, 1, 2, 3]
//     eighth notes,  1 measure:    [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
//     16th notes,    1 measure:    [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75,
//                                    2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75]
//     dotted quarters (3 hits):    [0, 1.5, 3]
//
//   At runtime, the engine converts each position p to a real audio-clock time:
//     t = startTime + p * (60 / bpm)
//
// Sticking and accents are advisory metadata for the UI; the scorer only cares
// about pattern timing for the MVP.
// ============================================================================

export const CATEGORIES = [
  {
    id: 'rudiments',
    label: 'Rudiments',
    blurb: 'Foundational sticking patterns. Build hand control and consistency.',
  },
  {
    id: 'timing',
    label: 'Timing',
    blurb: 'Lock onto the click. Develop a steady internal pulse across subdivisions.',
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    blurb: 'Control your volume. Practice accents and contrasts at varying loudness.',
  },
];

export const TIERS = ['beginner', 'intermediate', 'advanced'];

// ----------------------------------------------------------------------------
// Helpers for pattern construction. Using helpers (instead of writing each
// array literal by hand) keeps the data terse and reduces typos.
// ----------------------------------------------------------------------------

/**
 * Build an evenly-spaced pattern of `count` hits at the given `subdivision`.
 * subdivision is in beats: 1 = quarter, 0.5 = eighth, 0.25 = 16th.
 * Example: even(8, 0.5) === [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
 */
function even(count, subdivision) {
  return Array.from({ length: count }, (_, i) => i * subdivision);
}

/**
 * Build a triplet pattern over `beats` beats: 3 evenly-spaced hits per beat.
 * Example: triplets(2) === [0, 1/3, 2/3, 1, 4/3, 5/3]
 */
function triplets(beats) {
  return Array.from({ length: beats * 3 }, (_, i) => i / 3);
}

/**
 * Build a pattern from a "ternary mask" across `beats` beats. The mask is a
 * string of "X" (hit) and "." (rest) characters at a fixed subdivision.
 * Example: galloping eighths-sixteenths -> "X.XX" repeated per beat.
 *   patternFromMask("X.XX", 2) over 4 beats with subdivision 0.25 -> ...
 *
 * Used for irregular but repetitive rhythmic patterns.
 */
function patternFromMask(mask, repeats, subdivision) {
  const out = [];
  const cellsPerRepeat = mask.length;
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 'X') {
        out.push((r * cellsPerRepeat + i) * subdivision);
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Exercise library. Day 2 seeds 2 exercises per category x tier (18 total) so
// the engine has variety to test against; Day 5 will polish the wording, add
// more, and tune defaults.
// ----------------------------------------------------------------------------

export const EXERCISES = [
  // ============================ RUDIMENTS =================================
  {
    id: 'rud-singles-beg',
    category: 'rudiments',
    tier: 'beginner',
    title: 'Single Stroke Roll - Quarter Notes',
    description:
      'Alternate hands on every beat (R L R L). The simplest rudiment and the foundation of every drum pattern.',
    tips: [
      'Keep your wrists relaxed; let the stick rebound rather than gripping it.',
      'Aim for the same volume on every stroke - both hands matter equally.',
      'If you drift off the click, slow the BPM down by 20 and try again.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(8, 1),
    sticking: ['R', 'L', 'R', 'L', 'R', 'L', 'R', 'L'],
  },
  {
    id: 'rud-doubles-beg',
    category: 'rudiments',
    tier: 'beginner',
    title: 'Double Stroke Roll - Quarter Notes',
    description:
      'Two strokes with the same hand, then switch (R R L L). Builds bounce control and even doubles.',
    tips: [
      'Both strokes from the same hand should be the same volume.',
      'Use the wrist for the first stroke and let the stick rebound for the second.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(8, 1),
    sticking: ['R', 'R', 'L', 'L', 'R', 'R', 'L', 'L'],
  },
  {
    id: 'rud-half-warmup-beg',
    category: 'rudiments',
    tier: 'beginner',
    title: 'Hand-to-Hand Warm-up - Half Notes',
    description:
      'One alternating hit every two beats. The slowest possible rudiment - perfect for the first 30 seconds of practice.',
    tips: [
      'Use this to find your stick height and grip before going faster.',
      'Aim for the same arc on both hands.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 4,
    pattern: even(8, 2),
    sticking: ['R', 'L', 'R', 'L', 'R', 'L', 'R', 'L'],
  },

  {
    id: 'rud-singles-int',
    category: 'rudiments',
    tier: 'intermediate',
    title: 'Single Stroke Roll - Eighth Notes',
    description:
      'Same alternating sticking, now twice as fast. Two hits per metronome click.',
    tips: [
      'Listen for two evenly-spaced hits between each click.',
      'If your hits start clumping toward the click, your subdivision is uneven.',
    ],
    timeSignature: [4, 4],
    bpm: 90,
    measures: 2,
    pattern: even(16, 0.5),
    sticking: ['R', 'L', 'R', 'L', 'R', 'L', 'R', 'L', 'R', 'L', 'R', 'L', 'R', 'L', 'R', 'L'],
  },
  {
    id: 'rud-doubles-int',
    category: 'rudiments',
    tier: 'intermediate',
    title: 'Double Stroke Roll - Eighth Notes',
    description:
      'R R L L at twice the speed of the beginner version. Tests whether you can keep doubles even at speed.',
    tips: [
      'The second stroke of each pair tends to weaken - lift the stick higher to compensate.',
      'If the doubles smear together, slow the BPM by 10 and rebuild.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(16, 0.5),
    sticking: ['R', 'R', 'L', 'L', 'R', 'R', 'L', 'L', 'R', 'R', 'L', 'L', 'R', 'R', 'L', 'L'],
  },
  {
    id: 'rud-triples-int',
    category: 'rudiments',
    tier: 'intermediate',
    title: 'Triple Stroke Roll - Triplets',
    description:
      'Three strokes per hand at eighth-note triplets: R R R L L L. Builds three-stroke combinations used in fills.',
    tips: [
      'The middle stroke of each three is the hardest to keep at volume - lift the stick a bit higher.',
      'Counted "trip-le-let, trip-le-let", three hits per beat.',
    ],
    timeSignature: [4, 4],
    bpm: 70,
    measures: 1,
    pattern: triplets(4),
    sticking: ['R', 'R', 'R', 'L', 'L', 'L', 'R', 'R', 'R', 'L', 'L', 'L'],
  },

  {
    id: 'rud-paradiddle-adv',
    category: 'rudiments',
    tier: 'advanced',
    title: 'Single Paradiddle',
    description:
      'R L R R, L R L L. Repeats every 4 hits with the leading hand swapping each cycle. The most-used rudiment in modern drumming.',
    tips: [
      'The double on beat 3 (R R or L L) is where most players rush. Even it out.',
      'Practice the sticking on a flat surface before adding the metronome.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(16, 0.5),
    sticking: ['R', 'L', 'R', 'R', 'L', 'R', 'L', 'L', 'R', 'L', 'R', 'R', 'L', 'R', 'L', 'L'],
  },
  {
    id: 'rud-double-paradiddle-adv',
    category: 'rudiments',
    tier: 'advanced',
    title: 'Double Paradiddle',
    description:
      'R L R L R R, L R L R L L. A six-stroke pattern that fits naturally over triplets and 6/8.',
    tips: [
      'Lock onto the doubles at the end of each group - they should land cleanly on the downbeat.',
      'If you flatten in the middle, slow down and re-emphasize beat 5 of the group.',
    ],
    timeSignature: [4, 4],
    bpm: 70,
    measures: 1,
    // Two double-paradiddles fit one measure when played as triplets (2 groups x 6 hits = 12 hits over 4 beats)
    pattern: triplets(4),
    sticking: ['R', 'L', 'R', 'L', 'R', 'R', 'L', 'R', 'L', 'R', 'L', 'L'],
  },
  {
    id: 'rud-paradiddlediddle-adv',
    category: 'rudiments',
    tier: 'advanced',
    title: 'Paradiddle-diddle',
    description:
      'R L R R L L. A six-stroke pattern that always leads with the same hand - common in jazz and metal alike.',
    tips: [
      'Notice the hand never alternates at the start of the cycle - your leading hand stays constant.',
      'The two doubles back-to-back are the trickiest part to keep even.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 1,
    pattern: triplets(4),
    sticking: ['R', 'L', 'R', 'R', 'L', 'L', 'R', 'L', 'R', 'R', 'L', 'L'],
  },

  // ============================== TIMING ==================================
  {
    id: 'tim-quarters-beg',
    category: 'timing',
    tier: 'beginner',
    title: 'Quarter Notes',
    description:
      'One hit per click for two measures. The pure timing exercise - just lock onto the pulse.',
    tips: [
      'Hit exactly with the click, not just before or after.',
      'Listen for your hit and the click to fuse into one sound.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(8, 1),
  },
  {
    id: 'tim-halves-beg',
    category: 'timing',
    tier: 'beginner',
    title: 'Half Notes',
    description:
      'One hit every two beats. Slower than quarter notes - tests whether you can maintain pulse through silence.',
    tips: [
      'Count "1, 2, 3, 4" silently between hits. The space matters as much as the hit.',
      'If you rush, you are not actually counting; you are reacting.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 4,
    pattern: even(8, 2),
  },
  {
    id: 'tim-whole-beg',
    category: 'timing',
    tier: 'beginner',
    title: 'Whole Notes',
    description:
      'One hit per measure, four measures total. The slowest possible exercise - reveals how much you actually rely on the click vs. internal pulse.',
    tips: [
      'Count out loud through every beat between hits.',
      'If your hits drift over the four measures, your internal pulse needs work.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 4,
    pattern: [0, 4, 8, 12],
  },

  {
    id: 'tim-eighths-int',
    category: 'timing',
    tier: 'intermediate',
    title: 'Eighth Notes',
    description:
      'Two evenly-spaced hits per click. The first lands on the click, the second exactly halfway between clicks.',
    tips: [
      'Count "1 and 2 and 3 and 4 and" out loud while you play.',
      'The "and" should feel as solid as the numbered beat.',
    ],
    timeSignature: [4, 4],
    bpm: 90,
    measures: 2,
    pattern: even(16, 0.5),
  },
  {
    id: 'tim-sixteenths-int',
    category: 'timing',
    tier: 'intermediate',
    title: '16th Notes',
    description:
      'Four hits per beat - the densest common subdivision. Great for building right-hand speed.',
    tips: [
      'Count "1-e-and-a, 2-e-and-a..." with the same emphasis on every syllable.',
      'If the "e" or "a" feels weaker, those are the subdivisions you are rushing.',
    ],
    timeSignature: [4, 4],
    bpm: 70,
    measures: 1,
    pattern: even(16, 0.25),
  },
  {
    id: 'tim-triplets-int',
    category: 'timing',
    tier: 'intermediate',
    title: 'Eighth-note Triplets',
    description:
      'Three evenly-spaced hits per beat. The defining feel of swing, jazz, and most ballads.',
    tips: [
      'Count "trip-le-let, trip-le-let" or "1-and-a, 2-and-a".',
      'Triplets feel rounder than 16ths - resist the urge to flatten them into duples.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 1,
    pattern: triplets(4),
  },

  {
    id: 'tim-syncopation-adv',
    category: 'timing',
    tier: 'advanced',
    title: 'Off-beat Syncopation',
    description:
      'Hits on the "and" of every beat - the off-beats only. Builds independence from the click.',
    tips: [
      'Mentally count the on-beats, but only play the and-of-beat.',
      'It feels wrong at first; that is the point. Trust the click.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    // The off-beats: 0.5, 1.5, 2.5, 3.5 in measure 1, then +4 for measure 2
    pattern: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  },
  {
    id: 'tim-gallop-adv',
    category: 'timing',
    tier: 'advanced',
    title: 'Galloping Rhythm',
    description:
      'Eighth, sixteenth, sixteenth on every beat - the famous "gallop" feel of metal and folk music.',
    tips: [
      'The two 16ths must lock in tighter than the eighth - they are easier to drag.',
      'Counted "1 -and-a, 2 -and-a" but with no hit on the "and".',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    // Gallop = eighth (long) + 16th + 16th per beat. With subdivision 0.25,
    // mask "X.XX" places hits at cells 0, 2, 3 of each beat = positions
    // 0, 0.5, 0.75 of the beat. Repeated 8 beats over 2 measures.
    pattern: patternFromMask('X.XX', 8, 0.25),
  },
  {
    id: 'tim-three-over-four-adv',
    category: 'timing',
    tier: 'advanced',
    title: '3-over-4 Polyrhythm',
    description:
      'Three evenly-spaced hits across four beats. The metronome stays in 4; you superimpose 3 on top. The grandfather of polyrhythmic feel.',
    tips: [
      'The first hit lands on beat 1. The next two land between beats - feel them, don\'t count them.',
      'Try humming the click out loud while playing - if you can do both, you have it.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    // 3 hits across 4 beats, twice. Positions: 0, 4/3, 8/3, then +4
    pattern: [0, 4 / 3, 8 / 3, 4, 4 + 4 / 3, 4 + 8 / 3],
  },

  // ============================ DYNAMICS ==================================
  {
    id: 'dyn-soft-beg',
    category: 'dynamics',
    tier: 'beginner',
    title: 'Quiet Steady Eighths',
    description:
      'Eighth notes at a quiet, even volume. Trains volume control and consistency.',
    tips: [
      'Play noticeably softer than your usual stroke.',
      'Volume consistency is harder than it sounds; the mic will catch any spikes.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(16, 0.5),
    targetDynamic: 'soft',
  },
  {
    id: 'dyn-loud-beg',
    category: 'dynamics',
    tier: 'beginner',
    title: 'Loud Steady Quarters',
    description:
      'Quarter notes at a loud, even volume. Practice projecting confidently without speeding up.',
    tips: [
      'Play firmly but not tensely - tension makes you rush.',
      'Same volume on every hit; resist the natural urge to crescendo.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(8, 1),
    targetDynamic: 'loud',
  },
  {
    id: 'dyn-soft-loud-beg',
    category: 'dynamics',
    tier: 'beginner',
    title: 'Soft / Loud Alternation',
    description:
      'Quarter notes alternating soft and loud. Builds the muscle memory of conscious volume choice.',
    tips: [
      'The soft hit should feel like half the volume of the loud hit.',
      'Keep your stick height different for each - small stroke for soft, larger for loud.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(8, 1),
    accents: [false, true, false, true, false, true, false, true],
  },

  {
    id: 'dyn-accents-int',
    category: 'dynamics',
    tier: 'intermediate',
    title: 'Accent on 2 and 4',
    description:
      'Quarter notes with accents on beats 2 and 4 - the classic backbeat.',
    tips: [
      'The accent should be roughly twice the volume of the unaccented hit.',
      'Keep the unaccented hits quiet and even.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(8, 1),
    accents: [false, true, false, true, false, true, false, true],
  },
  {
    id: 'dyn-accents-and-int',
    category: 'dynamics',
    tier: 'intermediate',
    title: 'Accent on the "and"',
    description:
      'Eighth notes with an accent on every off-beat (the "and" between numbered beats). Feels backwards at first.',
    tips: [
      'Counted "1 AND 2 AND" with the accents on AND.',
      'It will feel like the accent is in the wrong place - that is the lesson.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(16, 0.5),
    accents: [false, true, false, true, false, true, false, true,
              false, true, false, true, false, true, false, true],
  },
  {
    id: 'dyn-accent-three-int',
    category: 'dynamics',
    tier: 'intermediate',
    title: 'Accent on Every Third Eighth',
    description:
      'Eighth notes with an accent every three hits. Creates a rolling 3-against-2 feel inside straight eighths.',
    tips: [
      'The accent moves around the beat - sometimes on the down, sometimes on the and.',
      'Trust the count, not your ear; the accent will feel "wrong" by design.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 2,
    pattern: even(16, 0.5),
    accents: [true, false, false, true, false, false, true, false,
              false, true, false, false, true, false, false, true],
  },

  {
    id: 'dyn-crescendo-adv',
    category: 'dynamics',
    tier: 'advanced',
    title: 'Crescendo over 4 Bars',
    description:
      'Steady eighths starting quiet, getting gradually louder over 4 measures.',
    tips: [
      'Increase volume smoothly, not in steps.',
      'The last hit should be your loudest controlled stroke.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 4,
    pattern: even(32, 0.5),
    targetDynamic: 'crescendo',
  },
  {
    id: 'dyn-decrescendo-adv',
    category: 'dynamics',
    tier: 'advanced',
    title: 'Decrescendo over 4 Bars',
    description:
      'Steady eighths starting loud, getting gradually quieter over 4 measures. Ending soft is harder than ending loud.',
    tips: [
      'Decrease volume in a smooth curve, not a step. Listen for any "shelves" where volume plateaus.',
      'The last few hits should be at the edge of audible without disappearing.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 4,
    pattern: even(32, 0.5),
    targetDynamic: 'decrescendo',
  },
  {
    id: 'dyn-wave-adv',
    category: 'dynamics',
    tier: 'advanced',
    title: 'Wave Dynamics',
    description:
      'Steady eighths shaped soft -> loud -> soft -> loud across 4 measures. Builds smooth, musical volume control in both directions.',
    tips: [
      'Each "wave" is one measure - one full crescendo/decrescendo cycle.',
      'The peak of each wave should hit on beat 1; the trough should be the last eighth before the next downbeat.',
    ],
    timeSignature: [4, 4],
    bpm: 80,
    measures: 4,
    pattern: even(32, 0.5),
    targetDynamic: 'wave',
  },
];

// ----------------------------------------------------------------------------
// Lookup helpers. Centralizing these keeps the rest of the app from caring
// about the array layout - if we move to a server-backed store later, only
// these functions change.
// ----------------------------------------------------------------------------

export function getExercise(id) {
  return EXERCISES.find((e) => e.id === id);
}

export function getExercisesByCategory(categoryId) {
  return EXERCISES.filter((e) => e.category === categoryId);
}

export function getExercisesByCategoryAndTier(categoryId, tier) {
  return EXERCISES.filter((e) => e.category === categoryId && e.tier === tier);
}
