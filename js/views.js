// ============================================================================
// views.js
// ----------------------------------------------------------------------------
// View renderers for each route. Every renderer takes a `deps` object holding
// the audio singletons (audioCtx, metronome, mic, engine) and a target view
// element, then mutates the view to draw the page and wire up its handlers.
//
// Why split views out of app.js?
//   app.js handles boot, audio singletons, and routing. Views are about DOM
//   shape and event wiring. Keeping them separate makes each file under 300
//   lines and lets us test view logic without bringing up the audio stack.
// ============================================================================

import { CATEGORIES, TIERS, EXERCISES, getExercise, getExercisesByCategoryAndTier } from './exercises.js';
import { Visualizer } from './visualizer.js';
import {
  load as loadProgress,
  reset as resetProgress,
  recordRun,
  isMastered,
  isPlayed,
  formatDuration,
  getLatencyOffset,
  setLatencyOffset,
  clearCalibration,
} from './storage.js';
import { CALIB_CONFIG } from './calibration.js';

// ---------------------------------------------------------------------------
// Tiny DOM helpers. We do not pull in a framework; these are sufficient.
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ============================================================================
// HOME VIEW
// ----------------------------------------------------------------------------
// Hero copy, two CTAs, and a collapsed diagnostics panel for verifying that
// audio + mic are working before going into an exercise.
// ============================================================================

export function renderHome(deps, view) {
  clear(view);

  const hero = el('section', { class: 'home' }, [
    el('h1', {}, ['Practice with purpose.']),
    el('p', { class: 'lede' }, [
      'Structured drum exercises, live timing feedback, and progress tracking. ',
      'Pick a category, play along with the click, and get immediate feedback on every hit.',
    ]),
    el('div', { class: 'cta-row' }, [
      el('a', { class: 'btn btn-primary', href: '#/exercises' }, ['Browse Exercises']),
      el('a', { class: 'btn', href: '#/metronome' }, ['Open Metronome']),
    ]),
    renderCalibrationCard(),
  ]);

  // Diagnostics card (collapsed by default)
  const out = el('div', { id: 'diag-output', class: 'diag-output' }, ['Idle.']);
  const diag = el('details', { class: 'diag-card' }, [
    el('summary', {}, ['Quick diagnostics (audio + mic check)']),
    el('p', { class: 'muted' }, ['Use this to confirm the audio pipeline before starting an exercise.']),
    el('div', { class: 'diag-controls' }, [
      el('button', {
        onclick: async () => {
          try {
            const ctx = await deps.unlockAudio();
            const { click } = await deps.ensureSamples();
            const src = ctx.createBufferSource();
            src.buffer = click;
            src.connect(ctx.destination);
            src.start();
            appendLine(out, 'Played test click.', 'info');
          } catch (e) { appendLine(out, `Error: ${e.message}`, 'miss'); }
        }
      }, ['Play Test Click']),
      el('button', {
        onclick: async () => {
          try {
            const m = await deps.getMetronome();
            m.setBpm(120);
            m.setBeatsPerMeasure(4);
            m.start();
            appendLine(out, 'Metronome started at 120 BPM.', 'info');
          } catch (e) { appendLine(out, `Error: ${e.message}`, 'miss'); }
        }
      }, ['Start Metronome']),
      el('button', {
        onclick: () => {
          if (deps.getMetronomeIfReady()) {
            deps.getMetronomeIfReady().stop();
            appendLine(out, 'Metronome stopped.', 'info');
          }
        }
      }, ['Stop']),
      el('button', {
        onclick: async () => {
          try {
            const mic = await deps.getMic();
            if (!mic._diagAttached) {
              mic.onHit(({ time, volume }) => {
                appendLine(out, `Hit at ${time.toFixed(3)}s | volume=${volume.toFixed(3)}`, 'hit');
              });
              mic._diagAttached = true;
            }
            await mic.start();
            appendLine(out, 'Listening - tap your drum or desk.', 'info');
          } catch (e) { appendLine(out, `Mic error: ${e.message}`, 'miss'); }
        }
      }, ['Start Mic']),
      el('button', {
        onclick: () => {
          if (deps.getMicIfReady()) {
            deps.getMicIfReady().stop();
            appendLine(out, 'Mic stopped.', 'info');
          }
        }
      }, ['Stop Mic']),
    ]),
    out,
  ]);

  view.appendChild(hero);
  view.appendChild(diag);
}

function appendLine(node, msg, cls = '') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  node.appendChild(line);
  node.scrollTop = node.scrollHeight;
}

