// ============================================================================
// visualizer.js
// ----------------------------------------------------------------------------
// Canvas-based "beat highway" — the Guitar-Hero-style visual that shows
// upcoming beats falling toward a judgment line. Renders in 2D canvas at the
// browser's native pixel ratio for sharpness on hi-DPI screens.
//
// Coordinate system ----------------------------------------------------------
//
//   Y axis  - top is "future", bottom is "past".
//   X axis  - we use a single lane in the middle of the canvas (the scorer
//             does not differentiate left/right hands today). Sticking labels
//             render inside the beat dots.
//
//   The judgment line sits at JUDGMENT_LINE_FRAC * height (default 78%). A
//   beat reaches the judgment line at exactly its expected time. Future
//   beats appear above; past beats continue downward briefly before going
//   off-screen.
//
// Time-to-pixel mapping ------------------------------------------------------
//
//   Given dt = expected.time - audioContext.currentTime  (seconds; positive = future)
//   the on-screen Y is:
//
//     y = judgmentY * (1 - dt / LOOKAHEAD_SEC)
//
//     dt = LOOKAHEAD : y = 0           (top of canvas)
//     dt = 0         : y = judgmentY   (judgment line)
//     dt = -X        : y > judgmentY   (below the line, recently past)
//
//   LOOKAHEAD_SEC controls how much of the future is visible. 2.0 seconds is
//   a nice middle ground — long enough to anticipate, short enough that
//   nothing scrolls too slowly to read.
//
// Render loop ----------------------------------------------------------------
//
//   start() begins a requestAnimationFrame loop that runs until stop(). Each
//   frame reads the current state from the attached PlayAlongEngine (which
//   exposes the scorer's expected[] and the audio context's currentTime) and
//   draws one full frame.
//
//   The visualizer does NOT subscribe to engine events — it pulls state
//   every frame instead. This keeps the rendering deterministic regardless
//   of when events fire and makes the code easier to reason about.
// ============================================================================

const LOOKAHEAD_SEC = 2.0;          // how far in the future to show
const TAIL_SEC = 0.5;               // how long to keep past beats on-screen
const JUDGMENT_LINE_FRAC = 0.78;    // judgment line position (fraction of height)
const BEAT_RADIUS = 16;
const FLASH_DURATION_MS = 450;

// Color palette. We pull from CSS custom properties at runtime so the canvas
// stays in sync with the app's theme.
const PALETTE = {
  bg:         '#0f1117',
  grid:       'rgba(255, 255, 255, 0.05)',
  gridStrong: 'rgba(255, 255, 255, 0.10)',
  judgment:   '#4ea1ff',
  pending:    '#4ea1ff',
  perfect:    '#22c55e',
  good:       '#f59e0b',
  miss:       '#ef4444',
  text:       '#ffffff',
  hudText:    '#e8ecf4',
  hudMuted:   '#8b93a7',
};

