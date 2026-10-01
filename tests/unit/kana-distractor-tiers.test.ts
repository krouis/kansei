import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { asItemId, type KanaCharacter, type QuestionType } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import type { SkillState } from '@/domain';
import { generateRomajiToKanaChoice } from '@/learning/generation/types/romajiToKanaChoice';
import { generateAudioToCharacterChoice } from '@/learning/generation/types/audioToCharacterChoice';
import { mulberry32 } from '@/learning/generation/rng';
import { defaultSettings } from '@/persistence/settingsStore';

/**
 * A learner's selected answer is only wrong if the correct answer is the only
 * glyph the question could honestly have meant. Found live: ぉ (small-o,
 * extended tier, "hiragana almost never uses it") offered as a confusable
 * distractor for お to a learner on the default (extended/historical off)
 * settings — visually near-identical to the real answer, and never taught.
 * This campaign exercises every kana, at every ladder rung the distractor
 * logic branches on, under the settings most learners actually have.
 */
const { kana } = JSON.parse(readFileSync('public/content/data/kana.json', 'utf8')) as { kana: KanaCharacter[] };

function context(seed: number): GenerationContext {
  return {
    now: new Date('2026-09-30T12:00:00Z'),
    settings: { ...defaultSettings(), enabledQuestionTypes: ['romaji-to-kana-choice', 'audio-to-character-choice'] as QuestionType[] },
    pool: { characters: kana, components: [], readings: [], vocab: [] },
    hasAudio: () => true,
    audio: (key) => ({
      path: `/fake/${key}.ogg`, sha256: '0'.repeat(64), bytes: 1, durationMs: null,
      attribution: { source: 'test', url: 'about:blank', author: 'test', license: 'CC0-1.0', licenseUrl: null, nativeSpeakerDocumented: false },
    }),
    hasStrokes: () => true, random: mulberry32(seed),
  };
}

/** A well-practised state, well past the rung where distractors become related (rung 2). */
function knownState(): SkillState {
  return {
    itemId: asItemId('kana:hi:a'), skill: 'recognition', readingId: null, stage: 'retained',
    stability: 30, difficulty: 3, streak: 6, spacedSuccesses: 5, totalAttempts: 8,
    unaidedFirstAttemptCorrect: 7, aidedAttempts: 0, lapses: 0,
    firstSeenAt: '2026-01-01T00:00:00Z', lastReviewedAt: '2026-09-01T00:00:00Z',
    lastUnaidedSuccessAt: '2026-09-01T00:00:00Z', dueAt: null, lastIntervalDays: 30,
    medianMsByInput: {}, scaffoldLevel: 0, strongestEvidencePassed: 'strong',
  };
}

function target(id: string, state: SkillState | null): SelectedTarget {
  return { itemId: asItemId(id), skill: 'recognition', readingId: null, reason: state ? 'due-review' : 'new-material', state, confusion: null };
}

function tierOf(itemId: string | null): string | undefined {
  if (!itemId) return undefined;
  return kana.find((k) => String(k.id) === itemId)?.tier;
}

describe('kana distractor tiers respect includeExtended/includeHistorical', () => {
  // Settings most learners actually have: both opt-ins off (defaultSettings()).
  for (const state of [null, knownState()]) {
    const label = state ? 'at a well-practised rung (related distractors allowed)' : 'as brand-new material (unrelated distractors only)';
    it(`never offers an extended or historical distractor for romaji-to-kana-choice, ${label}`, () => {
      let generated = 0;
      for (const entry of kana) {
        if (entry.tier !== 'modern-core') continue; // the target itself must be on the beginner path
        for (let seed = 1; seed <= 3; seed++) {
          const { question } = generateRomajiToKanaChoice(target(String(entry.id), state), context(seed * 97 + entry.teachingOrder));
          if (!question) continue;
          generated++;
          for (const option of question.options ?? []) {
            const tier = tierOf(option.itemId);
            expect(tier, `${entry.glyph} offered ${option.display} (${option.itemId}, tier ${tier}) as an option`).not.toBe('extended');
            expect(tier, `${entry.glyph} offered ${option.display} (${option.itemId}, tier ${tier}) as an option`).not.toBe('historical');
          }
        }
      }
      expect(generated).toBeGreaterThan(100);
    });

    it(`never offers an extended or historical distractor for audio-to-character-choice, ${label}`, () => {
      let generated = 0;
      for (const entry of kana) {
        if (entry.tier !== 'modern-core') continue;
        for (let seed = 1; seed <= 3; seed++) {
          const { question } = generateAudioToCharacterChoice(target(String(entry.id), state), context(seed * 131 + entry.teachingOrder));
          if (!question) continue;
          generated++;
          for (const option of question.options ?? []) {
            const tier = tierOf(option.itemId);
            expect(tier, `${entry.glyph} offered ${option.display} (${option.itemId}, tier ${tier}) as an option`).not.toBe('extended');
            expect(tier, `${entry.glyph} offered ${option.display} (${option.itemId}, tier ${tier}) as an option`).not.toBe('historical');
          }
        }
      }
      expect(generated).toBeGreaterThan(100);
    });
  }

  it('reproduces the exact live report: お does not offer ぉ as a distractor on default settings', () => {
    let sawSmallO = false;
    for (let seed = 1; seed <= 50; seed++) {
      const { question } = generateRomajiToKanaChoice(target('kana:hi:o', knownState()), context(seed));
      if (question?.options?.some((o) => o.itemId === 'kana:hi:small-o')) sawSmallO = true;
    }
    expect(sawSmallO).toBe(false);
  });

  it('still allows ぉ as a distractor once the learner opts into extended forms', () => {
    let sawSmallO = false;
    for (let seed = 1; seed <= 50; seed++) {
      const ctx = context(seed);
      ctx.settings = { ...ctx.settings, includeExtended: true };
      const { question } = generateRomajiToKanaChoice(target('kana:hi:o', knownState()), ctx);
      if (question?.options?.some((o) => o.itemId === 'kana:hi:small-o')) sawSmallO = true;
    }
    // Proves the gate is actually conditional on the setting, not a hardcoded
    // exclusion that would silently stop meaning anything if settings changed.
    expect(sawSmallO).toBe(true);
  });
});
