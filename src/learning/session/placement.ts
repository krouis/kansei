import { asItemId } from '@/domain';
import type { KanaCharacter } from '@/domain';
import type { SelectedTarget } from '@/learning/ports';

/**
 * The optional placement check.
 *
 * Scope, stated plainly because it is easy to overclaim here: this samples
 * RECOGNITION only, across hiragana and katakana — the only script this
 * release actually teaches as a course (see README's known limits). It never
 * touches reading recall, listening, or handwriting, and it must not be read
 * as having assessed any of those. The onboarding copy that wraps this
 * (Onboarding.tsx) repeats that limit explicitly, because a placement result
 * is exactly the kind of thing a learner could otherwise reasonably
 * over-interpret as "the app checked what I know."
 *
 * Sampling is a plain stride across teaching order rather than anything
 * adaptive (no item-response-theory, no branching): a fixed ten-item spread
 * from "first taught" to "last taught" gives a rough read on how far a
 * returning learner's kana recognition already reaches, using the exact same
 * question format, grader and scheduler update path as ordinary practice —
 * nothing here is bespoke or simulated.
 */

const PLACEMENT_SCREEN_COUNT = 10;

export function samplePlacementCharacters(
  kana: readonly KanaCharacter[],
  count = PLACEMENT_SCREEN_COUNT,
): KanaCharacter[] {
  // Modern-core only: extended/historical forms have no place in a beginner
  // placement check, and the basic set alone is larger than `count` anyway.
  const pool = kana
    .filter((k) => k.tier === 'modern-core')
    .slice()
    .sort((a, b) => a.teachingOrder - b.teachingOrder);
  if (pool.length === 0) return [];
  if (pool.length <= count) return pool;

  // An even stride from the first taught character to the last, so a
  // ten-item check actually spans the whole curriculum rather than
  // clustering near the start of teaching order.
  const stride = (pool.length - 1) / (count - 1);
  const chosen: KanaCharacter[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round(i * stride);
    const item = pool[Math.min(index, pool.length - 1)]!;
    if (seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    chosen.push(item);
  }
  return chosen;
}

export function placementTargetsFor(kana: readonly KanaCharacter[]): SelectedTarget[] {
  return samplePlacementCharacters(kana).map((k) => ({
    itemId: asItemId(String(k.id)),
    readingId: null,
    skill: 'recognition',
    reason: 'new-material',
    state: null,
    confusion: null,
  }));
}
