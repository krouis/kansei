import { asItemId, itemKind, type KanaCharacter, type KanjiCharacter, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool } from '../pool';
import { randomOrder, baseEnvelope, emptyPrompt, reject } from '../support';
import { shuffle } from '../rng';

/**
 * Type 3 — Character → select the correct reading among four options.
 *
 * Recognition (picking a reading out of four is elimination, not production).
 * For a kanji this is NEVER asked bare: a bare kanji can have several readings,
 * so the prompt always names the word the reading is being asked inside, per
 * the ambiguity rule. For a kana the "reading" is its rōmaji, asked with no
 * particle context — は/へ/を keep their character value here, and the note
 * field explains the particle exception separately.
 */
export function generateCharacterToReadingChoice(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  const kind = itemKind(target.itemId);
  const index = indexPool(ctx.pool);

  if (kind === 'kana') {
    const entry = index.characterById(String(target.itemId)) as KanaCharacter | undefined;
    if (!entry) return reject('Target kana not found in the generation pool.');
    const sameScript = index.kana(entry.script).filter((k) => k.romaji !== entry.romaji);
    const distractorRomaji = shuffle(sameScript, ctx.random)
      .map((k) => k.romaji)
      .filter((r, i, arr) => arr.indexOf(r) === i)
      .slice(0, 3);
    if (distractorRomaji.length < 3) return reject('Not enough distinct rōmaji distractors in this script.');

    const order = randomOrder(4, ctx.random);
    const values = [entry.romaji, ...distractorRomaji];
    const options = order.map((sourceIndex, slot) => ({
      key: 'ABCD'[slot]!,
      display: values[sourceIndex]!,
      itemId: sourceIndex === 0 ? asItemId(String(entry.id)) : null,
      correct: sourceIndex === 0,
      distractorReason: sourceIndex === 0 ? null : 'random-in-pool',
    }));

    const base = baseEnvelope('character-to-reading-choice', target, ctx.random);
    const question: Question = {
      ...base,
      prompt: { ...emptyPrompt('Choose how this is read.'), text: entry.glyph, textIsJapanese: true },
      options,
      pairs: null,
      acceptedAnswers: [entry.romaji],
      canonicalAnswer: entry.romaji,
      alsoAcceptableNote: null,
      distinction: entry.note,
    };
    return { question, rejected: null };
  }

  if (kind !== 'kanji') return reject(`character-to-reading-choice does not apply to a ${kind} target.`);

  const entry = index.characterById(String(target.itemId)) as KanjiCharacter | undefined;
  if (!entry) return reject('Target kanji not found in the generation pool.');
  const readingId = target.readingId ?? entry.readings.find((id) => index.wordForReading(String(id), entry.glyph)) ?? null;
  if (!readingId) return reject('This kanji has no taught reading to ask about.');
  const correctKana = index.readingKana(readingId);
  if (!correctKana) return reject('Could not resolve the reading’s kana.');

  const word = index.wordForReading(readingId, entry.glyph);
  if (!word) return reject('No taught word demonstrates this reading; a bare kanji reading is never asked.');

  // Distractor readings: every OTHER taught reading (of any kanji) that has at
  // least one example word, excluding anything that reads identically to the
  // correct answer.
  const allReadingIds = new Set<string>();
  for (const k of index.kanji()) for (const rid of k.readings) allReadingIds.add(String(rid));
  const candidates: string[] = [];
  for (const rid of allReadingIds) {
    if (rid === String(readingId)) continue;
    const kana = index.readingKana(rid);
    if (!kana || kana === correctKana) continue;
    if (index.wordsDemonstrating(rid).length === 0) continue;
    candidates.push(kana);
  }
  const distractorKana = shuffle(candidates, ctx.random)
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .slice(0, 3);
  if (distractorKana.length < 3) return reject('Not enough distinct reading distractors are taught yet.');

  const order = randomOrder(4, ctx.random);
  const values = [correctKana, ...distractorKana];
  const options = order.map((sourceIndex, slot) => ({
    key: 'ABCD'[slot]!,
    display: values[sourceIndex]!,
    itemId: null,
    correct: sourceIndex === 0,
    distractorReason: sourceIndex === 0 ? null : 'same-reading',
  }));

  const base = baseEnvelope('character-to-reading-choice', target, ctx.random);
  const question: Question = {
    ...base,
    targetReadingId: String(readingId),
    prompt: {
      ...emptyPrompt(`Choose how ${entry.glyph} is read here:`),
      text: word.spelling,
      textIsJapanese: true,
      context: `${word.spelling} — ${word.meaning}`,
    },
    options,
    pairs: null,
    acceptedAnswers: [correctKana],
    canonicalAnswer: correctKana,
    alsoAcceptableNote: null,
    distinction: null,
  };
  return { question, rejected: null };
}