// ============================================================================
// EXERCISES VIEW
// ----------------------------------------------------------------------------
// Lists all categories. Click a category to drill into its tiers and
// individual exercises. Click "Play" on an exercise to navigate to the play
// view for that exercise.
//
// State for "which category is open" lives in the URL hash so back/forward
// works naturally and a refresh keeps you where you were:
//
//   #/exercises               -> category overview
//   #/exercises/rudiments     -> rudiments detail
// ============================================================================

export function renderExercises(deps, view, args) {
  clear(view);
  const categoryId = args[0];
  if (!categoryId) {
    renderExerciseCategoryGrid(view);
  } else {
    renderExerciseCategoryDetail(view, categoryId);
  }
}

function renderExerciseCategoryGrid(view) {
  const grid = el('section', { class: 'exercise-grid' }, [
    el('h1', {}, ['Exercises']),
    el('p', { class: 'lede' }, ['Pick a category to begin.']),
    el('div', { class: 'category-row' },
      CATEGORIES.map((cat) => {
        const count = EXERCISES.filter((e) => e.category === cat.id).length;
        return el('a', { class: 'category-card', href: `#/exercises/${cat.id}` }, [
          el('h2', {}, [cat.label]),
          el('p', { class: 'muted' }, [cat.blurb]),
          el('div', { class: 'category-meta' }, [`${count} exercises  ·  3 tiers`]),
        ]);
      })
    ),
  ]);
  view.appendChild(grid);
}

function renderExerciseCategoryDetail(view, categoryId) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) {
    view.appendChild(el('section', { class: 'placeholder' }, [
      el('h1', {}, ['Unknown category']),
      el('a', { class: 'btn', href: '#/exercises' }, ['← Back']),
    ]));
    return;
  }

  const sections = TIERS.map((tier) => {
    const list = getExercisesByCategoryAndTier(categoryId, tier);
    if (list.length === 0) return null;
    return el('section', { class: 'tier-section' }, [
      el('h3', { class: `tier-heading tier-${tier}` }, [tier.toUpperCase()]),
      el('div', { class: 'exercise-list' },
        list.map((ex) =>
          el('div', { class: 'exercise-card' }, [
            el('div', { class: 'exercise-card-text' }, [
              el('h4', {}, [ex.title]),
              el('p', { class: 'muted' }, [ex.description]),
              el('p', { class: 'exercise-meta' }, [
                `${ex.bpm} BPM  ·  ${ex.timeSignature[0]}/${ex.timeSignature[1]}  ·  ${ex.measures} measures  ·  ${ex.pattern.length} hits`,
              ]),
            ]),
            el('a', { class: 'btn btn-primary', href: `#/play/${ex.id}` }, ['Play']),
          ])
        )
      ),
    ]);
  }).filter(Boolean);

  view.appendChild(el('section', { class: 'category-detail' }, [
    el('a', { class: 'back-link', href: '#/exercises' }, ['← All Categories']),
    el('h1', {}, [cat.label]),
    el('p', { class: 'lede' }, [cat.blurb]),
    ...sections,
  ]));
}

// ============================================================================
// PLAY VIEW
// ----------------------------------------------------------------------------
// The core gameplay loop. Three phases driven by engine state:
//
//   1. PRE-RUN  - Tips, BPM, "Start" button. No audio active.
//   2. RUNNING  - Visualizer animating, mic live, judgments streaming. The
//                 metronome plays a 1-measure countdown, then beats reach
//                 the judgment line at their expected times.
//   3. RESULTS  - Stats summary + tailored suggestions. Buttons to retry
//                 the same exercise, pick another, or go home.
//
// Phase transitions are driven by the engine's onUpdate / onComplete events
// so the view stays in sync with the actual audio state, not a guess.
// ============================================================================

