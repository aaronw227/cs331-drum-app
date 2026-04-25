// ============================================================================
// app.js
// ----------------------------------------------------------------------------
// SPA entry point. Three responsibilities:
//
//   1. Hash-based routing between views (#/home, #/exercises, etc.)
//   2. Lazy initialization of audio singletons (AudioContext, Metronome,
//      MicListener) - we don't create these until the user does something
//      that requires them, because browsers gate audio behind a user gesture.
//   3. Wiring up the diagnostics and Day-2 test panel on the Home page.
//
// The "real" UI for browsing exercises and viewing progress lands on Day 3-4;
// the Home-page panels here are intentionally rough so the underlying pipeline
// can be smoke-tested before we invest in polished views.
// ============================================================================

import { getAudioContext, unlockAudio, loadSample } from './audio.js';
import { Metronome } from './metronome.js';
import { MicListener } from './listener.js';
import { PlayAlongEngine } from './engine.js';
import { EXERCISES, getExercise } from './exercises.js';

const ROUTES = ['home', 'exercises', 'metronome', 'progress'];
const DEFAULT_ROUTE = 'home';

// ---------------------------------------------------------------------------
// Lazy-initialized audio singletons. We keep references in module scope so a
// second route visit doesn't recreate the AudioContext (browsers limit how
// many can exist).
// ---------------------------------------------------------------------------

let _clickBuf = null;
let _accentBuf = null;
let _metro = null;
let _mic = null;
let _engine = null;

async function ensureSamples() {
  if (!_clickBuf)  _clickBuf  = await loadSample('assets/click.wav');
  if (!_accentBuf) _accentBuf = await loadSample('assets/click-accent.wav');
  return { click: _clickBuf, accent: _accentBuf };
}

async function getMetronome() {
  if (_metro) return _metro;
  const ctx = await unlockAudio();
  const { click, accent } = await ensureSamples();
  _metro = new Metronome(ctx, click, accent);
  return _metro;
}

async function getMic() {
  if (_mic) return _mic;
  const ctx = await unlockAudio();
  _mic = new MicListener(ctx);
  return _mic;
}

async function getEngine() {
  if (_engine) return _engine;
  const ctx = await unlockAudio();
  const metro = await getMetronome();
  const mic = await getMic();
  _engine = new PlayAlongEngine({ audioCtx: ctx, metronome: metro, micListener: mic });
  return _engine;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(hash) ? hash : DEFAULT_ROUTE;
}