export class Visualizer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.engine = null;
    this._rafId = null;
    this._running = false;

    // Most recent judgment, used to render a brief flash banner.
    this._flash = null;       // { judgment, startMs }

    // Cached layout
    this._w = 0;
    this._h = 0;
    this._judgmentY = 0;

    // Bind for use as event handlers
    this._loop = this._loop.bind(this);
    this._handleResize = this._handleResize.bind(this);
  }

  /** Attach the engine whose state we'll render. */
  attach(engine) {
    this.engine = engine;
  }

  /** Begin animating. Safe to call multiple times. */
  start() {
    if (this._running) return;
    this._running = true;
    this._handleResize();
    window.addEventListener('resize', this._handleResize);
    this._rafId = requestAnimationFrame(this._loop);
  }

  /** Stop animating and detach the resize listener. */
  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    window.removeEventListener('resize', this._handleResize);
  }

  /**
   * Trigger a flash banner at the judgment line. Color is chosen by judgment.
   * @param {'perfect'|'good'|'miss'} judgment
   */
  flashJudgment(judgment) {
    this._flash = { judgment, startMs: performance.now() };
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    // Use a fallback minimum size in case the canvas is hidden or has no
    // layout when we initialize.
    const w = Math.max(rect.width, 320);
    const h = Math.max(rect.height, 360);
    // Set the backing-store size at devicePixelRatio so the image is crisp.
    this.canvas.width  = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    // Apply a one-time transform so all our drawing calls are in CSS pixels.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._w = w;
    this._h = h;
    this._judgmentY = h * JUDGMENT_LINE_FRAC;
  }

  _loop() {
    if (!this._running) return;
    this._draw();
    this._rafId = requestAnimationFrame(this._loop);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this._w, this._h);
    this._drawBackground();
    this._drawJudgmentLine();

    if (!this.engine || !this.engine.scorer) {
      this._drawIdleMessage();
      return;
    }

    const now = this.engine.ctx.currentTime;
    const expected = this.engine.scorer.expected;
    const exercise = this.engine.exercise;

    // Draw beats from farthest-future to most-recent so that recent ones
    // overlap older neighbors visually if they happen to overlap on screen.
    for (let i = expected.length - 1; i >= 0; i--) {
      this._drawBeat(expected[i], i, now, exercise);
    }

    this._drawFlash();
    this._drawHud();
  }

  _drawBackground() {
    const ctx = this.ctx;

    // Solid background
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, this._w, this._h);

    // Vertical lane guide (subtle)
    const laneX = this._w / 2;
    const laneWidth = 80;
    ctx.fillStyle = 'rgba(78, 161, 255, 0.04)';
    ctx.fillRect(laneX - laneWidth / 2, 0, laneWidth, this._h);

    // Horizontal time grid: a faint line at every quarter-second of lookahead.
    // These give the user a sense of speed.
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    const totalSec = LOOKAHEAD_SEC;
    const steps = totalSec * 4;            // 4 lines per second
    for (let i = 1; i < steps; i++) {
      const dt = (i / 4);                  // seconds of future
      const y = this._judgmentY * (1 - dt / LOOKAHEAD_SEC);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this._w, y);
      ctx.stroke();
    }
  }

  _drawJudgmentLine() {
    const ctx = this.ctx;
    ctx.strokeStyle = PALETTE.judgment;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this._judgmentY);
    ctx.lineTo(this._w, this._judgmentY);
    ctx.stroke();

    // Subtle glow above and below
    const grad = ctx.createLinearGradient(0, this._judgmentY - 8, 0, this._judgmentY + 8);
    grad.addColorStop(0,   'rgba(78, 161, 255, 0)');
    grad.addColorStop(0.5, 'rgba(78, 161, 255, 0.20)');
    grad.addColorStop(1,   'rgba(78, 161, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, this._judgmentY - 8, this._w, 16);
  }

  _drawBeat(beat, idx, now, exercise) {
    const ctx = this.ctx;
    const dt = beat.time - now;
    if (dt > LOOKAHEAD_SEC) return;     // too far in the future
    if (dt < -TAIL_SEC) return;         // long past

    const y = this._judgmentY * (1 - dt / LOOKAHEAD_SEC);
    const x = this._w / 2;

    // Color by status
    let fill, stroke;
    if (beat.judgment === 'perfect') { fill = PALETTE.perfect; stroke = '#16a34a'; }
    else if (beat.judgment === 'good') { fill = PALETTE.good;    stroke = '#d97706'; }
    else if (beat.judgment === 'miss') { fill = PALETTE.miss;    stroke = '#dc2626'; }
    else                                { fill = PALETTE.pending; stroke = '#9bc7ff'; }

    // Slight pulse on pending beats as they approach the judgment line, to
    // help the user anticipate. Scales 1.0 -> 1.25 over the last 0.4s.
    let radiusScale = 1.0;
    if (beat.status === 'pending' && dt < 0.4 && dt > -0.05) {
      radiusScale = 1.0 + (1 - Math.max(0, dt) / 0.4) * 0.25;
    }
    const r = BEAT_RADIUS * radiusScale;

    // Faded fill if past
    if (dt < 0) {
      ctx.globalAlpha = Math.max(0.25, 1 + dt / TAIL_SEC);
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sticking label inside the beat (R / L / etc.) if present
    const sticking = exercise && exercise.sticking ? exercise.sticking[idx] : null;
    if (sticking) {
      ctx.fillStyle = PALETTE.text;
      ctx.font = 'bold 12px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sticking, x, y + 1);
    }

    ctx.globalAlpha = 1;
  }

  _drawFlash() {
    if (!this._flash) return;
    const elapsed = performance.now() - this._flash.startMs;
    if (elapsed > FLASH_DURATION_MS) {
      this._flash = null;
      return;
    }
    const t = elapsed / FLASH_DURATION_MS;     // 0..1
    const alpha = 1 - t;                        // fade out
    const ctx = this.ctx;

    // Translucent horizontal band across the judgment line.
    let color;
    let label;
    if (this._flash.judgment === 'perfect') { color = '34, 197, 94';  label = 'PERFECT'; }
    else if (this._flash.judgment === 'good') { color = '245, 158, 11'; label = 'GOOD'; }
    else                                       { color = '239, 68, 68';  label = 'MISS'; }

    ctx.fillStyle = `rgba(${color}, ${alpha * 0.30})`;
    ctx.fillRect(0, this._judgmentY - 32, this._w, 64);

    // Floating label
    ctx.font = 'bold 28px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${color}, ${alpha})`;
    const labelY = this._judgmentY - 44 - t * 20;       // floats upward as it fades
    ctx.fillText(label, this._w / 2, labelY);
  }

  _drawHud() {
    const ctx = this.ctx;
    const stats = this.engine.scorer.getStats();
    const exercise = this.engine.exercise;
    const state = this.engine.state;

    // Top-left: title + tempo
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.font = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (exercise) {
      ctx.fillStyle = PALETTE.hudText;
      ctx.font = 'bold 14px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(exercise.title, 16, 14);
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.font = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`${this.engine.tempoBpm} BPM  ·  ${exercise.timeSignature[0]}/${exercise.timeSignature[1]}`, 16, 32);
    }

    // Top-right: stats
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.hudText;
    ctx.font = 'bold 14px -apple-system, "Segoe UI", Roboto, sans-serif';
    const acc = (stats.accuracy * 100).toFixed(0);
    ctx.fillText(`${acc}% accuracy`, this._w - 16, 14);

    ctx.fillStyle = PALETTE.hudMuted;
    ctx.font = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(
      `P ${stats.perfect}  ·  G ${stats.good}  ·  M ${stats.miss}`,
      this._w - 16, 32
    );

    // Center label during countdown
    if (state === 'countdown') {
      ctx.fillStyle = 'rgba(232, 236, 244, 0.8)';
      ctx.font = 'bold 24px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Get ready...', this._w / 2, this._h / 2 - 20);
      ctx.font = '14px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = PALETTE.hudMuted;
      ctx.fillText('Listen for the click; first beat starts at the line.', this._w / 2, this._h / 2 + 12);
    }
  }

  _drawIdleMessage() {
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.hudMuted;
    ctx.font = '14px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Press Start to begin the exercise.', this._w / 2, this._h / 2);
  }
}
