import { asItemId, itemKind, type CharacterEntry, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool, isKanji as isKanjiEntry } from '../pool';
import { shuffle } from '../rng';
import { randomOrder, baseEnvelope, emptyPrompt, reject } from '../support';

const SCRIPT_LABEL: Record<string, string> = { hiragana: 'hiragana', katakana: 'katakana', kanji: 'kanji' };

/**
 * Type 8 — Visually confusable character discrimination.
 *
 * Recognition, but rated 'moderate' rather than 'weak': every option is a
 * character learners actually mistake this one for (シ/ツ, ソ/ン, ね/れ/わ),
 * so eliminating three unrelated options is not what is happening here. Only
 * generated when the target has recorded confusables — a plausible-looking set
 * is never invented — and the instruction always names the script, so a
 * cross-script look-alike (り vs リ) reads as a genuinely wrong option rather
 * than a second right one.
 */
export function generateConfusableDiscrimination(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  const kind = itemKind(target.itemId);
  if (kind !== 'kana' && kind !== 'kanji') return reject(`confusable-discrimination does not apply to a ${kind} target.`);

  const index = indexPool(ctx.pool);
  const entry = index.characterById(String(target.itemId)) as CharacterEntry | undefined;
  if (!entry) return reject('Target character not found in the generation pool.');
  if (entry.confusableWith.length === 0) return reject('This character has no recorded confusables.');

  const confusableIds = new Set(entry.confusableWith.map(String));
  const inPool = (kind === 'kana' ? index.kana() : index.kanji()).filter((c) => confusableIds.has(String(c.id)));
  const chosen = shuffle(inPool, ctx.random).slice(0, 3);
  if (chosen.length < 3) return reject('Fewer than three recorded confusables are available in the current pool.');

  const order = randomOrder(4, ctx.random);
  const values: CharacterEntry[] = [entry, ...chosen];
  const options = order.map((sourceIndex, slot) => ({
    key: 'ABCD'[slot]!,
    display: values[sourceIndex]!.glyph,
    itemId: asItemId(String(values[sourceIndex]!.id)),
    correct: sourceIndex === 0,
    distractorReason: sourceIndex === 0 ? null : 'confusable',
  }));

  const reading = kind === 'kana'
    ? (entry as import('@/domain').KanaCharacter).romaji
    : isKanjiEntry(entry) ? (entry.meanings[0] ?? entry.glyph) : entry.glyph;
  const scriptLabel = kind === 'kana' ? SCRIPT_LABEL[(entry as import('@/domain').KanaCharacter).script] : 'kanji';

  const base = baseEnvelope('confusable-discrimination', target, ctx.random);
  const question: Question = {
    ...base,
    prompt: {
      ...emptyPrompt(`Choose the ${scriptLabel} character for:`),
      text: reading,
      textIsJapanese: false,
    },
    options,
    pairs: null,
    acceptedAnswers: [entry.glyph],
    canonicalAnswer: entry.glyph,
    alsoAcceptableNote: null,
    distinction: entry.printVsHandwritten ?? (kind === 'kana' ? (entry as import('@/domain').KanaCharacter).note : null),
  };
  return { question, rejected: null };
}
