/**
 * Tuning constants for session composition.
 *
 * Every number here is a PRODUCT DEFAULT chosen for balance and stated as such
 * in About & Science. None of them is a research finding, and none is a
 * measurement. They live in one object so that they can be shown to the learner,
 * overridden in tests, and changed without hunting through the algorithm.
 *
 * The one place research genuinely constrains a value is
 * `maxConfusablesWhileLearning`; the reasoning and the citation are in
 * `interleaving.ts`.
 */
export interface SelectionTuning {
  /**
   * Due items at or above this count count as a LARGE backlog: new material is
   * suspended entirely for the series. Ten screens against a 200-item backlog
   * is already a losing race; adding new debt makes it worse.
   */
  largeBacklog: number;
  /**
   * Due items at or above this count count as a MODERATE backlog: new material
   * is reduced but not stopped, so a learner who is a little behind does not
   * also stop progressing.
   */
  moderateBacklog: number;
  /** How many due states to pull before ordering them. Bounds the work, not the backlog. */
  dueFetchLimit: number;
  /** How many unresolved confusions to consider. */
  confusionFetchLimit: number;
  /** Smallest coherent group of new items to introduce at once. */
  newGroupMin: number;
  /** Largest number of DISTINCT new items in one series. */
  newGroupMax: number;
  /**
   * How many skills one brand-new item may be practised on within a series.
   * Meeting a character through recognition, then its reading, then writing it
   * is introduction rather than repetition, so new material is allowed more
   * than review material is.
   */
  maxSkillsPerNewItem: number;
  /**
   * Hard ceiling on targets per item once every relaxation has been applied.
   * Reached only when the available material genuinely cannot fill a series.
   */
  maxTargetsPerItemCeiling: number;
  /**
   * Most items from one mutually-confusable cluster allowed in a series while
   * the learner is still `unseen`/`learning` on them. 2 means a discrimination
   * PAIR is fine and a pile-up is not.
   */
  maxConfusablesWhileLearning: number;
  /** Same, once the pair is `consolidating` or `retained` — telling them apart is then the point. */
  maxConfusablesWhenConsolidated: number;
  /** Minimum number of intervening questions between an error and its revisit. */
  minInterveningBeforeRevisit: number;
}

export const DEFAULT_SELECTION_TUNING: SelectionTuning = Object.freeze({
  largeBacklog: 50,
  moderateBacklog: 20,
  dueFetchLimit: 500,
  confusionFetchLimit: 12,
  newGroupMin: 3,
  newGroupMax: 5,
  maxSkillsPerNewItem: 3,
  maxTargetsPerItemCeiling: 3,
  maxConfusablesWhileLearning: 2,
  maxConfusablesWhenConsolidated: 4,
  minInterveningBeforeRevisit: 3,
});
