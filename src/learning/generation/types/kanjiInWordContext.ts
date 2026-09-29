import { hiraganaToKatakana, itemKind, type KanjiCharacter, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool } from '../pool';
import { baseEnvelope, emptyPrompt, reject } from '../support';

/**
 * Type 10 — The reading one specific kanji takes inside one specific word.
 *
 * Reading recall, strong evidence. Never asked bare: `target.readingId` (or the
 * kanji's first taught reading, when a specific one was not requested) must
 * resolve to a reading that at least one taught word actually demonstrates —
 * that word supplies the context, and its id is what makes 日 in 日本 a
 * different tracked fact from 日 in 今日. Both kana scripts are accepted, since
 * dictionaries conventionally write on-readings in katakana.
 */
export function generateKanjiInWordContext(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  if (itemKind(target.itemId) !== 'kanji') return reject('kanji-in-word-context only applies to a kanji target.');
  const index = indexPool(ctx.pool);
  const entry = index.characterById(String(target.itemId)) as KanjiCharacter | undefined;
  if (!entry) return reject('Target kanji not found in the generation pool.');

  const readingId = target.readingId ?? entry.readings.find((id) => index.wordForReading(String(id), entry.glyph)) ?? null;
  if (!readingId) return reject('This kanji has no taught reading to ask about.');
  const readingKana = index.readingKana(readingId);
  const word = index.wordForReading(readingId, entry.glyph);
  if (!readingKana || !word) return reject('No taught word demonstrates this reading; it cannot be asked without context.');

  const accepted = [...new Set([readingKana, hiraganaToKatakana(readingKana)])];
  const base = baseEnvelope('kanji-in-word-context', target, ctx.random);
  const question: Question = {
    ...base,
    targetReadingId: String(readingId),
    prompt: {
      ...emptyPrompt(`Type how ${entry.glyph} is read here, in kana.`),
      text: word.spelling,
      textIsJapanese: true,
      context: `${word.spelling} — ${word.meaning}`,
    },
    options: null,
    pairs: null,
    acceptedAnswers: accepted,
    canonicalAnswer: readingKana,
    alsoAcceptableNote: 'Either kana script is accepted for this reading.',
    distinction: null,
  };
  return { question, rejected: null };
}
