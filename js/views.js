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

  async function startRun() {
    clear(body);

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
// METRONOME VIEW (Day 4 placeholder)
// ============================================================================

export function renderMetronome(deps, view) {
  clear(view);
  view.appendChild(el('section', { class: 'placeholder' }, [
    el('h1', {}, ['Metronome']),
    el('p', { class: 'muted' }, ['The standalone metronome view lands on Day 4.']),
    el('a', { class: 'btn', href: '#/home' }, ['Home']),
  ]));
}

// ============================================================================
// PROGRESS VIEW (Day 4 placeholder)
// ============================================================================

export function renderProgress(deps, view) {
  clear(view);
  view.appendChild(el('section', { class: 'placeholder' }, [
    el('h1', {}, ['Progress']),
    el('p', { class: 'muted' }, ['Per-category progress bars and total practice minutes land on Day 4.']),
    el('a', { class: 'btn', href: '#/home' }, ['Home']),
  ]));
}
