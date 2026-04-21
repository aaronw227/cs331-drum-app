// app.js
// SPA entry point. Hash-based routing, view rendering, and Day-1 diagnostics.

import { getAudioContext, unlockAudio, loadSample } from './audio.js';
import { Metronome } from './metronome.js';
import { MicListener } from './listener.js';

const ROUTES = ['home', 'exercises', 'metronome', 'progress'];
const DEFAULT_ROUTE = 'home';

// ------ Lazy-initialized audio singletons ------
let _clickBuf = null;
let _accentBuf = null;
let _metro = null;
let _mic = null;

async function ensureSamples() {
  if (!_clickBuf) _clickBuf = await loadSample('assets/click.wav');
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

// ------ Routing ------
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
  document.querySelectorAll('.app-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  // Per-view wiring
  if (route === 'home') wireHome();
}

window.addEventListener('hashchange', render);

// ------ Home diagnostics wiring ------
function appendDiag(msg, cls = '') {
  const out = document.getElementById('diag-output');
  if (!out) return;
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function wireHome() {
  const clickBtn = document.getElementById('diag-click-test');
  const metroStartBtn = document.getElementById('diag-metro-test');
  const metroStopBtn = document.getElementById('diag-metro-stop');
  const micStartBtn = document.getElementById('diag-mic-test');
  const micStopBtn = document.getElementById('diag-mic-stop');

  if (clickBtn) {
    clickBtn.addEventListener('click', async () => {
      try {
        const ctx = await unlockAudio();
        const { click } = await ensureSamples();
        const src = ctx.createBufferSource();
        src.buffer = click;
        src.connect(ctx.destination);
        src.start();
        appendDiag('Played test click.', 'info');
      } catch (err) {
        appendDiag(`Error playing click: ${err.message}`, 'miss');
      }
    });
  }

  if (metroStartBtn) {
    metroStartBtn.addEventListener('click', async () => {
      try {
        const m = await getMetronome();
        m.setBpm(120);
        m.setBeatsPerMeasure(4);
        // Attach a listener once
        if (!m._diagListenerAttached) {
          m.onBeat(({ measureBeat, isAccent }) => {
            appendDiag(`Beat ${measureBeat + 1}${isAccent ? ' (accent)' : ''}`, 'info');
          });
          m._diagListenerAttached = true;
        }
        m.start();
        appendDiag('Metronome started at 120 BPM.', 'info');
      } catch (err) {
        appendDiag(`Metronome error: ${err.message}`, 'miss');
      }
    });
  }

  if (metroStopBtn) {
    metroStopBtn.addEventListener('click', async () => {
      if (_metro) {
        _metro.stop();
        appendDiag('Metronome stopped.', 'info');
      }
    });
  }

  if (micStartBtn) {
    micStartBtn.addEventListener('click', async () => {
      try {
        const mic = await getMic();
        if (!mic._diagListenerAttached) {
          mic.onHit(({ time, volume }) => {
            appendDiag(`Hit detected at ${time.toFixed(3)}s | volume=${volume.toFixed(3)}`, 'hit');
          });
          mic._diagListenerAttached = true;
        }
        await mic.start();
        appendDiag('Listening... tap your desk or drum pad.', 'info');
        hideBanner();
      } catch (err) {
        appendDiag(`Mic error: ${err.message}`, 'miss');
        showBanner('Microphone blocked. Check browser permissions.');
      }
    });
  }

  if (micStopBtn) {
    micStopBtn.addEventListener('click', () => {
      if (_mic) {
        _mic.stop();
        appendDiag('Mic test stopped.', 'info');
      }
    });
  }
}

// ------ Mic permission banner ------
function showBanner(text) {
  const banner = document.getElementById('mic-banner');
  const textEl = document.getElementById('mic-banner-text');
  if (text && textEl) textEl.textContent = text;
  if (banner) banner.classList.remove('hidden');
}
function hideBanner() {
  const banner = document.getElementById('mic-banner');
  if (banner) banner.classList.add('hidden');
}

document.getElementById('mic-enable')?.addEventListener('click', async () => {
  try {
    const mic = await getMic();
    await mic.start();
    mic.stop(); // we just wanted the permission prompt
    hideBanner();
  } catch (err) {
    showBanner(`Microphone blocked: ${err.message}`);
  }
});

// ------ Boot ------
if (!window.location.hash) window.location.hash = '#/home';
render();
