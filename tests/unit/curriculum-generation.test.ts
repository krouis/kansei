import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { asItemId, QUESTION_TYPES, type KanjiCharacter, type KanjiComponent, type KanjiReading, type VocabEntry } from '@/domain';
import { defaultSettings } from '@/persistence/settingsStore';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { CompositeGenerator } from '@/learning/generation/composite';
import { mulberry32 } from '@/learning/generation/rng';
import { validateQuestion } from '@/learning/generation/validate';
import { generatePromptToHandwriting } from '@/learning/generation/types/promptToHandwriting';
import { generateKanjiInWordContext } from '@/learning/generation/types/kanjiInWordContext';
import { generateComponentInKanjiChoice } from '@/learning/generation/types/visualKanjiChoice';

const dataset = JSON.parse(readFileSync('public/content/data/kanji.json', 'utf8')) as {
  kanji: KanjiCharacter[]; components: KanjiComponent[]; readings: KanjiReading[];
};
const { vocab } = JSON.parse(readFileSync('public/content/data/vocab.json', 'utf8')) as { vocab: VocabEntry[] };
function context(): GenerationContext {
  return {
    now: new Date('2026-09-30T12:00:00Z'),
    settings: { ...defaultSettings(), enabledQuestionTypes: [...QUESTION_TYPES] },
    pool: { characters: dataset.kanji, components: dataset.components, readings: dataset.readings, vocab },
    hasAudio: () => false, hasStrokes: () => true, random: mulberry32(34),
  };
}
function target(id: string, skill: SelectedTarget['skill'], readingId: string | null = null): SelectedTarget {
  return { itemId: asItemId(id), skill, readingId, reason: 'new-material', state: null, confusion: null };
}

describe('installed kanji and vocabulary exercise generation', () => {
  it('can produce an honest recognition screen for all 1,500 kanji, even without aligned readings', async () => {
    const generator = new CompositeGenerator();
    for (const entry of dataset.kanji) {
      const result = await generator.generate(target(String(entry.id), 'recognition'), context());
      expect(result.question, `${entry.glyph}: ${result.rejected}`).not.toBeNull();
      expect(validateQuestion(result.question!).ok).toBe(true);
      expect(result.question!.skill).toBe('recognition');
    }
  });
  it('generates word reading for every installed vocabulary entry', async () => {
    const generator = new CompositeGenerator();
    for (const word of vocab) {
      const { question } = await generator.generate(target(String(word.id), 'readingRecall'), context());
      expect(question, word.spelling).not.toBeNull();
      expect(question!.prompt.scaffold).toBeNull();
      expect(question!.inputScript).toBe(/[\u3400-\u9fff]/.test(word.spelling) ? 'kana' : 'romaji');
    }
  });
  it('uses source membership for component choices, with no invented reading or handwriting credit', () => {
    let generated = 0;
    for (const component of dataset.components) {
      const { question } = generateComponentInKanjiChoice(target(String(component.id), 'recognition'), context());
      if (!question) continue;
      generated++;
      expect(question.evidence).toBe('weak');
      expect(question.direction).toBe('glyph-to-glyph');
      const correct = dataset.kanji.find((k) => k.glyph === question.canonicalAnswer)!;
      expect(correct.components).toContain(component.id);
      for (const option of question.options!.filter((o) => !o.correct)) {
        expect(dataset.kanji.find((k) => k.glyph === option.display)!.components).not.toContain(component.id);
      }
    }
    expect(generated).toBeGreaterThan(100);
  });
  it('hides the kanji being recalled and records the resolved reading on handwriting questions', () => {
    const entry = dataset.kanji.find((k) => k.glyph === '日')!;
    const { question } = generatePromptToHandwriting(target(String(entry.id), 'handwriting'), context());
    expect(question).not.toBeNull();
    expect(JSON.stringify(question!.prompt)).not.toContain('日');
    expect(question!.prompt.context).toContain('□');
    expect(question!.targetReadingId).toBe(entry.readings[0]);
    expect(question!.acceptedAnswers).toEqual(['日']);
  });
  it('refuses a reading that belongs to a different kanji', () => {
    const entry = dataset.kanji[0]!;
    const wrong = dataset.readings.find((r) => r.kanji !== entry.glyph)!;
    expect(generateKanjiInWordContext(target(String(entry.id), 'readingRecall', String(wrong.id)), context()).question).toBeNull();
  });
  it('refuses conflicting alignments for the same kanji in one word', () => {
    const ctx = context();
    const entry = dataset.kanji[0]!;
    const reading = entry.readings[0]!;
    const word = vocab.find((w) => w.demonstratesReadings.includes(reading))!;
    ctx.pool = { ...ctx.pool, vocab: [{ ...word, demonstratesReadings: [reading, entry.readings[1]!] }] };
    expect(generateKanjiInWordContext(target(String(entry.id), 'readingRecall', String(reading)), ctx).question).toBeNull();
  });
  it('respects stored enabled formats instead of silently overriding preferences', async () => {
    const ctx = context();
    ctx.settings.enabledQuestionTypes = ['word-reading'];
    expect((await new CompositeGenerator().generate(target(String(dataset.kanji[0]!.id), 'recognition'), ctx)).question).toBeNull();
  });
});
