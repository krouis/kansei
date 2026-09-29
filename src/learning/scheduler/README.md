# Scheduler

Implements `Scheduler` (`src/learning/ports.ts`): decides **WHEN** an
`(item, skill[, reading])` pair is next reviewed. Nothing here decides which
pairs make up a series (`../selection/`) or which question format asks about
one (`../generation/`) — see [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md)
for how the three fit together.

## Algorithm: FSRS-5

[FSRS](https://github.com/open-spaced-repetition/fsrs4anki) (Free Spaced
Repetition Scheduler), version 5, implemented directly in `fsrs.ts` — no
dependency. The published default weight vector
(`FSRS5_DEFAULT_WEIGHTS`) and the stability/difficulty/retrievability formulas
are used as documented by the project. `requestedRetention` is kept at FSRS's
own default, 0.90: lower buys fewer reviews at the cost of more forgetting,
which is the wrong trade when forgetting one kana blocks reading the next
word; higher roughly doubles review load for a few points of accuracy, which
is how a daily habit dies. Both are engineering judgement calls, not derived
from a fitted model.

**Honest limitation, stated once here rather than everywhere it matters:**
FSRS's published weights were fitted on Anki review logs of mostly-textual
flashcards. Nothing establishes they are optimal for handwriting or listening
practice, and Kansei does not fit per-learner parameters — everyone gets the
same weight vector. See [`docs/about the About & Science
data`](../../features/about/references.data.ts) for how this is framed to the
learner.

## What plain FSRS does not cover — the actual content of this module

- **Grade mapping** (`rating.ts`). FSRS wants a rating (again/hard/good/easy);
  Kansei has a richer `AttemptRecord`. `deriveRating` maps it: any hint,
  reveal, or decline is `again`; a genuinely uncertain handwriting verdict
  (`outcome: 'uncertain'`) is excluded from rating entirely rather than
  treated as a lapse — it leaves stability/difficulty untouched and schedules
  a near-term recheck (`uncertainRecheckDays`), because "the assessor
  couldn't tell" is an absence of evidence, not a wrong answer.
- **Evidence weighting.** A `Question.evidence` of `'weak'` (a four-option
  choice) caps how far the interval can grow in one step
  (`weakEvidenceGrowthCap`), so recognising an item off a multiple-choice list
  can never alone carry a pair to `retained` — see `stages.ts`.
- **Response time, interpreted per input method.** `fasterThanUsual` compares
  `elapsedMs` against the pair's OWN running median for that specific input
  method (`SkillState.medianMsByInput`, updated by `updateMedianEstimate`),
  never a global threshold. A 12-second correct handwriting answer is not
  rated down for being slower than a 2-second tap; it is only rated down if
  it is slow *for handwriting this pair*.
- **Interval fuzz.** ±`fuzzFraction` (5%) on intervals at or above
  `fuzzMinIntervalDays`, so reviews spread out instead of clumping on the same
  future date. Uses the `random` function injected into
  `FsrsSchedulerOptions` — never `Math.random` — so a test (or a "replay this
  session" diagnostic) is reproducible.
- **Leech detection** (`leech.ts`). A pair with repeated lapses is flagged
  (`assessLeech`) rather than just having its interval keep shrinking, so the
  UI has something to act on beyond "review it again, sooner."
- **A hard interval ceiling.** `maxIntervalDays` (180) means even a
  `retained` pair is rechecked at least twice a year — apparent mastery is
  never allowed to mean "never asked again."

## Learning stages (`stages.ts`)

Four stages, four **transparent, documented** criteria — never a percentage,
never raw model output. `STAGE_CRITERIA` is one exported object holding every
threshold, each with an inline "why this number" comment; `explainStage`
turns a `SkillState` into the one or two plain sentences the UI shows instead
of a score. In brief:

| Stage | Requires |
|---|---|
| `unseen` | No attempts. |
| `learning` | At least one attempt, short of the bar below. |
| `consolidating` | 3+ unaided first-attempt successes, on 2+ *distinct calendar dates* — the spacing requirement a single long session cannot buy. |
| `retained` | The success history spans 21+ days AND the model's own next interval is 21+ days AND at least one success was at `moderate`/`strong` evidence — weak (multiple-choice) evidence alone cannot reach this stage. |

Every threshold here is stated, in the code and in the About & Science
copy, as a **product choice**: no experiment established that three
successes on two dates is the right bar. They are documented so they can be
argued with.

## Testing — a real, disclosed gap

There is **no dedicated test file for this module.** The scheduler is only
exercised indirectly, through `tests/integration/session-engine.test.ts`'s
happy-path assertions (which check a couple of resulting `SkillState` fields
after a single scripted series, not the module's actual decision logic). None
of the following has a test anywhere: monotonic interval growth, a lapse
shortening the interval, `uncertain` leaving stability/difficulty untouched,
weak evidence being unable to reach `retained`, slow handwriting not being
penalised relative to its own per-method median, stage transitions requiring
distinct calendar dates, the interval ceiling, or leech detection firing.

This is exactly the kind of module — hard to verify by inspection, load-
bearing for what the learner is told about their own memory — that should not
be running on inspection alone. See `WORK.md` for tracking.
