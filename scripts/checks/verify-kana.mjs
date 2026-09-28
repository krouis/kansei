// Throwaway verifier: reads the EMITTED json and re-checks it independently of
// the builder, using the real ID_PATTERN source text from src/domain/ids.ts and
// a separately typed canonical kana list.
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const kana = JSON.parse(readFileSync(`${REPO}/data/kana.json`, 'utf8'));
const lessons = JSON.parse(readFileSync(`${REPO}/data/kana-lessons.json`, 'utf8'));

// Pull ID_PATTERN out of the TS source so we test against the real thing.
const idsTs = readFileSync(`${REPO}/src/domain/ids.ts`, 'utf8');
const m = idsTs.match(/export const ID_PATTERN = (\/.*\/u);/);
if (!m) throw new Error('could not find ID_PATTERN in ids.ts');
// eslint-disable-next-line no-eval
const ID_PATTERN = eval(m[1]);

const fails = [];
const passes = [];
const t = (name, cond, extra = '') => (cond ? passes : fails).push(`${name}${extra ? ` — ${extra}` : ''}`);

// Canonical lists, typed independently of the builder's tables.
const HI46 = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'];
const KA46 = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'];
const HI_DAKU = [...'がぎぐげござじずぜぞだぢづでどばびぶべぼ'];
const HI_HANDAKU = [...'ぱぴぷぺぽ'];
const HI_YOON_CORE = 'きゃきゅきょしゃしゅしょちゃちゅちょにゃにゅにょひゃひゅひょみゃみゅみょりゃりゅりょぎゃぎゅぎょじゃじゅじょびゃびゅびょぴゃぴゅぴょ'.match(/../g);

t('HI46 canonical list length is 46', HI46.length === 46, `got ${HI46.length}`);
t('KA46 canonical list length is 46', KA46.length === 46, `got ${KA46.length}`);

const byId = new Map(kana.map((r) => [r.id, r]));
t('every id unique', byId.size === kana.length, `${kana.length} records, ${byId.size} ids`);

const bad = kana.filter((r) => !ID_PATTERN.test(r.id));
t('every id matches ids.ts ID_PATTERN', bad.length === 0, bad.map((r) => r.id).join(','));

const notNfc = kana.filter((r) => r.glyph !== r.glyph.normalize('NFC'));
t('every glyph NFC-normalised', notNfc.length === 0, notNfc.map((r) => r.id).join(','));

const dupGlyph = new Map();
for (const r of kana) {
  const k = `${r.script}:${r.glyph}`;
  dupGlyph.set(k, (dupGlyph.get(k) ?? 0) + 1);
}
const dupes = [...dupGlyph].filter(([, n]) => n > 1);
t('no glyph repeated within a script', dupes.length === 0, dupes.map(([k]) => k).join(','));

const g = (script, group) => kana.filter((r) => r.script === script && r.group === group);
t('exactly 46 basic hiragana', g('hiragana', 'basic').length === 46, `got ${g('hiragana', 'basic').length}`);
t('exactly 46 basic katakana', g('katakana', 'basic').length === 46, `got ${g('katakana', 'basic').length}`);

const setEq = (a, b) => a.length === b.length && new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
t('basic hiragana set == canonical あ..ん', setEq(g('hiragana', 'basic').map((r) => r.glyph), HI46));
t('basic katakana set == canonical ア..ン', setEq(g('katakana', 'basic').map((r) => r.glyph), KA46));
t('dakuten hiragana set == が..ぼ (20)', setEq(g('hiragana', 'dakuten').map((r) => r.glyph), HI_DAKU));
t('handakuten hiragana set == ぱ..ぽ (5)', setEq(g('hiragana', 'handakuten').map((r) => r.glyph), HI_HANDAKU));
const coreYoonHi = kana.filter((r) => r.script === 'hiragana' && r.group === 'yoon' && r.tier === 'modern-core').map((r) => r.glyph);
t('modern-core hiragana yoon == the 33 standard combinations', setEq(coreYoonHi, HI_YOON_CORE), `got ${coreYoonHi.length}`);

