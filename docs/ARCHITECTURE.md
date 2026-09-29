# Architecture

A map of how Kansei is put together. For the details behind any one box, follow
its link — this file stays deliberately short and does not duplicate what the
linked module already documents.

## Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI  (src/app, src/features, src/ui)                                 │
│  React components, routing, the design system. Talks only to         │
│  Services — never imports an engine or a repo directly.              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │  Services (src/app/services.ts)
┌───────────────────────────────▼───────────────────────────────────────┐
│  Session engine  (src/learning/session)                              │
│  Owns the ten-screen series. Calls the three engines below for       │
│  their one decision each, and the ledger, inside one transaction     │
│  per graded screen.                                                  │
└──────┬───────────────┬───────────────┬───────────────┬───────────────┘
       │ WHEN           │ WHICH         │ HOW            │ correct?
┌──────▼──────┐  ┌──────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
│  Scheduler   │  │  Selector   │  │ Generator  │  │   Grader    │
│  (scheduler) │  │ (selection) │  │(generation)│  │  (grading)  │
└──────────────┘  └──────┬──────┘  └─────┬──────┘  └──────┬──────┘
                          │  reads         │ reads          │ reads
                   ┌──────▼─────────────────▼────────────────▼──────┐
                   │           Content library (src/content)         │
                   │   kana / kanji / components / vocab / readings  │
                   │   / audio / strokes — all read-only at runtime  │
                   └──────────────────────┬───────────────────────────┘
                                           │ installs from
                   ┌───────────────────────▼───────────────────────────┐
                   │        Content packs (public/content/*)           │
                   │   verified, versioned, installed by the           │
                   │   Installer; updated as a "generation" — see      │
                   │   the offline section below                       │
                   └─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Persistence  (src/persistence)                                      │
│  IndexedDB. Everything above that reads/writes learning records      │
│  goes through here — see docs/DATA-MODEL.md.                         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Handwriting  (src/handwriting)   │   Audio  (src/audio)             │
│  Real stroke capture, off-main-   │   Real recordings only, no       │
│  thread assessment. See its own   │   synthesis fallback.            │
│  README.                          │                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## The composition root

`src/app/services.ts`'s `createServices()` is the only place all of this is
wired together — everything else receives its dependencies through
constructor arguments or the returned `Services` object, never by importing a
concrete implementation of another layer directly. On boot it: opens the
database and migrates it, loads settings, resolves which content
*generation* is currently active (see below), loads the content library from
verified files, and constructs one `KanseiGrader` (wired to the real
`AssessorClient` and a small adapter over the content library for corrective
feedback) and one `KanseiSessionEngine` (wired to the scheduler, a
per-transaction selector factory, and the generator). `App.tsx` renders a
loading state until this resolves, then renders the whole app from the
single `Services` value.

## Why WHEN / WHICH / HOW / correct? are four separate modules

Conflating any two of them is exactly what makes adaptive learning systems
behave oddly in ways that are hard to debug: if the thing that decides a
pair is due also decides how hard the question should be, "this item is
struggling" and "this item is being asked the hard way" become the same
signal and neither can be reasoned about alone. Each module here is
independently testable and — more importantly — independently *arguable
with*: the product defaults each one carries (the FSRS retention target, the
6/2/2 selection mix, the difficulty ladder's rung order) are documented as
product choices in their own README, not buried in a monolith.

- **Scheduler** (`src/learning/scheduler`) — FSRS-5, plus the mapping from a
  rich `AttemptRecord` onto an FSRS rating, plus the four learning-stage
  criteria. [README](../src/learning/scheduler/README.md).
- **Selector** (`src/learning/selection`) — the due/weak/new mix, adapted for
  backlog size, silent/keyboard-only mode, focused practice, and interleaving
  with a documented confusable-clustering cap.
  [README](../src/learning/selection/README.md).
- **Generator** (`src/learning/generation`) — the ten question formats (plus
  two additional recognition-only formats for kanji components and
  meanings), the ambiguity rules, and the difficulty ladder.
  [README](../src/learning/generation/README.md).
- **Grader** (`src/learning/grading`) — pure with respect to the submission;
  delegates handwriting to the real assessor and never fabricates a verdict.
- **Session engine** (`src/learning/session`) — owns the ten-screen
  structure, delayed revisits (implemented as an in-place regeneration of a
  not-yet-reached screen), linked rounds, and the placement check (which
  reuses this entire pipeline with a different target-selection strategy
  rather than a parallel flow). [README](../src/learning/session/README.md).

See [`docs/LEARNING-AND-XP.md`](LEARNING-AND-XP.md) for how these combine
into the actual session/XP rules a learner experiences.

## Content: packs, the library, and "generations"

Content ships as verified packs (`public/content/index.json`, a
`PackIndex`). `src/content/installer.ts` fetches, verifies each file's
SHA-256, and tracks per-file progress so an interrupted install resumes.
`src/content/library.ts`'s `ContentLibrary` is the *only* thing the rest of
the app asks about content — its `hasAudio`/`hasStrokes` answer strictly
from files that actually verified, which is what lets the generator refuse
to build a listening or handwriting question for an asset that is not
really there.

Updating the curriculum without disturbing an install in progress uses a
**generation** (`src/content/updates.ts`): a new content release is
downloaded into its own named Cache Storage cache
(`content-v1-generation-<hash>`), fully verified and loaded as a real
`ContentLibrary` to confirm it is not corrupt, and only THEN is one small
control-cache record repointed to it — a single atomic write, not a
file-by-file switch. A failed or interrupted download never touches the
active generation or any learner data. Old generations are not yet cleaned
up (a disclosed, tracked limitation — see `WORK.md`).

## Offline and updates

The service worker (`src/sw.ts`) precaches the app shell via Workbox from
the Vite-injected manifest and deliberately does **not** manage content packs
— those live in the separate, generation-named caches above, so a shell
update can never collide with curriculum data. A new worker never calls
`skipWaiting()` on its own; `src/app/registerSW.ts` checks for updates on
launch, on reconnect, and hourly while visible, and only activates one on an
explicit user action — deferred while a practice session is active or a save
is pending, and blocked if another Kansei tab/window is open (`registerSW.ts`'s
`ensureSingleAppWindow`, used by both the app-shell and content-generation
update paths). See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for the build/hosting
side of this and the [README](../README.md#updates-without-losing-progress)
for the guarantee stated plainly.

## Design system

`src/styles/tokens.css` defines the whole palette as CSS custom properties in
three states (`:root` for light, a `prefers-color-scheme` media block for
system dark, `[data-theme="dark"]` for an explicit choice), checked against
WCAG contrast by `scripts/check-contrast.mjs`. `src/ui/primitives.tsx` is the
shared component set (buttons, cards, the learning-stage chip, switches,
dialogs) everything else is built from; `src/features/progress/charts.tsx`
is hand-built SVG rather than a charting dependency, using one sequential
hue for ordinal data (stage, XP volume) — never a categorical palette where
an ordinal ramp is the honest encoding — checked by
`scripts/check-viz-palette.mjs`.
