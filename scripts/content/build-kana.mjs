#!/usr/bin/env node
/**
 * build-kana.mjs — build Kansei's kana curriculum inventory.
 *
 * WHAT THIS FILE IS
 *   The tables below are the HAND-AUTHORED SOURCE OF TRUTH for the kana
 *   curriculum: teaching order, lesson grouping, teaching notes, learner
 *   confusion pairs, IME input variants and print-vs-handwritten warnings are
 *   curriculum judgement, not data that can be derived from a dictionary.
 *   They are committed here, next to the derivation, so that the authored
 *   judgement and the mechanical expansion live in one reviewable place.
 *
 *   Exactly one field is NOT authored here: `strokeCount`. It is read from
 *   KanjiVG, which documents one stroke decomposition per kana, so the counts
 *   are sourced rather than remembered.
 *
 * OUTPUT
 *   data/kana.json              — KanaCharacter[]   (src/domain/content.ts)
 *   data/kana-lessons.json      — Lesson[]          (src/domain/content.ts)
 *   data/kana.provenance.json   — provenance record for both files
 *
 * SOURCE (for strokeCount only)
 *   KanjiVG r20250816, CC BY-SA 3.0
 *   https://github.com/KanjiVG/kanjivg/releases/tag/r20250816
 *   https://creativecommons.org/licenses/by-sa/3.0/
 *   Attribution: Ulrich Apel / KanjiVG contributors. Share-alike.
 *
 * REPRODUCE
 *   node scripts/assets/fetch-sources.mjs          # writes data/sources/
 *   unzip -q -o data/sources/kanjivg-20250816-main.zip -d data/sources/kanjivg
 *   node scripts/content/build-kana.mjs
 *
 *   Output is a pure function of (these tables + the KanjiVG release), so a
 *   re-run on the same inputs produces byte-identical files.
 *
 * Node builtins only. Every invariant is asserted at the end; the script exits
 * non-zero rather than writing a file it cannot vouch for.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const KANJIVG_DIR = join(REPO, 'data', 'sources', 'kanjivg', 'kanji');
const OUT_DIR = join(REPO, 'data');

const KANJIVG = {
  id: 'kanjivg-20250816',
  project: 'KanjiVG',
  version: 'r20250816',
  url: 'https://github.com/KanjiVG/kanjivg/releases/tag/r20250816',
  license: 'CC-BY-SA-3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
};

/** Mirror of ID_PATTERN in src/domain/ids.ts — kept in sync by the assertions below. */
const ID_PATTERN = /^(kana:(hi|ka):[a-z0-9_-]+|kanji:.+|comp:.+|vocab:.+|reading:.+:.+)$/u;

// ---------------------------------------------------------------------------
// strokeCount, from KanjiVG
// ---------------------------------------------------------------------------

const strokeCache = new Map();

/** Stroke count of a single kana code point, counted from its KanjiVG drawing. */
function strokesOfCodePoint(ch) {
  if (strokeCache.has(ch)) return strokeCache.get(ch);
  const hex = ch.codePointAt(0).toString(16).padStart(5, '0');
  const file = join(KANJIVG_DIR, `${hex}.svg`);
  if (!existsSync(file)) {
    throw new Error(
      `KanjiVG has no drawing for ${ch} (U+${hex.toUpperCase()}) at ${file}. ` +
        'Run: node scripts/assets/fetch-sources.mjs && unzip -q -o data/sources/kanjivg-20250816-main.zip -d data/sources/kanjivg',
    );
  }
  const n = (readFileSync(file, 'utf8').match(/<path /g) ?? []).length;
  if (n < 1) throw new Error(`KanjiVG drawing for ${ch} has no strokes`);
  strokeCache.set(ch, n);
  return n;
}

/**
 * Stroke count of a glyph, which may be several code points (きゃ, ファ).
 * Composed voiced kana (が, ヴ) are looked up as a single code point, because
 * KanjiVG draws them as one character: the dakuten counts as 2 strokes and the
 * handakuten as 1, which is the conventional Japanese counting.
 */
function strokesOf(glyph) {
  let total = 0;
  for (const ch of glyph) total += strokesOfCodePoint(ch);
  return total;
}

// ---------------------------------------------------------------------------
// AUTHORED TABLE 1 — the 46 modern basic kana, shared by both scripts
// ---------------------------------------------------------------------------
// s  = id slug           r  = displayed modified-Hepburn romaji
// row/col = gojuon cell   h/k = hiragana / katakana glyph
// v  = accepted typed input (lowercase; Hepburn + Kunrei + IME spellings)
// hn/kn = teaching note for the hiragana / katakana record
// hp/kp = print-vs-handwritten warning, ONLY where the forms genuinely differ

