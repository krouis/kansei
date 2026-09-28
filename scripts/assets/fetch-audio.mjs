#!/usr/bin/env node
/**
 * fetch-audio.mjs — build Kansei's native-speaker audio pack.
 *
 * ============================================================================
 * PRODUCT RULE THIS SCRIPT EXISTS TO ENFORCE
 * ============================================================================
 * Kansei never speaks to the learner with a synthesised voice. There is no
 * browser SpeechSynthesis fallback, no TTS render step, and no silent or
 * placeholder clip dressed up as a recording. A clip is either a real human
 * recording with a documented licence and a documented speaker, or the
 * `AudioRef` is `null` and the listening exercise is simply not generated.
 *
 * Consequently this script is allowed to produce PARTIAL coverage, and it
 * reports the gap loudly rather than filling it. See docs/content/AUDIO.md.
 *
 * ============================================================================
 * SOURCES
 * ============================================================================
 * 1. Wikimedia Commons — isolated kana syllables.
 *    A hand-authored candidate table (KANA_SOUNDS below) lists the real
 *    Commons filenames for each syllable. Naming on Commons is inconsistent
 *    ("Japanese ka.ogg", "Ja-Ka.oga", "Ja-ka.ogg"), so several candidates per
 *    sound are probed and the first acceptable one wins. Licence, uploader and
 *    duration come from prop=imageinfo, never from assumption.
 *
 * 2. Wikimedia Commons — Lingua Libre word recordings.
 *    Enumerated live with list=allimages&aiprefix=LL-Q5287 (jpn)- . Speaker
 *    proficiency is NOT on the Commons page; it is on the Lingua Libre wiki,
 *    so it is read from Lingua Libre's SPARQL endpoint: a speaker whose
 *    "language" (P4) statement for Japanese (Q389) carries the qualifier
 *    "language level" (P16) = "native" (Q15). Only those speakers are kept.
 *    This matters: the single largest Lingua Libre Japanese contributor is a
 *    self-declared BEGINNER, and shipping a beginner's pronunciation as a
 *    model would be worse than shipping nothing.
 *
 * Sources deliberately NOT used — see docs/content/AUDIO.md for detail:
 *   - Shtooka (shtooka.net) and swac-collections.org: both dead. shtooka.net
 *     now redirects to an unrelated commercial domain; do not fetch from it.
 *   - Any TTS engine, online or offline.
 *
 * ============================================================================
 * USAGE
 * ============================================================================
 *   node scripts/assets/fetch-audio.mjs [options]
 *
 *   --dry-run                 Resolve and report coverage; download nothing.
 *   --out <dir>               Output dir (default public/content/audio).
 *   --limit-words <n>         Cap word clips (for a quick smoke run).
 *   --allow-undocumented-speaker
 *                             Also keep clips whose speaker's nativeness is
 *                             not documented anywhere. OFF by default; when on,
 *                             each such clip still records
 *                             nativeSpeakerDocumented:false in the index.
 *   --skip-words / --skip-kana
 *
 * Exit code is 0 on partial coverage. Partial coverage is an expected,
 * honest outcome, not an error.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Politeness / configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');

const USER_AGENT =
  'KanseiContentBot/1.0 (offline-first Japanese writing PWA; +https://github.com/kansei/kansei; khalifa@missingno.tech) node-fetch';

/** Minimum gap between requests to one host, ms. Deliberately conservative. */
const RATE_LIMIT_MS = {
  'commons.wikimedia.org': 250,
  'lingualibre.org': 1000,
  'upload.wikimedia.org': 120,
};
const DEFAULT_RATE_LIMIT_MS = 500;

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const LINGUALIBRE_SPARQL = 'https://lingualibre.org/sparql';

/** Commons titles per API request. The API caps anonymous callers at 50. */
const TITLE_BATCH = 45;

// ---------------------------------------------------------------------------
// Licence policy
// ---------------------------------------------------------------------------

/**
 * Commons `extmetadata.License` slug → SPDX-ish id we record in AudioAttribution.
 * Anything not listed here is REJECTED, including every NC and ND variant and
 * every fair-use / non-free tag. Absence from this table is a rejection, not a
 * prompt to guess.
 */
const LICENSE_MAP = {
  pd: { spdx: 'PD', url: null, attributionRequired: false, shareAlike: false },
  'pd-self': { spdx: 'PD', url: null, attributionRequired: false, shareAlike: false },
  'cc0': { spdx: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false, shareAlike: false },
  'cc-by-1.0': { spdx: 'CC-BY-1.0', url: 'https://creativecommons.org/licenses/by/1.0/', attributionRequired: true, shareAlike: false },
  'cc-by-2.0': { spdx: 'CC-BY-2.0', url: 'https://creativecommons.org/licenses/by/2.0/', attributionRequired: true, shareAlike: false },
  'cc-by-2.5': { spdx: 'CC-BY-2.5', url: 'https://creativecommons.org/licenses/by/2.5/', attributionRequired: true, shareAlike: false },
  'cc-by-3.0': { spdx: 'CC-BY-3.0', url: 'https://creativecommons.org/licenses/by/3.0/', attributionRequired: true, shareAlike: false },
  'cc-by-4.0': { spdx: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true, shareAlike: false },
  'cc-by-sa-1.0': { spdx: 'CC-BY-SA-1.0', url: 'https://creativecommons.org/licenses/by-sa/1.0/', attributionRequired: true, shareAlike: true },
  'cc-by-sa-2.0': { spdx: 'CC-BY-SA-2.0', url: 'https://creativecommons.org/licenses/by-sa/2.0/', attributionRequired: true, shareAlike: true },
  'cc-by-sa-2.5': { spdx: 'CC-BY-SA-2.5', url: 'https://creativecommons.org/licenses/by-sa/2.5/', attributionRequired: true, shareAlike: true },
  'cc-by-sa-3.0': { spdx: 'CC-BY-SA-3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/', attributionRequired: true, shareAlike: true },
  'cc-by-sa-4.0': { spdx: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attributionRequired: true, shareAlike: true },
};

/** Preference order when several acceptable files exist for one sound. */
const LICENSE_PREFERENCE = ['PD', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'CC-BY-SA-3.0'];

