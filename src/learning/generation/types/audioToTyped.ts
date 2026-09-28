import {
  hiraganaToKatakana, itemKind, katakanaToHiragana, type KanaCharacter, type Question, type VocabEntry,
} from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool, audioKey } from '../pool';
import { expandHomophoneSpellings, standaloneAmbiguity } from '../homophones';
import { baseEnvelope, emptyPrompt, reject } from '../support';

/**
 * Type 6 — Audio → type a reading or Japanese spelling, unaided.
 *
 * Listening, strong evidence — the hardest listening format, since nothing is
 * shown. A bare kanji is refused: its audio alone cannot name one reading. For
 * kana and vocabulary, every spelling that sounds identical is accepted:
 * standalone homophones (じ/ぢ, ず/づ, お/を) for a lone kana, and
 * `expandHomophoneSpellings` for a word, which folds those same pairs wherever
 * they occur inside it — but NOT は/へ, which only diverge from their spelling
 * in particle position and are simply /ha/ and /he/ inside an ordinary word.
 * Both kana scripts are accepted, since the question tests hearing rather than
 * which table the word is conventionally written in. IME use is tracked
 * separately by the session engine via the question's `imeInput` exercise tag,
 * never folded into the listening result itself.
 */
export function generateAudioToTyped(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  const kind = itemKind(target.itemId);
  if (kind === 'kanji') return reject('A bare kanji has no single reading for its audio to name.');
  if (kind !== 'kana' && kind !== 'vocab') return reject(`audio-to-typed does not apply to a ${kind} target.`);

  const key = audioKey(target.itemId);
  if (!ctx.hasAudio(key)) return reject('No verified recording for this item.');
  const audio = ctx.audio?.(key);
  if (!audio) return reject('hasAudio reported true but no AudioRef was supplied.');

  const index = indexPool(ctx.pool);
  const base = baseEnvelope('audio-to-typed', target, ctx.random);

  if (kind === 'kana') {
    const entry = index.characterById(String(target.itemId)) as KanaCharacter | undefined;
    if (!entry) return reject('Target kana not found in the generation pool.');
    const amb = standaloneAmbiguity(entry.glyph);
    const primary = [entry.glyph, ...amb.alternatives];
    const folded = primary.map((g) => (entry.script === 'hiragana' ? hiraganaToKatakana(g) : katakanaToHiragana(g)));
    const accepted = [...new Set([...primary, ...folded])];

    const question: Question = {
      ...base,
      prompt: { ...emptyPrompt('Listen, then type what you heard.'), audio },
      options: null,
      pairs: null,
      acceptedAnswers: accepted,
      canonicalAnswer: entry.glyph,
      alsoAcceptableNote:
        amb.note ?? 'Either kana script is accepted here — this question is about the sound, not the table it is written in.',
      distinction: entry.note,
      requiredAudio: [key],
    };
    return { question, rejected: null };
  }

  const entry = index.vocabById(String(target.itemId)) as VocabEntry | undefined;
  if (!entry) return reject('Target word not found in the generation pool.');
  const expansion = expandHomophoneSpellings(entry.reading);
  const folded = expansion.variants.map(hiraganaToKatakana);
  const accepted = [...new Set([...expansion.variants, ...folded])];

  const question: Question = {
    ...base,
    prompt: { ...emptyPrompt('Listen, then type what you heard.'), audio },
    options: null,
    pairs: null,
    acceptedAnswers: accepted,
    canonicalAnswer: entry.reading,
    alsoAcceptableNote:
      expansion.notes.length > 0
        ? expansion.notes.join(' ')
        : 'Either kana script is accepted here — this question is about the sound, not the table it is written in.',
    distinction: null,
    requiredAudio: [key],
  };
  return { question, rejected: null };
}
