/**
 * Learning stages: the transparent criteria behind the four badges.
 *
 * A stage is a statement about observed behaviour, never a measurement of memory
 * strength. That is why this file contains no model output at all except the
 * scheduled interval, and why there is no percentage anywhere: "Consolidating"
 * means "you have done these specific things", and the learner can read exactly
 * which things (see `explainStage`).
 *
 * The thresholds below are a PRODUCT CHOICE, not a validated measurement. No
 * experiment was run to show that three successes on two days predicts anything
 * in particular. They are defensible defaults, documented so that they can be
 * argued with — which is the point of publishing them.
 */

import { LEARNING_STAGE_LABELS } from '@/domain';
import type { LearningStage, SkillState } from '@/domain';
import { EVIDENCE_RANK } from './rating';
import { count, humaniseDays } from './phrasing';

/**
 * Every number the stage ladder depends on, in one place.
 *
 * WHY these values:
 *
 * `consolidating.minUnaidedSuccesses: 3` — one correct answer is noise; three is
 * the smallest number that makes a run rather than a coincidence, and keeps the
 * first badge reachable in a beginner's first week.
 *
 * `consolidating.minDistinctDates: 2` — the hard part. Three successes in one
 * sitting is short-term memory and nothing else, so a second calendar date is
 * required before anything can leave "Learning". This is the spacing claim, and
 * it is the one criterion that cannot be bought with a longer session.
 *
 * `retained.minStudySpanDays: 21` / `retained.minScheduledIntervalDays: 21` —
 * three weeks. Long enough that the learner has demonstrably survived at least a
 * couple of forgetting cycles; short enough to be reachable inside a course. The
 * two numbers are separate criteria: the *history* must span three weeks AND the
 * model must currently be willing to wait three weeks before the next check.
 *
 * `retained.minEvidence: 'moderate'` — a pair may NOT reach "Retained" on
 * four-option recognition alone. Recognising ね among four options is not knowing
 * ね; the learner has to have produced it (typed, spoken back, or written) at
 * least once. This is the rule that stops the badge from being inflated by the
 * easiest question format.
 *
 * `retained.minDistinctDates: 3` — three separate days, so "Retained" always
 * rests on spacing rather than a single lucky pair of sessions.
 */
export const STAGE_CRITERIA = {
  consolidating: {
    minUnaidedSuccesses: 3,
    minDistinctDates: 2,
  },
  retained: {
    minUnaidedSuccesses: 4,
    minDistinctDates: 3,
    minStudySpanDays: 21,
    minScheduledIntervalDays: 21,
    minEvidence: 'moderate',
  },
} as const;

/**
 * Days between first meeting the pair and the most recent unaided success.
 *
 * `firstSeenAt` is used as the start of the span rather than the first *success*,
 * because SkillState does not record the first success and the difference only
 * ever makes the criterion slightly easier to reach. Stated here rather than
 * hidden, so the number is not mistaken for "days of successful recall".
 */
export function studySpanDays(state: SkillState): number {
  if (state.firstSeenAt === null || state.lastUnaidedSuccessAt === null) return 0;
  const from = Date.parse(state.firstSeenAt);
  const to = Date.parse(state.lastUnaidedSuccessAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, (to - from) / 86_400_000);
}

/**
 * The modelled interval the stage ladder judges, in days.
 *
 * Stability is used rather than `lastIntervalDays` on purpose: near-term
 * rechecks (an inconclusive handwriting attempt, a relearning step) deliberately
 * set a short `dueAt` without touching the memory model, and a pair must not be
 * demoted from "Retained" because it is being looked at again today. At the
 * default requested retention of 0.9 the two are equal anyway, by construction
 * of the FSRS forgetting curve.
 */
export const stageIntervalDays = (state: SkillState): number => state.stability;

export interface StageCheck {
  met: boolean;
  /** Learner-facing description of the requirement. */
  requirement: string;
  /** Learner-facing description of where they actually are. */
  progress: string;
}