// ---------------------------------------------------------------------------
// The 104 modern kana syllable sounds, with the Commons filenames to probe.
// ---------------------------------------------------------------------------
//
// `key` is the audio-index key segment: kana/hi/<key> and kana/ka/<key>.
// `hi`/`ka` are the glyphs, so the content build can join on the GLYPH and
// never has to guess which romanisation key the kana dataset chose.
// `group` mirrors KanaGroup in src/domain/content.ts.
//
// A single recording of an isolated syllable serves both scripts: あ and ア are
// the same sound. That is stated in docs/content/AUDIO.md rather than hidden.
//
// `candidates` are exact Commons titles, most-preferred first. An empty array
// means "surveyed Commons and found nothing" — see PROBED_NAME_PATTERNS.

/** Patterns probed exhaustively during the survey (2026-09-28). Kept so the */
/** "nothing exists" claim for yōon is falsifiable and re-checkable. */
const PROBED_NAME_PATTERNS = [
  'File:Japanese <romaji>.ogg',
  'File:Japanese <romaji>.oga',
  'File:Ja-<Romaji>.oga',
  'File:Ja-<Romaji>.ogg',
  'intitle:<kana> filetype:audio (e.g. intitle:きゃ)',
];

const KANA_SOUNDS = [
  // --- 5 vowels -----------------------------------------------------------
  { key: 'a', hi: 'あ', ka: 'ア', group: 'basic', candidates: ['File:Japanese A.ogg', 'File:Ja-A.oga'] },
  { key: 'i', hi: 'い', ka: 'イ', group: 'basic', candidates: ['File:Japanese I.ogg'] },
  { key: 'u', hi: 'う', ka: 'ウ', group: 'basic', candidates: ['File:Japanese U.ogg', 'File:Ja-U.oga'] },
  { key: 'e', hi: 'え', ka: 'エ', group: 'basic', candidates: ['File:Japanese E.ogg', 'File:Ja-E.oga'] },
  { key: 'o', hi: 'お', ka: 'オ', group: 'basic', candidates: ['File:Japanese O.ogg', 'File:Ja-O.oga'] },
  // --- k ------------------------------------------------------------------
  { key: 'ka', hi: 'か', ka: 'カ', group: 'basic', candidates: ['File:Japanese ka.ogg', 'File:Ja-Ka.oga', 'File:Ja-ka.ogg'] },
  { key: 'ki', hi: 'き', ka: 'キ', group: 'basic', candidates: ['File:Japanese ki.ogg'] },
  { key: 'ku', hi: 'く', ka: 'ク', group: 'basic', candidates: ['File:Japanese ku.ogg'] },
  { key: 'ke', hi: 'け', ka: 'ケ', group: 'basic', candidates: ['File:Japanese ke.ogg', 'File:Ja-ke.ogg'] },
  { key: 'ko', hi: 'こ', ka: 'コ', group: 'basic', candidates: ['File:Japanese ko.ogg'] },
  // --- s ------------------------------------------------------------------
  { key: 'sa', hi: 'さ', ka: 'サ', group: 'basic', candidates: ['File:Japanese sa.ogg'] },
  { key: 'shi', hi: 'し', ka: 'シ', group: 'basic', candidates: ['File:Japanese shi.ogg', 'File:Ja-Shi.oga'] },
  { key: 'su', hi: 'す', ka: 'ス', group: 'basic', candidates: ['File:Japanese su.ogg', 'File:Ja-su.ogg'] },
  { key: 'se', hi: 'せ', ka: 'セ', group: 'basic', candidates: ['File:Japanese se.ogg'] },
  { key: 'so', hi: 'そ', ka: 'ソ', group: 'basic', candidates: ['File:Japanese so.ogg', 'File:Ja-So.oga'] },
  // --- t ------------------------------------------------------------------
  { key: 'ta', hi: 'た', ka: 'タ', group: 'basic', candidates: ['File:Japanese ta.ogg', 'File:Ja-ta.ogg'] },
  { key: 'chi', hi: 'ち', ka: 'チ', group: 'basic', candidates: ['File:Japanese chi.ogg', 'File:Japanese ti.ogg', 'File:Ja-Chi.oga'] },
  { key: 'tsu', hi: 'つ', ka: 'ツ', group: 'basic', candidates: ['File:Japanese tsu.ogg', 'File:Ja-Tsu.oga'] },
  { key: 'te', hi: 'て', ka: 'テ', group: 'basic', candidates: ['File:Japanese te.ogg', 'File:Ja-te.ogg'] },
  { key: 'to', hi: 'と', ka: 'ト', group: 'basic', candidates: ['File:Japanese to.ogg'] },
  // --- n ------------------------------------------------------------------
  { key: 'na', hi: 'な', ka: 'ナ', group: 'basic', candidates: ['File:Japanese na.ogg', 'File:Ja-na.ogg'] },
  { key: 'ni', hi: 'に', ka: 'ニ', group: 'basic', candidates: ['File:Japanese ni.ogg'] },
  { key: 'nu', hi: 'ぬ', ka: 'ヌ', group: 'basic', candidates: ['File:Japanese nu.ogg'] },
  { key: 'ne', hi: 'ね', ka: 'ネ', group: 'basic', candidates: ['File:Japanese ne.ogg'] },
  { key: 'no', hi: 'の', ka: 'ノ', group: 'basic', candidates: ['File:Japanese no.ogg'] },
  // --- h ------------------------------------------------------------------
  { key: 'ha', hi: 'は', ka: 'ハ', group: 'basic', candidates: ['File:Japanese ha.ogg'] },
  { key: 'hi', hi: 'ひ', ka: 'ヒ', group: 'basic', candidates: ['File:Japanese hi.ogg', 'File:Ja-Hi.oga'] },
  { key: 'fu', hi: 'ふ', ka: 'フ', group: 'basic', candidates: ['File:Japanese hu.ogg', 'File:Ja-Fu.oga'] },
  { key: 'he', hi: 'へ', ka: 'ヘ', group: 'basic', candidates: ['File:Japanese he.ogg'] },
  { key: 'ho', hi: 'ほ', ka: 'ホ', group: 'basic', candidates: ['File:Japanese ho.ogg'] },
  // --- m ------------------------------------------------------------------
  { key: 'ma', hi: 'ま', ka: 'マ', group: 'basic', candidates: ['File:Japanese ma.ogg'] },
  { key: 'mi', hi: 'み', ka: 'ミ', group: 'basic', candidates: ['File:Japanese mi.ogg'] },
  { key: 'mu', hi: 'む', ka: 'ム', group: 'basic', candidates: ['File:Japanese mu.ogg'] },
  { key: 'me', hi: 'め', ka: 'メ', group: 'basic', candidates: ['File:Japanese me.ogg'] },
  { key: 'mo', hi: 'も', ka: 'モ', group: 'basic', candidates: ['File:Japanese mo.ogg'] },
  // --- y ------------------------------------------------------------------
  { key: 'ya', hi: 'や', ka: 'ヤ', group: 'basic', candidates: ['File:Japanese ya.ogg'] },
  { key: 'yu', hi: 'ゆ', ka: 'ユ', group: 'basic', candidates: ['File:Japanese yu.ogg'] },
  { key: 'yo', hi: 'よ', ka: 'ヨ', group: 'basic', candidates: ['File:Japanese yo.ogg'] },
  // --- r ------------------------------------------------------------------
  { key: 'ra', hi: 'ら', ka: 'ラ', group: 'basic', candidates: ['File:Japanese ra.ogg', 'File:Ja-Ra.oga'] },
  { key: 'ri', hi: 'り', ka: 'リ', group: 'basic', candidates: ['File:Japanese ri.ogg', 'File:Ja-Ri.oga'] },
  { key: 'ru', hi: 'る', ka: 'ル', group: 'basic', candidates: ['File:Japanese ru.ogg', 'File:Ja-Ru.oga'] },
  { key: 're', hi: 'れ', ka: 'レ', group: 'basic', candidates: ['File:Japanese re.ogg', 'File:Ja-Re.oga'] },
  { key: 'ro', hi: 'ろ', ka: 'ロ', group: 'basic', candidates: ['File:Japanese ro.ogg', 'File:Ja-Ro.oga'] },
  // --- w, moraic n --------------------------------------------------------
  { key: 'wa', hi: 'わ', ka: 'ワ', group: 'basic', candidates: ['File:Japanese wa.ogg'] },
  {
    key: 'wo',
    hi: 'を',
    ka: 'ヲ',
    group: 'basic',
    candidates: ['File:Japanese wo.ogg'],
    note: 'を is pronounced identically to お. Audio alone cannot distinguish them — see HOMOPHONOUS_KANA_SETS in src/domain/romanization.ts.',
  },
  { key: 'n', hi: 'ん', ka: 'ン', group: 'special', candidates: ['File:Japanese N.ogg'] },
  // --- dakuten g ----------------------------------------------------------
  { key: 'ga', hi: 'が', ka: 'ガ', group: 'dakuten', candidates: ['File:Japanese ga.ogg'] },
  { key: 'gi', hi: 'ぎ', ka: 'ギ', group: 'dakuten', candidates: ['File:Japanese gi.ogg'] },
  { key: 'gu', hi: 'ぐ', ka: 'グ', group: 'dakuten', candidates: ['File:Japanese gu.ogg'] },
  { key: 'ge', hi: 'げ', ka: 'ゲ', group: 'dakuten', candidates: ['File:Japanese ge.ogg'] },
  { key: 'go', hi: 'ご', ka: 'ゴ', group: 'dakuten', candidates: ['File:Japanese go.ogg'] },
  // --- dakuten z ----------------------------------------------------------
  { key: 'za', hi: 'ざ', ka: 'ザ', group: 'dakuten', candidates: ['File:Japanese za.ogg'] },
  { key: 'ji', hi: 'じ', ka: 'ジ', group: 'dakuten', candidates: ['File:Japanese zi.ogg', 'File:Ja-ji.ogg'] },
  { key: 'zu', hi: 'ず', ka: 'ズ', group: 'dakuten', candidates: ['File:Japanese zu.ogg'] },
  { key: 'ze', hi: 'ぜ', ka: 'ゼ', group: 'dakuten', candidates: ['File:Japanese ze.ogg'] },
  { key: 'zo', hi: 'ぞ', ka: 'ゾ', group: 'dakuten', candidates: ['File:Japanese zo.ogg'] },
  // --- dakuten d ----------------------------------------------------------
  { key: 'da', hi: 'だ', ka: 'ダ', group: 'dakuten', candidates: ['File:Japanese da.ogg'] },
  {
    key: 'di',
    hi: 'ぢ',
    ka: 'ヂ',
    group: 'dakuten',
    candidates: ['File:Japanese di.ogg'],
    note: 'ぢ is pronounced identically to じ in modern standard Japanese.',
  },
  {
    key: 'du',
    hi: 'づ',
    ka: 'ヅ',
    group: 'dakuten',
    candidates: ['File:Japanese du.ogg'],
    note: 'づ is pronounced identically to ず in modern standard Japanese.',
  },
  { key: 'de', hi: 'で', ka: 'デ', group: 'dakuten', candidates: ['File:Japanese de.ogg'] },
  { key: 'do', hi: 'ど', ka: 'ド', group: 'dakuten', candidates: ['File:Japanese do.ogg'] },
  // --- dakuten b ----------------------------------------------------------
  { key: 'ba', hi: 'ば', ka: 'バ', group: 'dakuten', candidates: ['File:Japanese ba.ogg'] },
  { key: 'bi', hi: 'び', ka: 'ビ', group: 'dakuten', candidates: ['File:Japanese bi.ogg'] },
  { key: 'bu', hi: 'ぶ', ka: 'ブ', group: 'dakuten', candidates: ['File:Japanese bu.ogg'] },
  { key: 'be', hi: 'べ', ka: 'ベ', group: 'dakuten', candidates: ['File:Japanese be.ogg'] },
  { key: 'bo', hi: 'ぼ', ka: 'ボ', group: 'dakuten', candidates: ['File:Japanese bo.ogg'] },
  // --- handakuten p -------------------------------------------------------
  { key: 'pa', hi: 'ぱ', ka: 'パ', group: 'handakuten', candidates: ['File:Japanese pa.ogg'] },
  { key: 'pi', hi: 'ぴ', ka: 'ピ', group: 'handakuten', candidates: ['File:Japanese pi.ogg'] },
  { key: 'pu', hi: 'ぷ', ka: 'プ', group: 'handakuten', candidates: ['File:Japanese pu.ogg'] },
  { key: 'pe', hi: 'ぺ', ka: 'ペ', group: 'handakuten', candidates: ['File:Japanese pe.ogg'] },
  { key: 'po', hi: 'ぽ', ka: 'ポ', group: 'handakuten', candidates: ['File:Japanese po.ogg'] },
  // --- yōon: 33 sounds. Surveyed exhaustively; only りゅ has a recording. ---
  { key: 'kya', hi: 'きゃ', ka: 'キャ', group: 'yoon', candidates: [] },
  { key: 'kyu', hi: 'きゅ', ka: 'キュ', group: 'yoon', candidates: [] },
  { key: 'kyo', hi: 'きょ', ka: 'キョ', group: 'yoon', candidates: [] },
  { key: 'sha', hi: 'しゃ', ka: 'シャ', group: 'yoon', candidates: [] },
  { key: 'shu', hi: 'しゅ', ka: 'シュ', group: 'yoon', candidates: [] },
  { key: 'sho', hi: 'しょ', ka: 'ショ', group: 'yoon', candidates: [] },
  { key: 'cha', hi: 'ちゃ', ka: 'チャ', group: 'yoon', candidates: [] },
  { key: 'chu', hi: 'ちゅ', ka: 'チュ', group: 'yoon', candidates: [] },
  { key: 'cho', hi: 'ちょ', ka: 'チョ', group: 'yoon', candidates: [] },
  { key: 'nya', hi: 'にゃ', ka: 'ニャ', group: 'yoon', candidates: [] },
  { key: 'nyu', hi: 'にゅ', ka: 'ニュ', group: 'yoon', candidates: [] },
  { key: 'nyo', hi: 'にょ', ka: 'ニョ', group: 'yoon', candidates: [] },
  { key: 'hya', hi: 'ひゃ', ka: 'ヒャ', group: 'yoon', candidates: [] },
  { key: 'hyu', hi: 'ひゅ', ka: 'ヒュ', group: 'yoon', candidates: [] },
  { key: 'hyo', hi: 'ひょ', ka: 'ヒョ', group: 'yoon', candidates: [] },
  { key: 'mya', hi: 'みゃ', ka: 'ミャ', group: 'yoon', candidates: [] },
  { key: 'myu', hi: 'みゅ', ka: 'ミュ', group: 'yoon', candidates: [] },
  { key: 'myo', hi: 'みょ', ka: 'ミョ', group: 'yoon', candidates: [] },
  { key: 'rya', hi: 'りゃ', ka: 'リャ', group: 'yoon', candidates: [] },
  { key: 'ryu', hi: 'りゅ', ka: 'リュ', group: 'yoon', candidates: ['File:Ja-Ryu.oga'] },
  { key: 'ryo', hi: 'りょ', ka: 'リョ', group: 'yoon', candidates: [] },
  { key: 'gya', hi: 'ぎゃ', ka: 'ギャ', group: 'yoon', candidates: [] },
  { key: 'gyu', hi: 'ぎゅ', ka: 'ギュ', group: 'yoon', candidates: [] },
  { key: 'gyo', hi: 'ぎょ', ka: 'ギョ', group: 'yoon', candidates: [] },
  { key: 'ja', hi: 'じゃ', ka: 'ジャ', group: 'yoon', candidates: [] },
  { key: 'ju', hi: 'じゅ', ka: 'ジュ', group: 'yoon', candidates: [] },
  { key: 'jo', hi: 'じょ', ka: 'ジョ', group: 'yoon', candidates: [] },
  { key: 'bya', hi: 'びゃ', ka: 'ビャ', group: 'yoon', candidates: [] },
  { key: 'byu', hi: 'びゅ', ka: 'ビュ', group: 'yoon', candidates: [] },
  { key: 'byo', hi: 'びょ', ka: 'ビョ', group: 'yoon', candidates: [] },
  { key: 'pya', hi: 'ぴゃ', ka: 'ピャ', group: 'yoon', candidates: [] },
  { key: 'pyu', hi: 'ぴゅ', ka: 'ピュ', group: 'yoon', candidates: [] },
  { key: 'pyo', hi: 'ぴょ', ka: 'ピョ', group: 'yoon', candidates: [] },
];

