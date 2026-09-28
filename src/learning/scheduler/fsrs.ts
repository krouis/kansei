/**
 * FSRS-5, implemented from the published algorithm description.
 *
 * This file is deliberately free of every Kansei concept: no skills, no
 * evidence strength, no handwriting. It is the memory model and nothing else,
 * so it can be checked against the reference implementation term by term.
 * Everything Kansei-specific (how an attempt becomes a rating, how weak
 * evidence is capped, what a learning stage means) lives in the sibling files.
 *
 * Sources — see ./README.md for the full provenance note:
 *   - algorithm description: open-spaced-repetition/awesome-fsrs wiki, "The Algorithm"
 *   - reference code read term by term: open-spaced-repetition/py-fsrs
 *
 * FSRS-5 rather than FSRS-6 because FSRS-5 fixes the forgetting-curve decay at
 * -0.5 instead of learning it as a 21st parameter. Kansei does no per-learner
 * parameter fitting, so a learned decay we cannot fit is a parameter we would
 * only ever leave at its default — and the shorter, fixed-decay formulation is
 * easier to audit against the published equations.
 */

/** The four FSRS ratings, in increasing order of reported ease. */
export type FsrsRating = 'again' | 'hard' | 'good' | 'easy';

/** FSRS formulas use the rating as the number G ∈ {1,2,3,4}, not the name. */
export const FSRS_GRADE: Record<FsrsRating, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/** Rating order, used when one rule has to cap another (see rating.ts). */
export const RATING_ORDER: readonly FsrsRating[] = ['again', 'hard', 'good', 'easy'];

/**
 * A fixed-length tuple, not `number[]`, for two reasons: the compiler rejects a
 * weight vector of the wrong length at the call site, and under
 * `noUncheckedIndexedAccess` a tuple index is `number` rather than
 * `number | undefined`, so the formulas below stay readable.
 */
export type FsrsWeights = readonly [
  number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number,
];

/**
 * FSRS-5 default weights, copied verbatim from the published default vector in
 * the open-spaced-repetition wiki (see README.md).
 *
 * These were fitted on Anki review logs — overwhelmingly textual flashcards.
 * They are NOT known to be appropriate for handwriting or listening practice,
 * and Kansei does not re-fit them per learner. Read that as a stated limitation
 * of the schedule, not a claim about it.
 */
export const FSRS5_DEFAULT_WEIGHTS: FsrsWeights = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

/** FSRS-5 fixes the power-law decay of the forgetting curve at -0.5. */
export const FSRS5_DECAY = -0.5;

/**
 * FACTOR is chosen so that R = 0.9 exactly when elapsed time equals stability;
 * that is what makes "stability is the interval at 90% retention" true.
 */
export const FSRS5_FACTOR = 0.9 ** (1 / FSRS5_DECAY) - 1;

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
/** FSRS-5's stability floor. Stability is in days, so this is ~15 minutes. */
export const MIN_STABILITY = 0.01;

export const clampDifficulty = (d: number): number =>
  Math.min(Math.max(d, MIN_DIFFICULTY), MAX_DIFFICULTY);

export const clampStability = (s: number): number => Math.max(s, MIN_STABILITY);

/** S₀(G) = w[G-1]. The first rating picks the starting stability outright. */
export function initialStability(w: FsrsWeights, rating: FsrsRating): number {
  const g = FSRS_GRADE[rating];
  // Indexing by G-1 over the first four weights; written out so the tuple type
  // keeps the result `number` and the mapping stays obvious.
  const s = g === 1 ? w[0] : g === 2 ? w[1] : g === 3 ? w[2] : w[3];
  return clampStability(s);
}

/**
 * D₀(G) = w₄ - e^(w₅·(G-1)) + 1.
 *
 * `clamp` is false only for the mean-reversion target D₀(4), which the
 * reference implementation deliberately uses unclamped.
 */