function render() {
  const route = currentRoute();
  const tpl = document.getElementById(`tpl-${route}`);
  const view = document.getElementById('view');
  view.innerHTML = '';
  if (tpl) view.appendChild(tpl.content.cloneNode(true));

  // Update nav active state
  document.querySelectorAll('.app-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  if (route === 'home') wireHome();
}

window.addEventListener('hashchange', render);

// ---------------------------------------------------------------------------
// Home: diagnostics panel
// ---------------------------------------------------------------------------

function appendLine(targetId, msg, cls = '') {
  const out = document.getElementById(targetId);
  if (!out) return;
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function clearOutput(targetId) {
  const out = document.getElementById(targetId);
  if (out) out.textContent = '';
}

function wireHome() {
  wireDiagnostics();
  wireExerciseRunner();
}

function wireDiagnostics() {
  const clickBtn = document.getElementById('diag-click-test');
  const metroStartBtn = document.getElementById('diag-metro-test');
  const metroStopBtn = document.getElementById('diag-metro-stop');
  const micStartBtn = document.getElementById('diag-mic-test');
  const micStopBtn = document.getElementById('diag-mic-stop');

  clickBtn?.addEventListener('click', async () => {
    try {
      const ctx = await unlockAudio();
      const { click } = await ensureSamples();
      const src = ctx.createBufferSource();
      src.buffer = click;
      src.connect(ctx.destination);
      src.start();
      appendLine('diag-output', 'Played test click.', 'info');
    } catch (err) {
      appendLine('diag-output', `Error playing click: ${err.message}`, 'miss');
    }
  });

  metroStartBtn?.addEventListener('click', async () => {
    try {
      const m = await getMetronome();
      m.setBpm(120);
      m.setBeatsPerMeasure(4);
      if (!m._diagListenerAttached) {
        m.onBeat(({ measureBeat, isAccent }) => {
          appendLine('diag-output', `Beat ${measureBeat + 1}${isAccent ? ' (accent)' : ''}`, 'info');
        });
        m._diagListenerAttached = true;
      }
      m.start();
      appendLine('diag-output', 'Metronome started at 120 BPM.', 'info');
    } catch (err) {
      appendLine('diag-output', `Metronome error: ${err.message}`, 'miss');
    }
  });

  metroStopBtn?.addEventListener('click', () => {
    if (_metro) {
      _metro.stop();
      appendLine('diag-output', 'Metronome stopped.', 'info');
    }
  });

  micStartBtn?.addEventListener('click', async () => {
    try {
      const mic = await getMic();
      if (!mic._diagListenerAttached) {
        mic.onHit(({ time, volume }) => {
          appendLine('diag-output', `Hit detected at ${time.toFixed(3)}s | volume=${volume.toFixed(3)}`, 'hit');
        });
        mic._diagListenerAttached = true;
      }
      await mic.start();
      appendLine('diag-output', 'Listening... tap your desk or drum pad.', 'info');
      hideBanner();
    } catch (err) {
      appendLine('diag-output', `Mic error: ${err.message}`, 'miss');
      showBanner('Microphone blocked. Check browser permissions.');
    }
  });

  micStopBtn?.addEventListener('click', () => {
    if (_mic) {
      _mic.stop();
      appendLine('diag-output', 'Mic test stopped.', 'info');
    }
  });
}

// ---------------------------------------------------------------------------
// Home: Day-2 exercise-runner panel.
// ----------------------------------------------------------------------------
// Populates the picker from EXERCISES, runs the engine on Run, and streams
// judgments + final summary into the status box.
// ---------------------------------------------------------------------------

function wireExerciseRunner() {
  const picker = document.getElementById('ex-picker');
  const runBtn = document.getElementById('ex-run');
  const stopBtn = document.getElementById('ex-stop');
  if (!picker || !runBtn) return;

  // Populate the dropdown grouped by category. Categories first, then options
  // inside each <optgroup>.
  picker.innerHTML = '';
  const categoryGroups = {};
  for (const ex of EXERCISES) {
    if (!categoryGroups[ex.category]) {
      const g = document.createElement('optgroup');
      g.label = ex.category;
      categoryGroups[ex.category] = g;
      picker.appendChild(g);
    }
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = `${ex.title} (${ex.tier}, ${ex.bpm} BPM)`;
    categoryGroups[ex.category].appendChild(opt);
  }

  let _completeUnsub = null;
  let _updateUnsub = null;

  runBtn.addEventListener('click', async () => {
    clearOutput('ex-status');
    const exId = picker.value;
    const ex = getExercise(exId);
    if (!ex) {
      appendLine('ex-status', 'No exercise selected.', 'miss');
      return;
    }

    try {
      const engine = await getEngine();

      // Clean up any prior subscriptions so we don't double-log on a re-run.
      if (_updateUnsub)   { _updateUnsub();   _updateUnsub = null; }
      if (_completeUnsub) { _completeUnsub(); _completeUnsub = null; }

      _updateUnsub = engine.onUpdate((evt) => {
        if (evt.kind === 'state') {
          appendLine('ex-status', `[state] ${evt.state}`, 'info');
        } else if (evt.kind === 'hit' && evt.result?.type === 'judged') {
          const r = evt.result;
          const ms = (r.delta * 1000).toFixed(1);
          const sign = r.delta >= 0 ? '+' : '';
          const cls = r.judgment === 'perfect' ? 'hit'
                    : r.judgment === 'good'    ? 'info' : 'miss';
          appendLine(
            'ex-status',
            `Hit on beat ${r.index + 1}: ${r.judgment.toUpperCase()} (${sign}${ms}ms)`,
            cls
          );
        } else if (evt.kind === 'hit' && evt.result?.type === 'extra') {
          appendLine('ex-status', `Extra hit at ${evt.result.time.toFixed(3)}s (no matching beat)`, 'info');
        } else if (evt.kind === 'miss' && evt.missed?.length) {
          for (const m of evt.missed) {
            appendLine('ex-status', `Beat ${m.index + 1} missed.`, 'miss');
          }
        }
      });

      _completeUnsub = engine.onComplete(({ stats, suggestions, exercise }) => {
        appendLine('ex-status', '', '');
        appendLine('ex-status', `=== ${exercise.title} - Complete ===`, 'info');
        appendLine('ex-status', `Perfect: ${stats.perfect} / Good: ${stats.good} / Miss: ${stats.miss} / Extras: ${stats.extras}`, 'info');
        appendLine('ex-status', `Accuracy: ${(stats.accuracy * 100).toFixed(1)}%`, 'info');
        appendLine('ex-status', `Average offset: ${(stats.meanDelta * 1000).toFixed(1)}ms (negative = early)`, 'info');
        appendLine('ex-status', `Spread (std dev): ±${(stats.stdDelta * 1000).toFixed(1)}ms`, 'info');
        appendLine('ex-status', '', '');
        appendLine('ex-status', '--- Suggestions ---', 'info');
        for (const tip of suggestions) {
          appendLine('ex-status', `[${tip.severity}] ${tip.text}`,
                     tip.severity === 'positive' ? 'hit' : 'info');
        }
        // Auto-stop after a moment so the mic releases.
        setTimeout(() => engine.stop(), 1500);
      });

      engine.load(ex);
      await engine.start();
      appendLine('ex-status', `Loaded "${ex.title}" at ${ex.bpm} BPM. Get ready for the countdown...`, 'info');
      hideBanner();
    } catch (err) {
      appendLine('ex-status', `Error: ${err.message}`, 'miss');
      if (err.name === 'NotAllowedError') {
        showBanner('Microphone permission denied. Allow it in your browser to score hits.');
      }
    }
  });

  stopBtn?.addEventListener('click', async () => {
    if (_engine) {
      _engine.stop();
      appendLine('ex-status', 'Stopped by user.', 'info');
    }
  });
}

// ---------------------------------------------------------------------------
// Mic permission banner
// ---------------------------------------------------------------------------

function showBanner(text) {
  const banner = document.getElementById('mic-banner');
  const textEl = document.getElementById('mic-banner-text');
  if (text && textEl) textEl.textContent = text;
  banner?.classList.remove('hidden');
}

function hideBanner() {
  document.getElementById('mic-banner')?.classList.add('hidden');
}

document.getElementById('mic-enable')?.addEventListener('click', async () => {
  try {
    const mic = await getMic();
    await mic.start();
    mic.stop();   // we just wanted the permission prompt
    hideBanner();
  } catch (err) {
    showBanner(`Microphone blocked: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (!window.location.hash) window.location.hash = '#/home';
render();
