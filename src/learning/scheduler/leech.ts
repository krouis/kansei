/**
 * Leech detection.
 *
 * A "leech" is a pair the learner keeps losing. Plain spaced repetition responds
 * to repeated failure by shrinking the interval, which produces the worst
 * possible experience: the same character comes back every few minutes, fails
 * again, and crowds out everything else. Shrinking the interval is the wrong
 * lever because the problem is not the schedule — it is that the pair needs
 * different *treatment* (scaffolding, a component breakdown, a confusable
 * comparison, or simply being set aside for now).
 *
 * So this module only detects and reports. The scheduler uses the report to stop
 * shrinking (it applies a floor to the interval); the selector and the UI use it
 * to offer something more useful than another identical question.
 */

import type { SkillState } from '@/domain';

/**
 * Thresholds are a product choice, not a validated measurement.
 *
 * `lapsesForLeech: 4` — Anki's long-standing default is 8 lapses, but Anki
 * counts lapses on cards reviewed for months or years. Kansei's beginner path is
 * weeks long and a kana that has been forgotten four times after being learned
 * is already worth intervening on, so the bar is lower.
 *
 * `attemptsWithoutSuccess: 8` — a pair that has never once been produced unaided
 * after eight graded attempts is also stuck, even though it has zero "lapses" in
 * the strict sense (you cannot lapse what you never had). Reporting only the
 * first case would leave the hardest pairs invisible.
 */
export const LEECH_CRITERIA = {
  lapsesForLeech: 4,
  attemptsWithoutSuccess: 8,
} as const;

export interface LeechAssessment {
  isLeech: boolean;
  /** 'forgotten-repeatedly' | 'never-produced' | null */
  kind: 'forgotten-repeatedly' | 'never-produced' | null;
  lapses: number;
  /** Learner-facing sentence. Null when the pair is not a leech. */
  explanation: string | null;
  /** Learner-facing suggestion of what to do instead of more of the same. */
  suggestion: string | null;
}

const NOT_A_LEECH: LeechAssessment = {
  isLeech: false,
  kind: null,
  lapses: 0,
  explanation: null,
  suggestion: null,
};

export function assessLeech(state: SkillState): LeechAssessment {
  if (state.lapses >= LEECH_CRITERIA.lapsesForLeech) {
    return {
      isLeech: true,
      kind: 'forgotten-repeatedly',
      lapses: state.lapses,
      explanation: `You have learned this and then lost it ${state.lapses} times, so it is being treated differently instead of just coming back sooner and sooner.`,
      suggestion:
        'Try focused practice with the stroke guide on, and compare it side by side with the characters you mix it up with.',
    };
  }
  if (
    state.unaidedFirstAttemptCorrect === 0 &&
    state.totalAttempts >= LEECH_CRITERIA.attemptsWithoutSuccess
  ) {
    return {
      isLeech: true,
      kind: 'never-produced',
      lapses: state.lapses,
      explanation: `You have tried this ${state.totalAttempts} times without getting it unaided yet. That is a sign the material needs a different approach, not more repetitions.`,
      suggestion:
        'Work through it with the scaffolding on — stroke order, then rōmaji support — before being tested on it again.',
    };
  }
  return { ...NOT_A_LEECH, lapses: state.lapses };
}
