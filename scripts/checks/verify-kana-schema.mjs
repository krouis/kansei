// Runtime shape check of data/kana.json against the field list and literal
// unions declared in src/domain/content.ts (parsed from the source, not retyped).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const src = readFileSync(`${REPO}/src/domain/content.ts`, 'utf8');
const union = (name) => {
  const m = src.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  if (!m) throw new Error(`no union ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const iface = (name) => {
  const m = src.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no interface ${name}`);
  return [...m[1].matchAll(/^\s{2}([a-zA-Z]+)(\??):/gm)].map((x) => x[1]);
};
const GROUPS = union('KanaGroup'), TIERS = union('CurriculumTier'), SCRIPTS = union('Script');
const FIELDS = iface('KanaCharacter'), LFIELDS = iface('Lesson');
const kana = JSON.parse(readFileSync(`${REPO}/data/kana.json`, 'utf8'));
const lessons = JSON.parse(readFileSync(`${REPO}/data/kana-lessons.json`, 'utf8'));
const fails = [];
console.log('KanaCharacter fields from content.ts:', FIELDS.join(','));
console.log('KanaGroup:', GROUPS.join('|'), '  CurriculumTier:', TIERS.join('|'));
for (const r of kana) {
  const keys = Object.keys(r);
  for (const f of FIELDS) if (!keys.includes(f)) fails.push(`${r.id} missing field ${f}`);
  for (const k of keys) if (!FIELDS.includes(k)) fails.push(`${r.id} has field not in interface: ${k}`);
  if (r.kind !== 'kana') fails.push(`${r.id} kind`);
  if (!SCRIPTS.includes(r.script) || r.script === 'kanji') fails.push(`${r.id} script ${r.script}`);
  if (!GROUPS.includes(r.group)) fails.push(`${r.id} group ${r.group}`);
  if (!TIERS.includes(r.tier)) fails.push(`${r.id} tier ${r.tier}`);
  if (typeof r.glyph !== 'string' || !r.glyph) fails.push(`${r.id} glyph`);
  if (typeof r.romaji !== 'string' || !r.romaji) fails.push(`${r.id} romaji`);
  if (!Array.isArray(r.inputVariants)) fails.push(`${r.id} inputVariants`);
  if (r.position !== null && (typeof r.position.row !== 'string' || !['a','i','u','e','o'].includes(r.position.column))) fails.push(`${r.id} position`);
  if (!Number.isInteger(r.strokeCount)) fails.push(`${r.id} strokeCount`);
  if (r.printVsHandwritten !== null && typeof r.printVsHandwritten !== 'string') fails.push(`${r.id} printVsHandwritten`);
  if (r.note !== null && typeof r.note !== 'string') fails.push(`${r.id} note`);
  if (!Number.isInteger(r.teachingOrder) || typeof r.lessonId !== 'string') fails.push(`${r.id} order/lesson`);
}
for (const l of lessons) {
  const keys = Object.keys(l);
  for (const f of LFIELDS) if (!keys.includes(f)) fails.push(`${l.id} missing field ${f}`);
  for (const k of keys) if (!LFIELDS.includes(k)) fails.push(`${l.id} extra field ${k}`);
  if (![...SCRIPTS, 'mixed'].includes(l.script)) fails.push(`${l.id} script ${l.script}`);
  if (l.note !== null && typeof l.note !== 'string') fails.push(`${l.id} note`);
}
console.log(fails.length === 0 ? 'SHAPE OK — every record matches KanaCharacter, every lesson matches Lesson' : `SHAPE FAILURES ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