export async function renderPlay(deps, view, args) {
  clear(view);
  const exId = args[0];
  const exercise = getExercise(exId);
  if (!exercise) {
    view.appendChild(el('section', { class: 'placeholder' }, [
      el('h1', {}, ['Exercise not found']),
      el('a', { class: 'btn', href: '#/exercises' }, ['← Back to Exercises']),
    ]));
    return;
  }

  // Layout: header + body. Body swaps between pre-run, running, results.
  const header = el('header', { class: 'play-header' }, [
    el('a', { class: 'back-link', href: `#/exercises/${exercise.category}` }, ['← Back']),
    el('div', { class: 'play-title' }, [
      el('h2', {}, [exercise.title]),
      el('p', { class: 'muted' }, [
        `${exercise.category}  ·  ${exercise.tier}  ·  ${exercise.bpm} BPM  ·  ${exercise.timeSignature[0]}/${exercise.timeSignature[1]}`,
      ]),
    ]),
  ]);

  const body = el('div', { class: 'play-body' });

  view.appendChild(el('section', { class: 'play-view' }, [header, body]));

  // -----------------------------------------------------------------
  // Phase 1: pre-run
  // -----------------------------------------------------------------
  showPreRun();

  function showPreRun() {
    clear(body);
    body.appendChild(el('div', { class: 'pre-run' }, [
      el('h3', {}, ['Before you start']),
      el('p', {}, [exercise.description]),
      el('h4', {}, ['Tips']),
      el('ul', { class: 'tip-list' },
        (exercise.tips || []).map((t) => el('li', {}, [t]))
      ),
      el('div', { class: 'pre-run-controls' }, [
        el('button', { class: 'btn btn-primary btn-large', onclick: startRun }, ['Start']),
        el('p', { class: 'muted' }, ['One measure of countdown clicks will play, then the exercise begins.']),
      ]),
    ]));
  }

  // -----------------------------------------------------------------
  // Phase 2: running
  // -----------------------------------------------------------------
  let visualizer = null;
  let updateUnsub = null;
  let completeUnsub = null;
  let liveStatsEl = null;
  let lastSeenStats = null;
  let engineRef = null;
  let runStartedAt = 0;       // wall-clock ms; used to record practice duration

  async function startRun() {
    clear(body);
    runStartedAt = Date.now();

    // Build the running layout: live HUD, big canvas, stop button.
    liveStatsEl = el('div', { class: 'live-stats' }, ['Get ready...']);
    const canvas = el('canvas', { class: 'play-canvas' });
    const stopBtn = el('button', { class: 'btn', onclick: stopRun }, ['Stop']);

    body.appendChild(el('div', { class: 'running' }, [
      liveStatsEl,
      el('div', { class: 'canvas-wrap' }, [canvas]),
      el('div', { class: 'running-controls' }, [stopBtn]),
    ]));

    try {
      const engine = await deps.getEngine();
      engineRef = engine;
      engine.load(exercise);

      // Visualizer attaches to the engine and reads state every frame.
      visualizer = new Visualizer(canvas);
      visualizer.attach(engine);
      visualizer.start();

      // Stream updates: flash the visualizer on each judgment, refresh HUD.
      updateUnsub = engine.onUpdate((evt) => {
        if (evt.kind === 'hit' && evt.result?.type === 'judged') {
          visualizer.flashJudgment(evt.result.judgment);
        }
        if (evt.stats) {
          lastSeenStats = evt.stats;
          updateLiveStats(evt.state, evt.stats);
        }
      });

      // One-shot completion -> results phase.
      completeUnsub = engine.onComplete(({ stats, suggestions }) => {
        showResults(stats, suggestions);
      });

      await engine.start();
    } catch (err) {
      console.error(err);
      clear(body);
      body.appendChild(el('div', { class: 'error-card' }, [
        el('h3', {}, ['Could not start']),
        el('p', {}, [err.message]),
        err.name === 'NotAllowedError'
          ? el('p', { class: 'muted' }, ['Microphone access is required. Allow it in your browser settings and try again.'])
          : null,
        el('button', { class: 'btn', onclick: showPreRun }, ['Back']),
      ]));
    }
  }

  function updateLiveStats(state, stats) {
    if (!liveStatsEl) return;
    if (state === 'countdown') {
      liveStatsEl.textContent = 'Countdown - listen to the click.';
      return;
    }
    const acc = (stats.accuracy * 100).toFixed(0);
    liveStatsEl.innerHTML = '';
    liveStatsEl.appendChild(el('span', { class: 'live-accuracy' }, [`${acc}% accuracy`]));
    liveStatsEl.appendChild(el('span', { class: 'live-counts' }, [
      `Perfect ${stats.perfect}  ·  Good ${stats.good}  ·  Miss ${stats.miss}`,
    ]));
  }

  function stopRun() {
    if (updateUnsub) { updateUnsub(); updateUnsub = null; }
    if (completeUnsub) { completeUnsub(); completeUnsub = null; }
    if (visualizer) { visualizer.stop(); visualizer = null; }
    if (engineRef) engineRef.stop();
    showPreRun();
  }

  // -----------------------------------------------------------------
  // Phase 3: results
  // -----------------------------------------------------------------
  function showResults(stats, suggestions) {
    // Detach mid-run hooks but keep the visualizer briefly so the user can
    // see the final state. Then teardown.
    if (updateUnsub) { updateUnsub(); updateUnsub = null; }
    if (completeUnsub) { completeUnsub(); completeUnsub = null; }
    if (visualizer) { visualizer.stop(); visualizer = null; }
    if (engineRef) {
      // Defer the hard stop slightly so the mic releases gracefully.
      setTimeout(() => engineRef.stop(), 800);
    }

    clear(body);

    const acc = (stats.accuracy * 100).toFixed(1);
    const meanMs = (stats.meanDelta * 1000).toFixed(1);
    const stdMs = (stats.stdDelta * 1000).toFixed(1);
    const grade = letterGrade(stats);

    // Persist the run to localStorage. Wraps in try so a storage failure
    // (e.g. private browsing, full quota) never breaks the results screen.
    try {
      const durationMs = runStartedAt > 0 ? Date.now() - runStartedAt : 0;
      recordRun(exercise.id, {
        accuracy: stats.accuracy,
        grade,
        durationMs,
      });
    } catch (err) {
      console.warn('Failed to record run:', err);
    }

    body.appendChild(el('div', { class: 'results' }, [
      el('div', { class: `results-grade grade-${grade.toLowerCase()}` }, [grade]),
      el('h3', {}, [`${acc}% accuracy`]),
      el('div', { class: 'results-counts' }, [
        statBlock('Perfect', stats.perfect, 'count-perfect'),
        statBlock('Good', stats.good, 'count-good'),
        statBlock('Miss', stats.miss, 'count-miss'),
        statBlock('Extras', stats.extras, 'count-extras'),
      ]),
      el('p', { class: 'muted small' }, [
        `Average offset: ${meanMs}ms (negative = early)  ·  Spread: ±${stdMs}ms`,
      ]),
      el('h4', {}, ['Suggestions']),
      el('ul', { class: 'suggestions-list' },
        suggestions.map((s) =>
          el('li', { class: `suggestion suggestion-${s.severity}` }, [s.text])
        )
      ),
      el('div', { class: 'results-controls' }, [
        el('button', { class: 'btn btn-primary', onclick: () => { showPreRun(); setTimeout(startRun, 50); } }, ['Try Again']),
        el('a', { class: 'btn', href: `#/exercises/${exercise.category}` }, ['Pick Another']),
        el('a', { class: 'btn', href: '#/home' }, ['Home']),
      ]),
    ]));
  }

  // Cleanup if the user navigates away mid-run.
  window.addEventListener('hashchange', cleanupOnNav, { once: true });
  function cleanupOnNav() {
    if (updateUnsub) updateUnsub();
    if (completeUnsub) completeUnsub();
    if (visualizer) visualizer.stop();
    if (engineRef) engineRef.stop();
  }
}

