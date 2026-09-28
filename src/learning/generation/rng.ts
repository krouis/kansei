/**
 * Randomness helpers for generation.
 *
 * Every random decision goes through the `random` function injected on the
 * GenerationContext. `Math.random` is deliberately never called in this module:
 * a session must be replayable byte-for-byte from a seeded generator, otherwise
 * "the correct answer is uniformly distributed" is untestable and a learner's
 * bug report is unreproducible.
 */

export type Rng = () => number;

/**
 * Fisher–Yates, drawing exactly one number per swap.
 *
 * A naive `sort(() => random() - 0.5)` was rejected: comparison-sort shuffles are
 * not uniform over permutations, and the option-position uniformity test would
 * fail for reasons that have nothing to do with the generators.
 */
export function shuffle<T>(items: readonly T[], random: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function pickOne<T>(items: readonly T[], random: Rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

/** Take up to `n` distinct members, in random order. Fewer than `n` is a legal result. */
export function sample<T>(items: readonly T[], n: number, random: Rng): T[] {
  if (n <= 0) return [];
  return shuffle(items, random).slice(0, n);
}

/**
 * A small deterministic generator, exported so tests (and a future "replay this
 * session" diagnostic) can produce the same questions twice. mulberry32 is used
 * because it is four lines long and has no dependency; it is not cryptographic
 * and is never used for anything that needs to be.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
