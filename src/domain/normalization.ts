/**
 * Answer normalisation.
 *
 * Goal: accept every spelling that means the same thing, while preserving the
 * spelling distinctions that actually matter in Japanese.
 *
 * Normalised away (equivalent representations):
 *  - Unicode composition differences — NFC, so が written as か + U+3099 is
 *    treated as the single character が.
 *  - Full-width Latin and digits (ａ → a), because an IME often produces them.
 *  - Half-width katakana (ｱ → ア), which is a legacy encoding of the same kana.
 *  - Case, and surrounding or internal whitespace.
 *  - The IME's trailing 'n' artefacts are NOT touched; see below.
 *
 * Preserved (meaningful distinctions):
 *  - Hiragana vs katakana. These are different scripts and different answers;
 *    ねこ and ネコ are not interchangeable when a script was specified.
 *  - Small kana: っ/ッ (gemination) and ゃゅょ (contraction) change the word.
 *  - The long-vowel mark ー, and the おう/おお spelling distinction.
 *  - Voicing marks: か vs が vs ぱ.
 *  - ぢ/じ and づ/ず as written forms, even though they sound alike; a question
 *    that cannot distinguish them must accept both explicitly instead.
 */

const FULLWIDTH_ASCII_START = 0xff01;
const FULLWIDTH_ASCII_END = 0xff5e;
const ASCII_OFFSET = 0xff01 - 0x21;

/**
 * Half-width katakana → full-width. Built from the Unicode range U+FF61–U+FF9F.
 * The voicing marks ﾞ and ﾟ are separate characters in half-width, so they are
 * combined with the preceding base character and then NFC-composed.
 */
const HALFWIDTH_KATAKANA: Record<string, string> = {
  '\uFF61': '。', '\uFF62': '「', '\uFF63': '」', '\uFF64': '、', '\uFF65': '・',
  '\uFF66': 'ヲ', '\uFF67': 'ァ', '\uFF68': 'ィ', '\uFF69': 'ゥ',
  '\uFF6A': 'ェ', '\uFF6B': 'ォ', '\uFF6C': 'ャ', '\uFF6D': 'ュ', '\uFF6E': 'ョ',
  '\uFF6F': 'ッ', '\uFF70': 'ー',
  '\uFF71': 'ア', '\uFF72': 'イ', '\uFF73': 'ウ', '\uFF74': 'エ', '\uFF75': 'オ',
  '\uFF76': 'カ', '\uFF77': 'キ', '\uFF78': 'ク', '\uFF79': 'ケ', '\uFF7A': 'コ',
  '\uFF7B': 'サ', '\uFF7C': 'シ', '\uFF7D': 'ス', '\uFF7E': 'セ', '\uFF7F': 'ソ',
  '\uFF80': 'タ', '\uFF81': 'チ', '\uFF82': 'ツ', '\uFF83': 'テ', '\uFF84': 'ト',
  '\uFF85': 'ナ', '\uFF86': 'ニ', '\uFF87': 'ヌ', '\uFF88': 'ネ', '\uFF89': 'ノ',
  '\uFF8A': 'ハ', '\uFF8B': 'ヒ', '\uFF8C': 'フ', '\uFF8D': 'ヘ', '\uFF8E': 'ホ',
  '\uFF8F': 'マ', '\uFF90': 'ミ', '\uFF91': 'ム', '\uFF92': 'メ', '\uFF93': 'モ',
  '\uFF94': 'ヤ', '\uFF95': 'ユ', '\uFF96': 'ヨ',
  '\uFF97': 'ラ', '\uFF98': 'リ', '\uFF99': 'ル', '\uFF9A': 'レ', '\uFF9B': 'ロ',
  '\uFF9C': 'ワ', '\uFF9D': 'ン',
};

/** Half-width voicing marks, which follow their base character. */
const HALFWIDTH_VOICED = '\uFF9E';
const HALFWIDTH_SEMI_VOICED = '\uFF9F';

/** Convert a half-width katakana run to full-width, folding the voicing marks in. */
function expandHalfwidthKatakana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    const base = HALFWIDTH_KATAKANA[ch];
    if (base === undefined) {
      out += ch;
      continue;
    }
    const next = s[i + 1];
    if (next === HALFWIDTH_VOICED) {
      out += (base + '\u3099').normalize('NFC');
      i += 1;
    } else if (next === HALFWIDTH_SEMI_VOICED) {
      out += (base + '\u309A').normalize('NFC');
      i += 1;
    } else {
      out += base;
    }
  }
  return out;
}

/**
 * Normalise a typed answer for comparison.
 *
 * `preserveScript` defaults to true. When a question specifies the target script
 * the comparison is script-sensitive; when it does not, the caller may fold
 * katakana to hiragana by passing `{ foldScript: true }` and must say so in the
 * question's accepted-answer list.
 */
export function normaliseAnswer(input: string, opts: { foldScript?: boolean } = {}): string {
  let s = input.normalize('NFC');

  // Half-width katakana, with the trailing voicing marks folded into the base.
  s = expandHalfwidthKatakana(s).normalize('NFC');

  // Full-width ASCII → ASCII, and the full-width space.
  s = s.replace(/[！-～]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    return code >= FULLWIDTH_ASCII_START && code <= FULLWIDTH_ASCII_END
      ? String.fromCodePoint(code - ASCII_OFFSET)
      : ch;
  });
  s = s.replace(/　/g, ' ');

  // Trim and collapse whitespace; Japanese answers contain none.
  s = s.trim().replace(/\s+/g, ' ');

  // Latin case only. Kana has no case.
  s = s.toLowerCase();

  if (opts.foldScript) s = katakanaToHiragana(s);

  // Re-normalise: folding may have produced decomposed sequences.
  return s.normalize('NFC');
}

/** Katakana → hiragana, leaving ー and ヷ-class characters that have no pair alone. */
export function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCodePoint(ch.codePointAt(0)! - 0x60));
}

export function hiraganaToKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCodePoint(ch.codePointAt(0)! + 0x60));
}

export const isHiragana = (s: string): boolean => /^[ぁ-ゖゝゞー]+$/u.test(s);
export const isKatakana = (s: string): boolean => /^[ァ-ヺー-ヿ]+$/u.test(s);
export const containsKanji = (s: string): boolean => /[一-鿿㐀-䶿]/u.test(s);

/**
 * True when `typed` is just a copy of rōmaji that was visible on screen.
 * Used to make sure typing what is already displayed is never credited as
 * character recall.
 */
export function isCopyOfVisibleRomaji(typed: string, visibleRomaji: string | null): boolean {
  if (!visibleRomaji) return false;
  const a = normaliseAnswer(typed);
  const b = normaliseAnswer(visibleRomaji);
  return a.length > 0 && a === b;
}