function statBlock(label, value, cls) {
  return el('div', { class: `stat-block ${cls}` }, [
    el('div', { class: 'stat-value' }, [String(value)]),
    el('div', { class: 'stat-label' }, [label]),
  ]);
}

function letterGrade(stats) {
  // Simple rubric over accuracy, with a perfect-rate kicker for top grades.
  const acc = stats.accuracy;
  const pRate = stats.total > 0 ? stats.perfect / stats.total : 0;
  if (acc >= 0.95 && pRate >= 0.7) return 'A';
  if (acc >= 0.85)                 return 'B';
  if (acc >= 0.70)                 return 'C';
  if (acc >= 0.50)                 return 'D';
  return 'F';
}

// ============================================================================
// METRONOME VIEW
// ----------------------------------------------------------------------------
// Standalone metronome - separate from exercise play mode. The requirements
// doc specifies 40-300 BPM (we clamp the UI to that) and 4/4 + 3/4 time
// signatures (we add 2/4 and 6/8 since the underlying class supports it for
// no extra cost).
//
// Visuals:
//   - Big tempo readout
//   - Slider, +/-1 / +/-5 buttons, numeric input (all kept in sync)
//   - Time-signature buttons
//   - A row of beat dots that light up on each click (downbeat is bigger)
//   - Start / Stop toggle
//
// Cleanup: we register a one-shot hashchange listener that stops the
// metronome and unsubscribes the onBeat listener so navigating away leaves
// no audio running.
// ============================================================================

const METRO_MIN_BPM = 40;
const METRO_MAX_BPM = 300;

