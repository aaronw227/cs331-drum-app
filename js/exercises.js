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