const BASIC = [
  { s: 'a', r: 'a', row: '', col: 'a', h: 'あ', k: 'ア', v: ['a'],
    hn: null, kn: null },
  { s: 'i', r: 'i', row: '', col: 'i', h: 'い', k: 'イ', v: ['i', 'yi'],
    hn: 'A long i is written by simply repeating the kana: おおきい, ちいさい.', kn: null },
  { s: 'u', r: 'u', row: '', col: 'u', h: 'う', k: 'ウ', v: ['u', 'wu', 'whu'],
    hn: 'う also writes vowel length: added after an o-column kana it makes a long o (とうきょう = Tokyo), and after a u-column kana a long u (ゆうめい). Modified Hepburn writes these as o and u with a macron, not as "ou".',
    kn: null },
  { s: 'e', r: 'e', row: '', col: 'e', h: 'え', k: 'エ', v: ['e'],
    hn: null, kn: null },
  { s: 'o', r: 'o', row: '', col: 'o', h: 'お', k: 'オ', v: ['o'],
    hn: 'A long o is normally written おう (とうきょう), but a short list of words writes it おお instead: おおきい (big), おおい (many), とおい (far), おおさか (Osaka). There is no rule to derive this from — the おお words are learned as a list.',
    kn: null },

  { s: 'ka', r: 'ka', row: 'k', col: 'a', h: 'か', k: 'カ', v: ['ka', 'ca'], hn: null, kn: null },
  { s: 'ki', r: 'ki', row: 'k', col: 'i', h: 'き', k: 'キ', v: ['ki'],
    hn: null, kn: null,
    hp: 'Many printed faces join the last two strokes of き into one sweep. The handwritten form keeps the final stroke separate — four strokes, not three.' },
  { s: 'ku', r: 'ku', row: 'k', col: 'u', h: 'く', k: 'ク', v: ['ku', 'cu', 'qu'], hn: null, kn: null },
  { s: 'ke', r: 'ke', row: 'k', col: 'e', h: 'け', k: 'ケ', v: ['ke'], hn: null, kn: null },
  { s: 'ko', r: 'ko', row: 'k', col: 'o', h: 'こ', k: 'コ', v: ['ko', 'co'], hn: null, kn: null },

  { s: 'sa', r: 'sa', row: 's', col: 'a', h: 'さ', k: 'サ', v: ['sa'],
    hn: null, kn: null,
    hp: 'Printed さ often joins the second and third strokes into one curve. Handwritten さ keeps the bottom curve detached from the vertical.' },
  { s: 'shi', r: 'shi', row: 's', col: 'i', h: 'し', k: 'シ', v: ['shi', 'si', 'ci'],
    hn: 'Romanised shi, never "si" — the consonant is not the same sound as in さ. An IME accepts either spelling.',
    kn: null,
    kp: 'Print does not show stroke direction, and シ is told apart from ツ by exactly that. シ: two short ticks stacked down the LEFT side, then a long stroke sweeping from lower left up to the right. ツ: two ticks along the TOP, then a long stroke sweeping down to the left.' },
  { s: 'su', r: 'su', row: 's', col: 'u', h: 'す', k: 'ス', v: ['su'], hn: null, kn: null },
  { s: 'se', r: 'se', row: 's', col: 'e', h: 'せ', k: 'セ', v: ['se', 'ce'], hn: null, kn: null },
  { s: 'so', r: 'so', row: 's', col: 'o', h: 'そ', k: 'ソ', v: ['so'],
    hn: null, kn: null,
    hp: 'Two accepted shapes. Most printed faces draw そ as one continuous stroke; handwriting is often taught with the top horizontal written separately (two strokes). Both are correct — KanjiVG documents the one-stroke form, which is what the app animates.',
    kp: 'Print does not show stroke direction. ソ and ン have the same short opening tick; they differ in the long second stroke. ソ: it starts top right and sweeps DOWN-LEFT, like ノ. ン: it starts at the left and sweeps DOWN-RIGHT, flicking up at the end, like the last stroke of シ.' },

  { s: 'ta', r: 'ta', row: 't', col: 'a', h: 'た', k: 'タ', v: ['ta'], hn: null, kn: null },
  { s: 'chi', r: 'chi', row: 't', col: 'i', h: 'ち', k: 'チ', v: ['chi', 'ti'],
    hn: 'Romanised chi. An IME produces it from either chi or ti.', kn: null },
  { s: 'tsu', r: 'tsu', row: 't', col: 'u', h: 'つ', k: 'ツ', v: ['tsu', 'tu'],
    hn: 'Romanised tsu — one consonant sound, not "t + s". An IME produces it from tsu or tu.',
    kn: null,
    kp: 'Print does not show stroke direction, and ツ is told apart from シ by exactly that. ツ: two short ticks along the TOP, then a long stroke sweeping down to the LEFT. シ: ticks stacked down the left, final stroke sweeping up to the right.' },
  { s: 'te', r: 'te', row: 't', col: 'e', h: 'て', k: 'テ', v: ['te'], hn: null, kn: null },
  { s: 'to', r: 'to', row: 't', col: 'o', h: 'と', k: 'ト', v: ['to'], hn: null, kn: null },

  { s: 'na', r: 'na', row: 'n', col: 'a', h: 'な', k: 'ナ', v: ['na'], hn: null, kn: null },
  { s: 'ni', r: 'ni', row: 'n', col: 'i', h: 'に', k: 'ニ', v: ['ni'], hn: null, kn: null },
  { s: 'nu', r: 'nu', row: 'n', col: 'u', h: 'ぬ', k: 'ヌ', v: ['nu'], hn: null, kn: null },
  { s: 'ne', r: 'ne', row: 'n', col: 'e', h: 'ね', k: 'ネ', v: ['ne'], hn: null, kn: null },
  { s: 'no', r: 'no', row: 'n', col: 'o', h: 'の', k: 'ノ', v: ['no'], hn: null, kn: null },

  { s: 'ha', r: 'ha', row: 'h', col: 'a', h: 'は', k: 'ハ', v: ['ha'],
    hn: 'Written は and read "ha" as a character — but when it marks the topic of a sentence it is pronounced "wa": わたしは がくせいです (watashi wa gakusei desu). The spelling never changes; only the sound does.',
    kn: null },
  { s: 'hi', r: 'hi', row: 'h', col: 'i', h: 'ひ', k: 'ヒ', v: ['hi'], hn: null, kn: null },
  { s: 'fu', r: 'fu', row: 'h', col: 'u', h: 'ふ', k: 'フ', v: ['fu', 'hu'],
    hn: 'The h-row consonant becomes an f-like sound before u, so ふ is romanised fu. An IME accepts fu or hu.',
    kn: null,
    hp: 'Printed ふ looks like one flowing shape. It is written as four separate strokes: the top tick, the left curve, then the two short strokes on the right.' },
  { s: 'he', r: 'he', row: 'h', col: 'e', h: 'へ', k: 'ヘ', v: ['he'],
    hn: 'Written へ and read "he" as a character — but as the particle marking a direction or destination it is pronounced "e": とうきょうへ いきます (Tokyo e ikimasu).',
    kn: 'Katakana ヘ and hiragana へ are nearly identical shapes; only context tells you which script you are reading.' },
  { s: 'ho', r: 'ho', row: 'h', col: 'o', h: 'ほ', k: 'ホ', v: ['ho'], hn: null, kn: null },

  { s: 'ma', r: 'ma', row: 'm', col: 'a', h: 'ま', k: 'マ', v: ['ma'], hn: null, kn: null },
  { s: 'mi', r: 'mi', row: 'm', col: 'i', h: 'み', k: 'ミ', v: ['mi'], hn: null, kn: null },
  { s: 'mu', r: 'mu', row: 'm', col: 'u', h: 'む', k: 'ム', v: ['mu'], hn: null, kn: null },
  { s: 'me', r: 'me', row: 'm', col: 'e', h: 'め', k: 'メ', v: ['me'], hn: null, kn: null },
  { s: 'mo', r: 'mo', row: 'm', col: 'o', h: 'も', k: 'モ', v: ['mo'], hn: null, kn: null },

  { s: 'ya', r: 'ya', row: 'y', col: 'a', h: 'や', k: 'ヤ', v: ['ya'], hn: null, kn: null },
  { s: 'yu', r: 'yu', row: 'y', col: 'u', h: 'ゆ', k: 'ユ', v: ['yu'], hn: null, kn: null },
  { s: 'yo', r: 'yo', row: 'y', col: 'o', h: 'よ', k: 'ヨ', v: ['yo'], hn: null, kn: null },

  { s: 'ra', r: 'ra', row: 'r', col: 'a', h: 'ら', k: 'ラ', v: ['ra'],
    hn: 'The r-row consonant is a single tap of the tongue — between an English r and l, and closer to a light d than to either.',
    kn: null },
  { s: 'ri', r: 'ri', row: 'r', col: 'i', h: 'り', k: 'リ', v: ['ri'],
    hn: null, kn: null,
    hp: 'Some printed faces join the two strokes of り into one shape. Handwritten り is two separate strokes.' },
  { s: 'ru', r: 'ru', row: 'r', col: 'u', h: 'る', k: 'ル', v: ['ru'], hn: null, kn: null },
  { s: 're', r: 're', row: 'r', col: 'e', h: 'れ', k: 'レ', v: ['re'], hn: null, kn: null },
  { s: 'ro', r: 'ro', row: 'r', col: 'o', h: 'ろ', k: 'ロ', v: ['ro'], hn: null, kn: null },

  { s: 'wa', r: 'wa', row: 'w', col: 'a', h: 'わ', k: 'ワ', v: ['wa'], hn: null, kn: null },
  { s: 'wo', r: 'wo', row: 'w', col: 'o', h: 'を', k: 'ヲ', v: ['wo', 'o'],
    hn: 'Spelled wo, pronounced "o". In modern Japanese を is used almost only as the object particle: ほんを よむ (hon o yomu). A word that starts with the "o" sound is written お, never を.',
    kn: 'Katakana ヲ is effectively obsolete: modern loanwords use ウォ for the wo sound. You will meet ヲ in pre-war documents and in stylised titles, not in everyday text.' },
  { s: 'n', r: 'n', row: null, col: null, h: 'ん', k: 'ン', v: ['n', 'nn', "n'", 'xn', 'm'],
    hn: 'The only kana that is a consonant on its own, and it takes a full beat. Its sound follows what comes next: before b, p and m it is pronounced [m] — しんぶん (newspaper) sounds like "shimbun", えんぴつ like "empitsu". Typing it usually needs a doubled n: "kani" gives かに, "kanni" gives かんい. Hepburn writes n’ before a vowel to keep しんあい (shin’ai) distinct from しない.',
    kn: null },
];

// ---------------------------------------------------------------------------
// AUTHORED TABLE 2 — voiced (dakuten) and plosive (handakuten) rows
// ---------------------------------------------------------------------------
// base = slug of the unvoiced kana it derives from

const DAKUTEN = [
  { s: 'ga', r: 'ga', base: 'ka', row: 'g', col: 'a', v: ['ga'], hn: null },
  { s: 'gi', r: 'gi', base: 'ki', row: 'g', col: 'i', v: ['gi'], hn: null },
  { s: 'gu', r: 'gu', base: 'ku', row: 'g', col: 'u', v: ['gu'], hn: null },
  { s: 'ge', r: 'ge', base: 'ke', row: 'g', col: 'e', v: ['ge'], hn: null },
  { s: 'go', r: 'go', base: 'ko', row: 'g', col: 'o', v: ['go'], hn: null },

  { s: 'za', r: 'za', base: 'sa', row: 'z', col: 'a', v: ['za'], hn: null },
  { s: 'ji', r: 'ji', base: 'shi', row: 'z', col: 'i', v: ['ji', 'zi'],
    hn: 'じ and ぢ are pronounced identically in modern standard Japanese. じ is the normal spelling and the one to use unless you know the word takes ぢ. Type ji or zi.' },
  { s: 'zu', r: 'zu', base: 'su', row: 'z', col: 'u', v: ['zu'],
    hn: 'ず and づ are pronounced identically. ず is the normal spelling.' },
  { s: 'ze', r: 'ze', base: 'se', row: 'z', col: 'e', v: ['ze'], hn: null },
  { s: 'zo', r: 'zo', base: 'so', row: 'z', col: 'o', v: ['zo'], hn: null },

  { s: 'da', r: 'da', base: 'ta', row: 'd', col: 'a', v: ['da'], hn: null },
  { s: 'di', r: 'ji', base: 'chi', row: 'd', col: 'i', v: ['di', 'ji', 'dji'],
    hn: 'Sounds exactly like じ, and is romanised ji. It is written only where a ち has been voiced inside a word — by repetition, as in ちぢむ (to shrink), or by compounding, as in はなぢ (nosebleed, はな + ち). Everywhere else the correct spelling is じ. The IME key is di.' },
  { s: 'du', r: 'zu', base: 'tsu', row: 'd', col: 'u', v: ['du', 'zu', 'dzu'],
    hn: 'Sounds exactly like ず, and is romanised zu. It is written only where a つ has been voiced inside a word: つづく (to continue), つづける, みかづき (crescent moon, みか + つき). Everywhere else write ず. The IME key is du.' },
  { s: 'de', r: 'de', base: 'te', row: 'd', col: 'e', v: ['de'], hn: null },
  { s: 'do', r: 'do', base: 'to', row: 'd', col: 'o', v: ['do'], hn: null },

  { s: 'ba', r: 'ba', base: 'ha', row: 'b', col: 'a', v: ['ba'], hn: null },
  { s: 'bi', r: 'bi', base: 'hi', row: 'b', col: 'i', v: ['bi'], hn: null },
  { s: 'bu', r: 'bu', base: 'fu', row: 'b', col: 'u', v: ['bu'], hn: null },
  { s: 'be', r: 'be', base: 'he', row: 'b', col: 'e', v: ['be'], hn: null },
  { s: 'bo', r: 'bo', base: 'ho', row: 'b', col: 'o', v: ['bo'], hn: null },
];

