// ============================================================================
// storage.js
// ----------------------------------------------------------------------------
// localStorage-backed progress tracking. One JSON blob under a single key.
//
// Why localStorage?
//   - No backend needed for the MVP - data lives entirely on the user's
//     device, which matches the single-user model from the requirements doc.
//   - Synchronous and trivially debuggable (open DevTools -> Application
//     -> Local Storage).
//   - Cross-browser, no permissions prompt, no quota concerns at this size.
//
// Schema --------------------------------------------------------------------
//
//   {
//     schemaVersion: 1,
//     totalPracticeMs: <integer>,
//     totalRuns: <integer>,
//     exercises: {
//       "<exerciseId>": {
//         runs:            <integer>,
//         bestAccuracy:    <0..1>,
//         bestGrade:       "A" | "B" | "C" | "D" | "F",
//         lastRunISO:      "2026-04-26T...",
//         totalPracticeMs: <integer>,
//       }
//     },
//     runs: [
//       { exerciseId, accuracy, grade, durationMs, atISO },
//       ...   // most recent first, capped at MAX_RUN_LOG entries
//     ]
//   }
//
// Mastery rule --------------------------------------------------------------
//
//   An exercise is considered "mastered" when its bestGrade is B or higher.
//   This rule lives in isMastered(); per-category progress bars use it.
//
// Failure modes -------------------------------------------------------------
//
//   localStorage can be unavailable (private browsing, disabled by user,
//   storage quota). All read/write functions handle errors silently and
//   return safe defaults so the rest of the app keeps working without
//   persistence.
// ============================================================================

const KEY = 'drum-trainer-progress';
const SCHEMA_VERSION = 1;
const MAX_RUN_LOG = 50;

const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A'];
export const MASTERY_GRADE = 'B';   // lowest grade that counts as mastered

// ---------------------------------------------------------------------------

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    totalPracticeMs: 0,
    totalRuns: 0,
    exercises: {},
    runs: [],
    // Calibration: offset (in seconds) we subtract from each mic-hit time
    // before pairing it with an expected beat. Positive values mean "the
    // user appears late by this many seconds on average through no fault of
    // their own" - usually the sum of audio output delay + mic-input delay.
    // calibratedAt is the ISO timestamp of the calibration so we can show
    // "calibrated 3 days ago" in the UI.
    latencyOffsetSec: 0,
    calibratedAtISO: null,
  };
}

/** Read the current progress state. Always returns a valid object. */
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
      // Future schema migrations would happen here. For now, we reset on
      // mismatch rather than silently corrupting data.
      return defaultState();
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

/** Write the state. Returns true on success, false if storage is unavailable. */
export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Wipe all progress. Used by a Reset button on the dashboard. */
export function reset() {
  return save(defaultState());
}

/**
 * Record a completed exercise run. Updates per-exercise stats, totals, and
 * the recent-runs log. Returns the updated state.
 *
 * @param {string} exerciseId
 * @param {object} run
 * @param {number} run.accuracy    0..1
 * @param {string} run.grade       "A".."F"
 * @param {number} run.durationMs  total time spent (countdown + play)
 */
export function recordRun(exerciseId, run) {
  const s = load();
  const now = new Date().toISOString();

  const ex = s.exercises[exerciseId] || {
    runs: 0,
    bestAccuracy: 0,
    bestGrade: 'F',
    lastRunISO: null,
    totalPracticeMs: 0,
  };

  ex.runs++;
  ex.bestAccuracy = Math.max(ex.bestAccuracy, run.accuracy);
  ex.bestGrade = pickBetterGrade(ex.bestGrade, run.grade);
  ex.lastRunISO = now;
  ex.totalPracticeMs += run.durationMs || 0;
  s.exercises[exerciseId] = ex;

  s.totalPracticeMs += run.durationMs || 0;
  s.totalRuns++;

  s.runs.unshift({
    exerciseId,
    accuracy: run.accuracy,
    grade: run.grade,
    durationMs: run.durationMs || 0,
    atISO: now,
  });
  if (s.runs.length > MAX_RUN_LOG) s.runs.length = MAX_RUN_LOG;

  save(s);
  return s;
}

// ---------------------------------------------------------------------------
// Pure helpers (no storage access). Useful for the dashboard rendering.
// ---------------------------------------------------------------------------

export function pickBetterGrade(a, b) {
  return GRADE_ORDER.indexOf(b) > GRADE_ORDER.indexOf(a) ? b : a;
}

export function isMastered(exerciseEntry) {
  if (!exerciseEntry || !exerciseEntry.bestGrade) return false;
  return GRADE_ORDER.indexOf(exerciseEntry.bestGrade) >= GRADE_ORDER.indexOf(MASTERY_GRADE);
}

export function isPlayed(exerciseEntry) {
  return !!(exerciseEntry && exerciseEntry.runs > 0);
}

// ---------------------------------------------------------------------------
// Calibration accessors. Kept here so the engine and the calibration view
// share one source of truth.
// ---------------------------------------------------------------------------

/** Read the saved latency offset (seconds). Returns 0 if nothing is saved. */
export function getLatencyOffset() {
  const s = load();
  return Number.isFinite(s.latencyOffsetSec) ? s.latencyOffsetSec : 0;
}

/** Persist a calibration result. */
export function setLatencyOffset(seconds) {
  const s = load();
  s.latencyOffsetSec = Number(seconds) || 0;
  s.calibratedAtISO = new Date().toISOString();
  save(s);
  return s;
}

/** Wipe calibration only (does not touch run history). */
export function clearCalibration() {
  const s = load();
  s.latencyOffsetSec = 0;
  s.calibratedAtISO = null;
  save(s);
  return s;
}

/** "1h 23m" / "12m" / "45s" formatting for the dashboard. */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
