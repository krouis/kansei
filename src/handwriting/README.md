# Handwriting: capture and assessment

Real, local, stroke-aware assessment. Not image OCR, not a downloaded model,
and never a fabricated verdict — when the geometry cannot support a decision,
the result is `uncertain: true`, which the product treats as "not sure," not
as a memory failure.

## Capture (`capture.ts`)

A framework-agnostic controller over Pointer Events, attached to any
`HTMLElement`:

- Finger, stylus and mouse all report through the same `pointerdown` /
  `pointermove` / `pointerup` / `pointercancel` path; `pointerType` is recorded
  per stroke.
- `setPointerCapture` keeps a fast stroke tracked even when the pointer leaves
  the element's bounds mid-draw.
- A second simultaneous pointer is **ignored outright**, not merged — a stray
  palm touch while a stylus is down must not warp the stroke in progress.
- `pointercancel` (palm rejection, a system gesture taking over) discards the
  in-progress stroke rather than submitting a truncated one.
- `getCoalescedEvents()` is read when the browser exposes it, so a fast stroke
  is not undersampled between two `pointermove` events.
- Every drawing pointer event calls `preventDefault()`, so the page can never
  scroll or pull-to-refresh mid-stroke; the caller is still responsible for
  `touch-action: none` on the canvas element itself.

Undo, clear and replay are pure operations over the captured stroke array
(`undoLastStroke`; clear and replay are trivial array operations the UI layer
performs directly) — nothing about them is specific to the capture module.

## Assessment (`assess.ts`)

Five aspects, assessed **separately** and never collapsed into one score:

1. **Identity** — is this the target character at all? The learner's strokes
   are fitted against the target reference AND every supplied alternative
   (normally the target's documented confusables); the target only "wins"
   identity when it fits distinctly better (a margin, not a tie-break), and
   `bestAlternative` names whichever character actually fit best.
2. **Stroke count** — expected vs. given, after solving the correspondence
   (see below), so a learner who drew one extra or one too few strokes is told
   which.
3. **Stroke order** — the ordered correspondence between learner strokes and
   reference strokes is solved as a genuine **assignment problem**
   (`assignment.ts`, Jonker–Volgenant, O(n³), exact — cheap at the stroke
   counts Kansei's hardest kanji reach). A greedy nearest-match was rejected
   deliberately: it can read the same swapped-order input as "two badly-shaped
   strokes" or as "a swap" depending only on iteration order, which is not a
   fact about the drawing. The exact solve makes the correspondence a property
   of the input.
4. **Stroke direction** — for each matched pair, both a forward and a reversed
   reading are scored (`strokePairMetrics`), and the better one wins; if the
   reversed reading fits distinctly better, that stroke is flagged for
   direction, never folded into a shape penalty.
5. **Shape and relative position** — the placed (not just direction-invariant)
   distance between each matched pair, after both glyphs are normalised into a
   shared, **aspect-preserving** unit box (`features.ts`'s `normaliseGlyph`) —
   a lone horizontal stroke like 一 is never stretched to fill a square, which
   would make every other measurement meaningless for it.

`confidence` is a separate, weighted summary of the five aspects, computed for
exactly one purpose: choosing which of three outcome bands applies
(`ToleranceProfile.uncertainBelow` / `correctAtOrAbove` — see
`src/handwriting/ports.ts` for the exact three-band contract). It is never
shown to the learner as a percentage grade.

## Tolerance (`tolerance.ts`)

Tolerance describes the **input device and the canvas**, never the learner.
Geometry thresholds are derived from canvas edge length (CSS pixels) and the
browser's reported `pointerType`, and from nothing else — a finger on a small
phone screen is held to looser geometry than a stylus on a tablet by
construction, not by guessing at skill. Confidence bands
(`uncertainBelow`/`correctAtOrAbove`) are **not** loosened by device: what
"you wrote this character" means should not depend on the hardware, so
hardware slack lives entirely in the geometry that feeds the confidence
computation. Full rationale and the base numbers are documented inline in
`tolerance.ts`.

## Uncertainty

`uncertain: true` fires when:
- Confidence lands in the genuinely ambiguous middle band between
  `uncertainBelow` and `correctAtOrAbove`.
- Too little was captured to assess at all (no strokes, too few points, or a
  degenerate bounding box) — reported with a specific, truthful reason.

An uncertain verdict is never turned into a scheduler lapse (see
`src/learning/scheduler/rating.ts`): it leaves the pair's memory state
untouched and schedules a near-term recheck instead.

## Worker execution (`worker.ts` / `client.ts`)

`createAssessorClient()` runs `assess()` inside a module Web Worker, so the
cubic assignment solve never competes with the frame drawing the learner's own
ink. If `Worker` is unavailable or fails to construct (an old browser, a
sandboxed embed that blocks worker creation), the client falls back to running
`assess()` on the main thread and reports this honestly via `usingWorker` —
the app never claims off-main-thread execution it does not have.

## Validation

**KanjiVG is a reference dataset, not a grader.** Every stroke reference used
here (`public/content/strokes/`) is KanjiVG polyline data, licensed CC BY-SA
3.0 (see `docs/content/STROKES.md`); the assessment method — normalisation,
assignment, per-aspect scoring, tolerance, uncertainty — is entirely this
module's own design, built on top of that data.

`tests/fixtures/handwriting-samples.ts` derives **synthetic** samples from two
real confusable pairs (シ/ツ, ソ/ン) by transforming their real reference
polylines: clean, finger-tremor jitter, undersampled (fast-mouse), offset and
rescaled, one stroke reversed, two strokes swapped, a stroke missing, an extra
stroke, and — deliberately presented as an attempt at the wrong target — the
confusable character itself.

**These are synthetic geometric transforms of reference data, not real human
finger, stylus or mouse captures.** The assessor has not been validated
against actual human input of any kind. That is a genuine, disclosed gap: the
product brief calls for validation against "representative finger, mouse and
stylus samples," and what exists here validates the algorithm's handling of
the specific error *shapes* the brief names, using geometrically-constructed
stand-ins for those shapes — not the noise profile, hesitation, or genuine
variability of a real hand.

Measured on the current synthetic set (`npx vitest run tests/unit/handwriting.test.ts`,
21 tests, all passing):

```
correct-variant pass rate:        100% (8/8)     — clean, jitter, undersample, offset
wrong-character false-accept rate: 0% (0/2)      — シ mistaken for ツ, ソ mistaken for ン
uncertain rate over all variants: 11% (2/18)
```

"Correct variants" are the four kinds a learner's honest, recognisable attempt
should look like (clean / tremor / undersampled / offset-and-rescaled); the
missing-stroke, extra-stroke, swapped-stroke and reversed-stroke variants are
asserted individually against the SPECIFIC aspect they are meant to trip (see
the test file), not folded into the pass-rate number, since a passing grade on
those would be the algorithm failing to notice the induced error.

These numbers will shift as the algorithm is tuned; re-run the suite rather
than trusting this table if the code has changed since 2026-09-29.
