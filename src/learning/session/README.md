# Session engine

Implements `SessionEngine` (`src/learning/ports.ts`): owns the ten-screen
series structure and wires the four independent engines — scheduler
(WHEN), selector (WHICH), generator (HOW), grader — together with the XP
ledger and persistence, behind one IndexedDB transaction per graded screen.

## What this module decides, and what it delegates

Nothing here decides when a pair is due, which pairs make up a series, or how
a pair is asked about; it calls `Scheduler`, `Selector` and `Generator` for
those and persists the result. What it does own:

- The exactly-ten-screens structure, enforced by generating exactly
  `SERIES_LENGTH` questions per series and throwing (not silently truncating)
  if the selector ever returns a different count.
- First-attempt preservation: `submit()` always writes `attemptOrdinal: 0`;
  `submitRetry()` appends at `attemptOrdinal >= 1` and never mutates the
  original `screen.result`. Only the ordinal-0 attempt feeds the scheduler.
- XP idempotence in practice: `submit()` banks the screen's 1 XP through
  `XpLedger.awardScreen`, keyed by `(session, series, screen)`; `advance()`
  re-attempts the same bank defensively (a no-op if it already succeeded) so
  an interruption between `submit()` and `advance()` can never lose or
  double-award a screen's XP. The series completion bonus is banked once, at
  the tenth `advance()`, the same way.
- Delayed revisits (see below).
- Linked rounds: `advance()` on a series' last screen starts the next series
  (up to the session's requested count) rather than ending the session.

## Generation timing, and how delayed revisits actually work

`SeriesState.screens` is fully populated — ten concrete `Question`s — as soon
as a series starts, not generated lazily screen by screen. This is a
deliberate choice: `Selector.select()` decides the ORDER and MIX for the
*whole* series at once (the interleaving guard in `selection/interleaving.ts`
compares each target against its immediate neighbours), so the whole series
has to be planned together.

That creates a real tension with "an item answered wrong should come back
after intervening questions": the ten questions already exist by the time an
error happens. This engine resolves it as a **replacement**: when `submit()`
grades an `incorrect` outcome, `selection/revisit.ts`'s `planRevisit` computes
which later, not-yet-reached screen should carry the revisit (respecting the
documented minimum gap), and that screen's `question` is regenerated in place
and swapped in — asynchronously, before the learner can possibly reach it,
since screens ahead of the cursor are never rendered until reached. A screen
the learner has already answered is never touched.

When no room remains in the current series (the error happened too late, or
too many revisits are already queued), the revisit is deferred: its
`afterScreenIndex` is recorded as pointing past the series' last screen, and
`buildSeries` picks up any such carried-over entries when the *next* series in
a linked round starts, seeding them onto its opening screens. A standalone
`kind: 'standard'` session (one series) has no next series to defer to — the
revisit is simply not re-asked this session. This is not a silent loss: the
scheduler has already recorded the lapse from the original wrong answer, so
the item is due again on its own schedule regardless.

**Known simplification:** a cross-series carried revisit is currently always
re-asked as `recognition`, regardless of which skill the original error was
on. Fixing this needs `SeriesState.revisitQueue` (or a session-level field) to
carry the skill, which the current domain type does not. Documented here
rather than silently dropped.

## Auxiliary tracking

A question whose spec marks `alsoExercises: ['imeInput']` (currently
`audio-to-typed`, `word-reading`, `kanji-in-word-context`) increments the
auxiliary IME counters on every submit, in the same transaction as the
attempt — never folded into `readingRecall`. `GradeDetail.copiedVisibleRomaji`
from the grader is tracked the same way, separately again.

## What is NOT yet wired here

- **Keyboard-only substitution** is implemented in the selector
  (`substituteForHandwriting`) and reflected in which skill a target carries,
  but this engine does not yet pass `session.keyboardOnlyMode` /
  `session.silentMode` through to `allowedSkillsFor` per-target overrides
  beyond the blanket skill exclusion it already does — see
  `allowedSkillsFor()`. This matches the selector's own behaviour (it also
  only blanket-excludes), so the two are consistent, but neither implements
  a more granular per-item override.
- **Focused practice** (`focusItemId`) is threaded through to the selector on
  every `buildSeries` call, including for series 2+ of a linked round — a
  focused *round* is therefore supported, but there is no way to focus only
  the first series of a round and return to normal selection after. Nothing
  in the product brief asks for that; noted as a design boundary, not a bug.
