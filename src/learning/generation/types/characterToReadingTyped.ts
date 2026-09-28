import { itemKind, type KanaCharacter, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool } from '../pool';
import { baseEnvelope, emptyPrompt, reject } from '../support';

/**
 * Type 4 — Character → type its reading, no options shown.
 *
 * Reading recall, kana only. Kanji are refused outright here: a bare kanji has
 * several readings, so "type the reading" has no single answer for one — kanji
 * reading recall is asked in a word instead (types 9 and 10). The rōmaji
 * scaffold is withheld unconditionally, because the scaffold IS the answer.
 */
export function generateCharacterToReadingTyped(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  if (itemKind(target.itemId) !== 'kana') {
    return reject('character-to-reading-typed only applies to kana; a bare kanji has no single reading.');
  }
  const index = indexPool(ctx.pool);
  const entry = index.characterById(String(target.itemId)) as KanaCharacter | undefined;
  if (!entry) return reject('Target kana not found in the generation pool.');
  if (entry.inputVariants.length === 0) return reject('This character has no settled rōmaji value recorded.');

  const base = baseEnvelope('character-to-reading-typed', target, ctx.random);
  const question: Question = {
    ...base,
    prompt: { ...emptyPrompt('Type how this is read, in rōmaji.'), text: entry.glyph, textIsJapanese: true },
    options: null,
    pairs: null,
    acceptedAnswers: entry.inputVariants,
    canonicalAnswer: entry.romaji,
    alsoAcceptableNote:
      entry.inputVariants.length > 1 ? `Also accepted: ${entry.inputVariants.filter((v) => v !== entry.romaji).join(', ')}` : null,
    distinction: entry.note,
  };
  return { question, rejected: null };
}