// katakana must mirror hiragana one-for-one by codepoint offset, outside extended/special
const OFFSET = 0x60;
const hiraToKata = (s) => [...s].map((c) => (c >= 'ぁ' && c <= 'ゖ' ? String.fromCodePoint(c.codePointAt(0) + OFFSET) : c)).join('');
let mirrorFails = [];
for (const r of kana.filter((x) => x.script === 'hiragana')) {
  const kid = r.id.replace('kana:hi:', 'kana:ka:');
  const k = byId.get(kid);
  if (!k) { mirrorFails.push(`${r.id} has no katakana counterpart`); continue; }
  if (hiraToKata(r.glyph) !== k.glyph) mirrorFails.push(`${r.id} ${r.glyph} -> expected ${hiraToKata(r.glyph)}, got ${k.glyph}`);
  if (r.romaji !== k.romaji) mirrorFails.push(`${r.id} romaji ${r.romaji} != ${k.romaji}`);
}
t('every hiragana record has the matching katakana record with the offset glyph', mirrorFails.length === 0, mirrorFails.join('; '));

// reference integrity
const refFails = [];
for (const r of kana) {
  for (const d of r.derivesFrom) if (!byId.has(d)) refFails.push(`${r.id} derivesFrom ${d}`);
  for (const c of r.confusableWith) {
    if (!byId.has(c)) refFails.push(`${r.id} confusableWith ${c}`);
    else if (!byId.get(c).confusableWith.includes(r.id)) refFails.push(`${r.id}<->${c} not symmetric`);
  }
  if (r.derivesFrom.includes(r.id)) refFails.push(`${r.id} derives from itself`);
}
t('every derivesFrom / confusableWith id resolves, and confusions are symmetric', refFails.length === 0, refFails.join('; '));

// teaching order
const orders = kana.map((r) => r.teachingOrder).sort((a, b) => a - b);
t('teachingOrder is dense 1..N with no duplicates',
  orders.length === kana.length && orders.every((v, i) => v === i + 1),
  `min ${orders[0]}, max ${orders.at(-1)}, unique ${new Set(orders).size}`);

// lessons
const lessonIds = new Set(lessons.map((l) => l.id));
t('every record lessonId exists in kana-lessons.json', kana.every((r) => lessonIds.has(r.lessonId)));
const introduced = lessons.flatMap((l) => l.introduces);
t('lessons introduce every record exactly once', introduced.length === kana.length && new Set(introduced).size === kana.length,
  `${introduced.length} introduced, ${kana.length} records`);
t('every introduced id resolves', introduced.every((i) => byId.has(i)));
const sizes = lessons.map((l) => l.introduces.length);
t('every lesson introduces 3-5 characters', sizes.every((n) => n >= 3 && n <= 5), `sizes ${[...new Set(sizes)].sort().join(',')}`);
t('lesson order is dense 1..N', lessons.map((l) => l.order).every((v, i) => v === i + 1));
const prereqFails = lessons.flatMap((l) => l.prerequisites.filter((p) => !lessonIds.has(p)).map((p) => `${l.id}->${p}`));
t('every prerequisite resolves to a lesson', prereqFails.length === 0, prereqFails.join(','));
// prerequisites must come earlier in the order
const orderOf = new Map(lessons.map((l) => [l.id, l.order]));
const cyc = lessons.flatMap((l) => l.prerequisites.filter((p) => orderOf.get(p) >= l.order).map((p) => `${l.id} requires later ${p}`));
t('no lesson requires a later lesson', cyc.length === 0, cyc.join(','));
// teachingOrder must agree with lesson order
let seq = 0, seqFail = null;
for (const l of lessons) for (const id of l.introduces) { seq += 1; if (byId.get(id).teachingOrder !== seq) seqFail ??= `${id} order ${byId.get(id).teachingOrder} != ${seq}`; }
t('teachingOrder follows lesson order exactly', seqFail === null, seqFail ?? '');

// tiers
t('no historical record is modern-core', kana.filter((r) => r.group === 'historical').every((r) => r.tier === 'historical'));
t('beginner path (modern-core) contains no extended or historical group',
  kana.filter((r) => r.tier === 'modern-core').every((r) => r.group !== 'extended' && r.group !== 'historical'));