const HANDAKUTEN = [
  { s: 'pa', r: 'pa', base: 'ha', row: 'p', col: 'a', v: ['pa'],
    hn: 'The h-row with a small circle instead of two dots. Two dots voice the consonant (ば), a circle makes it p (ぱ) — the two marks are easy to confuse at small sizes.' },
  { s: 'pi', r: 'pi', base: 'hi', row: 'p', col: 'i', v: ['pi'], hn: null },
  { s: 'pu', r: 'pu', base: 'fu', row: 'p', col: 'u', v: ['pu'], hn: null },
  { s: 'pe', r: 'pe', base: 'he', row: 'p', col: 'e', v: ['pe'], hn: null },
  { s: 'po', r: 'po', base: 'ho', row: 'p', col: 'o', v: ['po'], hn: null },
];

// ---------------------------------------------------------------------------
// AUTHORED TABLE 3 — youon (contracted) combinations
// ---------------------------------------------------------------------------
// base = slug of the i-column kana; small = 'ya' | 'yu' | 'yo'

const YOON = [
  { s: 'kya', r: 'kya', base: 'ki', small: 'ya', v: ['kya'],
    hn: 'A full-size i-column kana plus a SMALL ゃ: one syllable, one beat. Compare きや (two beats) with きゃ (one).' },
  { s: 'kyu', r: 'kyu', base: 'ki', small: 'yu', v: ['kyu'], hn: null },
  { s: 'kyo', r: 'kyo', base: 'ki', small: 'yo', v: ['kyo'], hn: null },

  { s: 'sha', r: 'sha', base: 'shi', small: 'ya', v: ['sha', 'sya', 'shya'],
    hn: 'Hepburn spells this sha, not "sya": the sound is the し consonant, not s + y. Both spellings work on an IME.' },
  { s: 'shu', r: 'shu', base: 'shi', small: 'yu', v: ['shu', 'syu', 'shyu'], hn: null },
  { s: 'sho', r: 'sho', base: 'shi', small: 'yo', v: ['sho', 'syo', 'shyo'], hn: null },

  { s: 'cha', r: 'cha', base: 'chi', small: 'ya', v: ['cha', 'tya', 'cya', 'chya'],
    hn: 'Hepburn spells this cha, not "tya". An IME accepts cha or tya.' },
  { s: 'chu', r: 'chu', base: 'chi', small: 'yu', v: ['chu', 'tyu', 'cyu', 'chyu'], hn: null },
  { s: 'cho', r: 'cho', base: 'chi', small: 'yo', v: ['cho', 'tyo', 'cyo', 'chyo'], hn: null },

  { s: 'nya', r: 'nya', base: 'ni', small: 'ya', v: ['nya'], hn: null },
  { s: 'nyu', r: 'nyu', base: 'ni', small: 'yu', v: ['nyu'], hn: null },
  { s: 'nyo', r: 'nyo', base: 'ni', small: 'yo', v: ['nyo'], hn: null },

  { s: 'hya', r: 'hya', base: 'hi', small: 'ya', v: ['hya'], hn: null },
  { s: 'hyu', r: 'hyu', base: 'hi', small: 'yu', v: ['hyu'], hn: null },
  { s: 'hyo', r: 'hyo', base: 'hi', small: 'yo', v: ['hyo'], hn: null },

  { s: 'mya', r: 'mya', base: 'mi', small: 'ya', v: ['mya'], hn: null },
  { s: 'myu', r: 'myu', base: 'mi', small: 'yu', v: ['myu'], hn: null },
  { s: 'myo', r: 'myo', base: 'mi', small: 'yo', v: ['myo'], hn: null },

  { s: 'rya', r: 'rya', base: 'ri', small: 'ya', v: ['rya'], hn: null },
  { s: 'ryu', r: 'ryu', base: 'ri', small: 'yu', v: ['ryu'], hn: null },
  { s: 'ryo', r: 'ryo', base: 'ri', small: 'yo', v: ['ryo'], hn: null },

  { s: 'gya', r: 'gya', base: 'gi', small: 'ya', v: ['gya'], hn: null },
  { s: 'gyu', r: 'gyu', base: 'gi', small: 'yu', v: ['gyu'], hn: null },
  { s: 'gyo', r: 'gyo', base: 'gi', small: 'yo', v: ['gyo'], hn: null },

  { s: 'ja', r: 'ja', base: 'ji', small: 'ya', v: ['ja', 'jya', 'zya'],
    hn: 'Hepburn spells this ja. An IME accepts ja, jya or zya.' },
  { s: 'ju', r: 'ju', base: 'ji', small: 'yu', v: ['ju', 'jyu', 'zyu'], hn: null },
  { s: 'jo', r: 'jo', base: 'ji', small: 'yo', v: ['jo', 'jyo', 'zyo'], hn: null },

  { s: 'bya', r: 'bya', base: 'bi', small: 'ya', v: ['bya'], hn: null },
  { s: 'byu', r: 'byu', base: 'bi', small: 'yu', v: ['byu'], hn: null },
  { s: 'byo', r: 'byo', base: 'bi', small: 'yo', v: ['byo'], hn: null },

  { s: 'pya', r: 'pya', base: 'pi', small: 'ya', v: ['pya'], hn: null },
  { s: 'pyu', r: 'pyu', base: 'pi', small: 'yu', v: ['pyu'], hn: null },
  { s: 'pyo', r: 'pyo', base: 'pi', small: 'yo', v: ['pyo'], hn: null },

  // Rare: ぢゃ/ヂャ. Real but marginal, so tier 'extended', not part of the core count.
  { s: 'dya', r: 'ja', base: 'di', small: 'ya', v: ['dya', 'ja'], tier: 'extended',
    hn: 'Pronounced exactly like じゃ. Almost never written: it survives in a few dialect and old-spelling forms, and inside compounds where a ちゃ is voiced. Use じゃ unless a dictionary shows otherwise.' },
  { s: 'dyu', r: 'ju', base: 'di', small: 'yu', v: ['dyu', 'ju'], tier: 'extended',
    hn: 'Pronounced exactly like じゅ, and almost never written. Use じゅ.' },
  { s: 'dyo', r: 'jo', base: 'di', small: 'yo', v: ['dyo', 'jo'], tier: 'extended',
    hn: 'Pronounced exactly like じょ, and almost never written. Use じょ.' },
];

// ---------------------------------------------------------------------------
// AUTHORED TABLE 4 — special and small kana
// ---------------------------------------------------------------------------

const SMALL_VOWELS = [
  { s: 'small-a', base: 'a', r: 'a', h: 'ぁ', k: 'ァ', v: ['xa', 'la'] },
  { s: 'small-i', base: 'i', r: 'i', h: 'ぃ', k: 'ィ', v: ['xi', 'li'] },
  { s: 'small-u', base: 'u', r: 'u', h: 'ぅ', k: 'ゥ', v: ['xu', 'lu'] },
  { s: 'small-e', base: 'e', r: 'e', h: 'ぇ', k: 'ェ', v: ['xe', 'le'] },
  { s: 'small-o', base: 'o', r: 'o', h: 'ぉ', k: 'ォ', v: ['xo', 'lo'] },
];

const SMALL_Y = [
  { s: 'small-ya', base: 'ya', r: 'ya', h: 'ゃ', k: 'ャ', v: ['xya', 'lya'] },
  { s: 'small-yu', base: 'yu', r: 'yu', h: 'ゅ', k: 'ュ', v: ['xyu', 'lyu'] },
  { s: 'small-yo', base: 'yo', r: 'yo', h: 'ょ', k: 'ョ', v: ['xyo', 'lyo'] },
];

