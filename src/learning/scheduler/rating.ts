/**
 * Turning a Kansei attempt into an FSRS rating.
 *
 * FSRS was designed for a learner who self-reports again/hard/good/easy.
 * Kansei never asks that question — self-report is not evidence, and a beginner
 * has no calibrated sense of "hard". Instead the rating is derived from what was
 * actually observed: the graded outcome, whether any help was used, how strong
 * the question format's evidence is, and how the response time compares with
 * this pair's own history on the same input method.
 *
 * The rules that make this different from a straight port of FSRS:
 *
 *  1. 'uncertain' is NOT a failure. The handwriting assessor returns it when it
 *     could not decide what was drawn. That is the assessor's ignorance, not the
 *     learner's, so it produces no rating at all and the memory model is left
 *     alone (see scheduler.ts).
 *
 *  2. Evidence caps the rating. Picking the right answer from four options is
 *     weak evidence and can never be rated better than 'hard'; unaided
 *     production can reach 'easy'.
 *
 *  3. Response time can only ever RAISE a rating, never lower it. Handwriting a
 *     kanji with a finger takes many seconds; typing two rōmaji letters takes
 *     one. Comparing either against a global threshold would systematically
 *     punish the pen. Even comparing against the pair's own median can only earn
 *     a bonus here, because a slow-but-correct answer is genuinely ambiguous
 *     evidence (hesitation? a stiff stylus? a distraction?) and we refuse to
 *     read it as forgetting.
 */

import { NON_PENALISED_HINTS } from '@/domain';
import type { AttemptRecord, EvidenceStrength, SkillState } from '@/domain';
import { RATING_ORDER, type FsrsRating } from './fsrs';

/**
 * The best rating each evidence strength can produce.
 *
 * 'weak' → 'hard' is the primary mechanism for requirement (b): FSRS multiplies
 * the stability increase by w₁₅ (≈0.23) for a 'hard' review, so a correct
 * four-option answer moves the schedule far less than a correct unaided one.
 * scheduler.ts applies a second, explicit cap on interval growth on top of this.
 */
export const EVIDENCE_RATING_CEILING: Record<EvidenceStrength, FsrsRating> = {
  weak: 'hard',
  moderate: 'good',
  strong: 'easy',
};

export const EVIDENCE_RANK: Record<'none' | EvidenceStrength, number> = {
  none: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};

/** Why the scheduler reached the rating it did. Diagnostic, not learner-facing. */
export type RatingVerdict =
  | {
      kind: 'rated';
      rating: FsrsRating;
      evidence: EvidenceStrength;
      /** True when this counts as an unaided first-attempt success. */
      success: boolean;
      /** True when help was used or the answer was revealed. */
      aided: boolean;
      /** True when the response beat this pair's own median for the input method. */
      fasterThanUsual: boolean;
      reason: string;
    }
  | { kind: 'no-evidence'; reason: string };

export interface SpeedRules {
  /** A response at or below this fraction of the pair's own median earns 'easy'. */
  fastFractionOfMedian: number;
  /**
   * Minimum attempts on this pair before the median is trusted at all.
   * `medianMsByInput` is a running estimate; one sample is not a baseline.
   */
  minAttemptsForSpeedBonus: number;
}

const lower = (a: FsrsRating, b: FsrsRating): FsrsRating =>
  RATING_ORDER.indexOf(a) <= RATING_ORDER.indexOf(b) ? a : b;

/** Hints that weaken the evidence. Replaying audio in a listening question does not. */
export function penalisedHints(attempt: AttemptRecord): string[] {
  return attempt.hintsUsed.filter((h) => !NON_PENALISED_HINTS.has(h));
}

/**
 * Was this answer fast *for this pair, on this input method*?
 *
 * Never a global threshold: the comparison is always against
 * `SkillState.medianMsByInput[inputMethod]`, so finger-writing is compared with
 * finger-writing. With no baseline yet, the answer is "unknown", which costs the
 * learner nothing — it only means no speed bonus.
 */
export function fasterThanUsual(
  state: SkillState,
  attempt: AttemptRecord,
  rules: SpeedRules,
): boolean {
  const median = state.medianMsByInput[attempt.inputMethod];
  if (median === undefined || median <= 0) return false;
  if (state.totalAttempts < rules.minAttemptsForSpeedBonus) return false;
  return attempt.elapsedMs <= median * rules.fastFractionOfMedian;
}

/**
 * Derive the FSRS rating for one graded attempt.
 *
 * `attempt.evidence` is missing only while a caller has not been wired up yet;
 * absent evidence is read as 'weak', which is the choice that cannot inflate
 * anything (see the field's comment in domain/progress.ts).
 */
export function deriveRating(
  state: SkillState,
  attempt: AttemptRecord,
  rules: SpeedRules,
): RatingVerdict {
  const evidence: EvidenceStrength = attempt.evidence ?? 'weak';

  // (1) The assessor could not decide. No rating exists for "we don't know".
  if (attempt.outcome === 'uncertain') {
    return {
      kind: 'no-evidence',
      reason: 'The assessor could not decide what was written, so this attempt carries no evidence.',
    };
  }

  const hints = penalisedHints(attempt);
  const aided = hints.length > 0;

  if (attempt.declined) {
    return { kind: 'rated', rating: 'again', evidence, success: false, aided, fasterThanUsual: false, reason: 'The learner declined to answer.' };
  }
  if (attempt.outcome === 'incorrect') {
    return { kind: 'rated', rating: 'again', evidence, success: false, aided, fasterThanUsual: false, reason: 'The answer was wrong.' };
  }

  // Correct, but with help, or not on the first attempt: not a success. The
  // rating is 'again' because the learner could not produce it unaided, which is
  // what the schedule is a claim about.
  if (aided || !attempt.unaidedFirstAttempt) {
    return {
      kind: 'rated',
      rating: 'again',
      evidence,
      success: false,
      aided,
      fasterThanUsual: false,
      reason: aided
        ? `Correct, but with help (${hints.join(', ')}).`
        : 'Correct, but not on the first unaided attempt.',
    };
  }

  const fast = fasterThanUsual(state, attempt, rules);
  const ceiling = EVIDENCE_RATING_CEILING[evidence];
  const rating = lower(ceiling, fast ? 'easy' : 'good');

  return {
    kind: 'rated',
    rating,
    evidence,
    success: true,
    aided: false,
    fasterThanUsual: fast,
    reason:
      `Correct and unaided on ${evidence} evidence` +
      (fast ? ', and faster than usual for this pair.' : '.') +
      (rating === ceiling && ceiling !== 'easy'
        ? ` Capped at '${ceiling}' because the format is ${evidence} evidence.`
        : ''),
  };
}
