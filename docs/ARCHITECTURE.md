
## 1. High-level overview

The Drum Trainer is a single-page web application written in plain ES modules (no build step, no framework). It has four primary concerns:

1. **Generate a steady pulse** that the user practices against (the metronome).
2. **Listen to the user play** and decide when each "hit" occurred (the mic listener).
3. **Decide whether each hit is on time** versus the expected pattern of the chosen exercise (the scorer).
4. **Show the user immediate feedback and improvement suggestions** so practice translates into measurable progress (the engine + UI).

Each concern lives in its own JavaScript module. Modules communicate via subscriber callbacks — there is no global state, no event bus, and no DOM coupling inside the audio modules. This is what lets the metronome and scorer be unit-testable in isolation and what makes the engine straightforward to reason about.

```
index.html
└── js/app.js                 SPA router + audio singletons (only "glue" code)
    ├── js/audio.js           Shared AudioContext + sample loader
    ├── js/metronome.js       Web Audio metronome
    ├── js/listener.js        Microphone hit detector
    ├── js/scorer.js          Timing classifier and suggestions
    ├── js/engine.js          Play-along orchestrator
    ├── js/exercises.js       Exercise content (data)
    ├── js/views.js           View renderers (home, exercises, play, ...)
    └── js/visualizer.js      Canvas-based scrolling beat grid
```

## 2. Why a web app instead of native mobile?

The original Requirements Analysis specified a Flutter or React Native cross-platform mobile app. That was the right call for a multi-month project but not for a small prototype, for three reasons.

First, **the Web Audio API gives sub-10ms scheduling accuracy in modern browsers** — better than what most cross-platform mobile audio libraries offer without native bridging. For a platform that is concerned with evaluating people's rhythm keeping abilities, scheduling precision is the single most important capability.

Second, **a web app is reachable from every platform with zero install friction**. A user opens a URL and the app runs. We get the cross-platform reach the requirements doc demanded, including modern phone browsers, without the install-and-deploy overhead of native.

Third, **the existing Python prototype's algorithms ported directly to JavaScript**. The metronome scheduling logic and the threshold-plus-cooldown hit detection are nearly line-for-line equivalents in JS. A native mobile pivot would have meant rewriting them in Swift or Dart from scratch.

A scope-refinement note in the README explains this pivot for the submission. Native mobile remains a "wishes" item in the requirements framework.

## 3. The clock everything runs on: `AudioContext.currentTime`

A normal JavaScript `Date.now()` or `performance.now()` is a wall-clock that the operating system can drift, throttle, or pause. It is unsuitable for music timing.

`AudioContext.currentTime` is a monotonic high-resolution clock driven by the audio hardware itself. It increments in seconds, with a typical resolution of one audio sample (about 21 µs at 48 kHz). Critically, every audio scheduling API in Web Audio takes its time arguments in this same clock, so when we say "play this click at time T", the browser delivers it to the speakers at exactly T — regardless of how busy the JavaScript event loop is.

We use this clock for three things:

1. **Scheduling metronome clicks** (`metronome.js`) — clicks are queued into the audio graph at precise future times.
2. **Tagging mic hits** (`listener.js`) — when a hit is detected, its timestamp is `audioCtx.currentTime` at the moment we detected it.
3. **Defining expected beat times for an exercise** (`engine.js`) — the engine computes `startTime + p * (60 / bpm)` for each pattern position `p`.

Because all three concerns share one clock, the scorer can directly subtract a hit's time from an expected beat's time to get a meaningful delta in seconds.

## 4. The metronome: lookahead scheduling

Naively, you might schedule clicks like this:

```js
setInterval(() => playClick(), 60_000 / bpm);
```

This is wrong. `setInterval` is throttled by the browser when the tab loses focus, drifts under load, and fires whenever the JS event loop gets around to it — easily off by 5–50 ms.

The correct pattern, popularized by Chris Wilson's "A Tale of Two Clocks"[^1] article, is the **lookahead scheduler**:

- Run a JavaScript timer every 25 ms (the *lookahead interval*).
- Each time the timer fires, look at `audioContext.currentTime`. Schedule any clicks whose time falls within the next 100 ms (the *lookahead window*) by calling `bufferSourceNode.start(when)` with their precise audio-clock time.

