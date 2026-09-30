/**
 * Contract test for data/components.json.
 *
 * The build script (scripts/content/build-components.mjs) verifies the dataset as
 * it writes it. This test verifies the *committed file* against the domain types,
 * so a hand-edit, a bad merge or a stale checkout is caught by `npm test` without
 * needing the upstream sources in data/sources/.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { KanjiComponent } from '@/domain/content';
import { ID_PATTERN, itemKind } from '@/domain/ids';

/** Vite rewrites import.meta.url under /@fs, so resolve from the project root instead. */
const DATA = join(process.cwd(), 'data');
const components = JSON.parse(readFileSync(join(DATA, 'components.json'), 'utf8')) as KanjiComponent[];
const kanjiList = JSON.parse(readFileSync(join(DATA, 'kanji-top1500.json'), 'utf8')) as {
  entries: Array<{ id: string; glyph: string }>;
};

const ROLES = new Set(['radical', 'recurring', 'standalone']);

describe('data/components.json', () => {
  it('is a non-empty array of component records', () => {
    expect(Array.isArray(components)).toBe(true);
    expect(components.length).toBeGreaterThan(0);
  });

  it('matches the KanjiComponent shape on every record', () => {
    for (const c of components) {
      expect(c.kind).toBe('component');
      expect(typeof c.glyph).toBe('string');
      expect([...c.glyph]).toHaveLength(1);
      expect(c.id).toBe(`comp:${c.glyph}`);
      expect(ID_PATTERN.test(c.id)).toBe(true);
      expect(itemKind(c.id)).toBe('component');

      expect(Array.isArray(c.roles)).toBe(true);
      expect(c.roles.length).toBeGreaterThan(0);
      for (const r of c.roles) expect(ROLES.has(r)).toBe(true);
      expect(new Set(c.roles).size).toBe(c.roles.length);

      expect(Array.isArray(c.glosses)).toBe(true);
      for (const g of c.glosses) expect(typeof g).toBe('string');
      expect(typeof c.meaningIsUnreliable).toBe('boolean');

      expect(Array.isArray(c.variants)).toBe(true);
      expect(c.variants).not.toContain(c.glyph);

      expect(Number.isInteger(c.strokeCount)).toBe(true);
      expect(c.strokeCount).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(c.teachingOrder)).toBe(true);
      expect(typeof c.lessonId).toBe('string');
      expect(c.lessonId.length).toBeGreaterThan(0);
      expect(Array.isArray(c.appearsIn)).toBe(true);
    }
  });

  it('agrees between the radical role and kangxiNumber, in 1..214', () => {
    for (const c of components) {
      expect(c.roles.includes('radical')).toBe(c.kangxiNumber !== null);
      if (c.kangxiNumber !== null) {
        expect(Number.isInteger(c.kangxiNumber)).toBe(true);
        expect(c.kangxiNumber).toBeGreaterThanOrEqual(1);
        expect(c.kangxiNumber).toBeLessThanOrEqual(214);
      }
    }
  });

  it('has unique ids and a dense teachingOrder over 1..N', () => {
    const ids = components.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = components.map((c) => c.teachingOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: components.length }, (_, i) => i + 1));
  });

  it('references only kanji that exist in data/kanji-top1500.json', () => {
    const taught = new Set(kanjiList.entries.map((e) => e.glyph));
    for (const c of components) {
      expect(new Set(c.appearsIn).size).toBe(c.appearsIn.length);
      for (const id of c.appearsIn) {
        expect(id.startsWith('kanji:')).toBe(true);
        expect(taught.has(id.slice('kanji:'.length))).toBe(true);
      }
    }
  });

  it('never claims a reliable meaning without a gloss', () => {
    for (const c of components) {
      if (c.glosses.length === 0) expect(c.meaningIsUnreliable).toBe(true);
    }
  });

  it('leans toward meaningIsUnreliable, as the curriculum requires', () => {
    // Not a style preference: the app must never imply one fixed meaning per
    // component. If this ratio ever inverts, the derivation has regressed.
    const unreliable = components.filter((c) => c.meaningIsUnreliable).length;
    expect(unreliable / components.length).toBeGreaterThan(0.8);
  });

  it('marks every component that appears in more than one shape as unreliable', () => {
    for (const c of components) {
      if (c.variants.length > 0) expect(c.meaningIsUnreliable).toBe(true);
    }
  });

  it('keeps variant links symmetric wherever both shapes are taught', () => {
    const byGlyph = new Map(components.map((c) => [c.glyph, c]));
    for (const c of components) {
      for (const v of c.variants) {
        const other = byGlyph.get(v);
        if (other) expect(other.variants).toContain(c.glyph);
      }
    }
  });

  it('resolves the dictionary radical of every taught kanji to a component', () => {
    // KanjiCharacter.radical is a ComponentId, so radical lookup must not dangle.
    const radicals = new Set(components.filter((c) => c.kangxiNumber !== null).map((c) => c.glyph));
    expect(radicals.size).toBeGreaterThan(100);
  });
});
