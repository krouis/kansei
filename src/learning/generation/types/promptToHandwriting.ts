import { itemKind, type KanaCharacter, type KanjiCharacter, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool } from '../pool';
import { reject, baseEnvelope, emptyPrompt } from '../support';

const SCRIPT_LABEL = { hiragana: 'hiragana', katakana: 'katakana' } as const;

/**
 * Type 7 — Write the target by hand, from an unambiguous prompt.
 *
 * Handwriting, strong evidence, blank canvas — no model on screen. Refused
 * outright in keyboard-only mode: the selector substitutes a different skill
 * for handwriting there, and this module never fakes a keyboard-only
 * equivalent of writing.
 *
 * Kana are unambiguous from their rōmaji alone, PROVIDED the script is stated —
 * か and カ share a romanisation, so the instruction always names the table.
 * Kanji have no such single spelling: the prompt identifies one by BOTH its
 * meaning and the specific reading it takes in a named word, which is enough
 * context that only one character can be meant.
 *
 * Component targets are not handled here: `GenerationContext.pool` does not
 * currently carry the component table, so component handwriting practice is a
 * known, disclosed gap rather than a silent one (see generation/README.md).
 */
export function generatePromptToHandwriting(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  if (ctx.settings.keyboardOnlyMode) {
    return reject('Handwriting is not generated in keyboard-only mode; the selector substitutes a different skill.');
  }
  const kind = itemKind(target.itemId);
  if (kind !== 'kana' && kind !== 'kanji') return reject(`prompt-to-handwriting does not apply to a ${kind} target.`);

  const index = indexPool(ctx.pool);
  const base = baseEnvelope('prompt-to-handwriting', target, ctx.random);

  if (kind === 'kana') {
    const entry = index.characterById(String(target.itemId)) as KanaCharacter | undefined;
    if (!entry) return reject('Target kana not found in the generation pool.');
    if (!ctx.hasStrokes(entry.glyph)) return reject('No verified stroke reference for this character.');

    const question: Question = {
      ...base,
      prompt: {
        ...emptyPrompt(`Write this in ${SCRIPT_LABEL[entry.script]}:`),
        text: entry.romaji,
        textIsJapanese: false,
      },
      options: null,
      pairs: null,
      acceptedAnswers: [entry.glyph],
      canonicalAnswer: entry.glyph,
      alsoAcceptableNote: null,
      distinction: entry.note,
      requiredStrokeData: [entry.glyph],
    };
    return { question, rejected: null };
  }

  const entry = index.characterById(String(target.itemId)) as KanjiCharacter | undefined;
  if (!entry) return reject('Target kanji not found in the generation pool.');
  if (!ctx.hasStrokes(entry.glyph)) return reject('No verified stroke reference for this character.');

  const readingId = target.readingId ?? entry.readings[0] ?? null;
  if (!readingId) return reject('This kanji has no taught reading to identify it by.');
  const readingKana = index.readingKana(readingId);
  const word = index.wordsDemonstrating(readingId)[0];
  if (!readingKana || !word) return reject('No taught word demonstrates a reading of this kanji unambiguously.');
  const meaning = entry.meanings[0];
  if (!meaning) return reject('This kanji has no recorded meaning to identify it by.');

  const question: Question = {
    ...base,
    prompt: {
      ...emptyPrompt(`Write the kanji meaning "${meaning}", read ${readingKana} in ${word.spelling}.`),
      text: null,
      context: `${word.spelling} — ${word.meaning}`,
    },
    options: null,
    pairs: null,
    acceptedAnswers: [entry.glyph],
    canonicalAnswer: entry.glyph,
    alsoAcceptableNote: null,
    distinction: null,
    requiredStrokeData: [entry.glyph],
  };
  return { question, rejected: null };
}
