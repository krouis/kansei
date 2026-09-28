import type { ItemId, MatchPair, PairResult } from '@/domain';

/**
 * Matching screens.
 *
 * A three-pair matching screen is ONE screen, but it is THREE pieces of
 * evidence, so each pair is graded on its own. The two fields that make that
 * evidence usable are derived here rather than trusted from the caller:
 *
 *  - `remainingChoices` is how many right-hand options were still unassigned
 *    when the pair was resolved. With n pairs, the k-th resolution (0-based) had
 *    n - k choices left. This follows from the order alone, so the grader
 *    computes it and overwrites whatever the UI reported.
 *  - `forcedByElimination` is therefore exactly `remainingChoices === 1`: the
 *    last pair in a matching screen is unavoidable, and crediting it as recall
 *    would inflate every matching screen by a third.
 *
 * Correctness itself is verified from `chosenRightItemId` when the surface
 * reports it. When it does not, the reported `correct` is taken as given — that
 * is a real limitation, not a silent one, and it is stated in the return value.
 */

export interface GradedPair extends PairResult {
  /** True when this pair's correctness was verified from the chosen counterpart. */
  verified: boolean;
}

export interface MatchingBreakdown {
  pairs: GradedPair[];
  correctCount: number;
  /** Pairs the learner got right that were forced, i.e. not evidence of recall. */
  forcedCorrectCount: number;
  /** Left item → the item it was wrongly attached to. Feeds the confusion table. */
  confusions: Array<{ itemId: ItemId; confusedWith: ItemId }>;
  /** True when every pair's correctness was verified rather than taken on trust. */
  fullyVerified: boolean;
}

/**
 * Grade the pairs of one matching screen.
 *
 * `results` must be in the order the learner resolved them; that order is the
 * only source for how many choices remained. Pairs the learner never resolved
 * are not invented here — a screen submitted with fewer results than pairs
 * simply has fewer graded pairs, and the caller decides what that means.
 */
export function gradeMatchingPairs(pairs: MatchPair[], results: PairResult[]): MatchingBreakdown {
  const byId = new Map(pairs.map((p) => [p.pairId, p]));
  const total = pairs.length;
  const graded: GradedPair[] = [];
  const confusions: Array<{ itemId: ItemId; confusedWith: ItemId }> = [];
  let correctCount = 0;
  let forcedCorrectCount = 0;
  let fullyVerified = results.length > 0;

  results.forEach((result, k) => {
    const pair = byId.get(result.pairId);
    const remainingChoices = Math.max(1, total - k);
    const forcedByElimination = remainingChoices === 1;
    const chosen = result.chosenRightItemId ?? null;
    const verified = pair !== undefined && chosen !== null;
    const correct = verified ? chosen === pair.right.itemId : result.correct;

    if (!verified) fullyVerified = false;
    if (correct) {
      correctCount += 1;
      if (forcedByElimination) forcedCorrectCount += 1;
    } else if (pair !== undefined && chosen !== null) {
      // The learner attached this left-hand item to another item's counterpart:
      // that other item is what they confused it with.
      confusions.push({ itemId: pair.left.itemId, confusedWith: chosen });
    }

    graded.push({
      ...result,
      chosenRightItemId: chosen,
      correct,
      remainingChoices,
      forcedByElimination,
      verified,
    });
  });

  return { pairs: graded, correctCount, forcedCorrectCount, confusions, fullyVerified };
}