// input variants / romaji
const ivFails = kana.filter((r) => r.inputVariants.length === 0 || r.inputVariants.some((v) => v !== v.toLowerCase() || v.trim() !== v));
t('inputVariants present, lowercase, untrimmed-free', ivFails.length === 0, ivFails.map((r) => r.id).join(','));
const hepburn = { 'kana:hi:shi': 'shi', 'kana:hi:chi': 'chi', 'kana:hi:tsu': 'tsu', 'kana:hi:fu': 'fu', 'kana:hi:sha': 'sha', 'kana:hi:ja': 'ja', 'kana:hi:cha': 'cha', 'kana:hi:jo': 'jo', 'kana:ka:she': 'she' };
const hepFails = Object.entries(hepburn).filter(([id, r]) => byId.get(id)?.romaji !== r).map(([id, r]) => `${id} != ${r}`);
t('Hepburn spellings correct (shi/chi/tsu/fu/sha/ja/cha)', hepFails.length === 0, hepFails.join(','));
const imeNeeded = { 'kana:hi:shi': 'si', 'kana:hi:chi': 'ti', 'kana:hi:tsu': 'tu', 'kana:hi:fu': 'hu', 'kana:hi:ji': 'zi', 'kana:hi:n': 'nn', 'kana:hi:sha': 'sya', 'kana:hi:ja': 'jya', 'kana:hi:cha': 'tya' };
const imeFails = Object.entries(imeNeeded).filter(([id, v]) => !byId.get(id)?.inputVariants.includes(v)).map(([id, v]) => `${id} lacks ${v}`);
t('Kunrei/IME variants present (si, ti, tu, hu, zi, nn, sya, jya, tya)', imeFails.length === 0, imeFails.join(','));

// required teaching notes
const mustMention = [
  ['kana:hi:ha', 'wa'], ['kana:hi:he', 'e'], ['kana:hi:wo', 'o'],
  ['kana:hi:sokuon', 'きって'], ['kana:hi:n', 'しんぶん'], ['kana:hi:n', 'nn'],
  ['kana:hi:o', 'おおきい'], ['kana:hi:u', 'とうきょう'],
  ['kana:hi:du', 'つづく'], ['kana:hi:di', 'ちぢむ'],
  ['kana:ka:chouonpu', 'コーヒー'],
];
const noteFails = mustMention.filter(([id, needle]) => !(byId.get(id)?.note ?? '').includes(needle)).map(([id, n]) => `${id} lacks ${n}`);
t('required teaching notes present', noteFails.length === 0, noteFails.join(','));

// print-vs-handwritten only where expected
const pvh = kana.filter((r) => r.printVsHandwritten !== null).map((r) => r.glyph).sort();
const expectPvh = ['き', 'さ', 'ふ', 'り', 'そ', 'シ', 'ツ', 'ソ'].sort();
t('printVsHandwritten set only on the documented glyphs', JSON.stringify(pvh) === JSON.stringify(expectPvh), `got ${pvh.join('')}`);

// stroke counts spot-check against hand-asserted values from a standard chart
const strokeSpot = { 'kana:hi:a': 3, 'kana:hi:ki': 4, 'kana:hi:fu': 4, 'kana:hi:n': 1, 'kana:hi:ga': 5, 'kana:hi:pa': 4, 'kana:ka:ne': 4, 'kana:ka:shi': 3, 'kana:ka:tsu': 3, 'kana:ka:so': 2, 'kana:ka:n': 2, 'kana:ka:chouonpu': 1, 'kana:hi:kya': 7, 'kana:ka:fa': 3, 'kana:ka:vu': 5 };
const strokeFails = Object.entries(strokeSpot).filter(([id, n]) => byId.get(id)?.strokeCount !== n).map(([id, n]) => `${id} ${byId.get(id)?.strokeCount} != ${n}`);
t('stroke counts match hand-asserted chart values on 15 spot checks', strokeFails.length === 0, strokeFails.join(','));

console.log(`PASS ${passes.length}`);
for (const p of passes) console.log(`  ok   ${p}`);
console.log(`FAIL ${fails.length}`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
