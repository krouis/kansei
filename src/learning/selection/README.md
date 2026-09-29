# Selector

Implements `Selector` (`src/learning/ports.ts`) as `DefaultSelector`: decides
**WHICH** `(item, skill)` pairs make up the next series. Not when a pair is
due (`../scheduler/`), not which question format asks about it
(`../generation/`). See [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md).

`DefaultSelector` is constructed fresh per IndexedDB transaction (from
`SelectorDeps.skills`/`confusions`, which are transaction-bound repos — see
`src/persistence/README.md`'s note on `TxScope`), not held as one long-lived
instance. `KanseiSessionEngine` does this via a `createSelector(tx)` factory;
see `../session/README.md`.

## The default mix, and why it is a mix, not a quota

The starting policy — 6 due-review, 2 weak-skill-or-confusion, 2
new-or-extending, out of a 10-screen series — lives in `tuning.ts`
(`DEFAULT_SELECTION_TUNING`) and `src/domain/session.ts`
(`DEFAULT_SELECTION_POLICY`). **This split is a product default for balance,
not a scientific constant**, and every place it is shown to the learner says
so. `select()` deviates from it deliberately and reports why in plain
language (`SelectionResult.deviation`):

- **Large backlog** (`largeBacklog`, 50+ due): new material is suspended
  entirely — ten screens against 200 due items is already a losing race, and
  adding new debt on top makes it worse. `priority.ts`'s
  `orderByBacklogPriority` decides which of the due items go first.
- **Moderate backlog** (`moderateBacklog`, 20+): new material is reduced, not
  stopped.
- **Nothing due, or a new learner**: the mix shifts toward new material,
  introduced as a coherent lesson-sized GROUP (`newMaterial.ts`,
  `newGroupMin`–`newGroupMax` items), never scattered singletons — and now
  (see below) mixes in a couple of useful components alongside real kanji
  rather than isolating either.
- **Curriculum exhausted**: redistributed toward review/weak-skill.
- **Focused practice** (`focusItemId` set): every target is that one item,
  tagged `reason: 'focused'`, which is what lets the UI and scheduler treat
  the evidence as weaker than an ordinary series (the answer is already
  known to the learner going in).
- **Silent / keyboard-only mode**: `resolveAllowedSkills` removes
  `listening`/`handwriting` from what can be selected at all — never
  selected, so their progress is genuinely untouched, not selected-and-
  discarded. `substituteForHandwriting` picks `readingRecall` or
  `recognition` instead, and the substitute is what gets recorded — a
  keyboard-only session can never silently become handwriting evidence.
  (The product brief also allows stroke-order reconstruction as a
  substitute; no question format implements the `ResponseMode: 'ordering'`
  needed for that yet, so this is the only substitution actually available —
  documented in `substituteForHandwriting`'s own comment, not hidden.)
- **A tiny eligible pool** (a brand-new keyboard-only kanji learner, say,
  where far fewer than ten distinct eligible pairs exist): rather than fail
  or silently pad with ineligible pairs, eligible targets are repeated with
  an explicit reported note that repetition inside one series is not spaced
  mastery.

`chooseReading` (for a kanji target) prefers a reading the learner has never
attempted before falling back to re-drilling the most-overdue started one —
new readings are introduced before old ones are re-tested. `currentReading`
guards every due/candidate lookup against a reading the content no longer
actually teaches (a stale scheduler row surviving a content update), so a
removed reading can't surface as a review target.

## Interleaving (`interleaving.ts`)

Consecutive screens prefer a different skill and a different script from the
one before — a series is not ten hiragana-recognition questions in a row.
But `confusableGuardAllows` caps how many mutually-confusable items
(`maxConfusablesWhileLearning`, 2; `maxConfusablesWhenConsolidated`, 4) may
appear together while the learner has no stable representation of any of
them yet, citing Brunmair & Richter (2019) directly in the code next to the
guard it justifies — interleaving's benefit is moderated by how similar the
material is, so mixing four look-alike characters for someone who knows none
of them yet is noise, not discrimination practice. New vocabulary is kept in
one contiguous block for the same reason, in the other direction (word
learning in that meta-analysis favoured blocking).

## Delayed revisits (`revisit.ts`)

`planRevisit` is a pure function: given where an error happened, it returns
where the item should come back — at least `minInterveningBeforeRevisit`
(3) questions later, never adjacent to the error, deferring to a later
series if the current one has no room left. The session engine calls it and
does the actual replacement; see `../session/README.md` for how a
already-generated series gets a screen swapped in place.

## Testing — real, but not exhaustive

`tests/unit/curriculum-selection.test.ts` (4 tests) covers: components
introduced alongside real kanji rather than in isolation, vocabulary
introduced strictly after every required character regardless of a lesson's
own `introduces[]` list, unsupported handwriting targets (a component, a
multi-character word) never selected, and a first keyboard-only kanji series
still filling all ten screens. `tests/integration/session-engine.test.ts`
exercises the selector indirectly through full sessions.

**Not covered by a dedicated test**: the large/moderate-backlog capping
behaviour, a completely new learner's default mix, a fully-exhausted
curriculum, focused-practice target generation, confusion-repair selection,
and the small-pool repetition path. These are real code paths — see
`selector.ts` directly — just not yet asserted against in isolation.
