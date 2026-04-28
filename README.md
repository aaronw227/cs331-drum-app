# Drum Trainer

A web-based drum learning app: structured exercises, live timing feedback against a metronome, and progress tracking.

## Current Version

latency calibration is in (one-shot 60 BPM tap-along that saves a median offset and applies it to every future run), and the exercise library has expanded to 27 exercises (3 per tier per category) covering rudiments, timing subdivisions, polyrhythms, accents, and dynamics shaping. The app now runs end-to-end with all the features the requirements doc lists as Needs.

## Project documentation

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a thorough walk-through of every design decision: why we chose a web app, how the lookahead scheduler works, how the scorer pairs hits to expected beats, why the timing windows are 30 ms / 80 ms, how the suggestions engine generates tips, and known risks. Read this before a code review or demo — it's structured so you can defend every design choice.

Every JavaScript module also has a long header comment explaining its responsibility and key algorithms in plain English.

## Run locally

Because the app fetches audio samples, it cannot be opened via `file://` — a local web server is required. Any simple static server works.

**Python 3** (easiest, no install needed):

```bash
cd "path/to/Drum App"
python -m http.server 8000
```

Then open http://localhost:8000 in Chrome, Edge, or Firefox.

**Node** (if you prefer):

```bash
npx http-server . -p 8000 -c-1
```

## Architecture

```
Drum App/
├── index.html               SPA shell with hash-based routing
├── css/styles.css           Dark theme, minimal
├── js/
│   ├── app.js               Entry point, router, view wiring
│   ├── audio.js             Shared AudioContext + sample loading
│   ├── metronome.js         Lookahead-scheduled Web Audio metronome
│   ├── listener.js          Mic hit detection (getUserMedia + AnalyserNode)
│   ├── exercises.js         Exercise library (data + lookups)
│   ├── scorer.js            Timing classifier + suggestions engine
│   ├── engine.js            Play-along orchestrator
│   ├── views.js             View renderers (home, exercises, play, metronome, progress, calibrate)
│   ├── visualizer.js        Canvas scrolling beat-grid visualizer
│   ├── storage.js           localStorage progress tracking + calibration offset
│   └── calibration.js       One-shot latency calibration runner
├── assets/
│   ├── click.wav            Regular beat sample
│   └── click-accent.wav     Downbeat / accent sample
├── docs/
│   └── ARCHITECTURE.md      Design decisions, algorithms, and risks
└── legacy-python/           Original Python prototype (metronome.py, listener.py, test.py)
```

## Ported from Python

The Web Audio modules preserve the logic from the original Python prototype:

- **metronome.js** — same 20–300 BPM validation range as `metronome.py`, uses lookahead scheduling (`AudioContext.currentTime` + 100ms lookahead, 25ms scheduler tick) for sample-accurate timing.
- **listener.js** — same `THRESHOLD = 0.15` and `COOLDOWN = 0.15s` semantics as `listener.py`, using `AnalyserNode.getFloatTimeDomainData` to sample peak amplitude per block.

## Scope note

The original Requirements Analysis specified a cross-platform mobile app. Given the timeline and the need for a visually rich play-along experience, the project has been refocused as a web app prototype. This gives the same cross-platform reach (browsers on desktop and mobile) while enabling precise Web Audio scheduling and a scrolling beat-grid visual. Native mobile remains a future-wishes item.

Coordination category has been cut from MVP scope; the app ships with three categories (rudiments, timing, dynamics), each with beginner / intermediate / advanced tiers.