const SOKUON_NOTE_HI =
  'The small っ writes consonant LENGTH, not a "tsu" sound. It holds the next consonant for one extra beat: きって (kitte, a stamp) against きて (kite, come); いっぱい against いぱい. Romanised by doubling the following consonant. On an IME you get it by typing that doubled consonant (kitte), or directly with xtu / ltu.';
const SOKUON_NOTE_KA =
  'Same consonant-length mark as hiragana っ, and just as common in loanwords: サッカー (soccer), コップ (cup), チケット (ticket). Romanised by doubling the next consonant; typed as that doubled consonant, or as xtu / ltu.';

const CHOONPU_NOTE =
  'The long-vowel mark. It lengthens the vowel of the kana before it: コーヒー (kohi, coffee), ラーメン, ケーキ. It is a katakana convention — hiragana does not use it in ordinary writing, and lengthens a vowel instead by writing the vowel again (おおきい) or by adding う (とうきょう). Typed as the hyphen key. Written vertically it becomes a vertical line, not a rotated dash.';

// ---------------------------------------------------------------------------
// AUTHORED TABLE 5 — extended katakana for loanwords
// ---------------------------------------------------------------------------
// Every entry below is a combination that genuinely occurs in modern written
// Japanese. Where a form is marginal the note SAYS SO rather than inventing a
// familiar-looking example.
// derives = slugs of the katakana records it is built from.

const EXTENDED = [
  { s: 'fa', r: 'fa', g: 'ファ', derives: ['fu', 'a'], v: ['fa', 'hwa', 'fuxa'],
    hn: 'フ + small ァ for a foreign fa: ファイル (file), ファン (fan), ソファ (sofa).' },
  { s: 'fi', r: 'fi', g: 'フィ', derives: ['fu', 'i'], v: ['fi', 'hwi', 'fuxi'],
    hn: 'フィルム (film), オフィス (office), フィンランド (Finland).' },
  { s: 'fe', r: 'fe', g: 'フェ', derives: ['fu', 'e'], v: ['fe', 'hwe', 'fuxe'],
    hn: 'カフェ (cafe), フェリー (ferry), フェスティバル.' },
  { s: 'fo', r: 'fo', g: 'フォ', derives: ['fu', 'o'], v: ['fo', 'hwo', 'fuxo'],
    hn: 'フォーク (fork), プラットフォーム, インフォメーション.' },

  { s: 'ti', r: 'ti', g: 'ティ', derives: ['te', 'i'], v: ['ti', 'thi', 'texi', 'teli'],
    hn: 'テ + small ィ for a foreign ti, which Japanese has no native syllable for: パーティー (party), チケット vs ティーシャツ, ティッシュ. Older borrowings used チ instead (チーム for "team"). The IME key is thi — plain ti gives ち.' },
  { s: 'di', r: 'di', g: 'ディ', derives: ['de', 'i'], v: ['di', 'dhi', 'dexi', 'deli'],
    hn: 'ディスク (disc), ディズニー (Disney), メディア (media). The IME key is dhi — plain di gives ぢ.' },

  { s: 'tu', r: 'tu', g: 'トゥ', derives: ['to', 'u'], v: ['tu', 'twu', 'toxu', 'tolu'],
    hn: 'ト + small ゥ for a foreign tu: タトゥー (tattoo), トゥモロー. Many words use ツ or ト instead. The IME key is twu — plain tu gives つ.' },
  { s: 'du', r: 'du', g: 'ドゥ', derives: ['do', 'u'], v: ['du', 'dwu', 'doxu', 'dolu'],
    hn: 'ヒンドゥー (Hindu), ドゥーワップ. Rarer than トゥ. The IME key is dwu.' },

  { s: 'wi', r: 'wi', g: 'ウィ', derives: ['u', 'i'], v: ['wi', 'uxi', 'whi'],
    hn: 'ウ + small ィ for a foreign wi: ウィスキー (whisky), ウィンドウ (window), ウィキ. Some publishers still write ウイスキー with a full-size イ.' },
  { s: 'we', r: 'we', g: 'ウェ', derives: ['u', 'e'], v: ['we', 'uxe', 'whe'],
    hn: 'ウェブ (web), ウェイター, ハロウィン/ハロウェン. The historical kana for this sound was ヱ.' },
  { s: 'wo-ext', r: 'wo', g: 'ウォ', derives: ['u', 'o'], v: ['wo', 'uxo', 'who'],
    hn: 'ウォーター (water), ストップウォッチ (stopwatch), ウォン (won). This, not ヲ, is how the wo sound is written in modern loanwords.' },

  { s: 'vu', r: 'vu', g: 'ヴ', derives: ['u'], v: ['vu'],
    hn: 'ウ with dakuten, used for a foreign v. Most loanwords now use the b-row instead (バイオリン rather than ヴァイオリン), and Japanese speakers usually pronounce ヴ as b anyway; the Ministry of Education treats the b-row spelling as standard. You will still meet ヴ in names and in careful transcription: ラヴ, ヴ単独 in ヴィヴァルディ.' },
  { s: 'va', r: 'va', g: 'ヴァ', derives: ['vu', 'a'], v: ['va', 'vuxa'],
    hn: 'ヴァイオリン (violin), ヴァージョン — both usually written バイオリン, バージョン today.' },
  { s: 'vi', r: 'vi', g: 'ヴィ', derives: ['vu', 'i'], v: ['vi', 'vuxi'],
    hn: 'ヴィンテージ (vintage), ヴィクトリア (Victoria); commonly ビンテージ.' },
  { s: 've', r: 've', g: 'ヴェ', derives: ['vu', 'e'], v: ['ve', 'vuxe'],
    hn: 'ヴェネツィア (Venice), ヴェルサイユ (Versailles); commonly ベネチア.' },
  { s: 'vo', r: 'vo', g: 'ヴォ', derives: ['vu', 'o'], v: ['vo', 'vuxo'],
    hn: 'ヴォーカル (vocal), ヴォルガ (Volga); commonly ボーカル.' },

  { s: 'she', r: 'she', g: 'シェ', derives: ['shi', 'e'], v: ['she', 'sye', 'sixe'],
    hn: 'シェフ (chef), シェア (share), ミルクシェイク. The し consonant with an e vowel, which the gojuon table has no cell for.' },
  { s: 'je', r: 'je', g: 'ジェ', derives: ['ji', 'e'], v: ['je', 'jye', 'zye', 'jixe'],
    hn: 'ジェット (jet), ジェンダー, プロジェクト (project).' },
  { s: 'che', r: 'che', g: 'チェ', derives: ['chi', 'e'], v: ['che', 'tye', 'cye', 'chixe'],
    hn: 'チェック (check), チェス (chess), チェロ (cello).' },

  { s: 'tsa', r: 'tsa', g: 'ツァ', derives: ['tsu', 'a'], v: ['tsa', 'tuxa'],
    hn: 'モーツァルト (Mozart), ピッツァ (pizza).' },
  { s: 'tsi', r: 'tsi', g: 'ツィ', derives: ['tsu', 'i'], v: ['tsi', 'tuxi'],
    hn: 'ライプツィヒ (Leipzig), ヴェネツィア (Venice). Chiefly in German and Italian names.' },
  { s: 'tse', r: 'tse', g: 'ツェ', derives: ['tsu', 'e'], v: ['tse', 'tuxe'],
    hn: 'ツェッペリン (Zeppelin), コンツェルン (Konzern). Chiefly in German names and terms.' },
  { s: 'tso', r: 'tso', g: 'ツォ', derives: ['tsu', 'o'], v: ['tso', 'tuxo'],
    hn: 'カンツォーネ (canzone), ピッツォ. Chiefly in Italian words.' },

  { s: 'kwa', r: 'kwa', g: 'クァ', derives: ['ku', 'a'], v: ['kwa', 'qa', 'kuxa'],
    hn: 'ク + small ァ for a foreign kwa: クァルテット (quartet). Most such words are written with a plain カ or クア instead (カルテット, クアラルンプール), so this spelling is uncommon.' },
  { s: 'kwa-wa', r: 'kwa', g: 'クヮ', derives: ['ku', 'wa'], v: ['kwa', 'kuxwa', 'kulwa'],
    hn: 'The same kwa sound written with a small ヮ instead of ァ. The older of the two spellings and now rare; you meet it in historical transcriptions and in Ryukyuan and dialect writing. Prefer クァ.' },
  { s: 'gwa', r: 'gwa', g: 'グァ', derives: ['gu', 'a'], v: ['gwa', 'guxa', 'gula'],
    hn: 'グァテマラ (Guatemala), グァム (Guam) — both also written グアテマラ, グアム with a full-size ア.' },

  { s: 'kye', r: 'kye', g: 'キェ', derives: ['ki', 'e'], v: ['kye', 'kixe'],
    hn: 'Marginal. Used in transcription of foreign names: キェルケゴール (Kierkegaard), also written キルケゴール. No everyday loanword uses it.' },
  { s: 'nye', r: 'nye', g: 'ニェ', derives: ['ni', 'e'], v: ['nye', 'nixe'],
    hn: 'Marginal. It appears only in ad-hoc transcription of Slavic and Romance names; no established loanword uses it, and this inventory does not claim a standard example.' },
  { s: 'hye', r: 'hye', g: 'ヒェ', derives: ['hi', 'e'], v: ['hye', 'hixe'],
    hn: 'Marginal. Occasional in foreign-name transcription (most such names use ヒエ instead); no established loanword uses it.' },
  { s: 'mye', r: 'mye', g: 'ミェ', derives: ['mi', 'e'], v: ['mye', 'mixe'],
    hn: 'Marginal. Occasional in Slavic name transcription; no established loanword uses it.' },
  { s: 'rye', r: 'rye', g: 'リェ', derives: ['ri', 'e'], v: ['rye', 'rixe'],
    hn: 'Marginal. Occasional in Slavic name transcription; no established loanword uses it.' },
];

