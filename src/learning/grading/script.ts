import { isHiragana, isKatakana, katakanaToHiragana, normaliseAnswer } from '@/domain';
import type { InputScript } from '@/domain';

/**
 * Script sensitivity.
 *
 * "When a script was specified, hiragana and katakana are DIFFERENT answers;
 * when it was not, fold script and say so." The question states which case it is
 * through `inputScript`:
 *
 *  - 'kana'          the question asked for kana, and its accepted answers spell
 *                    out which script(s) count. ねこ and ネコ are different
 *                    answers, and a question that means to take either lists both.
 *  - 'japanese-any'  no script was specified, so script is folded. The grade says
 *                    so, because a learner who typed katakana and was accepted
 *                    needs to know they were not marked on the script.
 *  - 'romaji'        Latin letters; folding kana is irrelevant.
 *  - 'none'          no text response (choice, matching, handwriting).
 */
export function shouldFoldScript(inputScript: InputScript): boolean {
  return inputScript === 'japanese-any';
}

/** Normalise a typed answer exactly the way the question's script rule requires. */
export function normaliseFor(input: string, inputScript: InputScript): string {
  return normaliseAnswer(input, { foldScript: shouldFoldScript(inputScript) });
}

/**
 * The script the question's accepted answers are written in, when they agree on
 * one. Used only to explain a script mistake truthfully; when the answers mix
 * scripts there is nothing to explain and this returns null.
 */
export function expectedScript(acceptedAnswers: string[]): 'hiragana' | 'katakana' | null {
  const kana = acceptedAnswers.filter((a) => a.length > 0);
  if (kana.length === 0) return null;
  if (kana.every((a) => isHiragana(a))) return 'hiragana';
  if (kana.every((a) => isKatakana(a))) return 'katakana';
  return null;
}

/**
 * True when the answer differs from an accepted answer ONLY by script. This is a
 * safe claim to make: it is an equality test after folding katakana to hiragana,
 * not a judgement about pronunciation.
 */
export function differsOnlyByScript(typed: string, acceptedAnswers: string[]): boolean {
  if (typed.length === 0) return false;
  const folded = katakanaToHiragana(typed);
  return acceptedAnswers.some((a) => a !== typed && katakanaToHiragana(a) === folded);
}