export function initialDifficulty(w: FsrsWeights, rating: FsrsRating, clamp = true): number {
  const d = w[4] - Math.exp(w[5] * (FSRS_GRADE[rating] - 1)) + 1;
  return clamp ? clampDifficulty(d) : d;
}

/**
 * D' = D + ΔD·(10-D)/9 with ΔD = -w₆·(G-3), then mean-reverted toward D₀(easy):
 * D'' = w₇·D₀(4) + (1-w₇)·D'.
 *
 * The (10-D)/9 damping is why a hard item gets harder slowly and an easy one
 * easier quickly; it is what stops difficulty pinning itself at 10.
 */
export function nextDifficulty(w: FsrsWeights, difficulty: number, rating: FsrsRating): number {
  const deltaD = -(w[6] * (FSRS_GRADE[rating] - 3));
  const damped = difficulty + ((10 - difficulty) * deltaD) / 9;
  const reverted = w[7] * initialDifficulty(w, 'easy', false) + (1 - w[7]) * damped;
  return clampDifficulty(reverted);
}

/**
 * R(t,S) = (1 + FACTOR·t/S)^DECAY — the modelled probability of recall after
 * `elapsedDays`. A power law, not an exponential: forgetting slows down.
 */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return (1 + (FSRS5_FACTOR * t) / stability) ** FSRS5_DECAY;
}

/**
 * S'ᵣ = S·(1 + e^(w₈)·(11-D)·S^(-w₉)·(e^(w₁₀·(1-R))-1)·hard·easy)
 *
 * Note S^(-w₉): the larger stability already is, the less a single success adds.
 * Note (1-R): reviewing something you had nearly forgotten teaches you more
 * than reviewing something you were certain of.
 */
export function nextRecallStability(
  w: FsrsWeights,
  difficulty: number,
  stability: number,
  r: number,
  rating: FsrsRating,
): number {
  const hardPenalty = rating === 'hard' ? w[15] : 1;
  const easyBonus = rating === 'easy' ? w[16] : 1;
  const increase =
    Math.exp(w[8]) *
    (11 - difficulty) *
    stability ** -w[9] *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus;
  return clampStability(stability * (1 + increase));
}

/**
 * S'f = min( w₁₁·D^(-w₁₂)·((S+1)^w₁₃ - 1)·e^(w₁₄·(1-R)) , S/e^(w₁₇·w₁₈) )
 *
 * The second term is the FSRS-5 guard that a lapse can never leave stability
 * higher than a same-day review would have: post-lapse stability is not allowed
 * to exceed the pre-lapse value scaled down.
 */
export function nextForgetStability(
  w: FsrsWeights,
  difficulty: number,
  stability: number,
  r: number,
): number {
  const longTerm =
    w[11] * difficulty ** -w[12] * ((stability + 1) ** w[13] - 1) * Math.exp(w[14] * (1 - r));
  const shortTermCeiling = stability / Math.exp(w[17] * w[18]);
  return clampStability(Math.min(longTerm, shortTermCeiling));
}

/**
 * S'(S,G) = S·e^(w₁₇·(G-3+w₁₈)) — FSRS-5's same-day review rule.
 *
 * Reviewing again within the same day is not spaced repetition, so the
 * long-term formula (which is driven by elapsed time) does not apply.
 */
export function shortTermStability(
  w: FsrsWeights,
  stability: number,
  rating: FsrsRating,
): number {
  return clampStability(stability * Math.exp(w[17] * (FSRS_GRADE[rating] - 3 + w[18])));
}

/**
 * I = S/FACTOR · (requestedRetention^(1/DECAY) - 1) — invert the forgetting
 * curve to find when recall probability will have fallen to the target.
 *
 * Kept in fractional days on purpose. The reference implementation rounds to
 * whole days because Anki schedules by day; Kansei runs in a browser and can
 * legitimately bring something back in ten minutes.
 */
export function intervalDaysForStability(stability: number, requestedRetention: number): number {
  return (stability / FSRS5_FACTOR) * (requestedRetention ** (1 / FSRS5_DECAY) - 1);
}