export function renderMetronome(deps, view) {
  clear(view);

  // Local state for this view instance
  let bpm = 120;
  let beatsPerMeasure = 4;
  let metro = null;
  let unsubBeat = null;
  let isRunning = false;

  // ---------- DOM elements (built up first, wired below) ----------
  const tempoValueEl = el('span', { class: 'tempo-value' }, [String(bpm)]);
  const tempoDisplay = el('div', { class: 'tempo-display' }, [
    tempoValueEl,
    el('span', { class: 'tempo-unit' }, ['BPM']),
  ]);

  const beatRow = el('div', { class: 'beat-row' });

  const slider = el('input', {
    type: 'range',
    min: METRO_MIN_BPM, max: METRO_MAX_BPM, value: String(bpm), step: '1',
    class: 'tempo-slider',
    'aria-label': 'Tempo slider',
  });
  slider.addEventListener('input', (e) => setTempo(Number(e.target.value)));

  const numericInput = el('input', {
    type: 'number',
    min: METRO_MIN_BPM, max: METRO_MAX_BPM, value: String(bpm), step: '1',
    class: 'tempo-input',
    id: 'tempo-num',
    'aria-label': 'Set BPM',
  });
  numericInput.addEventListener('change', (e) => setTempo(Number(e.target.value)));

  const startStopBtn = el('button', {
    class: 'btn btn-primary btn-large',
    onclick: toggleStartStop,
  }, ['Start']);

  const timeSigOptions = [[2, '2/4'], [3, '3/4'], [4, '4/4'], [6, '6/8']];
  const timeSigButtons = timeSigOptions.map(([num, label]) =>
    el('button', {
      class: 'time-sig-btn' + (num === beatsPerMeasure ? ' active' : ''),
      'data-num': String(num),
      onclick: () => setTimeSignature(num),
    }, [label])
  );

  // ---------- Helpers ----------

  function rebuildBeatRow() {
    clear(beatRow);
    for (let i = 0; i < beatsPerMeasure; i++) {
      beatRow.appendChild(el('div', {
        class: 'beat-dot' + (i === 0 ? ' beat-dot-accent' : ''),
        'data-beat': String(i),
      }));
    }
  }

  function setTempo(newBpm) {
    const clamped = Math.max(METRO_MIN_BPM, Math.min(METRO_MAX_BPM, Math.round(newBpm)));
    if (Number.isNaN(clamped)) return;
    bpm = clamped;
    tempoValueEl.textContent = String(bpm);
    slider.value = String(bpm);
    numericInput.value = String(bpm);
    if (metro) {
      // setBpm mid-run is supported by the Metronome class; the next
      // scheduled beat will use the new tempo.
      try { metro.setBpm(bpm); } catch (e) { console.warn(e); }
    }
  }

  function setTimeSignature(num) {
    beatsPerMeasure = num;
    rebuildBeatRow();
    timeSigButtons.forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.num) === num);
    });
    if (metro) {
      try { metro.setBeatsPerMeasure(num); } catch (e) { console.warn(e); }
    }
  }

  async function toggleStartStop() {
    if (isRunning) {
      stopMetro();
    } else {
      try {
        metro = await deps.getMetronome();
        metro.setBpm(bpm);
        metro.setBeatsPerMeasure(beatsPerMeasure);
        // Subscribe each time we start so we don't double-fire if a previous
        // unsub leaked. The onBeat callback lights up the visual indicator.
        if (unsubBeat) { unsubBeat(); unsubBeat = null; }
        unsubBeat = metro.onBeat(({ measureBeat }) => {
          const dots = beatRow.querySelectorAll('.beat-dot');
          dots.forEach((d, i) => {
            d.classList.toggle('active', i === measureBeat);
          });
        });
        metro.start();
        isRunning = true;
        startStopBtn.textContent = 'Stop';
      } catch (err) {
        console.error('Metronome start failed:', err);
      }
    }
  }

  function stopMetro() {
    if (metro && isRunning) {
      try { metro.stop(); } catch {}
    }
    if (unsubBeat) { unsubBeat(); unsubBeat = null; }
    beatRow.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('active'));
    isRunning = false;
    startStopBtn.textContent = 'Start';
  }

  // Cleanup on navigation away
  window.addEventListener('hashchange', cleanupOnNav, { once: true });
  function cleanupOnNav() { stopMetro(); }

  // ---------- Initial render ----------

  rebuildBeatRow();

  view.appendChild(el('section', { class: 'metronome-view' }, [
    el('h1', {}, ['Metronome']),
    el('p', { class: 'lede' }, [
      `Adjustable from ${METRO_MIN_BPM} to ${METRO_MAX_BPM} BPM. Use it on its own to practice with a steady click, or as a warm-up before an exercise.`,
    ]),
    el('div', { class: 'metro-card' }, [
      el('div', { class: 'beat-row-wrap' }, [beatRow]),
      tempoDisplay,
      el('div', { class: 'tempo-controls' }, [
        el('button', { class: 'tempo-step', onclick: () => setTempo(bpm - 5) }, ['−5']),
        el('button', { class: 'tempo-step', onclick: () => setTempo(bpm - 1) }, ['−1']),
        slider,
        el('button', { class: 'tempo-step', onclick: () => setTempo(bpm + 1) }, ['+1']),
        el('button', { class: 'tempo-step', onclick: () => setTempo(bpm + 5) }, ['+5']),
      ]),
      el('div', { class: 'tempo-input-row' }, [
        el('label', { for: 'tempo-num', class: 'muted' }, ['Set exact BPM:']),
        numericInput,
      ]),
      el('div', { class: 'time-sig-row' }, [
        el('span', { class: 'muted' }, ['Time signature:']),
        ...timeSigButtons,
      ]),
      el('div', { class: 'metro-start-row' }, [startStopBtn]),
    ]),
  ]));
}

