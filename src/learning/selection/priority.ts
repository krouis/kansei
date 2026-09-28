import type { LearningStage, SkillState } from '@/domain';

/**
 * Ordering rules for review and weak-skill candidates.
 *
 * These are heuristics, and they are labelled as such wherever they are shown.
 * The scheduler owns WHEN a pair is due; this file only decides which of the
 * already-due pairs are worth the ten screens we actually have.
 */

/**
 * How fragile a stage is — how much is lost if the pair is forgotten now.
 *
 * A pair still in `learning` that lapses goes back to the start; a `retained`
 * pair that lapses is usually recovered in one successful answer. So when there
 * is more due than can fit, the fragile pairs are the ones worth the screens.
 */
const STAGE_FRAGILITY: Record<LearningStage, number> = {
  unseen: 1,
  learning: 1,
  consolidating: 0.6,
  retained: 0.25,
};

const EVIDENCE_RANK: Record<SkillState['strongestEvidencePassed'], number> = {
  none: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};

const MS_PER_DAY = 86_400_000;

function daysOverdue(state: SkillState, now: Date): number {
  if (state.dueAt === null) return 0;
  const due = Date.parse(state.dueAt);
  if (Number.isNaN(due)) return 0;
  return Math.max(0, (now.getTime() - due) / MS_PER_DAY);
}

/**
 * Overdue RATIO, not absolute lateness.
 *
 * "Most overdue first" is a poor rule on its own, and this is why: a pair with a
 * one-day interval that is three days late has been left for four times its
 * interval and is very likely gone, while a pair with a sixty-day interval that
 * is three days late has barely moved. Dividing the lateness by the interval
 * that produced it compares the two fairly, and it stops a long backlog from
 * being dominated by mature items that are still perfectly well retained.
 */
export function overdueRatio(state: SkillState, now: Date): number {
  const interval = Math.max(state.lastIntervalDays, 1);
  return daysOverdue(state, now) / interval;
}

/**
 * Priority of a due pair. Higher is selected first.
 *
 * Deliberately a weighted sum of three independent signals rather than a single
 * one: overdue ratio (how far past its interval), stage fragility (how much is
 * lost by leaving it), and lapse history (this pair has already proved hard).
 * The weights are product defaults.
 */
export function backlogPriority(state: SkillState, now: Date): number {
  const ratio = Math.min(overdueRatio(state, now), 8) / 8;
  const fragility = STAGE_FRAGILITY[state.stage];
  const lapseRate = state.lapses / Math.max(state.totalAttempts, 1);
  return 0.5 * ratio + 0.35 * fragility + 0.15 * Math.min(lapseRate, 1);
}

/** Total, deterministic ordering of due pairs. Ties break on ids so tests are stable. */
export function orderByBacklogPriority(states: readonly SkillState[], now: Date): SkillState[] {
  return [...states].sort((a, b) => {
    const diff = backlogPriority(b, now) - backlogPriority(a, now);
    if (Math.abs(diff) > 1e-9) return diff;
    // Weaker modelled memory first, then the pair that has waited longest.
    if (a.stability !== b.stability) return a.stability - b.stability;
    const aDue = a.dueAt ?? '';
    const bDue = b.dueAt ?? '';
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return String(a.itemId).localeCompare(String(b.itemId)) || a.skill.localeCompare(b.skill);
  });
}

/**
 * Weakness of a pair that is NOT yet due.
 *
 * Used when the backlog is empty. "Weak" here means "the least secure thing we
 * could practise", which covers two cases the learner experiences as the same:
 * a pair that keeps lapsing, and a pair that is merely closest to fading. Both
 * are reported as `weak-skill`, and the deviation note says which case applied.
 */
export function weakness(state: SkillState, now: Date): number {
  const attempts = Math.max(state.totalAttempts, 1);
  const fragility = STAGE_FRAGILITY[state.stage];
  const failureRate = Math.min(state.lapses / attempts, 1);
  const aidReliance = Math.min(state.aidedAttempts / attempts, 1);
  const evidenceGap = 1 - EVIDENCE_RANK[state.strongestEvidencePassed] / 3;
  // How far through its current interval the pair has travelled. 1 means it is
  // at or past its due date; the scheduler, not this number, decides due-ness.
  const last = state.lastReviewedAt === null ? Number.NaN : Date.parse(state.lastReviewedAt);
  const elapsedDays = Number.isNaN(last) ? 0 : Math.max(0, (now.getTime() - last) / MS_PER_DAY);
  const decay = Math.min(elapsedDays / Math.max(state.lastIntervalDays, 1), 1);
  return 0.35 * fragility + 0.25 * failureRate + 0.15 * aidReliance + 0.15 * evidenceGap + 0.1 * decay;
}

export function orderByWeakness(states: readonly SkillState[], now: Date): SkillState[] {
  return [...states].sort((a, b) => {
    const diff = weakness(b, now) - weakness(a, now);
    if (Math.abs(diff) > 1e-9) return diff;
    return String(a.itemId).localeCompare(String(b.itemId)) || a.skill.localeCompare(b.skill);
  });
}