// ---------------------------------------------------------------------------
// AUTHORED TABLE 6 — historical kana, off the beginner path
// ---------------------------------------------------------------------------

const HISTORICAL = [
  { s: 'wi-historical', r: 'wi', h: 'ゐ', k: 'ヰ', v: ['wi', 'wyi'],
    hn: 'Historical kana for wi. Its sound merged with い centuries ago, and the 1946 spelling reform removed it from ordinary use. You meet it in pre-war texts and in classical Japanese — never in modern spelling.',
    kn: 'Historical katakana for wi, removed from ordinary use by the 1946 spelling reform. It survives in a few company and product names (the farm-machinery maker ヰセキ). Modern loanwords write this sound ウィ.' },
  { s: 'we-historical', r: 'we', h: 'ゑ', k: 'ヱ', v: ['we', 'wye'],
    hn: 'Historical kana for we. Its sound merged with え, and the 1946 reform removed it from ordinary use. Pre-war texts and classical Japanese only.',
    kn: 'Historical katakana for we, removed from ordinary use by the 1946 reform. Best known from the beer brand ヱビス (Yebisu). Modern loanwords write this sound ウェ.' },
];

// ---------------------------------------------------------------------------
// AUTHORED TABLE 7 — learner confusion pairs
// ---------------------------------------------------------------------------
// Symmetric: the builder writes both directions. Pairs are given as slugs
// within a script, or as explicit ids for cross-script pairs.
// Every pair below is a shape or spelling confusion that learners actually
// make; none is included merely to fill the table.

/** Shape confusions among hiragana. */
const CONFUSE_HI = [
  ['ne', 're'], ['ne', 'wa'], ['re', 'wa'], ['ne', 'nu'],
  ['nu', 'me'], ['nu', 'ru'], ['ru', 'ro'],
  ['sa', 'ki'], ['sa', 'chi'], ['chi', 'ra'],
  ['i', 'ri'], ['a', 'o'], ['o', 'wo'], ['a', 'me'],
  ['tsu', 'u'], ['shi', 'tsu'], ['ku', 'he'],
  ['ta', 'na'], ['ma', 'mo'], ['ha', 'ho'], ['ha', 'ke'],
  // spelling choices that sound identical
  ['ji', 'di'], ['zu', 'du'],
  // two dots against a small circle
  ['ba', 'pa'], ['bi', 'pi'], ['bu', 'pu'], ['be', 'pe'], ['bo', 'po'],
  // small against full size
  ['sokuon', 'tsu'], ['small-ya', 'ya'], ['small-yu', 'yu'], ['small-yo', 'yo'],
  ['small-a', 'a'], ['small-i', 'i'], ['small-u', 'u'], ['small-e', 'e'], ['small-o', 'o'],
  // historical forms against the kana that absorbed them
  ['wi-historical', 'i'], ['we-historical', 'e'], ['wi-historical', 'we-historical'],
];

/** Shape confusions among katakana. */
const CONFUSE_KA = [
  ['shi', 'tsu'], ['shi', 'so'], ['so', 'n'], ['tsu', 'n'], ['no', 'so'],
  ['no', 're'], ['ru', 're'],
  ['ku', 'wa'], ['ku', 'ke'], ['ku', 'ta'], ['wa', 'u'], ['ra', 'u'], ['fu', 'wa'],
  ['su', 'nu'], ['nu', 'me'], ['me', 'na'], ['me', 'mu'], ['ma', 'mu'], ['ma', 'a'],
  ['a', 'ya'], ['chi', 'te'], ['ko', 'yu'], ['yu', 'e'], ['ni', 'e'],
  ['ha', 'he'], ['ne', 'ho'],
  ['ji', 'di'], ['zu', 'du'],
  ['ba', 'pa'], ['bi', 'pi'], ['bu', 'pu'], ['be', 'pe'], ['bo', 'po'],
  ['sokuon', 'tsu'], ['small-ya', 'ya'], ['small-yu', 'yu'], ['small-yo', 'yo'],
  ['small-a', 'a'], ['small-i', 'i'], ['small-u', 'u'], ['small-e', 'e'], ['small-o', 'o'],
  ['wi-historical', 'i'], ['we-historical', 'e'], ['wi-historical', 'we-historical'],
  // extended spellings against the native kana they compete with
  ['wi', 'wi-historical'], ['we', 'we-historical'], ['wo-ext', 'wo'],
  ['va', 'ba'], ['vi', 'bi'], ['vu', 'bu'], ['ve', 'be'], ['vo', 'bo'],
  ['ti', 'chi'], ['tu', 'tsu'], ['di', 'ji'], ['fa', 'ha'],
];

