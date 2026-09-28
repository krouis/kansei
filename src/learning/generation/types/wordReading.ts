import { containsKanji, hiraganaToKatakana, itemKind, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool } from '../pool';
import { baseEnvelope, emptyPrompt, reject } from '../support';

const MACRON_TO_PLAIN: Record<string, string> = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' };
const MACRON_TO_DOUBLE: Record<string, string> = { ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'oo' };

/**
 * Every documented spelling of a macron long vowel: kōhī, koohii, kohi.
 *
 * The macron form is always first (it is the canonical, displayed spelling);
 * the other two are typing conveniences a learner's keyboard may not produce a
 * macron for. Only applied to rōmaji answers — this is a romanisation detail,
 * not a claim about Japanese spelling, so it never touches a kana answer.
 */
function macronVariants(romaji: string): string[] {
  if (!/[āīūēō]/.test(romaji)) return [romaji];
  const plain = romaji.replace(/[āīūēō]/g, (c) => MACRON_TO_PLAIN[c] ?? c);
  const doubled = romaji.replace(/[āīūēō]/g, (c) => MACRON_TO_DOUBLE[c] ?? c);
  return [romaji, doubled, plain].filter((v, i, arr) => arr.indexOf(v) === i);
}

/**
 * Type 9 — Read a short word, unaided.
 *
 * Reading recall, strong evidence. A word written with kanji is read by typing
 * its kana reading; a word written entirely in kana is read by typing its
 * RŌMAJI instead, because typing back the same kana that is already printed on
 * screen would be copying the spelling, not reading it.
 */
export function generateWordReading(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  if (itemKind(target.itemId) !== 'vocab') return reject('word-reading only applies to a vocabulary target.');
  const index = indexPool(ctx.pool);
  const entry = index.vocabById(String(target.itemId));
  if (!entry) return reject('Target word not found in the generation pool.');

  const base = baseEnvelope('word-reading', target, ctx.random);
  const hasKanji = containsKanji(entry.spelling);

  if (!hasKanji) {
    // The spelling IS the reading, so the reading is asked for in rōmaji.
    const accepted = macronVariants(entry.romaji);
    const question: Question = {
      ...base,
      // 'inputScript' on the spec is 'kana', which describes the kanji-word case;
      // a kana-only word overrides it to 'romaji' so the answer is never the
      // string already on screen. Documented in generation/README.md.
      inputScript: 'romaji',
      prompt: { ...emptyPrompt('Type this in rōmaji.'), text: entry.spelling, textIsJapanese: true },
      options: null,
      pairs: null,
      acceptedAnswers: accepted,
      canonicalAnswer: entry.romaji,
      alsoAcceptableNote: accepted.length > 1 ? `Also accepted: ${accepted.slice(1).join(', ')}` : null,
      distinction: null,
    };
    return { question, rejected: null };
  }

  const katakanaForm = hiraganaToKatakana(entry.reading);
  const accepted = [...new Set([entry.reading, katakanaForm])];
  const question: Question = {
    ...base,
    prompt: { ...emptyPrompt('Type the reading, in kana.'), text: entry.spelling, textIsJapanese: true },
    options: null,
    pairs: null,
    acceptedAnswers: accepted,
    canonicalAnswer: entry.reading,
    alsoAcceptableNote: 'Either kana script is accepted for this reading.',
    distinction: null,
  };
  return { question, rejected: null };
}
