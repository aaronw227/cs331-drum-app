// ============================================================================
// app.js
// ----------------------------------------------------------------------------
// SPA entry point. Three responsibilities, in this order:
//
//   1. Lazy-create the audio singletons. AudioContext, Metronome, MicListener,
//      and the PlayAlongEngine are created on first demand so we don't
//      generate them just for visiting the home page (browsers limit how many
//      AudioContexts can exist).
//   2. Hash-based routing. We split the path on "/" so we get parameters:
//        #/exercises/rudiments     -> route='exercises', args=['rudiments']
//        #/play/rud-singles-beg    -> route='play',      args=['rud-singles-beg']
//   3. Delegate to views.js for the actual rendering. app.js never touches
//      the DOM beyond passing the view container along.
//
// Everything view-shaped lives in views.js. Everything audio-shaped lives in
// the modules under js/. This file is the seam between them.
// ============================================================================

import { getAudioContext, unlockAudio, loadSample } from './audio.js';
import { Metronome } from './metronome.js';
import { MicListener } from './listener.js';
import { PlayAlongEngine } from './engine.js';
import { CalibrationRunner } from './calibration.js';
import { renderHome, renderExercises, renderPlay, renderMetronome, renderProgress, renderCalibration } from './views.js';

const ROUTES = ['home', 'exercises', 'metronome', 'progress', 'play', 'calibrate'];
const DEFAULT_ROUTE = 'home';

// ---------------------------------------------------------------------------
// Lazy audio singletons. References live in module scope so a second visit to
// the same view doesn't recreate them.
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

/**
 * Calibration uses the same singletons (metronome + mic) as the engine.
 * We don't cache the runner itself - one fresh instance per calibration is
 * cheap and keeps state between attempts clean.
 */
async function getCalibration() {
  const ctx = await unlockAudio();
  const metro = await getMetronome();
  const mic = await getMic();
  return new CalibrationRunner({ audioCtx: ctx, metronome: metro, micListener: mic });
}

// Synchronous "if-already-built" accessors so views can stop running audio
// without inadvertently constructing it.
const getMetronomeIfReady = () => _metro;
const getMicIfReady = () => _mic;
const getEngineIfReady = () => _engine;

// Bag of dependencies passed to each view. Centralizing it here means a view
// only depends on this shape, not on app.js internals.
const deps = {
  getAudioContext,
  unlockAudio,
  ensureSamples,
  getMetronome,
  getMic,
  getEngine,
  getCalibration,
  getMetronomeIfReady,
  getMicIfReady,
  getEngineIfReady,
};

// ---------------------------------------------------------------------------
// Hash routing.
// ---------------------------------------------------------------------------

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');   // strip leading "#/"
  const parts = raw.split('/').filter(Boolean);
  const route = parts[0] && ROUTES.includes(parts[0]) ? parts[0] : DEFAULT_ROUTE;
  const args = parts.slice(1);
  return { route, args };
}

function render() {
  const { route, args } = parseRoute();
  const view = document.getElementById('view');

  // Update nav active state
  document.querySelectorAll('.app-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  switch (route) {
    case 'home':       renderHome(deps, view); break;
    case 'exercises':  renderExercises(deps, view, args); break;
    case 'play':       renderPlay(deps, view, args); break;
    case 'metronome':  renderMetronome(deps, view); break;
    case 'progress':   renderProgress(deps, view); break;
    case 'calibrate':  renderCalibration(deps, view); break;
    default:           renderHome(deps, view);
  }
}

window.addEventListener('hashchange', render);

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
    mic.stop();
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
