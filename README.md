# Drum Trainer

A web-based drum learning app: structured exercises, live timing feedback against a metronome, and progress tracking. Inspired by Guitar Hero but focused on education.

## Status

**Day 2 of 6** — exercise data model, play-along engine, and timing scorer are complete. End-to-end runnable from the Home page (pick an exercise, press Run, tap along; live judgments and a final summary with practice suggestions are shown).

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
│   └── engine.js            Play-along orchestrator
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

## Roadmap

- **Day 1** ✅ — Scaffolding, metronome, mic listener
- **Day 2** ✅ — Exercise data model, play-along engine, timing scorer, suggestions engine
- **Day 3** — Exercise browser UI, beat-grid visualizer, polished immediate feedback view
- **Day 4** — Standalone metronome view, progress tracking + dashboard
- **Day 5** — Flesh out exercise content (rudiments, timing, dynamics), mic + timing calibration
- **Day 6** — Polish, README, submission write-up

## Scope note

The original Requirements Analysis specified a cross-platform mobile app. Given the 6-day timeline and the need for a visually rich play-along experience, the project has been refocused as a web app prototype. This gives the same cross-platform reach (browsers on desktop and mobile) while enabling precise Web Audio scheduling and a scrolling beat-grid visual. Native mobile remains a future-wishes item.

Coordination category has been cut from MVP scope; the app ships with three categories (rudiments, timing, dynamics), each with beginner / intermediate / advanced tiers.