/** Cross-script pairs: near-identical shapes, or the same sound in both scripts. */
const CONFUSE_CROSS = [
  ['he', 'he'], ['ri', 'ri'], ['ka', 'ka'], ['se', 'se'], ['mo', 'mo'],
  ['ya', 'ya'], ['i', 'i'], ['u', 'u'],
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const records = [];
const bySlug = { hi: new Map(), ka: new Map() };

const prefix = (script) => (script === 'hiragana' ? 'hi' : 'ka');
const idOf = (script, slug) => `kana:${prefix(script)}:${slug}`;

function add(rec) {
  const glyph = rec.glyph.normalize('NFC');
  const full = {
    id: idOf(rec.script, rec.slug),
    kind: 'kana',
    script: rec.script,
    glyph,
    romaji: rec.romaji,
    inputVariants: dedupe(rec.inputVariants),
    group: rec.group,
    tier: rec.tier,
    position: rec.position ?? null,
    derivesFrom: (rec.derivesFrom ?? []).map((slug) => idOf(rec.script, slug)),
    confusableWith: [],
    strokeCount: strokesOf(glyph),
    printVsHandwritten: rec.printVsHandwritten ?? null,
    note: rec.note ?? null,
    teachingOrder: 0, // assigned from the lesson plan
    lessonId: '', // assigned from the lesson plan
    _slug: rec.slug,
  };
  const key = prefix(rec.script);
  if (bySlug[key].has(rec.slug)) throw new Error(`Duplicate slug ${full.id}`);
  bySlug[key].set(rec.slug, full);
  records.push(full);
  return full;
}

const dedupe = (xs) => [...new Set(xs)];

const SCRIPTS = [
  { script: 'hiragana', pick: 'h', note: 'hn', pvh: 'hp' },
  { script: 'katakana', pick: 'k', note: 'kn', pvh: 'kp' },
];

// -- basic 46 -----------------------------------------------------------------
for (const sc of SCRIPTS) {
  for (const e of BASIC) {
    add({
      script: sc.script,
      slug: e.s,
      glyph: e[sc.pick],
      romaji: e.r,
      inputVariants: e.v,
      group: 'basic',
      tier: 'modern-core',
      position: e.row === null ? null : { row: e.row, column: e.col },
      derivesFrom: [],
      printVsHandwritten: e[sc.pvh] ?? null,
      note: e[sc.note] ?? null,
    });
  }
}

// -- special / small kana -----------------------------------------------------
for (const sc of SCRIPTS) {
  const hira = sc.script === 'hiragana';
  add({
    script: sc.script,
    slug: 'sokuon',
    glyph: hira ? 'っ' : 'ッ',
    romaji: '(sokuon)',
    inputVariants: ['xtu', 'ltu', 'xtsu', 'ltsu'],
    group: 'special',
    tier: 'modern-core',
    derivesFrom: ['tsu'],
    note: hira ? SOKUON_NOTE_HI : SOKUON_NOTE_KA,
  });
  if (!hira) {
    add({
      script: 'katakana',
      slug: 'chouonpu',
      glyph: 'ー',
      romaji: '(long vowel)',
      inputVariants: ['-'],
      group: 'special',
      tier: 'modern-core',
      derivesFrom: [],
      note: CHOONPU_NOTE,
    });
  }
  for (const e of SMALL_Y) {
    add({
      script: sc.script,
      slug: e.s,
      glyph: e[sc.pick],
      romaji: e.r,
      inputVariants: e.v,
      group: 'special',
      tier: 'extended',
      derivesFrom: [e.base],
      note: `Small ${e[sc.pick]}. It is not written on its own in ordinary Japanese: it exists to build the contracted ${hira ? 'きゃ / しゅ / ちょ' : 'キャ / シュ / チョ'} syllables, where it merges with the kana before it into one beat. Typed ${e.v[0]}.`,
    });
  }
  for (const e of SMALL_VOWELS) {
    add({
      script: sc.script,
      slug: e.s,
      glyph: e[sc.pick],
      romaji: e.r,
      inputVariants: e.v,
      group: 'special',
      tier: 'extended',
      derivesFrom: [e.base],
      note: hira
        ? `Small ${e.h}. Hiragana almost never uses it: you meet it in written-out speech (あぁ) and in transcriptions. The katakana ${e.k} is the one that matters, because it builds ファ, ティ, ウィ and friends. Typed ${e.v[0]}.`
        : `Small ${e.k}. Not a syllable on its own — it combines with the kana before it to write sounds Japanese has no kana for: フ + ${e.k} in ファ / フィ / フェ / フォ, テ + ィ in ティ. Typed ${e.v[0]}.`,
    });
  }
}

// -- dakuten / handakuten ----------------------------------------------------
for (const sc of SCRIPTS) {
  const mark = (slug, combining) => {
    const base = bySlug[prefix(sc.script)].get(slug);
    if (!base) throw new Error(`No base kana ${slug} for ${sc.script}`);
    return (base.glyph + combining).normalize('NFC');
  };
  for (const e of DAKUTEN) {
    add({
      script: sc.script,
      slug: e.s,
      glyph: mark(e.base, '゙'),
      romaji: e.r,
      inputVariants: e.v,
      group: 'dakuten',
      tier: 'modern-core',
      position: { row: e.row, column: e.col },
      derivesFrom: [e.base],
      note: e.hn ?? null,
    });
  }
  for (const e of HANDAKUTEN) {
    add({
      script: sc.script,
      slug: e.s,
      glyph: mark(e.base, '゚'),
      romaji: e.r,
      inputVariants: e.v,
      group: 'handakuten',
      tier: 'modern-core',
      position: { row: e.row, column: e.col },
      derivesFrom: [e.base],
      note: e.hn ?? null,
    });
  }
}

// -- youon -------------------------------------------------------------------
const SMALL_GLYPH = {
  hiragana: { ya: 'ゃ', yu: 'ゅ', yo: 'ょ' },
  katakana: { ya: 'ャ', yu: 'ュ', yo: 'ョ' },
};
for (const sc of SCRIPTS) {
  for (const e of YOON) {
    const base = bySlug[prefix(sc.script)].get(e.base);
    add({
      script: sc.script,
      slug: e.s,
      glyph: base.glyph + SMALL_GLYPH[sc.script][e.small],
      romaji: e.r,
      inputVariants: e.v,
      group: 'yoon',
      tier: e.tier ?? 'modern-core',
      position: null,
      derivesFrom: [e.base, e.small],
      note: e.hn ?? null,
    });
  }
}

// -- extended katakana -------------------------------------------------------
for (const e of EXTENDED) {
  add({
    script: 'katakana',
    slug: e.s,
    glyph: e.g,
    romaji: e.r,
    inputVariants: e.v,
    group: 'extended',
    tier: 'extended',
    position: null,
    derivesFrom: e.derives,
    note: e.hn,
  });
}

// -- historical --------------------------------------------------------------
for (const sc of SCRIPTS) {
  for (const e of HISTORICAL) {
    add({
      script: sc.script,
      slug: e.s,
      glyph: e[sc.pick],
      romaji: e.r,
      inputVariants: e.v,
      group: 'historical',
      tier: 'historical',
      position: null,
      derivesFrom: [],
      note: e[sc.note],
    });
  }
}

// ---------------------------------------------------------------------------
// Confusion pairs, expanded symmetrically
// ---------------------------------------------------------------------------

function link(idA, idB) {
  const a = records.find((r) => r.id === idA);
  const b = records.find((r) => r.id === idB);
  if (!a) throw new Error(`Confusable pair refers to unknown id ${idA}`);
  if (!b) throw new Error(`Confusable pair refers to unknown id ${idB}`);
  if (a === b) throw new Error(`Confusable pair links ${idA} to itself`);
  if (!a.confusableWith.includes(b.id)) a.confusableWith.push(b.id);
  if (!b.confusableWith.includes(a.id)) b.confusableWith.push(a.id);
}
for (const [x, y] of CONFUSE_HI) link(idOf('hiragana', x), idOf('hiragana', y));
for (const [x, y] of CONFUSE_KA) link(idOf('katakana', x), idOf('katakana', y));
for (const [x, y] of CONFUSE_CROSS) link(idOf('hiragana', x), idOf('katakana', y));

// ---------------------------------------------------------------------------
// AUTHORED TABLE 8 — the lesson plan (also fixes global teaching order)
// ---------------------------------------------------------------------------
// Order: hiragana vowels, the k/s/t/n/h/m/y/r/w rows (ん closes the w row, as
// it does in the gojuon table), the small kana, the voiced rows, the youon;
// then the whole katakana sequence the same way, then extended katakana;
// historical kana last, off the beginner path.

const plan = [];
function lesson(id, title, script, note, script2 = null) {
  const l = { id, title, script, note, members: [], prerequisites: [] };
  plan.push(l);
  return l;
}
/** Collect records by slug within a script, in the order given. */
function membersOf(script, slugs) {
  return slugs.map((s) => {
    const r = bySlug[prefix(script)].get(s);
    if (!r) throw new Error(`Lesson refers to unknown ${script} slug ${s}`);
    return r;
  });
}

const ROWS = {
  '': ['a', 'i', 'u', 'e', 'o'],
  k: ['ka', 'ki', 'ku', 'ke', 'ko'],
  s: ['sa', 'shi', 'su', 'se', 'so'],
  t: ['ta', 'chi', 'tsu', 'te', 'to'],
  n: ['na', 'ni', 'nu', 'ne', 'no'],
  h: ['ha', 'hi', 'fu', 'he', 'ho'],
  m: ['ma', 'mi', 'mu', 'me', 'mo'],
  y: ['ya', 'yu', 'yo'],
  r: ['ra', 'ri', 'ru', 're', 'ro'],
  w: ['wa', 'wo', 'n'],
  g: ['ga', 'gi', 'gu', 'ge', 'go'],
  z: ['za', 'ji', 'zu', 'ze', 'zo'],
  d: ['da', 'di', 'du', 'de', 'do'],
  b: ['ba', 'bi', 'bu', 'be', 'bo'],
  p: ['pa', 'pi', 'pu', 'pe', 'po'],
};
const YOON_SETS = [
  ['k', ['kya', 'kyu', 'kyo']],
  ['s', ['sha', 'shu', 'sho']],
  ['t', ['cha', 'chu', 'cho']],
  ['n', ['nya', 'nyu', 'nyo']],
  ['h', ['hya', 'hyu', 'hyo']],
  ['m', ['mya', 'myu', 'myo']],
  ['r', ['rya', 'ryu', 'ryo']],
  ['g', ['gya', 'gyu', 'gyo']],
  ['z', ['ja', 'ju', 'jo']],
  ['b', ['bya', 'byu', 'byo']],
  ['p', ['pya', 'pyu', 'pyo']],
  ['d', ['dya', 'dyu', 'dyo']],
];

const ROW_LABEL_HI = { '': 'あ', k: 'か', s: 'さ', t: 'た', n: 'な', h: 'は', m: 'ま', y: 'や', r: 'ら', w: 'わ', g: 'が', z: 'ざ', d: 'だ', b: 'ば', p: 'ぱ' };
const ROW_LABEL_KA = { '': 'ア', k: 'カ', s: 'サ', t: 'タ', n: 'ナ', h: 'ハ', m: 'マ', y: 'ヤ', r: 'ラ', w: 'ワ', g: 'ガ', z: 'ザ', d: 'ダ', b: 'バ', p: 'パ' };

const ROW_NOTE = {
  '': 'The five vowels. Every other kana is one of these with a consonant in front, so the five sounds a-i-u-e-o are the whole phonetic system in miniature. Japanese u is said with flat, unrounded lips.',
  k: null,
  s: 'Watch the i-column: し is shi, not "si".',
  t: 'Two irregular cells here: ち is chi and つ is tsu, not "ti" and "tu".',
  n: null,
  h: 'ふ is fu, not "hu" — the consonant is lighter than an English f, made with the lips alone. は has a second life as the topic particle, where it is pronounced "wa".',
  m: null,
  y: 'Only three cells: yi and ye do not exist in modern Japanese.',
  r: 'One tapped consonant for the whole row, between an English r and l.',
  w: 'A three-cell row, and the only one with leftovers: わ is a normal syllable, を survives only as the object particle (pronounced "o"), and ん is a consonant on its own.',
  g: 'The か row with two dots. Voiced kana are never new shapes — learn the mark, not ten more characters.',
  z: 'じ is ji. ぢ in the だ row sounds the same but is almost never the right spelling.',
  d: 'ぢ and づ sound exactly like じ and ず. They appear only where a ち or つ is voiced inside a word (ちぢむ, つづく).',
  b: null,
  p: 'The only row that uses the small circle (handakuten) instead of two dots.',
};

const VOICED_ROWS = ['g', 'z', 'd', 'b', 'p'];
const BASIC_ROWS = ['', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w'];

function buildScriptPlan(script) {
  const p = prefix(script);
  const label = script === 'hiragana' ? ROW_LABEL_HI : ROW_LABEL_KA;
  const rowLesson = {};

  for (const row of BASIC_ROWS) {
    const id = `kana-${p}-row-${row === '' ? 'vowel' : row}`;
    const l = lesson(
      id,
      row === ''
        ? `${script === 'hiragana' ? 'Hiragana' : 'Katakana'}: the five vowels`
        : `${script === 'hiragana' ? 'Hiragana' : 'Katakana'}: the ${label[row]} row`,
      script,
      ROW_NOTE[row],
    );
    l.members = membersOf(script, ROWS[row]);
    rowLesson[row] = id;
  }

  // small kana: the mechanism behind sokuon and youon
  const smallId = `kana-${p}-small`;
  const smallL = lesson(
    smallId,
    script === 'hiragana'
      ? 'Hiragana: small っ, ゃ, ゅ, ょ'
      : 'Katakana: ー, small ッ, ャ, ュ, ョ',
    script,
    script === 'hiragana'
      ? 'Four half-size kana that change the beat rather than adding a sound: っ holds the next consonant, and ゃ/ゅ/ょ fuse with the kana before them. Size is the whole distinction — きや is two beats, きゃ is one.'
      : 'The marks that make katakana work for loanwords: ー lengthens the vowel before it, ッ doubles the next consonant, and ャ/ュ/ョ fuse into one beat. コーヒー, サッカー, キャベツ.',
  );
  smallL.members = script === 'hiragana'
    ? membersOf(script, ['sokuon', 'small-ya', 'small-yu', 'small-yo'])
    : membersOf(script, ['chouonpu', 'sokuon', 'small-ya', 'small-yu', 'small-yo']);

  const smallVowelId = `kana-${p}-small-vowels`;
  const svL = lesson(
    smallVowelId,
    script === 'hiragana' ? 'Hiragana: the small vowels ぁぃぅぇぉ' : 'Katakana: the small vowels ァィゥェォ',
    script,
    script === 'hiragana'
      ? 'Half-size vowels. Hiragana barely uses them; they are here so you recognise them, and because the katakana versions build every loanword sound Japanese lacks a kana for.'
      : 'Half-size vowels. These are the building blocks of ファ, ティ, ウィ and ヴォ: a full-size kana keeps its consonant and borrows the small vowel.',
  );
  svL.members = membersOf(script, SMALL_VOWELS.map((e) => e.s));

  for (const row of VOICED_ROWS) {
    const id = `kana-${p}-row-${row}`;
    const l = lesson(
      id,
      `${script === 'hiragana' ? 'Hiragana' : 'Katakana'}: the ${label[row]} row`,
      script,
      ROW_NOTE[row],
    );
    l.members = membersOf(script, ROWS[row]);
    rowLesson[row] = id;
  }

  for (const [row, slugs] of YOON_SETS) {
    const id = `kana-${p}-yoon-${row}`;
    const glyphs = membersOf(script, slugs);
    const l = lesson(
      id,
      `${script === 'hiragana' ? 'Hiragana' : 'Katakana'}: ${glyphs.map((g) => g.glyph).join(' ')}`,
      script,
      row === 'd'
        ? 'Rare forms, included only so you can read them. They sound exactly like the じゃ set and are practically never the right spelling.'
        : null,
    );
    l.members = glyphs;
  }

  return { rowLesson, smallId, smallVowelId };
}

const hiPlan = buildScriptPlan('hiragana');
const kaPlan = buildScriptPlan('katakana');

// extended katakana lessons
const EXT_LESSONS = [
  ['kana-ka-ext-f', 'Katakana extended: ファ フィ フェ フォ', ['fa', 'fi', 'fe', 'fo'], 'h',
    'Japanese has only ふ in the h-row u-column, so every foreign f sound is built on フ plus a small vowel.'],
  ['kana-ka-ext-t', 'Katakana extended: ティ ディ トゥ ドゥ', ['ti', 'di', 'tu', 'du'], 't',
    'The t/d row has no ti, tu, di or du cell — ち, つ, ぢ, づ sit there instead. Loanwords rebuild the missing sounds with テ, デ, ト, ド plus a small vowel. Note the IME keys: thi, dhi, twu, dwu.'],
  ['kana-ka-ext-w', 'Katakana extended: ウィ ウェ ウォ', ['wi', 'we', 'wo-ext'], '',
    'The w-row lost wi, we and wo. Modern loanwords write them with ウ plus a small vowel, not with the historical ヰ, ヱ, ヲ.'],
  ['kana-ka-ext-v', 'Katakana extended: ヴ ヴァ ヴィ ヴェ ヴォ', ['vu', 'va', 'vi', 've', 'vo'], '',
    'ウ with dakuten writes a foreign v. Read it, but know that the b-row spelling (バイオリン) is now standard and far more common.'],
  ['kana-ka-ext-e', 'Katakana extended: シェ ジェ チェ', ['she', 'je', 'che'], 's',
    'し, じ and ち have no e-column cell. A small ェ supplies one, and these three are the most frequent extended combinations in everyday loanwords.'],
  ['kana-ka-ext-ts', 'Katakana extended: ツァ ツィ ツェ ツォ', ['tsa', 'tsi', 'tse', 'tso'], 't',
    'ツ plus a small vowel, mostly for German and Italian names and terms.'],
  ['kana-ka-ext-kw', 'Katakana extended: クァ クヮ グァ', ['kwa', 'kwa-wa', 'gwa'], 'k',
    'kwa and gwa, which Japanese lost long ago. Most words now avoid them (カルテット, グアム), so treat these as reading knowledge.'],
  ['kana-ka-ext-ye', 'Katakana extended: キェ ニェ ヒェ ミェ リェ', ['kye', 'nye', 'hye', 'mye', 'rye'], '',
    'The far edge of the katakana system: consonant + small ェ forms that occur only in transcription of foreign names. Included for completeness, not for production.'],
];
for (const [id, title, slugs, , note] of EXT_LESSONS) {
  const l = lesson(id, title, 'katakana', note);
  l.members = membersOf('katakana', slugs);
}

// historical, both scripts together, last
const histL = lesson(
  'kana-historical',
  'Historical kana: ゐ ゑ ヰ ヱ',
  'mixed',
  'Off the beginner path. These four were retired from ordinary use by the 1946 spelling reform; their sounds merged with い and え. Learn to recognise them for old signage, pre-war text and brand names such as ヱビス — you will never need to write them.',
);
histL.members = [
  ...membersOf('hiragana', ['wi-historical', 'we-historical']),
  ...membersOf('katakana', ['wi-historical', 'we-historical']),
];

// -- prerequisites -----------------------------------------------------------
const planById = new Map(plan.map((l) => [l.id, l]));
function requires(id, ...deps) {
  const l = planById.get(id);
  if (!l) throw new Error(`Unknown lesson ${id}`);
  for (const d of deps) {
    if (!planById.has(d)) throw new Error(`Lesson ${id} requires unknown lesson ${d}`);
    if (!l.prerequisites.includes(d)) l.prerequisites.push(d);
  }
}
// hiragana basic rows chain
for (let i = 1; i < BASIC_ROWS.length; i += 1) {
  requires(`kana-hi-row-${BASIC_ROWS[i] === '' ? 'vowel' : BASIC_ROWS[i]}`, `kana-hi-row-${BASIC_ROWS[i - 1] === '' ? 'vowel' : BASIC_ROWS[i - 1]}`);
}
requires('kana-hi-small', 'kana-hi-row-w', 'kana-hi-row-t', 'kana-hi-row-y');
requires('kana-hi-small-vowels', 'kana-hi-small');
for (const [voiced, base] of [['g', 'k'], ['z', 's'], ['d', 't'], ['b', 'h'], ['p', 'h']]) {
  requires(`kana-hi-row-${voiced}`, `kana-hi-row-${base}`);
}
requires('kana-hi-row-p', 'kana-hi-row-b');
for (const [row] of YOON_SETS) {
  requires(`kana-hi-yoon-${row}`, 'kana-hi-small', `kana-hi-row-${row === '' ? 'vowel' : row}`);
}
// katakana: each row after the matching hiragana row, and after the previous katakana row
requires('kana-ka-row-vowel', 'kana-hi-row-w', 'kana-hi-row-vowel');
for (let i = 1; i < BASIC_ROWS.length; i += 1) {
  const cur = BASIC_ROWS[i] === '' ? 'vowel' : BASIC_ROWS[i];
  const prev = BASIC_ROWS[i - 1] === '' ? 'vowel' : BASIC_ROWS[i - 1];
  requires(`kana-ka-row-${cur}`, `kana-ka-row-${prev}`, `kana-hi-row-${cur}`);
}
requires('kana-ka-small', 'kana-ka-row-w', 'kana-hi-small');
requires('kana-ka-small-vowels', 'kana-ka-small', 'kana-hi-small-vowels');
for (const [voiced, base] of [['g', 'k'], ['z', 's'], ['d', 't'], ['b', 'h'], ['p', 'h']]) {
  requires(`kana-ka-row-${voiced}`, `kana-ka-row-${base}`, `kana-hi-row-${voiced}`);
}
requires('kana-ka-row-p', 'kana-ka-row-b');
for (const [row] of YOON_SETS) {
  requires(`kana-ka-yoon-${row}`, 'kana-ka-small', `kana-ka-row-${row === '' ? 'vowel' : row}`, `kana-hi-yoon-${row}`);
}
for (const [id, , , baseRow] of EXT_LESSONS) {
  requires(id, 'kana-ka-small-vowels');
  if (baseRow !== '') requires(id, `kana-ka-row-${baseRow}`);
}
requires('kana-ka-ext-v', 'kana-ka-row-vowel', 'kana-ka-row-b');
requires('kana-ka-ext-w', 'kana-ka-row-w');
requires('kana-ka-ext-ye', 'kana-ka-row-k', 'kana-ka-row-n', 'kana-ka-row-h', 'kana-ka-row-m', 'kana-ka-row-r');
requires('kana-historical', 'kana-hi-row-w', 'kana-ka-row-w');

// -- assign teachingOrder + lessonId ----------------------------------------
let order = 0;
const lessons = plan.map((l, i) => {
  for (const rec of l.members) {
    if (rec.teachingOrder !== 0) throw new Error(`${rec.id} appears in more than one lesson`);
    order += 1;
    rec.teachingOrder = order;
    rec.lessonId = l.id;
  }
  return {
    id: l.id,
    title: l.title,
    script: l.script,
    introduces: l.members.map((r) => r.id),
    prerequisites: l.prerequisites,
    note: l.note,
    order: i + 1,
  };
});

// ---------------------------------------------------------------------------
// Assertions — the script refuses to write output it cannot vouch for
// ---------------------------------------------------------------------------

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

const ids = new Set();
for (const r of records) {
  check(!ids.has(r.id), `duplicate id ${r.id}`);
  ids.add(r.id);
  check(ID_PATTERN.test(r.id), `id does not match ID_PATTERN: ${r.id}`);
  check(r.glyph === r.glyph.normalize('NFC'), `glyph not NFC: ${r.id}`);
  check(r.teachingOrder > 0, `${r.id} was never placed in a lesson`);
  check(r.lessonId !== '', `${r.id} has no lessonId`);
  check(r.strokeCount > 0, `${r.id} has no stroke count`);
  check(r.inputVariants.length > 0, `${r.id} has no input variants`);
  for (const v of r.inputVariants) check(v === v.toLowerCase(), `${r.id} input variant not lowercase: ${v}`);
  const needsPosition = r.group === 'basic' || r.group === 'dakuten' || r.group === 'handakuten';
  if (needsPosition && r._slug !== 'n') check(r.position !== null, `${r.id} should have a gojuon position`);
  if (!needsPosition) check(r.position === null, `${r.id} should not have a gojuon position`);
}
for (const r of records) {
  for (const d of r.derivesFrom) check(ids.has(d), `${r.id} derivesFrom unknown id ${d}`);
  for (const c of r.confusableWith) {
    check(ids.has(c), `${r.id} confusableWith unknown id ${c}`);
    const other = records.find((x) => x.id === c);
    check(other && other.confusableWith.includes(r.id), `confusable pair not symmetric: ${r.id} -> ${c}`);
  }
}
const orders = records.map((r) => r.teachingOrder).sort((a, b) => a - b);
check(orders.length === new Set(orders).size, 'teachingOrder has duplicates');
for (let i = 0; i < orders.length; i += 1) check(orders[i] === i + 1, `teachingOrder is not dense at ${orders[i]}`);

const count = (pred) => records.filter(pred).length;
const basicHi = count((r) => r.script === 'hiragana' && r.group === 'basic');
const basicKa = count((r) => r.script === 'katakana' && r.group === 'basic');
check(basicHi === 46, `expected 46 basic hiragana, got ${basicHi}`);
check(basicKa === 46, `expected 46 basic katakana, got ${basicKa}`);
for (const sc of ['hiragana', 'katakana']) {
  check(count((r) => r.script === sc && r.group === 'dakuten') === 20, `${sc} dakuten != 20`);
  check(count((r) => r.script === sc && r.group === 'handakuten') === 5, `${sc} handakuten != 5`);
  check(count((r) => r.script === sc && r.group === 'yoon' && r.tier === 'modern-core') === 33, `${sc} core yoon != 33`);
}
for (const l of lessons) {
  check(l.introduces.length >= 2, `lesson ${l.id} introduces fewer than 2 items`);
  check(l.introduces.length <= 5, `lesson ${l.id} introduces more than 5 items`);
}
check(lessons.reduce((n, l) => n + l.introduces.length, 0) === records.length, 'lessons do not cover every record exactly once');

if (problems.length > 0) {
  console.error(`build-kana: ${problems.length} assertion failure(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

for (const r of records) delete r._slug;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const kanaPath = join(OUT_DIR, 'kana.json');
const lessonPath = join(OUT_DIR, 'kana-lessons.json');
const provPath = join(OUT_DIR, 'kana.provenance.json');

// Compact: this file is well over 100KB.
writeFileSync(kanaPath, JSON.stringify(records) + '\n');
writeFileSync(lessonPath, JSON.stringify(lessons, null, 2) + '\n');

const byGroup = {};
for (const r of records) {
  const k = `${r.script}/${r.group}/${r.tier}`;
  byGroup[k] = (byGroup[k] ?? 0) + 1;
}
const provenance = {
  schema: 'kansei-provenance/1',
  dataset: 'kana',
  files: ['data/kana.json', 'data/kana-lessons.json'],
  producedBy: 'scripts/content/build-kana.mjs',
  reproduce: [
    'node scripts/assets/fetch-sources.mjs',
    'unzip -q -o data/sources/kanjivg-20250816-main.zip -d data/sources/kanjivg',
    'node scripts/content/build-kana.mjs',
  ],
  deterministic: true,
  authored: {
    what: 'Every field except strokeCount: coverage, romaji, inputVariants, gojuon position, derivesFrom, confusableWith, printVsHandwritten, notes, teachingOrder, lessonId, lessons.',
    where: 'The tables at the top of scripts/content/build-kana.mjs (hand-authored curriculum source of truth, committed).',
    by: 'Kansei curriculum author',
    license: 'AGPL-3.0-or-later, as the rest of this repository',
  },
  sources: [
    {
      field: 'strokeCount',
      name: KANJIVG.project,
      version: KANJIVG.version,
      url: KANJIVG.url,
      license: KANJIVG.license,
      licenseUrl: KANJIVG.licenseUrl,
      redistribution:
        'CC BY-SA 3.0: redistribution and derivative works permitted with attribution to Ulrich Apel and the KanjiVG project; derived works share-alike. Only per-character stroke COUNTS are taken here (integers derived by counting <path> elements); no KanjiVG path data is copied into data/kana.json.',
      method: 'strokeCount = number of <path> elements in data/sources/kanjivg/kanji/<codepoint>.svg, summed over the code points of a multi-kana glyph. Voiced kana are single code points in KanjiVG, which counts the dakuten as 2 strokes and the handakuten as 1.',
    },
  ],
  counts: {
    records: records.length,
    lessons: lessons.length,
    byScriptGroupTier: byGroup,
  },
};
writeFileSync(provPath, JSON.stringify(provenance, null, 2) + '\n');

console.log(`build-kana: wrote ${records.length} kana records and ${lessons.length} lessons`);
for (const [k, v] of Object.entries(byGroup).sort()) console.log(`  ${k}: ${v}`);
console.log(`  -> ${kanaPath}`);
console.log(`  -> ${lessonPath}`);
console.log(`  -> ${provPath}`);