This works because the timer's job is no longer to play sounds — its job is to *queue* sounds slightly in advance, into the audio graph. The audio graph then plays them at the exact requested time. JavaScript jitter no longer matters as long as the timer keeps up over a 100ms horizon, which it always does.

Implementation lives in `js/metronome.js`:

- `_scheduler()` walks forward in time as long as `_nextNoteTime < audioCtx.currentTime + 0.1`, scheduling each beat via `_scheduleBeat()`.
- `_advance()` increments `_nextNoteTime` by `60 / bpm` seconds and the beat counter mod the beats-per-measure.
- `_scheduleBeat()` creates a one-shot `AudioBufferSourceNode`, points it at either the accent or regular click sample, and starts it at the exact future time.
- A `setTimeout` at the same delay invokes the `onBeat` listeners, so the UI flashes in time with the audible click.

The 20–300 BPM range mirrors the validated range in the original `metronome.py`. The lookahead numbers (100ms ahead, 25ms tick) are taken directly from Wilson's reference metronome implementation[^2] and have ample margin even on a slow phone.

[^1]: Chris Wilson, *A Tale of Two Clocks – Scheduling Web Audio with Precision*. Originally published on HTML5 Rocks, now hosted at <https://web.dev/articles/audio-scheduling>.
[^2]: Wilson's reference metronome source: <https://github.com/cwilso/metronome/blob/main/js/metronome.js>. Uses `scheduleAheadTime = 0.1` (seconds) and `lookahead = 25.0` (milliseconds) — the values our `metronome.js` mirrors.

## 5. The listener: threshold + cooldown

The Python original sampled audio in 1024-frame blocks via `sounddevice` and considered any block whose peak amplitude exceeded a threshold a "hit", with a cooldown to prevent a single hit's tail from triggering twice.

The JS port preserves the same logic exactly:

- `getUserMedia` requests microphone access. The browser requires a user gesture (a button click) for the prompt, which the app provides.
- A `MediaStreamAudioSourceNode` feeds an `AnalyserNode` with `fftSize = 1024` (matching the Python block size).
- Once per animation frame, we call `analyser.getFloatTimeDomainData(buf)` to fill a 1024-sample array, then loop through to find the peak amplitude. This is `np.max(np.abs(indata))` from the Python version.
- If the peak exceeds `THRESHOLD = 0.15` and at least `COOLDOWN = 0.15` seconds have passed since the last detected hit, a hit event fires with `{ time: audioCtx.currentTime, volume: peak }`.

The `requestAnimationFrame` polling loop quantizes detection to roughly 16ms (60 Hz). For musical purposes that's well within the GOOD window, but Day 5 includes an upgrade path to an `AudioWorkletNode`, which can sample at sample-rate accuracy. The current implementation is intentionally simple so it can be explained in a code review and replaced cleanly later.

The threshold and cooldown are deliberately the same constants as the Python prototype. If we change them in calibration, both numbers are tunable through the `MicListener` constructor.

## 6. The exercise data model

An exercise is a plain object. The schema is:

```js
{
  id: 'rud-singles-beg',           // unique
  category: 'rudiments',           // 'rudiments' | 'timing' | 'dynamics'
  tier: 'beginner',                // 'beginner' | 'intermediate' | 'advanced'
  title: 'Single Stroke Roll',
  description: '...',
  tips: ['...', '...'],
  timeSignature: [4, 4],
  bpm: 80,                         // default tempo; user can override
  measures: 2,
  pattern: [0, 1, 2, 3, 4, 5, 6, 7],   // beat positions where hits are expected
  sticking: ['R', 'L', ...],       // optional UI metadata
  accents: [false, true, ...],     // optional dynamics metadata
}
```

The crucial field is `pattern`: an array of *beat positions*, measured in quarter-note beats from the start of the exercise. The engine multiplies each position by `60 / bpm` to get a real audio-clock time relative to a chosen `startTime`.

Why this representation? Because it decouples the *rhythm* of an exercise from its *tempo*. We can let the user override the BPM at runtime — say, to practice the same paradiddle slower than its default 80 — without rewriting the pattern. It also reads naturally:

- Quarter notes in 4/4: `[0, 1, 2, 3]` (you can see four hits, one per beat)
- Eighth notes: `[0, 0.5, 1, 1.5, ...]`
- 16th notes: `[0, 0.25, 0.5, 0.75, ...]`
- Off-beats: `[0.5, 1.5, 2.5, 3.5]`

