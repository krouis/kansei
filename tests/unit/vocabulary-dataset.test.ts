import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VocabEntry, KanjiReading } from '../../src/domain/content';
const vocab = JSON.parse(readFileSync('data/vocab.json', 'utf8')) as VocabEntry[];
const readings = JSON.parse(readFileSync('data/readings.json', 'utf8')) as KanjiReading[];
const word = (spelling: string) => vocab.find(v => v.spelling === spelling)!;

describe('reproducible vocabulary curriculum regressions', () => {
  it('retains common irregular whole-word readings without invented segmentation', () => {
    const cases: Array<[string, string]> = [['今日', 'きょう'], ['明日', 'あした'], ['昨日', 'きのう']];
    for (const [spelling, reading] of cases) {
      expect(word(spelling).reading).toBe(reading);
      expect(word(spelling).demonstratesReadings).toEqual([]);
    }
  });
  it('keeps source-backed starter meanings separate from homophones and restricted senses', () => {
    const cases: Array<[string, string]> = [['いく', 'to go'], ['うたう', 'to sing'], ['たべる', 'to eat']];
    for (const [spelling, meaning] of cases) {
      expect(word(spelling).meaning).toBe(meaning);
      expect(word(spelling).source).toContain('pedagogical kana spelling');
    }
    expect(word('いぬ').meaning).toContain('dog');
    expect(word('ねこ').meaning).toContain('cat');
    expect(word('ケーキ').meaning).toBe('cake');
  });
  it('displays greeting pronunciation without rewriting its kana spelling', () => {
    expect(word('こんにちは').reading).toBe('こんにちは');
    expect(word('こんにちは').romaji).toBe('konnichiwa');
  });
  it('isolates reading evidence by word and preserves reciprocal links', () => {
    expect(new Set(readings.map(r => r.id)).size).toBe(readings.length);
    for (const reading of readings) {
      expect(reading.exampleVocab).toHaveLength(1);
      const example = vocab.find(v => v.id === reading.exampleVocab[0])!;
      expect(reading.id).toBe(`reading:${reading.kanji}:${reading.reading}:${example.spelling}`);
      expect(example.demonstratesReadings).toContain(reading.id);
    }
    for (const v of vocab) for (const id of v.demonstratesReadings) {
      expect(readings.find(r => r.id === id)?.exampleVocab).toEqual([v.id]);
    }
  });
});