function consolidatingChecks(state: SkillState): StageCheck[] {
  const c = STAGE_CRITERIA.consolidating;
  return [
    {
      met: state.unaidedFirstAttemptCorrect >= c.minUnaidedSuccesses,
      requirement: `${c.minUnaidedSuccesses} correct answers with no help`,
      progress: `you have ${state.unaidedFirstAttemptCorrect}`,
    },
    {
      met: state.spacedSuccesses >= c.minDistinctDates,
      requirement: `on at least ${count(c.minDistinctDates, 'different day')}`,
      progress: `so far ${count(state.spacedSuccesses, 'day')}`,
    },
  ];
}

function retainedChecks(state: SkillState): StageCheck[] {
  const r = STAGE_CRITERIA.retained;
  const span = studySpanDays(state);
  const interval = stageIntervalDays(state);
  return [
    {
      met: state.unaidedFirstAttemptCorrect >= r.minUnaidedSuccesses,
      requirement: `${r.minUnaidedSuccesses} correct answers with no help`,
      progress: `you have ${state.unaidedFirstAttemptCorrect}`,
    },
    {
      met: state.spacedSuccesses >= r.minDistinctDates,
      requirement: `on at least ${count(r.minDistinctDates, 'different day')}`,
      progress: `so far ${count(state.spacedSuccesses, 'day')}`,
    },
    {
      met: span >= r.minStudySpanDays,
      requirement: `spread over at least ${r.minStudySpanDays} days`,
      progress: `spread over ${Math.floor(span)} so far`,
    },
    {
      met: EVIDENCE_RANK[state.strongestEvidencePassed] >= EVIDENCE_RANK[r.minEvidence],
      requirement: 'at least once by producing it yourself, not just picking it from options',
      progress:
        state.strongestEvidencePassed === 'none'
          ? 'not yet'
          : `strongest so far: ${state.strongestEvidencePassed} evidence`,
    },
    {
      met: interval >= r.minScheduledIntervalDays,
      requirement: `and the gap between checks has reached ${r.minScheduledIntervalDays} days`,
      progress: `currently ${humaniseDays(interval)}`,
    },
  ];
}

/** Pure derivation: the stage is a function of the recorded state, nothing else. */
export function stageFor(state: SkillState): LearningStage {
  if (state.totalAttempts === 0) return 'unseen';
  if (retainedChecks(state).every((c) => c.met)) return 'retained';
  if (consolidatingChecks(state).every((c) => c.met)) return 'consolidating';
  return 'learning';
}

/**
 * Plain-language account of why a pair sits where it does, for the UI.
 *
 * Always names what is still missing, because "Learning" with no explanation is
 * the kind of opaque feedback that makes a learner distrust the whole app.
 * Never a percentage.
 */
export function explainStage(state: SkillState): string {
  const stage = stageFor(state);
  const label = LEARNING_STAGE_LABELS[stage];

  if (stage === 'unseen') {
    return `${label}: you have not practised this yet.`;
  }

  const missing = (checks: StageCheck[]): string =>
    checks
      .filter((c) => !c.met)
      .map((c) => `${c.requirement} (${c.progress})`)
      .join('; ');

  if (stage === 'learning') {
    return `${label}: you have answered this ${count(state.totalAttempts, 'time')} and got it right unaided ${count(state.unaidedFirstAttemptCorrect, 'time')}. To reach ${LEARNING_STAGE_LABELS.consolidating} you still need ${missing(consolidatingChecks(state))}.`;
  }

  if (stage === 'consolidating') {
    return `${label}: you have got this right unaided ${count(state.unaidedFirstAttemptCorrect, 'time')} on ${count(state.spacedSuccesses, 'separate day')}. To reach ${LEARNING_STAGE_LABELS.retained} you still need ${missing(retainedChecks(state))}.`;
  }

  return `${label}: you have recalled this unaided ${count(state.unaidedFirstAttemptCorrect, 'time')} across ${count(state.spacedSuccesses, 'separate day')}, and it has kept coming back correct after gaps of ${humaniseDays(stageIntervalDays(state))}. It will still reappear from time to time — that is how it stays retained.`;
}