/** Lingua Libre's Commons filename prefix for Japanese (jpn = Q5287). */
const LL_PREFIX = 'LL-Q5287 (jpn)-';
/** Parses `LL-Q5287 (jpn)-<speaker>-<word>.wav`. Speaker names have no '-'. */
const LL_NAME_RE = /^LL-Q5287[ _]\(jpn\)-([^-]+)-(.+)\.(wav|ogg|oga|mp3|flac)$/u;

/** Lingua Libre entity/property ids used below, named so the query is readable. */
const LL = {
  sparqlLanguageJapanese: 'Q389',
  sparqlLevelNative: 'Q15',
  propLanguage: 'P4',
  propLanguageLevel: 'P16',
  propWikimediaUsername: 'P11',
};

// ---------------------------------------------------------------------------
// tiny utilities
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OPTIONS = {
  dryRun: flag('dry-run'),
  outDir: resolve(REPO_ROOT, opt('out', 'public/content/audio')),
  limitWords: opt('limit-words') ? Number(opt('limit-words')) : null,
  allowUndocumentedSpeaker: flag('allow-undocumented-speaker'),
  skipWords: flag('skip-words'),
  skipKana: flag('skip-kana'),
};

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);

const lastRequestAt = new Map();
async function politeFetch(url, init = {}) {
  const host = new URL(url).host;
  const gap = RATE_LIMIT_MS[host] ?? DEFAULT_RATE_LIMIT_MS;
  const last = lastRequestAt.get(host) ?? 0;
  const waitMs = last + gap - Date.now();
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  lastRequestAt.set(host, Date.now());

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip', ...(init.headers ?? {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`fetch failed: ${url}`);
}