For Day 2 we seed two exercises per category-tier (nine total) so the engine has variety to test. Day 5 expands the catalog and tunes wording.

## 7. The play-along engine

`PlayAlongEngine` (`js/engine.js`) is the orchestrator. It owns nothing audio-related itself — it composes a `Metronome`, a `MicListener`, and a `Scorer`. The lifecycle:

**`load(exercise, opts)`** — sets the exercise, configures the metronome to the chosen BPM and time signature, and computes `secondsPerBeat`. No audio yet.

**`start()`** —

1. Awaits `mic.start()`. The browser's permission prompt fires here on first use.
2. Subscribes to `mic.onHit`, routing each detected hit into `_onMicHit`.
3. Computes `startTime = currentTime + 0.1 + countdownDuration`. The 0.1s safety offset gives the audio graph headroom; the countdown is one full measure of metronome clicks at the exercise tempo, so the user has a feel for the pulse before the exercise begins.
4. Builds `expectedTimes` by mapping each `pattern` position to a real audio time relative to `startTime`.
5. Creates a `Scorer(expectedTimes)`.
6. Computes `endTime = lastExpectedTime + 0.25` (the tail window where late hits can still pair before we finalize).
7. Starts the metronome — it begins clicking immediately, providing the audible countdown.
8. Sets state to `'countdown'` and starts a 50ms tick.

**The 50ms tick** does three things every interval:

1. **State transition.** When `currentTime >= startTime - 0.02`, we move from `'countdown'` to `'playing'`.
2. **Sweep for missed beats.** Calls `scorer.sweep(currentTime)`, which marks any pending expected beat that is more than `pairWindow` seconds in the past as a `'miss'`. This is what causes a beat to be judged as missed even if the user never tapped.
3. **Detect completion.** When `currentTime >= endTime`, we emit a one-shot completion event with full stats and suggestions, stop the metronome, and stop ticking. The mic stays alive briefly so any tail hits can still be recorded for the UI.

**Mic hits during countdown are ignored** (the engine drops any hit with `time < startTime - 0.05`). This is intentional: the user is allowed to tap to find the pulse without it counting.

The engine emits events to UI subscribers via `onUpdate`, including `'tick'`, `'hit'`, `'miss'`, `'state'`, and `'complete'`. UI code (Day 3) consumes these to drive the on-screen visualizer.

## 8. The scorer

`Scorer` (`js/scorer.js`) is the heart of the timing logic. It is intentionally pure: no audio, no DOM, no globals. It accepts expected times and hit times in seconds and returns judgments.

### 8.1 The pairing algorithm

When a hit arrives at time `t`, we walk the list of *pending* expected beats and find the one whose time is closest to `t`. If that closest beat is within `PAIR_WINDOW` (200 ms by default), we pair them: the expected beat transitions from `pending` to `judged`, with a signed `delta` recorded.

If the closest beat is too far away (or there are no pending beats), the hit is recorded as an "extra" — surfaced to the UI but not counted toward score.

**Why closest-match instead of next-pending or interval-based?** Closest-match is the simplest correct rule for sparse patterns and stays correct for dense patterns until the user is more than half a sub-beat off. For 16th notes at 80 BPM (187 ms between expected hits), closest-match works correctly until the user is 93 ms off. That's well past the GOOD window, meaning the algorithm only mispairs when the user is already clearly out of time.

For very dense fast patterns (e.g. 16ths at 200 BPM, where beats are 75 ms apart), closest-match would mispair if the user were more than 37 ms off. That edge case is what the calibration step (Day 5) addresses — we measure the user's average offset against the click and subtract it before classification, removing baseline lateness so closest-match continues to work.

### 8.2 Classification windows

```
PERFECT: |delta| <= 30 ms
GOOD:    |delta| <= 80 ms
MISS:    everything else
```

Why these numbers? **30 ms is roughly the threshold below which two attacks fuse perceptually into a single percept** — hits in this window sound simultaneous with the click. **80 ms is around where most listeners agree something feels "off"** but not catastrophically so. These windows are widely used in rhythm-game scoring and sit comfortably within the limits of human auditory timing perception.

The constants are tunable via the `Scorer` constructor's `opts` so calibration and per-exercise overrides remain straightforward.

### 8.3 Sweeping for missed beats

