import type { HintKind, InputScript, Settings, SkillState } from '@/domain';
import { isCopyOfVisibleRomaji } from '@/domain';

/**
 * Rōmaji scaffold withdrawal.
 *
 * Rōmaji is a starting aid, not a representation of Japanese. Leaving it on
 * screen keeps a learner reading Latin letters and mapping them to kana, which
 * is the wrong association to strengthen: the goal is sound → character and
 * character → reading directly. So it is withdrawn, gradually, in three states:
 *
 *   'shown'      printed next to the prompt, unasked.
 *   'on-request' hidden, available from the hint button; asking for it is
 *                recorded and costs the unaided credit for that attempt.
 *   'withheld'   not available at all for this pair.
 *
 * The schedule below is a product choice; the speed is the learner's, via
 * settings.scaffoldWithdrawal. `scaffoldLevel` on the pair's own state is
 * honoured as an override when it is lower than the schedule would give, so a
 * learner who has already moved past the aid never has it put back.
 */
export type ScaffoldVisibility = 'shown' | 'on-request' | 'withheld';

export interface ScaffoldPolicy {
  visibility: ScaffoldVisibility;
  /** Why, in one sentence, for the diagnostics panel. */
  reason: string;
}

/**
 * The withdrawal schedule.
 *
 *  fast     shown only until the first unaided success, then on request while
 *           still learning, then gone from 'consolidating'.
 *  standard shown while learning with fewer than two unaided successes in a row,
 *           on request through 'consolidating', gone at 'retained'.
 *  slow     shown through 'learning', on request through 'consolidating' and
 *           into 'retained' until two spaced successes, then gone.
 */
export function romajiScaffoldPolicy(
  state: SkillState | null,
  withdrawal: Settings['scaffoldWithdrawal'],
): ScaffoldPolicy {
  if (state === null) {
    return { visibility: 'shown', reason: 'New material: the rōmaji is shown the first few times.' };
  }

  const scheduled = ((): ScaffoldVisibility => {
    switch (withdrawal) {
      case 'fast':
        if (state.stage === 'unseen') return 'shown';
        if (state.stage === 'learning') return state.streak >= 1 ? 'on-request' : 'shown';
        return 'withheld';
      case 'slow':
        if (state.stage === 'unseen' || state.stage === 'learning') return 'shown';
        if (state.stage === 'consolidating') return 'on-request';
        return state.spacedSuccesses >= 2 ? 'withheld' : 'on-request';
      case 'standard':
      default:
        if (state.stage === 'unseen') return 'shown';
        if (state.stage === 'learning') return state.streak >= 2 ? 'on-request' : 'shown';
        if (state.stage === 'consolidating') return 'on-request';
        return 'withheld';
    }
  })();

  // scaffoldLevel is the pair's recorded position: 2 = full, 1 = on request,
  // 0 = none. It can only tighten the schedule, never loosen it, so support is
  // never restored to a pair that has already gone without it.
  const byLevel: ScaffoldVisibility =
    state.scaffoldLevel >= 2 ? 'shown' : state.scaffoldLevel === 1 ? 'on-request' : 'withheld';
  const order: ScaffoldVisibility[] = ['shown', 'on-request', 'withheld'];
  const visibility = order[Math.max(order.indexOf(scheduled), order.indexOf(byLevel))] as ScaffoldVisibility;

  return { visibility, reason: SCAFFOLD_REASONS[visibility] };
}

const SCAFFOLD_REASONS: Record<ScaffoldVisibility, string> = {
  shown: 'Still early with this character, so the rōmaji is shown.',
  'on-request': 'The rōmaji is available if you ask for it, and asking is recorded.',
  withheld: 'No rōmaji for this one — the point is the character itself.',
};

/**
 * True when showing `scaffold` would hand the learner an answer they are about
 * to type.
 *
 * This is rule (e): if the rōmaji is on the screen and the learner types it into
 * an IME to produce kana, the screen exercised the IME, not character recall.
 * Crediting that to readingRecall would make the progress display a lie, so the
 * scaffold is withheld instead of the result being quietly downgraded.
 */
export function scaffoldWouldLeakAnswer(
  scaffold: string | null,
  acceptedAnswers: readonly string[],
  inputScript: InputScript,
): boolean {
  if (scaffold === null) return false;
  // A choice question cannot be "copied": there is nothing to type.
  if (inputScript === 'none') return false;
  // Typing rōmaji when rōmaji is displayed is a direct copy.
  if (acceptedAnswers.some((a) => isCopyOfVisibleRomaji(a, scaffold))) return true;
  // Typing kana via an IME from displayed rōmaji is a copy with one extra step.
  return inputScript === 'kana' || inputScript === 'japanese-any';
}

export interface ResolvedScaffold {
  scaffold: string | null;
  allowedHints: HintKind[];
  /** Set when the scaffold was removed by the leak rule rather than the schedule. */
  withheldBecauseItWouldLeak: boolean;
}

/**
 * Apply the policy and the leak rule to one question's prompt.
 *
 * `candidate` is the rōmaji this format could display. The result is what it may
 * actually display, plus the hint list with 'romaji-scaffold' added or removed to
 * match — the hint list and the prompt must never disagree, or the UI would
 * offer a hint the engine refuses to honour.
 */
export function resolveScaffold(
  candidate: string | null,
  policy: ScaffoldPolicy,
  baseHints: readonly HintKind[],
  acceptedAnswers: readonly string[],
  inputScript: InputScript,
): ResolvedScaffold {
  const hints = baseHints.filter((h) => h !== 'romaji-scaffold');
  if (candidate === null || policy.visibility === 'withheld') {
    return { scaffold: null, allowedHints: hints, withheldBecauseItWouldLeak: false };
  }
  if (scaffoldWouldLeakAnswer(candidate, acceptedAnswers, inputScript)) {
    return { scaffold: null, allowedHints: hints, withheldBecauseItWouldLeak: true };
  }
  if (policy.visibility === 'on-request') {
    return { scaffold: null, allowedHints: [...hints, 'romaji-scaffold'], withheldBecauseItWouldLeak: false };
  }
  return { scaffold: candidate, allowedHints: hints, withheldBecauseItWouldLeak: false };
}
