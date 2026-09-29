# Learning rules and XP

What a session actually consists of, how a pair's learning stage is decided,
and exactly what XP does and does not mean. Everything numeric on this page
is a **product choice**, stated as such — see
[`src/features/about/references.data.ts`](../src/features/about/references.data.ts)
for the research it is informed by and, just as importantly, what that
research does not establish. This page is the technical companion to the
in-app About & Science section, not a duplicate of it.

## Sessions

A **series** is exactly ten question screens
(`SERIES_LENGTH` in [`src/domain/session.ts`](../src/domain/session.ts)). A
matching screen with roughly three pairs counts as **one** screen — its pairs
are graded individually, but it earns one screen's worth of XP, no more. A
**linked round** chains 2–3 series back to back while each one keeps the
same ten-screen structure. A **placement check** is a special one-series
session (`kind: 'placement'`) that samples recognition only, evenly across
taught kana, through the identical generation/grading/scheduling pipeline as
ordinary practice — see
[`src/learning/session/README.md`](../src/learning/session/README.md).

The default mix for a series — 6 due-review, 2 weak-skill-or-confusion, 2
new-or-extending — is a starting point the selector adapts from (a large
backlog suspends new material; a brand-new learner gets a coherent group of
new material instead), never a quota. Full adaptation rules:
[`src/learning/selection/README.md`](../src/learning/selection/README.md).

## The ten question formats (plus two)

Implemented in `src/learning/generation`, each with its assessed skill,
prompt direction, accepted answers, permitted hints, scoring rule, and
ambiguity checks defined in one frozen table
(`src/learning/generation/specs.ts`) that the About & Science screen renders
directly — the prose there has to be true, not marketing copy. Two additional
formats (`component-in-kanji-choice`, `meaning-to-kanji-choice`) extend this
for kanji components and meanings, explicitly labelled as weak recognition
evidence that establishes no pronunciation or handwriting mastery. Full list,
the ambiguity rules (never forcing a unique answer from ambiguous audio like
じ/ぢ; never asking a bare kanji's reading without word context; never
letting a distractor also be a correct answer), and the difficulty ladder:
[`src/learning/generation/README.md`](../src/learning/generation/README.md).

## Grading

The grader (`src/learning/grading`) is pure with respect to the submission —
same question, same answer, same context, same grade, always. Key rules:

- Comparison normalises equivalent Unicode representations (composed vs.
  decomposed dakuten, half-width katakana, full-width Latin) while
  preserving distinctions that change a word's meaning (script, small kana,
  voicing, vowel length) — see `src/domain/normalization.ts`.
- `unaidedFirstAttempt` is true only on attempt ordinal 0, with no penalised
  hint used. Replaying audio is explicitly **not** a penalised hint — it is
  part of listening, and hearing a clip twice is not help.
- A handwriting question delegates to the real, worker-based stroke
  assessor (`src/handwriting`) and never fabricates a verdict; an
  `'uncertain'` outcome is a real outcome, not a failure the UI hides.
- A wrong-but-valid answer (the reading of a different, confusable
  character) is recorded against that OTHER item via `confusedWith`, which is
  what makes the confusion table meaningful instead of a bare tally of wrong
  answers.

## First-attempt preservation — the single most load-bearing invariant

`submit()` always writes `attemptOrdinal: 0` and is the ONLY path that feeds
the scheduler. `submitRetry()` appends at ordinal 1+, is recorded for history
and confusion statistics, and **never** touches the original result or the
pair's memory state. An immediate corrected retry is answered with the
mistake still fresh — it is not equivalent to unaided delayed recall, and
must never be allowed to look like it to the thing deciding when the pair
comes back.

## Learning stages

Four stages — `unseen` → `learning` → `consolidating` → `retained` — from
transparent, documented criteria (`src/learning/scheduler/stages.ts`), never
a percentage:

- **Consolidating** needs 3+ unaided first-attempt successes on 2+ *distinct
  calendar dates* — the spacing requirement a single long session cannot
  buy by repetition alone.
- **Retained** needs the success history to span 21+ days, the model's own
  next interval to be 21+ days, AND at least one success at
  `moderate`/`strong` evidence — **weak (four-option) evidence alone can
  never reach this stage.**

For a kanji, stage is tracked **per reading**, not per character — a kanji
with two taught readings has two independent stage badges, one per reading,
never averaged into a single per-character score; knowing one reading well
says nothing about the other. See
[`src/learning/scheduler/README.md`](../src/learning/scheduler/README.md) for
the full criteria table and the FSRS-5 algorithm underneath the scheduling
date itself (a separate question from the stage badge).

## XP

The complete rule set (`src/domain/xp.ts`), unconditionally:

| Event | XP |
|---|---|
| A completed question screen (right or wrong, once feedback is acknowledged) | 1 |
| Completing all ten screens of a series | +10, once |
| **Total for a perfect or an imperfect complete series** | **20** |
| A corrected retry, a revealed answer, an audio replay | 0 |
| A three-pair matching screen | 1 (one screen, not three) |
| Speed or accuracy | no bonus |

XP is banked at `submit()` time (not held back until feedback is dismissed),
keyed by `(session, series, screen)` for a screen and `(session, series)` for
the completion bonus — the same key banked twice, from a reload, a resumed
session, or a double-tapped submit, is a no-op, enforced at the storage
layer (the key IS the store's primary key; see `docs/DATA-MODEL.md`), not by
application code remembering to check. Interrupted sessions keep whatever
screen XP they already earned. The daily goal in force is frozen into that
day's own record the first time it is written — raising the goal at 9pm does
not retroactively fail the morning, and earned XP is never clawed back for a
missed day.

**XP measures completed practice. It is not a measure of learning.** The
learning-stage badges above are the thing that represents demonstrated
learning, and the two are deliberately never conflated in the UI or the
data model.

## What none of these numbers claim to be

Ten questions per series, 1+10 XP, the 6/2/2 selection split, FSRS's default
weights and 90% retention target, and the stage thresholds are every one of
them a specific, documented engineering decision — not a finding from an
experiment run on Kansei, and not claimed to be universally optimal. Kansei
itself has not been clinically or experimentally validated. See the About &
Science section in the app, and
[`references.data.ts`](../src/features/about/references.data.ts), for exactly
which claims are research-supported, which are Kansei's own interpretation of
that research, and which are design choices that would need a real
evaluation to confirm.
