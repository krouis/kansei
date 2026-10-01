import { itemKind, type KanaCharacter, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { pickCharacterDistractors } from '../distractors';
import { indexPool } from '../pool';
import { ladderFor } from '../ladder';
import { randomOrder, baseEnvelope, buildChoiceOptions, emptyPrompt, reject } from '../support';

const SCRIPT_LABEL = { hiragana: 'hiragana', katakana: 'katakana' } as const;

/**
 * Type 2 — Rōmaji → select the correct kana among four options.
 *
 * Recognition, kana only. The script is always named in the instruction: two
 * kana can share a romanisation only across scripts (か vs カ never collide, but
 * a learner studying both at once benefits from being told which table this
 * question is drawn from), and distractors are drawn from the SAME script so a
 * learner cannot pass by noticing "this is the only katakana option".
 */
export function generateRomajiToKanaChoice(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  if (itemKind(target.itemId) !== 'kana') return reject('romaji-to-kana-choice only applies to kana.');

  const index = indexPool(ctx.pool);
  const entry = index.characterById(String(target.itemId)) as KanaCharacter | undefined;
  if (!entry) return reject('Target kana not found in the generation pool.');

  const ladder = ladderFor(target.state, ctx.settings);
  const distractors = pickCharacterDistractors({
    target: entry,
    candidates: index.kana(entry.script),
    count: 3,
    related: ladder.relatedDistractors,
    forbid: () => false,
    random: ctx.random,
    settings: ctx.settings,
  });
  if (!distractors) return reject('Could not assemble three distractors from the same script.');

  const options = buildChoiceOptions(entry.glyph, entry.id, distractors, randomOrder(4, ctx.random));
  const base = baseEnvelope('romaji-to-kana-choice', target, ctx.random);

  const question: Question = {
    ...base,
    prompt: {
      ...emptyPrompt(`Choose the ${SCRIPT_LABEL[entry.script]} for:`),
      text: entry.romaji,
      textIsJapanese: false,
    },
    options,
    pairs: null,
    acceptedAnswers: [entry.glyph],
    canonicalAnswer: entry.glyph,
    alsoAcceptableNote: null,
    distinction: entry.note,
  };
  return { question, rejected: null };
}
