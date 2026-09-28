import type { ItemId, Skill } from '@/domain';
import { DEFAULT_SELECTION_TUNING } from './tuning';

/**
 * The delayed-revisit rule.
 *
 * After a wrong answer the item comes back — but NOT on the next screen. An
 * immediate repeat is answered from the feedback the learner has just read
 * rather than from memory, so it produces a correct answer that means nothing
 * and, worse, teaches the scheduler that the item is fine.
 *
 * So a revisit is placed after at least `minIntervening` other questions, later
 * in the same series if there is room, and otherwise carried into the next
 * series. This is a pure function: the session engine calls it, decides nothing
 * itself, and can be tested without a session.
 */

export interface RevisitRequest {
  itemId: ItemId;
  skill: Skill;
  /** For a kanji reading, the specific reading that was missed. */
  readingId?: string | null;
  /** 0-based index of the screen the error happened on. */
  erroredAtScreenIndex: number;
  /** Screens in a series. 10 for a standard series. */
  seriesLength: number;
  /** Screen indexes in this series that already hold a queued revisit. */
  occupiedScreenIndexes?: readonly number[];
  /** Override the minimum gap. Defaults to the product default. */
  minIntervening?: number;
}

export interface RevisitPlan {
  itemId: ItemId;
  skill: Skill;
  readingId: string | null;
  /**
   * Screen index the revisit will occupy in THIS series, or null when it has to
   * wait for the next one.
   */
  screenIndex: number | null;
  /**
   * The screen the revisit is shown after. Matches
   * `SeriesState.revisitQueue[].afterScreenIndex`; for a deferred revisit it is
   * the last screen of the current series.
   */
  afterScreenIndex: number;
  /** True when this series has no room left for a properly spaced revisit. */
  deferToNextSeries: boolean;
  /** Questions that will sit between the error and the revisit. Never below `minIntervening`. */
  intervening: number;
  /** Machine-readable reason, stored on the queue entry. */
  reason: 'delayed-revisit-after-error';
  /** Plain-language explanation, safe to show in a debug or About view. */
  explanation: string;
}

/**
 * Place a revisit for an item the learner just got wrong.
 *
 * Never returns a placement adjacent to the error: the earliest acceptable
 * screen is `erroredAt + minIntervening + 1`, which leaves exactly
 * `minIntervening` questions in between. If a revisit is already queued for
 * that screen the placement slides forward, and if sliding runs off the end of
 * the series the revisit is deferred rather than squeezed in.
 */
export function planRevisit(request: RevisitRequest): RevisitPlan {
  const minIntervening = Math.max(
    request.minIntervening ?? DEFAULT_SELECTION_TUNING.minInterveningBeforeRevisit,
    1,
  );
  const occupied = new Set(request.occupiedScreenIndexes ?? []);
  const lastIndex = request.seriesLength - 1;

  let screenIndex = request.erroredAtScreenIndex + minIntervening + 1;
  while (screenIndex <= lastIndex && occupied.has(screenIndex)) screenIndex += 1;

  const base = {
    itemId: request.itemId,
    skill: request.skill,
    readingId: request.readingId ?? null,
    reason: 'delayed-revisit-after-error' as const,
  };

  if (screenIndex > lastIndex) {
    return {
      ...base,
      screenIndex: null,
      afterScreenIndex: lastIndex,
      deferToNextSeries: true,
      // The series boundary is itself more than `minIntervening` questions away
      // from the error, so the spacing requirement is satisfied by deferring.
      intervening: Math.max(lastIndex - request.erroredAtScreenIndex, minIntervening),
      explanation:
        'This series has no room left to bring the item back with questions in between, so it returns early in the next series.',
    };
  }

  return {
    ...base,
    screenIndex,
    afterScreenIndex: screenIndex - 1,
    deferToNextSeries: false,
    intervening: screenIndex - request.erroredAtScreenIndex - 1,
    explanation: `The item returns on screen ${screenIndex + 1}, after ${String(screenIndex - request.erroredAtScreenIndex - 1)} other questions, so the answer has to come from memory rather than from the feedback just shown.`,
  };
}