async function commonsApi(params) {
  const u = new URL(COMMONS_API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', maxlag: '5', ...params })) {
    u.searchParams.set(k, String(v));
  }
  const res = await politeFetch(u.toString());
  const body = await res.json();
  if (body.error) throw new Error(`Commons API error: ${JSON.stringify(body.error)}`);
  return body;
}

const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim();

/** Collapse an upload.wikimedia.org URL to its canonical, parameter-free form. */
function cleanUploadUrl(url) {
  const u = new URL(url);
  u.search = '';
  return u.toString();
}

const chunk = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ---------------------------------------------------------------------------
// Speaker nativeness: Babel declarations on user pages
// ---------------------------------------------------------------------------

/**
 * A Commons/Wikipedia uploader counts as a documented native speaker of
 * Japanese only if a user page declares it through Babel:
 *   - {{#babel:ja|...}}        — a bare language code means native
 *   - {{#babel:...|ja-N|...}}
 *   - {{user ja}} / {{User ja}} on ja.wikipedia (= 母語, native)
 *   - {{User ja-N}}
 * Anything vaguer (writing the description in Japanese, a Japanese username,
 * a Japan-related edit history) is NOT documentation and yields `false`.
 */
function babelDeclaresNativeJapanese(wikitext) {
  if (!wikitext) return null;
  const babel = /\{\{\s*#babel\s*:\s*([^}]*)\}\}/giu;
  for (const m of wikitext.matchAll(babel)) {
    const codes = m[1].split('|').map((s) => s.trim().toLowerCase());
    for (const c of codes) {
      if (c === 'ja') return '{{#babel:…|ja|…}} — bare code, i.e. native';
      if (c === 'ja-n') return '{{#babel:…|ja-N|…}}';
    }
  }
  const userbox = /\{\{\s*user[ _]ja(?:-n)?\s*\}\}/giu;
  const um = wikitext.match(userbox);
  if (um) return `${um[0]} userbox (= 母語 / native)`;
  return null;
}

const nativenessCache = new Map();

/**
 * @returns {Promise<{documented: boolean, evidence: string|null}>}
 */
async function commonsUploaderNativeness(username) {
  if (!username) return { documented: false, evidence: null };
  if (nativenessCache.has(username)) return nativenessCache.get(username);

  const probes = [
    { api: COMMONS_API, title: `User:${username}`, label: 'Commons user page' },
    { api: 'https://ja.wikipedia.org/w/api.php', title: `利用者:${username}`, label: 'ja.wikipedia user page' },
  ];
  let result = { documented: false, evidence: null };
  for (const p of probes) {
    const u = new URL(p.api);
    for (const [k, v] of Object.entries({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: p.title,
    })) u.searchParams.set(k, v);
    let page;
    try {
      const body = await (await politeFetch(u.toString())).json();
      page = body?.query?.pages?.[0];
    } catch (err) {
      warn(`  ! could not read ${p.label} for ${username}: ${err.message}`);
      continue;
    }
    const text = page?.revisions?.[0]?.slots?.main?.content;
    const evidence = babelDeclaresNativeJapanese(text);
    if (evidence) {
      result = {
        documented: true,
        evidence: `${p.label} (${p.api.replace('/w/api.php', '')}/wiki/${encodeURIComponent(p.title)}): ${evidence}`,
      };
      break;
    }
  }
  nativenessCache.set(username, result);
  return result;
}

// ---------------------------------------------------------------------------
// Lingua Libre: which Japanese speakers declare Japanese as a NATIVE language
// ---------------------------------------------------------------------------

async function linguaLibreNativeJapaneseSpeakers() {
  const query = `PREFIX llprop: <https://lingualibre.org/prop/>
PREFIX llps:   <https://lingualibre.org/prop/statement/>
PREFIX llpq:   <https://lingualibre.org/prop/qualifier/>
PREFIX llpd:   <https://lingualibre.org/prop/direct/>
PREFIX lle:    <https://lingualibre.org/entity/>
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?speaker ?username ?label WHERE {
  ?speaker llpd:${LL.propWikimediaUsername} ?username .
  OPTIONAL { ?speaker rdfs:label ?label }
  ?speaker llprop:${LL.propLanguage} ?st .
  ?st llps:${LL.propLanguage} lle:${LL.sparqlLanguageJapanese} .
  ?st llpq:${LL.propLanguageLevel} lle:${LL.sparqlLevelNative} .
}`;
  const u = new URL(LINGUALIBRE_SPARQL);
  u.searchParams.set('query', query);
  const res = await politeFetch(u.toString(), { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`Lingua Libre SPARQL HTTP ${res.status}`);
  const body = await res.json();

  // A Commons Lingua Libre filename embeds the SPEAKER ITEM's label, not the
  // Wikimedia username, and appends "_(<username>)" when the two differ — e.g.
  // Q287558 is labelled "higa4_kagoshima" for user "Higa4", giving
  // "LL-Q5287 (jpn)-higa4_kagoshima_(Higa4)-<word>.wav". So every alias of a
  // native speaker's item is registered here, and the filename segment is
  // matched against all of them.
  const out = new Map(); // filename speaker segment → {username, entity}
  for (const b of body.results.bindings) {
    const entity = b.speaker.value.split('/').pop();
    const username = b.username.value;
    const label = b.label?.value ?? null;
    const aliases = new Set([username, label, label ? `${label}_(${username})` : null].filter(Boolean));
    for (const a of aliases) out.set(a.replace(/ /gu, '_'), { username, entity });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Commons file metadata
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<Map<string, object>>} title → normalised file record
 */
async function commonsFileInfo(titles) {
  const found = new Map();
  for (const batch of chunk(titles, TITLE_BATCH)) {
    const body = await commonsApi({
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|mediatype|extmetadata|user',
      titles: batch.join('|'),
    });
    for (const page of body?.query?.pages ?? []) {
      if (page.missing || !page.imageinfo?.length) continue;
      const ii = page.imageinfo[0];
      const em = ii.extmetadata ?? {};
      const licenseSlug = String(em.License?.value ?? '').toLowerCase();
      const mapped = LICENSE_MAP[licenseSlug] ?? null;
      found.set(page.title, {
        title: page.title,
        pageUrl: ii.descriptionurl,
        downloadUrl: cleanUploadUrl(ii.url),
        bytes: ii.size ?? null,
        mime: ii.mime ?? null,
        durationMs: typeof ii.duration === 'number' ? Math.round(ii.duration * 1000) : null,
        uploader: ii.user ?? null,
        artist: stripHtml(em.Artist?.value) || null,
        licenseSlug,
        licenseShortName: stripHtml(em.LicenseShortName?.value) || null,
        licenseUrlFromSource: em.LicenseUrl?.value ?? null,
        license: mapped,
      });
    }
  }
  return found;
}

async function enumerateLinguaLibreFiles() {
  const out = [];
  let cont = null;
  do {
    const params = {
      action: 'query',
      list: 'allimages',
      aiprefix: LL_PREFIX,
      ailimit: '500',
      aiprop: 'url|size|mime|user',
    };
    if (cont) params.aicontinue = cont;
    const body = await commonsApi(params);
    for (const img of body?.query?.allimages ?? []) out.push(img);
    cont = body?.continue?.aicontinue ?? null;
  } while (cont);
  return out;
}

// ---------------------------------------------------------------------------
// Download + hash
// ---------------------------------------------------------------------------

const sanitiseSegment = (s) => {
  const cleaned = s
    .normalize('NFC')
    .replace(/[ -/\\:*?"<>|]/gu, '_')
    .replace(/^\.+/u, '_');
  if (cleaned.length === 0 || Buffer.byteLength(cleaned, 'utf8') > 100) {
    return createHash('sha256').update(s).digest('hex').slice(0, 24);
  }
  return cleaned;
};

let downloadedBytes = 0;
let downloadCount = 0;
let reusedCount = 0;

/**
 * Downloads (or reuses) a file, byte-for-byte as the source serves it.
 * NOTHING is transcoded: the original container and codec are preserved and
 * recorded, because re-encoding would both lose fidelity and muddy provenance.
 */
async function downloadTo(relPath, record) {
  const abs = join(OPTIONS.outDir, relPath);
  await mkdir(dirname(abs), { recursive: true });

  let buf = null;
  try {
    const st = await stat(abs);
    if (record.bytes != null && st.size === record.bytes) {
      buf = await readFile(abs);
      reusedCount += 1;
    }
  } catch {
    /* not cached */
  }

  if (!buf) {
    const res = await politeFetch(record.downloadUrl);
    if (!res.ok) throw new Error(`download HTTP ${res.status}: ${record.downloadUrl}`);
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(abs, buf);
    downloadCount += 1;
  }
  downloadedBytes += buf.length;
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

const EXT_BY_MIME = {
  'application/ogg': 'oga',
  'audio/ogg': 'oga',
  'audio/vorbis': 'oga',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
};

function extensionFor(record) {
  const fromTitle = record.title.split('.').pop()?.toLowerCase();
  if (fromTitle && /^[a-z0-9]{2,5}$/u.test(fromTitle)) return fromTitle;
  return EXT_BY_MIME[record.mime ?? ''] ?? 'bin';
}

// ---------------------------------------------------------------------------
// AudioRef construction
// ---------------------------------------------------------------------------

/**
 * @returns AudioRef, exactly as typed in src/domain/content.ts, with the
 *   Kansei-specific extras (`format`, `sourceTitle`, `speakerEvidence`) kept in
 *   a sibling `meta` object so the AudioRef shape stays clean.
 */
function buildAudioRef({ relPath, sha256, bytes, durationMs, record, sourceName, nativeDocumented }) {
  return {
    path: `audio/${relPath}`,
    sha256,
    bytes,
    durationMs,
    attribution: {
      source: sourceName,
      url: record.pageUrl,
      author: record.artist ?? record.uploader ?? 'unknown',
      license: record.license.spdx,
      licenseUrl: record.license.url ?? record.licenseUrlFromSource ?? null,
      nativeSpeakerDocumented: nativeDocumented,
    },
  };
}

// ---------------------------------------------------------------------------
// Step 1 — kana syllables
// ---------------------------------------------------------------------------

async function buildKana(report) {
  log('\n== Kana syllables (Wikimedia Commons) ==');
  const allCandidates = [...new Set(KANA_SOUNDS.flatMap((s) => s.candidates))];
  log(`probing ${allCandidates.length} candidate titles for ${KANA_SOUNDS.length} syllable sounds`);
  const info = await commonsFileInfo(allCandidates);
  log(`  ${info.size} of ${allCandidates.length} candidate titles exist on Commons`);

  const clips = {};
  const glyphs = {};
  const unavailable = [];

  for (const sound of KANA_SOUNDS) {
    glyphs[sound.key] = { hiragana: sound.hi, katakana: sound.ka, group: sound.group, note: sound.note ?? null };

    const usable = [];
    for (const title of sound.candidates) {
      const rec = info.get(title);
      if (!rec) {
        report.rejected.push({ title, sound: sound.key, reason: 'file does not exist on Commons' });
        continue;
      }
      if (!rec.license) {
        report.rejected.push({
          title,
          sound: sound.key,
          reason: `licence not on the redistribution allowlist: "${rec.licenseSlug || '(none reported)'}"`,
        });
        continue;
      }
      const nat = await commonsUploaderNativeness(rec.uploader);
      if (!nat.documented && !OPTIONS.allowUndocumentedSpeaker) {
        report.rejected.push({
          title,
          sound: sound.key,
          reason: `speaker nativeness not documented (uploader ${rec.uploader}); no Babel ja / ja-N declaration found on Commons or ja.wikipedia`,
        });
        continue;
      }
      usable.push({ rec, nat });
    }

    if (usable.length === 0) {
      unavailable.push(sound.key);
      continue;
    }
    usable.sort((a, b) => {
      const ai = LICENSE_PREFERENCE.indexOf(a.rec.license.spdx);
      const bi = LICENSE_PREFERENCE.indexOf(b.rec.license.spdx);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const { rec, nat } = usable[0];

    const relPath = `kana/${sound.key}.${extensionFor(rec)}`;
    let hashed = { sha256: null, bytes: rec.bytes };
    if (!OPTIONS.dryRun) hashed = await downloadTo(relPath, rec);

    const ref = buildAudioRef({
      relPath,
      sha256: hashed.sha256,
      bytes: hashed.bytes,
      durationMs: rec.durationMs,
      record: rec,
      sourceName: 'Wikimedia Commons',
      nativeDocumented: nat.documented,
    });
    // One isolated-syllable recording serves both scripts: あ and ア are the
    // same sound. Documented in docs/content/AUDIO.md.
    clips[`kana/hi/${sound.key}`] = ref;
    clips[`kana/ka/${sound.key}`] = ref;
    report.speakerEvidence[rec.uploader ?? 'unknown'] = nat.evidence;
    report.files.push({ key: `kana/${sound.key}`, ...ref, format: rec.mime, sourceTitle: rec.title });
  }

  const covered = KANA_SOUNDS.length - unavailable.length;
  log(`  covered ${covered}/${KANA_SOUNDS.length} syllable sounds`);
  if (unavailable.length) log(`  NO AUDIO for ${unavailable.length}: ${unavailable.join(' ')}`);
  return { clips, glyphs, unavailable, covered, total: KANA_SOUNDS.length };
}

// ---------------------------------------------------------------------------
// Step 2 — Lingua Libre word recordings
// ---------------------------------------------------------------------------

async function buildWords(report) {
  log('\n== Word recordings (Lingua Libre via Wikimedia Commons) ==');

  let natives;
  try {
    natives = await linguaLibreNativeJapaneseSpeakers();
  } catch (err) {
    warn(`  ! Lingua Libre SPARQL unavailable (${err.message}).`);
    warn('  ! Without it, no Lingua Libre speaker can be shown to be a native speaker.');
    warn('  ! Refusing to guess: skipping all Lingua Libre word audio.');
    return { clips: {}, unavailable: [], covered: 0, total: 0, speakers: [], sparqlFailed: true };
  }
  const nativeUsernames = [...new Set([...natives.values()].map((v) => v.username))];
  log(`  Lingua Libre declares ${nativeUsernames.length} native Japanese speakers: ${nativeUsernames.join(', ')}`);

  const files = await enumerateLinguaLibreFiles();
  log(`  ${files.length} Japanese Lingua Libre files on Commons (prefix "${LL_PREFIX}")`);

  const kept = [];
  const bySpeaker = new Map();
  for (const f of files) {
    const m = LL_NAME_RE.exec(f.name);
    if (!m) {
      report.rejected.push({ title: `File:${f.name}`, reason: 'filename does not match the Lingua Libre pattern' });
      continue;
    }
    const [, speaker, word] = m;
    bySpeaker.set(speaker, (bySpeaker.get(speaker) ?? 0) + 1);
    const native = natives.get(speaker);
    if (!native) continue;
    kept.push({ name: f.name, speaker, speakerUsername: native.username, llEntity: native.entity, word: word.normalize('NFC') });
  }
  const speakerTable = [...bySpeaker.entries()]
    .map(([speaker, count]) => ({
      speaker,
      count,
      nativeDocumented: natives.has(speaker),
      llEntity: natives.get(speaker)?.entity ?? null,
    }))
    .sort((a, b) => b.count - a.count);
  for (const s of speakerTable) {
    log(`    ${s.nativeDocumented ? 'KEEP  ' : 'reject'} ${String(s.count).padStart(4)}  ${s.speaker}${s.nativeDocumented ? ` (${s.llEntity}, native)` : ' (Japanese not declared native on Lingua Libre)'}`);
  }

  let selected = kept;
  if (OPTIONS.limitWords != null) selected = kept.slice(0, OPTIONS.limitWords);
  log(`  ${kept.length} files by documented native speakers${selected.length !== kept.length ? `, limited to ${selected.length}` : ''}`);

  const info = await commonsFileInfo(selected.map((s) => `File:${s.name.replace(/_/gu, ' ')}`));

  const clips = {};
  const words = new Set();
  let n = 0;
  for (const item of selected) {
    const title = `File:${item.name.replace(/_/gu, ' ')}`;
    const rec = info.get(title);
    if (!rec) {
      report.rejected.push({ title, reason: 'imageinfo lookup returned nothing' });
      continue;
    }
    if (!rec.license) {
      report.rejected.push({ title, reason: `licence not on the redistribution allowlist: "${rec.licenseSlug || '(none)'}"` });
      continue;
    }
    const relPath = `words/${sanitiseSegment(item.word)}--${sanitiseSegment(item.speaker)}.${extensionFor(rec)}`;
    let hashed = { sha256: null, bytes: rec.bytes };
    if (!OPTIONS.dryRun) hashed = await downloadTo(relPath, rec);

    const ref = buildAudioRef({
      relPath,
      sha256: hashed.sha256,
      bytes: hashed.bytes,
      durationMs: rec.durationMs,
      record: rec,
      sourceName: 'Lingua Libre (via Wikimedia Commons)',
      nativeDocumented: true,
    });
    const key = `vocab/${item.word}`;
    // First clip wins the canonical key; extra speakers stay addressable.
    if (clips[key]) clips[`${key}#${item.speaker}`] = ref;
    else clips[key] = ref;
    words.add(item.word);
    report.files.push({ key, ...ref, format: rec.mime, sourceTitle: rec.title, speaker: item.speaker });
    n += 1;
    if (n % 50 === 0) log(`    ... ${n}/${selected.length}`);
  }

  log(`  ${n} word clips, ${words.size} distinct words`);
  return { clips, covered: words.size, total: words.size, speakers: speakerTable, sparqlFailed: false };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date().toISOString();
  log(`fetch-audio.mjs — ${startedAt}`);
  log(`out: ${OPTIONS.outDir}${OPTIONS.dryRun ? '  (DRY RUN — nothing will be written)' : ''}`);
  log(`policy: speaker nativeness must be documented = ${!OPTIONS.allowUndocumentedSpeaker}`);

  const report = { rejected: [], files: [], speakerEvidence: {} };

  const kana = OPTIONS.skipKana
    ? { clips: {}, glyphs: {}, unavailable: KANA_SOUNDS.map((s) => s.key), covered: 0, total: KANA_SOUNDS.length }
    : await buildKana(report);
  const words = OPTIONS.skipWords
    ? { clips: {}, covered: 0, total: 0, speakers: [], sparqlFailed: false }
    : await buildWords(report);

  const clips = { ...kana.clips, ...words.clips };
  const uniqueFiles = new Map();
  for (const f of report.files) uniqueFiles.set(f.path, f);
  const totalBytes = [...uniqueFiles.values()].reduce((a, f) => a + (f.bytes ?? 0), 0);

  const index = {
    schemaVersion: 1,
    generatedAt: startedAt,
    generator: 'scripts/assets/fetch-audio.mjs',
    reproduce: 'npm run audio:fetch',

    policy: {
      noSpeechSynthesis:
        'Kansei never substitutes text-to-speech or any synthesised audio for a missing recording. When a key is absent from `clips`, the AudioRef is null and the listening exercise is not generated.',
      noPlaceholders: 'No silent, generated or stand-in clip is ever written.',
      requireDocumentedNativeSpeaker: !OPTIONS.allowUndocumentedSpeaker,
      redistributableLicensesOnly: Object.values(LICENSE_MAP).map((l) => l.spdx).filter((v, i, a) => a.indexOf(v) === i),
      noTranscoding: 'Files are byte-for-byte as the source serves them; the original container is kept.',
    },

    sources: [
      {
        id: 'commons-kana',
        name: 'Wikimedia Commons — isolated Japanese syllable recordings',
        url: 'https://commons.wikimedia.org/wiki/Category:Pronunciation_of_Japanese_syllables',
        api: COMMONS_API,
        licenses: ['PD', 'CC0-1.0', 'CC-BY-*', 'CC-BY-SA-*'],
        redistribution:
          'Permitted. PD/CC0 need no credit; CC BY and CC BY-SA require per-file author + licence credit, and CC BY-SA requires that any adapted clip be released under the same licence. Kansei adapts nothing.',
        probedNamePatterns: PROBED_NAME_PATTERNS,
      },
      {
        id: 'lingualibre-words',
        name: 'Lingua Libre — Japanese word recordings (hosted on Wikimedia Commons)',
        url: 'https://commons.wikimedia.org/w/index.php?title=Special:ListFiles&ilshowall=1',
        commonsPrefix: LL_PREFIX,
        speakerProficiencySource: LINGUALIBRE_SPARQL,
        speakerProficiencyCriterion: `speaker ${LL.propLanguage}=Japanese(${LL.sparqlLanguageJapanese}) with qualifier ${LL.propLanguageLevel}=native(${LL.sparqlLevelNative})`,
        licenses: ['CC0-1.0', 'CC-BY-SA-4.0'],
        redistribution:
          'Permitted. CC BY-SA 4.0 files require per-file credit (speaker name, licence, licence URL, link to the file page) and share-alike on adaptations.',
      },
    ],

    sourcesRejected: [
      {
        id: 'shtooka',
        name: 'Shtooka project',
        url: 'http://shtooka.net/',
        reason:
          'DEAD. As of 2026-09-28 shtooka.net and www.shtooka.net resolve and 301 to an unrelated commercial domain (xoilaczzw.cc); download.shtooka.net and packs.shtooka.net no longer resolve; the swac-collections.org mirror answers 503 behind an expired TLS certificate. Nothing may be fetched from any of these.',
      },
      {
        id: 'tts',
        name: 'Any speech synthesiser (browser SpeechSynthesis, server-side TTS, neural voices)',
        url: null,
        reason: 'Forbidden by product rule: Kansei only ever plays real human recordings.',
      },
    ],

    coverage: {
      kana: {
        syllableSoundsTargeted: kana.total,
        syllableSoundsWithAudio: kana.covered,
        syllableSoundsWithoutAudio: kana.unavailable,
        note: 'A single isolated-syllable recording is used for both the hiragana and the katakana key, because the sound is identical.',
      },
      words: {
        distinctWordsWithAudio: words.covered,
        note: 'Keyed by the Japanese spelling exactly as it appears in the Lingua Libre filename (NFC). The content build joins these keys against VocabEntry.spelling; a vocabulary entry with no matching key keeps audio: null.',
        linguaLibreSpeakers: words.speakers,
        linguaLibreSparqlFailed: words.sparqlFailed,
      },
      totals: { clipKeys: Object.keys(clips).length, files: uniqueFiles.size, bytes: totalBytes },
    },

    kanaKeyGlyphs: kana.glyphs,
    speakerNativenessEvidence: report.speakerEvidence,
    clips,
    rejectedCandidates: report.rejected,
  };

  if (OPTIONS.dryRun) {
    log('\n(dry run — index not written)');
  } else {
    await mkdir(OPTIONS.outDir, { recursive: true });
    const indexPath = join(OPTIONS.outDir, 'index.json');
    const json = JSON.stringify(index);
    await writeFile(indexPath, json.length > 100_000 ? json : JSON.stringify(index, null, 2));
    log(`\nwrote ${relative(REPO_ROOT, indexPath)} (${json.length} bytes${json.length > 100_000 ? ', compact' : ''})`);

    await writeFile(join(OPTIONS.outDir, 'ATTRIBUTION.md'), renderAttribution(index));
    log(`wrote ${relative(REPO_ROOT, join(OPTIONS.outDir, 'ATTRIBUTION.md'))}`);

    const provPath = resolve(REPO_ROOT, 'data/audio-provenance.json');
    await mkdir(dirname(provPath), { recursive: true });
    await writeFile(
      provPath,
      `${JSON.stringify(
        {
          generatedAt: index.generatedAt,
          generator: index.generator,
          reproduce: index.reproduce,
          policy: index.policy,
          sources: index.sources,
          sourcesRejected: index.sourcesRejected,
          coverage: index.coverage,
          speakerNativenessEvidence: index.speakerNativenessEvidence,
        },
        null,
        2,
      )}\n`,
    );
    log(`wrote ${relative(REPO_ROOT, provPath)}`);
  }

  log('\n== RESULT ==');
  log(`kana syllable sounds with audio : ${kana.covered}/${kana.total}`);
  log(`kana syllable sounds with NONE  : ${kana.unavailable.length} -> ${kana.unavailable.join(' ') || '(none)'}`);
  log(`distinct words with audio       : ${words.covered}`);
  log(`clip keys in index              : ${Object.keys(clips).length}`);
  log(`audio files on disk             : ${uniqueFiles.size}`);
  log(`total bytes                     : ${totalBytes} (${(totalBytes / 1e6).toFixed(1)} MB)`);
  log(`downloaded now / reused         : ${downloadCount} / ${reusedCount}`);
  log(`rejected candidates             : ${report.rejected.length}`);
}

function renderAttribution(index) {
  const lines = [
    '# Audio credits',
    '',
    `Generated by \`${index.generator}\` at ${index.generatedAt}. Do not edit by hand.`,
    '',
    'Every clip Kansei ships is a real human recording. Nothing here is synthesised.',
    'CC BY and CC BY-SA files require this per-file credit to be reachable from the app.',
    '',
  ];
  const byFile = new Map();
  for (const [key, ref] of Object.entries(index.clips)) {
    const e = byFile.get(ref.path) ?? { ref, keys: [] };
    e.keys.push(key);
    byFile.set(ref.path, e);
  }
  const groups = new Map();
  for (const { ref, keys } of byFile.values()) {
    const g = groups.get(ref.attribution.license) ?? [];
    g.push({ ref, keys });
    groups.set(ref.attribution.license, g);
  }
  for (const [license, entries] of [...groups.entries()].sort()) {
    lines.push(`## ${license} (${entries.length} files)`, '');
    entries.sort((a, b) => a.ref.path.localeCompare(b.ref.path));
    for (const { ref, keys } of entries) {
      const a = ref.attribution;
      lines.push(
        `- \`${ref.path}\` — keys: ${keys.map((k) => `\`${k}\``).join(', ')} — ${a.author} — ${a.source} — ${a.license}${a.licenseUrl ? ` (${a.licenseUrl})` : ''} — [file page](${a.url}) — native speaker documented: ${a.nativeSpeakerDocumented}`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
