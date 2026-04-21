// audio.js
// Shared AudioContext and sample loading.
//
// Browsers require a user gesture to unlock audio. We create the context lazily
// on the first call to getAudioContext() and always attempt a resume() after
// user-initiated actions.

let _ctx = null;
const _bufferCache = new Map();

export function getAudioContext() {
  if (!_ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio API not supported in this browser');
    _ctx = new Ctor({ latencyHint: 'interactive' });
  }
  return _ctx;
}

/** Resume the context; safe to call repeatedly. */
export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/** Load and decode a sample once; subsequent calls return the cached buffer. */
export async function loadSample(url) {
  if (_bufferCache.has(url)) return _bufferCache.get(url);
  const ctx = getAudioContext();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const arr = await res.arrayBuffer();
  // decodeAudioData returns a promise in modern browsers
  const buf = await ctx.decodeAudioData(arr);
  _bufferCache.set(url, buf);
  return buf;
}