The scorer doesn't "know" that a beat has been missed until the engine tells it that time has passed. A periodic `sweep(currentTime)` call walks pending beats and marks any whose time is more than `pairWindow` (200 ms) seconds in the past as `missed`. This is what produces the negative judgments for beats the user never tapped.

### 8.4 Stats

`getStats()` walks the expected array on demand and returns:

- counts (`perfect`, `good`, `miss`, `extras`)
- `meanDelta` — signed average offset, in seconds. Negative = early; positive = late. This is the bias signal the suggestions engine uses.
- `meanAbsDelta` — unsigned average offset. The "how far off on average" number.
- `stdDelta` — standard deviation of `delta`. The consistency signal.
- `accuracy` — `(perfect + good) / total`, used as the headline percentage.

Stats are computed on demand rather than maintained as running counters. The arrays are tiny (typically tens of entries), so the simplicity wins over micro-optimization.

## 9. The suggestions engine

`generateSuggestions(scorer)` in `scorer.js` is a small rule-based heuristic that turns stats into 1–3 short, actionable practice tips. It is deliberately rule-based, not learned, for two reasons: it's explainable in a code review (every tip can be traced to a single rule), and it produces correct output on small samples (a learned model would be unreliable after only a few dozen hits).

The rules, in order of evaluation, are:

1. **Strong dragging** (`meanDelta > +25 ms`) — "you're behind the click by Xms; anticipate the beat slightly."
2. **Strong rushing** (`meanDelta < -25 ms`) — "you're ahead by Xms; relax and let the click lead."
3. **Drift** (linear-regression slope of delta vs. beat index, |slope| > 4 ms/beat) — "you're slowing down" or "you're speeding up." Catches the case where average is fine but the user is gradually accelerating or decelerating.
4. **Inconsistency** (`stdDelta > 40 ms`, with at least 4 hits) — "tempo is too fast for you; try 10–20 BPM lower."
5. **High miss rate** (`missRate > 25%`) — "slow it down significantly."
6. **Excellent run** (`perfectRate > 70% && missRate < 10%`) — "push the BPM up by 10."
7. **Many extras** (`extras > 20% of total`) — "double-tapping or mic bleed; check setup."
8. **Default fallback** — "solid run, keep at it."

We return at most three tips so the user isn't overwhelmed. Severity (`positive` / `low` / `medium` / `high`) drives styling on Day 3.

## 10. Storage strategy

**Day 4** introduces `localStorage`-backed progress tracking. The schema (proposed):

```json
{
  "totalPracticeMs": 1234567,
  "exerciseCompletions": {
    "rud-singles-beg": { "lastRunISO": "...", "bestAccuracy": 0.92, "runs": 7 }
  }
}
```

`localStorage` is correct for this app because (a) it works without a backend, (b) the data is single-device by design (a student practicing alone), and (c) it's trivially easy to inspect and reason about. If we ever need cloud sync we'll move to `IndexedDB` plus a Firestore mirror — but that's wishes-tier and out of MVP scope.

## 10b. The visualizer (Day 3)

`js/visualizer.js` renders the scrolling beat grid that fills most of the play screen. It is a thin canvas-2D component, intentionally not tied to any framework.

**Coordinate system.** Time flows top-to-bottom. The judgment line sits at 78% of the canvas height. A beat reaches the judgment line at exactly its expected time. Future beats appear above; past beats slide briefly below before fading out.

**Time-to-pixel mapping.** Each frame we compute `dt = expected.time - audioCtx.currentTime` for every expected beat. The beat's Y is then:

```
y = judgmentY * (1 - dt / LOOKAHEAD_SEC)
```

so `dt = LOOKAHEAD` puts the beat at the top, `dt = 0` puts it on the judgment line, and negative `dt` puts it below. `LOOKAHEAD_SEC` (2.0) controls how far the user can see ahead.

**Pull, don't push.** The visualizer subscribes to *nothing*. Each animation frame it reads `engine.scorer.expected` and `engine.ctx.currentTime` directly. This makes rendering deterministic — the picture you see is always the picture for *right now*, not whatever the most recent event told us. Engine events are still used (in `views.js`) to trigger one-shot judgment flashes via `visualizer.flashJudgment(judgment)`, but the steady-state render loop is pull-based.

**Drawing pipeline per frame.**

