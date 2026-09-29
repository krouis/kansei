# Kansei (感性)

An offline-first Progressive Web App for learning to read and write Japanese —
hiragana and katakana first, with a beginner kanji and vocabulary curriculum
underneath it. Once installed, it works with no internet connection at all:
every question, every recording, every stroke check, and every scheduling
decision runs locally, on-device.

**Current status: a genuinely usable kana practice app, not the complete
curriculum the project aims at.** The rest of this file, and
[`WORK.md`](WORK.md), say exactly where that line falls today.

## What it actually does

- **Ten-question practice series** across the real question formats a
  language app needs: audio recognition, typed reading with correct IME
  handling, keyboard-operable matching (no dragging), and real stroke-aware
  **handwriting assessment** — a blank canvas in recall mode, capture via
  finger/stylus/mouse, graded off-main-thread by comparing the strokes you
  actually drew against reference stroke order, direction, and shape
  separately. Nothing here is simulated: a missing recording means no
  listening question is generated for it, not a synthesised voice standing
  in.
- **A local spaced-repetition scheduler** (FSRS-5) that tracks recognition,
  reading recall, listening, and handwriting **separately** per character —
  and per *reading*, for kanji, since one character can have several. Strong
  multiple-choice performance never counts as strong evidence for unaided
  recall.
- **An optional placement check** for a returning learner: ten
  multiple-choice questions sampled across the kana curriculum, scored
  through the exact same pipeline as ordinary practice — and honest about
  its own limits (it checks recognition only; reading, listening, and
  handwriting always start fresh).
- **XP that measures practice, not mastery**: 1 XP per completed question
  screen plus a 10 XP bonus for finishing a series — never inflated by speed
  or a lucky guess, never reduced for a missed day.
- **Local progress history** — daily XP against the goal that applied on
  that specific day, a practice calendar, accuracy by skill, and recurring
  confusions — plus versioned backup export/import for moving progress
  between devices by hand (there is no account and no automatic sync).
- **A genuinely offline architecture**: an installable PWA with a real
  update flow that never interrupts an in-progress session, content packs
  verified by checksum before they are trusted, and a from-scratch,
  no-dependency stroke recognizer rather than a call to a cloud OCR service.
- **An About & Science section**, readable offline, that distinguishes
  research findings from Kansei's own product choices — including which of
  its own numbers (ten questions per series, the XP formula, the scheduler's
  defaults) are engineering decisions rather than validated constants.

## Try it

Requires Node 20+ and npm.

```sh
npm ci
npm run dev
```

Open the printed localhost URL, choose your preferences, and install the
learning material from inside the app. (The dev server doesn't cache the app
shell — for a real test of offline behaviour, use a production build; see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).)

## Known limits, plainly

- The kanji (1,000 characters) and vocabulary (1,600 words) datasets are
  real, sourced, and pass their own validation — but they are generated
  draft material that has not had an editorial pass, and their explorer/
  course integration is not yet a finished experience the way kana practice
  is.
- Kana audio covers 71 of the 104 modern sounds; yōon (contracted)
  combinations have no recordings yet. Only 61 of the 1,600 vocabulary
  entries have a matching recording — most of the 358 recorded words
  available upstream simply aren't in the beginner-selected set.
- Handwriting assessment is real and runs locally, but it has only been
  validated against synthetic stroke samples — not representative human
  finger/stylus/mouse input.
- An in-progress answer is kept per browser tab; a submitted answer is
  stored in IndexedDB like everything else.
- Automated browser testing covers one desktop viewport and one phone
  viewport in one browser engine — that is not a claim of compatibility
  across physical devices.

The itemized list this is drawn from — what's done, what's in progress, what
was deliberately deferred and why — is [`WORK.md`](WORK.md).

## Reading further

| Doc | Covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit: the four engines behind a session, the content pipeline, the offline/update model. |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | The IndexedDB schema, the transaction and migration guarantees, the backup format. |
| [`docs/LEARNING-AND-XP.md`](docs/LEARNING-AND-XP.md) | Session structure, question formats, grading rules, learning stages, and the complete XP formula. |
| [`docs/CONTENT.md`](docs/CONTENT.md) | Content inventory: every dataset, its source, licence, and how to reproduce it. |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Building, verifying, hosting requirements, and the GitHub Pages CI/CD workflow. |
| [`WORK.md`](WORK.md) | The itemized, actively-maintained implementation checklist. |

Each engine module (`src/learning/scheduler`, `src/learning/selection`,
`src/learning/generation`, `src/learning/session`, `src/persistence`,
`src/handwriting`) also carries its own `README.md` with the reasoning and
trade-offs specific to that piece — the docs above link out to them rather
than repeating their contents.

## License

[GPL-2.0-or-later](LICENSE). See [`docs/CONTENT.md`](docs/CONTENT.md) for the
separate licences and attribution required by the bundled fonts, audio,
dictionaries, and stroke data — none of which share the app's own licence.