// ============================================================================
// PROGRESS VIEW
// ----------------------------------------------------------------------------
// Dashboard rendered from localStorage state. Three sections:
//
//   1. Top stats - total practice time, total runs, exercises played,
//      exercises mastered.
//   2. Per-category cards - progress bar showing mastered/total, plus a
//      list of all exercises in the category with their current status.
//   3. Recent runs table - last 10 runs with timestamp, accuracy, grade.
//
// "Mastered" = bestGrade is B or higher (see storage.js MASTERY_GRADE).
// ============================================================================

export function renderProgress(deps, view) {
  clear(view);
  const state = loadProgress();

  const masteredCount = countMastered(state);
  const playedCount = Object.keys(state.exercises).filter((id) => isPlayed(state.exercises[id])).length;
  const totalExercises = EXERCISES.length;

  view.appendChild(el('section', { class: 'progress-view' }, [
    el('h1', {}, ['Progress']),
    el('p', { class: 'lede' }, [
      'Your practice history. An exercise is "mastered" once you reach a B grade or higher.',
    ]),

    // Top stats
    el('div', { class: 'progress-stats' }, [
      progressStat('Total practice', formatDuration(state.totalPracticeMs)),
      progressStat('Total runs', String(state.totalRuns)),
      progressStat('Mastered', `${masteredCount} / ${totalExercises}`),
      progressStat('Played', `${playedCount} / ${totalExercises}`),
    ]),

    // Per-category cards
    el('div', { class: 'progress-categories' },
      CATEGORIES.map((cat) => renderCategoryProgress(state, cat))
    ),

    // Recent runs
    state.runs.length > 0 ? renderRecentRuns(state) : el('div', { class: 'progress-empty' }, [
      el('p', { class: 'muted' }, ['No runs recorded yet. Play an exercise to start tracking.']),
      el('a', { class: 'btn btn-primary', href: '#/exercises' }, ['Browse Exercises']),
    ]),

    // Reset
    state.totalRuns > 0 ? el('div', { class: 'progress-reset' }, [
      el('button', { class: 'btn', onclick: () => {
        if (confirm('Reset all progress? This cannot be undone.')) {
          resetProgress();
          renderProgress(deps, view);
        }
      } }, ['Reset all progress']),
    ]) : null,
  ]));
}

function progressStat(label, value) {
  return el('div', { class: 'progress-stat' }, [
    el('div', { class: 'progress-stat-value' }, [value]),
    el('div', { class: 'progress-stat-label' }, [label]),
  ]);
}

function renderCategoryProgress(state, cat) {
  const exercises = EXERCISES.filter((e) => e.category === cat.id);
  const total = exercises.length;
  const mastered = exercises.filter((e) => isMastered(state.exercises[e.id])).length;
  const played = exercises.filter((e) => isPlayed(state.exercises[e.id])).length;
  const masteredPct = total > 0 ? (mastered / total) * 100 : 0;

  return el('div', { class: 'progress-category-card' }, [
    el('div', { class: 'progress-category-head' }, [
      el('h3', {}, [cat.label]),
      el('span', { class: 'muted small' }, [`${mastered} / ${total} mastered`]),
    ]),
    el('div', { class: 'progress-bar' }, [
      el('div', { class: 'progress-bar-fill', style: `width: ${masteredPct}%;` }),
    ]),
    el('ul', { class: 'progress-exercise-list' },
      exercises.map((ex) => {
        const entry = state.exercises[ex.id];
        let status, statusLabel;
        if (isMastered(entry)) {
          status = 'mastered';
          statusLabel = `Mastered  ·  best ${entry.bestGrade} (${(entry.bestAccuracy * 100).toFixed(0)}%)`;
        } else if (isPlayed(entry)) {
          status = 'played';
          statusLabel = `Played  ·  best ${entry.bestGrade} (${(entry.bestAccuracy * 100).toFixed(0)}%)`;
        } else {
          status = 'new';
          statusLabel = 'Not yet played';
        }
        return el('li', { class: `progress-ex progress-ex-${status}` }, [
          el('span', { class: 'progress-ex-title' }, [ex.title]),
          el('span', { class: 'progress-ex-status' }, [statusLabel]),
        ]);
      })
    ),
  ]);
}