1. Clear the canvas and paint the dark background.
2. Stroke faint horizontal time-grid lines (one every 0.25 s of lookahead) so the user can sense scroll speed.
3. Stroke the judgment line plus a soft glow band.
4. For each expected beat in range, draw a colored circle: blue (pending), green (perfect), yellow (good), red (miss). Pending beats pulse slightly larger as they approach the line. Sticking labels (R, L, etc.) render inside the circle when the exercise has them.
5. If a flash is active, paint a translucent band across the judgment line plus a floating "PERFECT / GOOD / MISS" label that drifts upward as it fades.
6. Render a small HUD with title, BPM, time signature, and live accuracy / counts.

**High-DPI handling.** On `resize` we set `canvas.width = cssWidth * devicePixelRatio` and apply a `setTransform(dpr, 0, 0, dpr, 0, 0)` so all our drawing calls remain in CSS pixels but the backing store is sharp on retina displays.

## 10c. The view layer (Day 3)

`js/views.js` exports one renderer per route. Each renderer takes `(deps, view, args)` and mutates the view container. There is no virtual DOM. We use a tiny `el(tag, attrs, children)` helper to keep the construction code readable without pulling in a framework.

**Routing parameters.** `app.js` parses the hash on `/` boundaries:

```
#/exercises             -> route='exercises', args=[]
#/exercises/rudiments   -> route='exercises', args=['rudiments']
#/play/rud-singles-beg  -> route='play',      args=['rud-singles-beg']
```

This is enough for our four views without bringing in a router library.

**Play view state machine.** Three phases driven by engine state:

- **Pre-run** — exercise tips and a Start button. No audio is active.
- **Running** — visualizer animating, mic live, judgments streaming. Subscribes to `engine.onUpdate` for per-event flashes and live-stat refreshes.
- **Results** — stats summary, letter grade, up to three tailored suggestions, and three buttons (Try Again, Pick Another, Home).

The phase transitions are driven by the engine's `onUpdate` and `onComplete` callbacks rather than timers, so the UI stays in sync with actual audio state, not a guess.

**Letter grade.** `letterGrade(stats)` in `views.js` maps accuracy and perfect-rate to A–F. The boundaries are tunable; current values are A ≥ 95% accuracy with 70%+ perfect, B ≥ 85%, C ≥ 70%, D ≥ 50%, F otherwise.

## 11. Why no framework?

A vanilla ES-module SPA has two advantages for this project:

1. **Zero build step.** `python -m http.server` and a browser is the entire toolchain. Every line of code we write is the line that runs.
2. **Faster to explain.** A `<template>` clone-and-append router is one screen of code. There is no virtual DOM to defend, no reactivity model to introduce.

The trade-off is that scaling to many views or shared component state would benefit from React or Svelte — but with four primary views (Home, Exercises, Metronome, Progress), we don't approach that ceiling.

## 12. Risks and known limitations

**Latency.** Browser audio output latency varies by hardware and OS. Without calibration, hits can register as systematically late, biasing scores. Day 5 introduces a one-tap calibration step that measures the user's mean offset against a click track and subtracts it. Until then, scoring is biased on some setups.

**`requestAnimationFrame` polling for the mic.** ~60 Hz is plenty for hit detection but adds up to 16 ms of timing quantization. An `AudioWorkletNode` would eliminate this; deferred to Day 5.

**Closest-match pairing on extremely dense patterns.** Discussed in §8.1. Calibration is the mitigation.

**Mic bleed / cross-talk.** A mic placed on a desk near a metronome speaker will pick up the click as well as the user's hits. Day 5 includes a setup-tips screen that walks the user through mic placement.

**Single-user profile.** There is no auth and no multi-profile in the MVP. Adding profiles is a one-day addition if needed.

## 13. Testing strategy

The original Python prototype shipped with a TDD test file (`legacy-python/test.py`) covering BPM validation, beat-timing math, and hit-detection logic. The JS port preserves the same constants and algorithms, so equivalent tests can be ported on Day 6 if time allows.

Manual smoke tests for Day 2:

1. **Metronome accuracy** — start the metronome at 120 BPM and confirm beats arrive every 500 ms (eyeball or measure with an external app).
2. **Mic detection** — tap the desk; the diagnostics box should print `Hit detected at Xs | volume=Y`.
3. **End-to-end exercise run** — pick "Quarter Notes" beginner, click Run, tap along; the status box should show per-beat judgments and a summary at the end.

The final verification task on Day 6 will exercise these end-to-end and capture screenshots / a short video.
