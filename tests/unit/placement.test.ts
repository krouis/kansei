import { describe, expect, it } from 'vitest';
import type { KanaCharacter } from '@/domain';
import { samplePlacementCharacters, placementTargetsFor } from '@/learning/session/placement';

function fixtureKana(n: number, overrides: Partial<KanaCharacter> = {}): KanaCharacter[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `kana:hi:${i}`, kind: 'kana', script: 'hiragana', glyph: String(i), romaji: String(i),
    inputVariants: [String(i)], group: 'basic', tier: 'modern-core', position: null,
    derivesFrom: [], confusableWith: [], strokeCount: 1, printVsHandwritten: null, note: null,
    teachingOrder: i + 1, lessonId: 'l1', ...overrides,
  }) as unknown as KanaCharacter);
}

describe('placement sampling', () => {
  it('spans the full range of teaching order rather than clustering near the start', () => {
    const kana = fixtureKana(100);
    const chosen = samplePlacementCharacters(kana, 10);
    expect(chosen).toHaveLength(10);
    const orders = chosen.map((c) => c.teachingOrder);
    expect(Math.min(...orders)).toBe(1);
    expect(Math.max(...orders)).toBe(100);
    // Strictly increasing: no duplicate, no reordering.
    for (let i = 1; i < orders.length; i += 1) expect(orders[i]!).toBeGreaterThan(orders[i - 1]!);
  });

  it('returns the whole pool, unpadded, when it has fewer characters than requested', () => {
    const kana = fixtureKana(4);
    expect(samplePlacementCharacters(kana, 10)).toHaveLength(4);
  });

  it('returns nothing rather than throwing when no kana is installed', () => {
    expect(samplePlacementCharacters([], 10)).toEqual([]);
  });

  it('excludes extended and historical tiers from the beginner placement check', () => {
    const kana = [
      ...fixtureKana(5),
      ...fixtureKana(5, { tier: 'extended' }).map((k, i) => ({ ...k, id: `kana:ka:ext${i}`, teachingOrder: 100 + i }) as unknown as KanaCharacter),
      ...fixtureKana(2, { tier: 'historical' }).map((k, i) => ({ ...k, id: `kana:hi:hist${i}`, teachingOrder: 200 + i }) as unknown as KanaCharacter),
    ];
    const chosen = samplePlacementCharacters(kana, 10);
    expect(chosen.every((c) => c.tier === 'modern-core')).toBe(true);
    expect(chosen).toHaveLength(5); // Only the modern-core five exist.
  });

  it('produces recognition-only targets, never a reading, listening or handwriting placement', () => {
    const kana = fixtureKana(30);
    const targets = placementTargetsFor(kana);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.skill === 'recognition')).toBe(true);
    expect(targets.every((t) => t.readingId === null && t.state === null && t.confusion === null)).toBe(true);
  });
});