function renderRecentRuns(state) {
  const recent = state.runs.slice(0, 10);
  return el('div', { class: 'recent-runs' }, [
    el('h3', {}, ['Recent runs']),
    el('table', { class: 'recent-runs-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['When']),
          el('th', {}, ['Exercise']),
          el('th', {}, ['Accuracy']),
          el('th', {}, ['Grade']),
          el('th', {}, ['Duration']),
        ]),
      ]),
      el('tbody', {},
        recent.map((r) => {
          const ex = getExercise(r.exerciseId);
          const gradeClass = `grade-cell grade-${r.grade.toLowerCase()}`;
          return el('tr', {}, [
            el('td', {}, [formatRelative(r.atISO)]),
            el('td', {}, [ex ? ex.title : r.exerciseId]),
            el('td', {}, [`${(r.accuracy * 100).toFixed(0)}%`]),
            el('td', { class: gradeClass }, [r.grade]),
            el('td', {}, [formatDuration(r.durationMs)]),
          ]);
        })
      ),
    ]),
  ]);
}

function countMastered(state) {
  let c = 0;
  for (const id in state.exercises) {
    if (isMastered(state.exercises[id])) c++;
  }
  return c;
}

function formatRelative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ============================================================================
// CALIBRATION CARD (home-page widget) and CALIBRATION VIEW
// ----------------------------------------------------------------------------
// The home-page card surfaces calibration prominently when the user has not
// yet calibrated, and shows status (last calibration time + saved offset)
// when they have. Clicking through goes to the full calibration view.
//
// The full view runs CalibrationRunner, shows progress, and saves the result.
// ============================================================================

function renderCalibrationCard() {
  const offset = getLatencyOffset();
  const state = loadProgress();
  const calibrated = !!state.calibratedAtISO;

  if (!calibrated) {
    return el('div', { class: 'calibration-card calibration-card-warn' }, [
      el('div', {}, [
        el('h3', {}, ['Calibrate before your first run']),
        el('p', { class: 'muted' }, [
          'Browser audio has variable latency. A 30-second calibration measures your offset and applies it so timing scoring is fair.',
        ]),
      ]),
      el('a', { class: 'btn btn-primary', href: '#/calibrate' }, ['Calibrate now']),
    ]);
  }

  const offsetMs = (offset * 1000).toFixed(0);
  const offsetLabel = offset === 0
    ? 'No offset'
    : (offset > 0 ? `+${offsetMs}ms` : `${offsetMs}ms`);

  return el('div', { class: 'calibration-card' }, [
    el('div', {}, [
      el('h3', {}, ['Calibration']),
      el('p', { class: 'muted' }, [
        `Offset: ${offsetLabel}  ·  Calibrated ${formatRelative(state.calibratedAtISO)}.`,
      ]),
    ]),
    el('a', { class: 'btn', href: '#/calibrate' }, ['Recalibrate']),
  ]);
}

// ----------------------------------------------------------------------------
// Calibration view
// ----------------------------------------------------------------------------

export function renderCalibration(deps, view) {
  clear(view);

  let runner = null;
  let unsubUpdate = null;
  let unsubComplete = null;

  const statusEl = el('div', { class: 'calib-status' }, ['Ready when you are.']);
  const counterEl = el('div', { class: 'calib-counter' }, [`0 / ${CALIB_CONFIG.beats} captured`]);
  const liveOffsetEl = el('div', { class: 'calib-live-offset muted' }, ['']);

  const startBtn = el('button', { class: 'btn btn-primary btn-large', onclick: startCalibration }, ['Start Calibration']);
  const stopBtn = el('button', { class: 'btn', onclick: stopCalibration }, ['Stop']);
  stopBtn.style.display = 'none';

  const resultsArea = el('div', { class: 'calib-results' });

  view.appendChild(el('section', { class: 'calibration-view' }, [
    el('h1', {}, ['Latency Calibration']),
    el('p', { class: 'lede' }, [
      `Tap along to ${CALIB_CONFIG.beats} steady clicks at ${CALIB_CONFIG.bpm} BPM. ` +
      `We'll measure your average offset and apply it to all future scoring.`,
    ]),
    el('div', { class: 'calib-card' }, [
      el('h3', {}, ['How it works']),
      el('ol', {}, [
        el('li', {}, [`The metronome plays a ${CALIB_CONFIG.leadBeats}-beat countdown.`]),
        el('li', {}, [`Then ${CALIB_CONFIG.beats} more clicks. Tap on each one.`]),
        el('li', {}, ['We compute the median timing offset from your taps and save it.']),
      ]),
      statusEl,
      counterEl,
      liveOffsetEl,
      el('div', { class: 'calib-controls' }, [startBtn, stopBtn]),
      resultsArea,
    ]),
  ]));

  // Cleanup on navigation away
  window.addEventListener('hashchange', cleanupOnNav, { once: true });
  function cleanupOnNav() {
    if (unsubUpdate) unsubUpdate();
    if (unsubComplete) unsubComplete();
    if (runner) runner.stop();
  }

  // ---------- handlers ----------

  async function startCalibration() {
    clear(resultsArea);
    statusEl.textContent = 'Starting...';
    counterEl.textContent = `0 / ${CALIB_CONFIG.beats} captured`;
    liveOffsetEl.textContent = '';
    startBtn.style.display = 'none';
    stopBtn.style.display = '';

    try {
      runner = await deps.getCalibration();
      if (unsubUpdate) unsubUpdate();
      if (unsubComplete) unsubComplete();

      unsubUpdate = runner.onUpdate((evt) => {
        if (evt.kind === 'state') {
          if (evt.state === 'countdown') statusEl.textContent = 'Get ready - listen to the countdown clicks.';
          else if (evt.state === 'capturing') statusEl.textContent = 'Tap on every click now.';
          else if (evt.state === 'complete') statusEl.textContent = 'Done.';
          return;
        }
        if (evt.capturedCount != null) {
          counterEl.textContent = `${evt.capturedCount} / ${evt.targetCount} captured`;
        }
        // Show running median if we have at least 2 samples
        if (evt.expected) {
          const deltas = evt.expected.filter((e) => e.delta != null).map((e) => e.delta);
          if (deltas.length >= 2) {
            const sorted = [...deltas].sort((a, b) => a - b);
            const med = sorted[Math.floor(sorted.length / 2)];
            const sign = med >= 0 ? '+' : '';
            liveOffsetEl.textContent = `Running median offset: ${sign}${(med * 1000).toFixed(0)}ms`;
          }
        }
      });

      unsubComplete = runner.onComplete((result) => {
        startBtn.style.display = '';
        stopBtn.style.display = 'none';
        showResult(result);
      });

      await runner.start();
    } catch (err) {
      startBtn.style.display = '';
      stopBtn.style.display = 'none';
      statusEl.textContent = 'Could not start';
      resultsArea.appendChild(el('div', { class: 'error-card' }, [
        el('h4', {}, ['Calibration failed to start']),
        el('p', {}, [err.message]),
        err.name === 'NotAllowedError'
          ? el('p', { class: 'muted' }, ['Microphone access is required. Allow it in your browser settings and try again.'])
          : null,
      ]));
    }
  }

  function stopCalibration() {
    if (runner) runner.stop();
    startBtn.style.display = '';
    stopBtn.style.display = 'none';
    statusEl.textContent = 'Stopped.';
  }

  function showResult(result) {
    if (!result.ok) {
      const reasonText = {
        'no-hits':       'We did not detect any hits. Make sure your microphone is on and try again.',
        'too-few-hits':  `We only got ${result.sampleCount} usable hits. Tap on every click and try again.`,
        'inconsistent':  `Your taps were too inconsistent (spread of ±${(result.meanAbsDevSec * 1000).toFixed(0)}ms). The number won't be accurate. Retry with steady taps.`,
      }[result.reason] || 'Calibration was inconclusive.';

      resultsArea.appendChild(el('div', { class: 'calib-result calib-result-warn' }, [
        el('h4', {}, ['Calibration not saved']),
        el('p', {}, [reasonText]),
        el('div', { class: 'calib-actions' }, [
          el('button', { class: 'btn btn-primary', onclick: startCalibration }, ['Try Again']),
        ]),
      ]));
      return;
    }

    const offsetMs = (result.offsetSec * 1000).toFixed(1);
    const sign = result.offsetSec >= 0 ? '+' : '';
    const devMs = (result.meanAbsDevSec * 1000).toFixed(1);

    setLatencyOffset(result.offsetSec);

    resultsArea.appendChild(el('div', { class: 'calib-result calib-result-ok' }, [
      el('h4', {}, ['Calibration saved']),
      el('p', {}, [
        `Your audio latency is ${sign}${offsetMs}ms (consistency: ±${devMs}ms across ${result.sampleCount} hits). ` +
        `This offset will be applied automatically on all future runs.`,
      ]),
      el('p', { class: 'muted small' }, [
        result.offsetSec > 0.040
          ? 'A positive offset is normal - it accounts for the time between when audio leaves your speaker and your hit reaches the mic.'
          : (result.offsetSec < -0.040
              ? 'A negative offset is unusual; double-check that you tapped in time with the click rather than ahead of it.'
              : 'A near-zero offset means your setup is already close to ideal.'),
      ]),
      el('div', { class: 'calib-actions' }, [
        el('a', { class: 'btn', href: '#/exercises' }, ['Browse Exercises']),
        el('a', { class: 'btn', href: '#/home' }, ['Home']),
        el('button', { class: 'btn', onclick: () => { clearCalibration(); startCalibration(); } }, ['Recalibrate']),
      ]),
    ]));
  }
}
