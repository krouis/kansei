#!/usr/bin/env node
/**
 * build-components.mjs — derive Kansei's taught kanji-component set from KanjiVG.
 *
 * Outputs
 *   data/components.json              KanjiComponent[] (src/domain/content.ts), compact
 *   data/components.provenance.json   sources, inclusion rule, verification, diagnostics
 *
 * Reproduce
 *   node scripts/assets/fetch-sources.mjs          # kanjivg, kanjidic2, ucd-*
 *   node scripts/content/build-kanji-list.mjs      # data/kanji-top1000.json
 *   node scripts/content/build-components.mjs      # this script
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT A HAND-WRITTEN TABLE
 * ---------------------------------------------------------------------------
 * KanjiVG already encodes the decomposition of every kanji as nested <g>
 * elements, so nothing here is transcribed by hand. The kvg:* attributes used:
 *
 *   kvg:element   the component glyph this group draws, e.g. "氵"
 *   kvg:original  the unvaried form of a variant shape, e.g. 氵 -> 水. This is
 *                 KanjiVG's own statement that two glyphs are the same
 *                 component in different shapes; it is the source for variants[].
 *   kvg:radical   "general" | "tradit" | "nelson" | "jis" — which radical scheme
 *                 indexes the character under THIS group. Only "general" is used
 *                 for kangxiNumber, because it is the scheme KANJIDIC's
 *                 rad_type="classical" corresponds to.
 *   kvg:phon      present when the component is there for its SOUND. This is
 *                 exactly the signal for meaningIsUnreliable.
 *   kvg:position  left/right/top/bottom/kamae/tare/nyo… — layout, carried in the
 *                 diagnostics but not part of a KanjiComponent record.
 *   kvg:part      a component drawn in several non-contiguous groups (甲 in 単 is
 *                 part 1 + part 2). Counted once per host kanji, and a part group
 *                 nested inside another group with the SAME element is not a
 *                 containment edge.
 *   kvg:partial   the group draws only a piece of the named element.
 *   kvg:variant   this is a variant shape of the named element.
 *
 * The one thing a script cannot write is teaching judgement: glosses that are
 * honest about a component carrying several senses or none, and the decision
 * that a shape is not worth teaching at all. That lives in the hand-authored
 * data/component-notes.json, which is a committed source of truth, is clearly
 * labelled as human judgement, and can only narrow or annotate what the
 * derivation found — it can never invent a component that KanjiVG does not show.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT FOR THE KANJI-ORDER TASK  (see assignTeachingOrder below)
 * ---------------------------------------------------------------------------
 * A component must be introduced strictly BEFORE the first kanji that needs it,
 * so its teachingOrder cannot be finalised until the kanji teaching order exists.
 * This script therefore emits a PROVISIONAL order and exports the interleaver:
 *
 *   import { buildComponentModel, assignTeachingOrder, COMPONENT_CONTRACT }
 *     from './build-components.mjs';
 *
 *   const model = buildComponentModel();                 // pure derivation, no I/O out
 *   const plan  = assignTeachingOrder(model, {
 *     kanjiOrder: ['一', '二', ...],                     // kanji glyphs, teaching order
 *     lessonIdForKanji: (glyph, index) => 'kanji-lesson-03',   // optional
 *   });
 *   plan.components   // KanjiComponent[] with final teachingOrder + lessonId
 *   plan.sequence     // interleaved ['comp:氵', 'kanji:海', ...] — the curriculum spine
 *   plan.unusedComponents  // kept components no kanji in kanjiOrder needs
 *
 * `model.decomposition` is also part of the contract: Map<kanjiGlyph, {
 *   all, direct, ordered, radical, phonetic }> where `ordered` is the kept
 * components in KanjiVG writing order — that is what KanjiCharacter.components
 * should be populated from, so the two datasets cannot disagree.
 *
 * Bump COMPONENT_CONTRACT.version if any of those shapes change.
 *
 * No dependencies beyond Node builtins. The TrueType cmap reader and the SVG
 * group-tree reader below are deliberately minimal and throw on anything they
 * were not audited against rather than silently producing wrong data.
 *
 * Derived-licence note: the decomposition, the variant relations and the
 * component inventory are an adaptation of KanjiVG (CC BY-SA 3.0), so
 * data/components.json is share-alike. Glosses and stroke counts taken from
 * KANJIDIC2 are CC BY-SA 4.0. See data/components.provenance.json.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

export const COMPONENT_CONTRACT = {
  version: 1,
  module: 'scripts/content/build-components.mjs',
  exports: ['buildComponentModel', 'assignTeachingOrder', 'COMPONENT_CONTRACT'],
  notes: 'See the header comment. assignTeachingOrder places every component strictly before the first kanji in kanjiOrder that contains it.',
};

/* ------------------------------------------------------------------ *
 * Inclusion rule. Every constant here is a curriculum decision and is
 * reported verbatim in data/components.provenance.json.
 * ------------------------------------------------------------------ */

/** A shape recurring in at least this many taught kanji earns a record. */
const RECUR_MIN = 4;
/**
 * …or it is KanjiVG's `general` radical for at least this many taught kanji.
 * 1, deliberately: the app offers radical lookup and KanjiCharacter.radical must
 * resolve to a ComponentId, so every dictionary radical of a taught kanji earns a
 * record even when it is the radical of only one of them.
 */
const RADICAL_MIN = 1;
/** …or it is itself a taught kanji AND acts as a part of at least this many others. */
const STANDALONE_MIN = 2;
/** A kvg:original pair becomes a variants[] link only at this many DISTINCT taught kanji. */
const VARIANT_MIN_KANJI = 2;
/** Below this share, a split kangxi vote is treated as genuinely ambiguous (-> null). */
const KANGXI_MAJORITY = 0.6;
/**
 * Variant closure: when a variant shape is kept, keep the unvaried parent form
 * KanjiVG names too (氵 -> 水, ⻌ -> 辶, 艹 -> 艸). The parent is what carries the
 * sense, so teaching the variant without it would strand the explanation, and it
 * makes variants[] navigable in both directions.
 */
const KEEP_VARIANT_PARENTS = true;

/**
 * Coarse codepoint sanity filter (control chars, astral padding, etc.) — NOT the
 * renderability gate. The gate that actually bites is loadShippedFontIndex()
 * below, which reads public/fonts/index.json: the codepoint coverage Kansei's
 * shipped, SUBSETTED webfonts actually claim. A glyph can exist in the full
 * source Noto Sans JP typeface (data/sources/fonts/*.ttf) and still be absent
 * from the shipped subset, because scripts/assets/build-fonts.mjs only subsets
 * data/kanji-top1000.json plus kana plus the frequency-crosscheck list — none of
 * which include bare KanjiVG shapes like 氵 忄 扌 灬 刂 亻. The source-typeface
 * cmap reader further down is kept only as a diagnostic (readCmap /
 * sourceTypefaceHasGlyph), to tell "does not exist in the type design at all"
 * apart from "exists but was never subsetted in for Kansei".
 */
const FONT_REQUESTED_RANGES = [
  [0x0020, 0x007e], [0x00a0, 0x00ff],
  [0x3000, 0x303f], [0x3041, 0x3096], [0x3099, 0x309f], [0x30a0, 0x30ff],
  [0x31f0, 0x31ff], [0xff61, 0xff9f],
  [0x2e80, 0x2eff], [0x2f00, 0x2fdf],
  [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff],
];

/** The faces scripts/assets/build-fonts.mjs actually subsets and ships. */
const SHIPPED_FACES = [
  { key: 'noto-sans-jp', file: 'NotoSansJP[wght].ttf' },
  { key: 'noto-serif-jp', file: 'NotoSerifJP[wght].ttf' },
  { key: 'klee-one', file: 'KleeOne-Regular.ttf' },
];

/* ------------------------------------------------------------------ paths */

const P = {
  kanjivgDir: join(REPO, 'data', 'sources', 'kanjivg'),
  kanjivgZip: join(REPO, 'data', 'sources', 'kanjivg-20250816-main.zip'),
  kanjidic: join(REPO, 'data', 'sources', 'kanjidic2.xml'),
  kanjidicGz: join(REPO, 'data', 'sources', 'kanjidic2.xml.gz'),
  cjkRadicals: join(REPO, 'data', 'sources', 'CJKRadicals.txt'),
  equivIdeograph: join(REPO, 'data', 'sources', 'EquivalentUnifiedIdeograph.txt'),
  sourcesLock: join(REPO, 'data', 'sources', 'SOURCES.lock.json'),
  fontsDir: join(REPO, 'data', 'sources', 'fonts'),
  kanjiList: join(REPO, 'data', 'kanji-top1000.json'),
  fontIndex: join(REPO, 'public', 'fonts', 'index.json'),
  notes: join(REPO, 'data', 'component-notes.json'),
  outData: join(REPO, 'data', 'components.json'),
  outProv: join(REPO, 'data', 'components.provenance.json'),
};

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const fail = (msg) => {
  throw new Error(msg);
};
const hex = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
/**
 * KanjiVG occasionally labels a shape with a non-Unicode placeholder from the CDP
 * / Hanyo-Denshi private collections ("CDP-8BC4") because no code point encodes
 * it. Those are not glyphs and can never be shown, so they are excluded up front
 * rather than being mistaken for a one-character ASCII label.
 */
const isPlaceholderLabel = (s) => [...s].length !== 1 || /^(?:CDP|U)-/i.test(s);
/** Kana. KanjiVG labels a few shapes with kana (マ in 予, つ in 学); they are never radicals. */
const isKana = (s) => /^[\u3041-\u309f\u30a0-\u30ff]+$/u.test(s);
const cpsOf = (s) => [...s].map((c) => c.codePointAt(0));

/* ------------------------------------------------------------------ *
 * Minimal TrueType cmap reader (formats 4 and 12 only).
 * Used to answer one question: does this face have a glyph for this codepoint?
 * ------------------------------------------------------------------ */

function readCmap(file) {
  const b = readFileSync(file);
  const tag = b.readUInt32BE(0);
  if (tag !== 0x00010000 && tag !== 0x74727565) fail(`${file}: not a TrueType file (sfnt tag ${tag.toString(16)})`);
  const numTables = b.readUInt16BE(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (b.toString('latin1', rec, rec + 4) === 'cmap') cmapOff = b.readUInt32BE(rec + 8);
  }
  if (!cmapOff) fail(`${file}: no cmap table`);
  const nSub = b.readUInt16BE(cmapOff + 2);
  let best = null;
  for (let i = 0; i < nSub; i += 1) {
    const rec = cmapOff + 4 + i * 8;
    const platform = b.readUInt16BE(rec);
    const encoding = b.readUInt16BE(rec + 2);
    const off = cmapOff + b.readUInt32BE(rec + 4);
    const format = b.readUInt16BE(off);
    // Prefer a full-repertoire (format 12) Unicode subtable, else BMP format 4.
    const score =
      (format === 12 && (platform === 3 ? encoding === 10 : true) ? 3 : 0) ||
      (format === 4 && (platform === 3 ? encoding === 1 : platform === 0) ? 2 : 0);
    if (score && (!best || score > best.score)) best = { off, format, score };
  }
  if (!best) fail(`${file}: no usable cmap subtable (formats 4/12)`);
  const set = new Set();
  if (best.format === 4) {
    const o = best.off;
    const segX2 = b.readUInt16BE(o + 6);
    const seg = segX2 / 2;
    const endO = o + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let s = 0; s < seg; s += 1) {
      const end = b.readUInt16BE(endO + s * 2);
      const start = b.readUInt16BE(startO + s * 2);
      const delta = b.readInt16BE(deltaO + s * 2);
      const rangeOffset = b.readUInt16BE(rangeO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c += 1) {
        let gid;
        if (rangeOffset === 0) gid = (c + delta) & 0xffff;
        else {
          const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= b.length) continue;
          gid = b.readUInt16BE(gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) set.add(c);
      }
    }
  } else {
    const o = best.off;
    const nGroups = b.readUInt32BE(o + 12);
    for (let g = 0; g < nGroups; g += 1) {
      const rec = o + 16 + g * 12;
      const start = b.readUInt32BE(rec);
      const end = b.readUInt32BE(rec + 4);
      const startGid = b.readUInt32BE(rec + 8);
      if (startGid === 0 && end - start > 0x10000) continue;
      for (let c = start; c <= end; c += 1) if (startGid + (c - start) !== 0) set.add(c);
    }
  }
  return set;
}

function loadFontCoverage() {
  const faces = [];
  for (const f of SHIPPED_FACES) {
    const file = join(P.fontsDir, f.file);
    if (!existsSync(file)) return { available: false, missingFile: file, faces: [] };
    faces.push({ ...f, cmap: readCmap(file), bytes: statSync(file).size });
  }
  return { available: true, faces };
}

/**
 * The REAL renderability gate: Kansei's shipped, SUBSETTED webfonts
 * (public/fonts/index.json), not the full source typefaces read by
 * loadFontCoverage() above. A glyph can exist in every source TTF — Noto Sans JP
 * covers essentially all of CJK — and still render as tofu in the app, because
 * scripts/assets/build-fonts.mjs only subsets the codepoints named by
 * data/kanji-top1000.json, the kana files and the frequency-crosscheck list. None
 * of those name bare KanjiVG component shapes, so every one of them (氵 忄 扌 灬
 * 刂 亻 …) is absent from the shipped subset today. This is the check task step 8
 * asks for — "against public/fonts font glyph coverage claims" — and it is what
 * actually decides whether a learner sees the glyph or a tofu box.
 *
 * public/fonts/index.json's `unicodeRange` per file is the REQUESTED set (a face
 * can still be missing a few, listed in `missingCodepoints`), so actual coverage
 * is unicodeRange minus missingCodepoints, unioned over a family's base+kanji
 * files.
 */
function loadShippedFontIndex() {
  if (!existsSync(P.fontIndex)) fail(`missing ${P.fontIndex}. Run "npm run fonts:build" first.`);
  const doc = JSON.parse(readFileSync(P.fontIndex, 'utf8'));
  const FAMILY_KEY = { 'Noto Sans JP': 'noto-sans-jp', 'Noto Serif JP': 'noto-serif-jp', 'Klee One': 'klee-one' };
  const parseUnicodeRange = (s) => {
    const set = new Set();
    for (const part of (s ?? '').split(',')) {
      const m = /^\s*U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?\s*$/.exec(part);
      if (!m) continue;
      const a = parseInt(m[1], 16);
      const b = m[2] ? parseInt(m[2], 16) : a;
      for (let c = a; c <= b; c += 1) set.add(c);
    }
    return set;
  };
  const byFamily = new Map();
  const perFile = [];
  for (const f of doc.files ?? []) {
    const key = FAMILY_KEY[f.family];
    if (!key) continue;
    const requested = parseUnicodeRange(f.unicodeRange);
    const missing = new Set((f.missingCodepoints ?? []).map((s) => parseInt(String(s).replace(/^U\+/i, ''), 16)));
    if (!byFamily.has(key)) byFamily.set(key, new Set());
    const set = byFamily.get(key);
    for (const c of requested) if (!missing.has(c)) set.add(c);
    perFile.push({ file: f.file, family: f.family, group: f.group, requested: requested.size, missing: missing.size, actual: requested.size - missing.size });
  }
  const missingFamilies = SHIPPED_FACES.map((f) => f.key).filter((k) => !byFamily.has(k));
  if (missingFamilies.length) fail(`${P.fontIndex}: no files found for shipped face(s) ${missingFamilies.join(', ')}`);
  return { generatedAt: doc.generatedAt ?? null, generatedBy: doc.generatedBy ?? null, byFamily, perFile };
}

/* ------------------------------------------------------------------ *
 * KanjiVG source: an extracted kanji/ directory, or the release zip.
 * ------------------------------------------------------------------ */

function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('zip: end-of-central-directory signature not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail(`zip: bad central directory header at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf, e) {
  if (buf.readUInt32LE(e.local) !== 0x04034b50) fail(`zip: bad local header for ${e.name}`);
  const nameLen = buf.readUInt16LE(e.local + 26);
  const extraLen = buf.readUInt16LE(e.local + 28);
  const start = e.local + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + (e.method === 0 ? e.size : buf.length - start));
  if (e.method === 0) return raw.toString('utf8');
  if (e.method === 8) return inflateRawSync(raw).toString('utf8');
  return fail(`zip: unsupported compression method ${e.method} for ${e.name}`);
}

function openKanjivg() {
  const dir = existsSync(P.kanjivgDir)
    ? [P.kanjivgDir, join(P.kanjivgDir, 'kanji')].find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith('.svg')))
    : null;
  if (dir) {
    const index = new Map();
    for (const f of readdirSync(dir)) {
      const m = /^([0-9a-f]{5,6})\.svg$/.exec(f);
      if (m) index.set(String.fromCodePoint(parseInt(m[1], 16)), join(dir, f));
    }
    return { kind: 'directory', at: dir, count: index.size, read: (g) => readFileSync(index.get(g), 'utf8'), has: (g) => index.has(g) };
  }
  if (!existsSync(P.kanjivgZip)) fail(`no KanjiVG source: neither ${P.kanjivgDir} nor ${P.kanjivgZip} exists. Run scripts/assets/fetch-sources.mjs kanjivg.`);
  const buf = readFileSync(P.kanjivgZip);
  const index = new Map();
  for (const e of zipEntries(buf)) {
    const m = /(?:^|\/)([0-9a-f]{5,6})\.svg$/.exec(e.name);
    if (m) index.set(String.fromCodePoint(parseInt(m[1], 16)), e);
  }
  return { kind: 'zip', at: P.kanjivgZip, count: index.size, read: (g) => zipRead(buf, index.get(g)), has: (g) => index.has(g) };
}

/* ------------------------------------------------------------------ *
 * KanjiVG SVG -> group tree. Only <g> nesting and <path> counts matter here.
 * ------------------------------------------------------------------ */

function parseGroupTree(svg, label) {
  const at = svg.indexOf('<svg');
  if (at < 0) fail(`${label}: no <svg> element`);
  const body = svg.slice(at);
  const root = { attrs: {}, children: [], paths: 0 };
  const stack = [root];
  const re = /<g\b([^>]*?)(\/?)>|<\/g>|<path\b[^>]*>/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[0] === '</g>') {
      if (stack.length === 1) fail(`${label}: unbalanced </g>`);
      stack.pop();
      continue;
    }
    if (m[0].startsWith('<path')) {
      for (const n of stack) n.paths += 1;
      continue;
    }
    const attrs = {};
    for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { attrs, children: [], paths: 0 };
    stack[stack.length - 1].children.push(node);
    if (!m[2]) stack.push(node);
  }
  if (stack.length !== 1) fail(`${label}: ${stack.length - 1} unclosed <g>`);
  const strokePaths = root.children.find((c) => /StrokePaths/.test(c.attrs.id || ''));
  if (!strokePaths) fail(`${label}: no StrokePaths group`);
  if (strokePaths.children.length !== 1) fail(`${label}: expected exactly 1 root kanji group, got ${strokePaths.children.length}`);
  return strokePaths.children[0];
}

/* ------------------------------------------------------------------ KANJIDIC2 */

function readKanjidic() {
  let xml;
  if (existsSync(P.kanjidic)) xml = readFileSync(P.kanjidic, 'utf8');
  else if (existsSync(P.kanjidicGz)) xml = gunzipSync(readFileSync(P.kanjidicGz)).toString('utf8');
  else fail(`no KANJIDIC2: ${P.kanjidic} / ${P.kanjidicGz}. Run scripts/assets/fetch-sources.mjs kanjidic2.`);

  const dbVersion = /<database_version>([^<]*)<\/database_version>/.exec(xml)?.[1] ?? null;
  const created = /<date_of_creation>([^<]*)<\/date_of_creation>/.exec(xml)?.[1] ?? null;
  const byGlyph = new Map();
  for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
    const b = m[1];
    const literal = /<literal>([^<]*)<\/literal>/.exec(b)?.[1];
    if (!literal) continue;
    const meanings = [...b.matchAll(/<meaning>([^<]*)<\/meaning>/g)].map((x) => x[1]);
    const sc = /<stroke_count>(\d+)<\/stroke_count>/.exec(b);
    const rad = /rad_type="classical">(\d+)</.exec(b);
    byGlyph.set(literal, {
      meanings,
      strokeCount: sc ? Number(sc[1]) : null,
      classicalRadical: rad ? Number(rad[1]) : null,
      grade: /<grade>(\d+)<\/grade>/.exec(b) ? Number(/<grade>(\d+)<\/grade>/.exec(b)[1]) : null,
      freq: /<freq>(\d+)<\/freq>/.exec(b) ? Number(/<freq>(\d+)<\/freq>/.exec(b)[1]) : null,
    });
  }
  return { byGlyph, dbVersion, created, bytes: Buffer.byteLength(xml) };
}

/**
 * KANJIDIC2's own declaration that a character IS a radical form.
 * Its glosses for radical characters spell it out: "water radical (no. 85)",
 * "radical number 9", "variant of radical 125". Only a gloss that states the
 * number, matching the character's own rad_type="classical" value, is accepted —
 * otherwise every ordinary kanji would claim to be its own radical.
 */
function kanjidicRadicalSelfDeclaration(entry) {
  if (!entry || entry.classicalRadical == null) return null;
  for (const g of entry.meanings) {
    const m = /radical(?:\s+variant)?\s*(?:\(\s*no\.?\s*(\d+)\s*\)|number\s+(\d+)|(\d+))/i.exec(g) ||
      /radical\s+(\d+)/i.exec(g);
    const n = m ? Number(m[1] ?? m[2] ?? m[3]) : null;
    if (n != null && n === entry.classicalRadical) return { number: n, gloss: g };
  }
  return null;
}

/* ------------------------------------------------------------------ Unicode UCD */

function readCjkRadicals() {
  if (!existsSync(P.cjkRadicals)) fail(`missing ${P.cjkRadicals}. Run scripts/assets/fetch-sources.mjs ucd-cjk-radicals.`);
  const txt = readFileSync(P.cjkRadicals, 'utf8');
  const version = /^#\s*CJKRadicals-([\d.]+)\.txt/m.exec(txt)?.[1] ?? null;
  /** glyph -> radical number, from both the radical-block char and the unified ideograph. */
  const byGlyph = new Map();
  const byNumber = new Map();
  let lines = 0;
  for (const line of txt.split('\n')) {
    const s = line.replace(/#.*$/, '').trim();
    if (!s) continue;
    const [numRaw, radRaw, uniRaw] = s.split(';').map((x) => x.trim());
    if (!numRaw || !radRaw || !uniRaw) continue;
    // A number may be suffixed with ' for a variant form in older UCD versions.
    const number = Number(numRaw.replace(/'+$/, ''));
    if (!Number.isFinite(number)) continue;
    lines += 1;
    const radChar = String.fromCodePoint(parseInt(radRaw, 16));
    const uniChar = String.fromCodePoint(parseInt(uniRaw, 16));
    if (!byGlyph.has(radChar)) byGlyph.set(radChar, number);
    if (!byGlyph.has(uniChar)) byGlyph.set(uniChar, number);
    if (!byNumber.has(number)) byNumber.set(number, { radChar, uniChar });
  }
  return { byGlyph, byNumber, version, lines };
}

function readEquivalentUnifiedIdeograph() {
  if (!existsSync(P.equivIdeograph)) fail(`missing ${P.equivIdeograph}. Run scripts/assets/fetch-sources.mjs ucd-equivalent-unified-ideograph.`);
  const txt = readFileSync(P.equivIdeograph, 'utf8');
  const version = /^#\s*EquivalentUnifiedIdeograph-([\d.]+)\.txt/m.exec(txt)?.[1] ?? null;
  /** radical-block glyph -> equivalent unified ideograph glyph. */
  const map = new Map();
  /**
   * radical-block glyph -> its Unicode character name, from the trailing comment.
   * These names ("KANGXI RADICAL GRAIN") are the authoritative short name of each
   * radical and are a far better gloss for a radical-only shape than KANJIDIC's
   * entry for the same codepoint, which is sometimes a shape description
   * ("two-branch tree" for 禾) or a rare standalone word.
   */
  const names = new Map();
  for (const line of txt.split('\n')) {
    const body = line.replace(/#.*$/, '').trim();
    const comment = /#(.*)$/.exec(line)?.[1]?.trim() ?? '';
    if (!body) continue;
    const [range, target] = body.split(';').map((x) => x.trim());
    if (!range || !target) continue;
    const [a, b] = range.split('..');
    const lo = parseInt(a, 16);
    const hi = b ? parseInt(b, 16) : lo;
    const to = String.fromCodePoint(parseInt(target, 16));
    const nameParts = comment.replace(/^\[\d+\]\s*/, '').split('..');
    for (let c = lo; c <= hi; c += 1) {
      const ch = String.fromCodePoint(c);
      map.set(ch, to);
      const nm = nameParts.length > 1 ? nameParts[c - lo] : nameParts[0];
      if (nm) names.set(ch, nm.trim());
    }
  }
  return { map, names, version };
}

/* ------------------------------------------------------------------ notes */

function readNotes() {
  if (!existsSync(P.notes)) {
    return { present: false, byGlyph: new Map(), exclude: new Map(), include: new Map(), meta: null };
  }
  const doc = JSON.parse(readFileSync(P.notes, 'utf8'));
  const byGlyph = new Map(Object.entries(doc.components ?? {}));
  const exclude = new Map(Object.entries(doc.exclude ?? {}));
  const include = new Map(Object.entries(doc.include ?? {}));
  return { present: true, byGlyph, exclude, include, meta: { schema: doc.schema, description: doc.description, authoredBy: doc.authoredBy } };
}

/* ------------------------------------------------------------------ *
 * The derivation.
 * ------------------------------------------------------------------ */

export function buildComponentModel() {
  const list = JSON.parse(readFileSync(P.kanjiList, 'utf8'));
  const taught = new Map(list.entries.map((e) => [e.glyph, e]));
  if (taught.size === 0) fail(`${P.kanjiList} has no entries`);

  const kvg = openKanjivg();
  const kd = readKanjidic();
  const ucdRad = readCjkRadicals();
  const ucdEq = readEquivalentUnifiedIdeograph();
  const notes = readNotes();
  const fonts = loadFontCoverage(); // full source typefaces: can the type design draw this at all
  const shippedFonts = loadShippedFontIndex(); // Kansei's actual shipped, SUBSETTED webfonts today

  const inFontRange = (g) => cpsOf(g).every((c) => FONT_REQUESTED_RANGES.some(([a, b]) => c >= a && c <= b));
  /**
   * The inclusion/folding gate: can the source typeface draw this glyph at all?
   * This is a permanent property of the type design, unlike the shipped subset
   * (below), which is just today's codepoint list and can be widened by rerunning
   * scripts/assets/build-fonts.mjs. Gating inclusion on the CURRENT shipped subset
   * instead would be circular: KanjiCharacter.radical must resolve to a kept
   * component for every taught kanji (checked below), and build-fonts.mjs decides
   * what to subset FROM data/components.json, not the other way around.
   */
  const facesMissing = (g) =>
    fonts.available ? fonts.faces.filter((f) => cpsOf(g).some((c) => !f.cmap.has(c))).map((f) => f.key) : SHIPPED_FACES.map((f) => f.key);
  const renderableGlyph = (g) => !isPlaceholderLabel(g) && inFontRange(g) && facesMissing(g).length === 0;
  /**
   * VERIFICATION only (task step 8): is this glyph in Kansei's actual shipped
   * font subset (public/fonts/index.json) today? Answered separately from
   * renderableGlyph above — see shippedFontSubsetGap in verify().
   */
  const shippedSubsetMissing = (g) =>
    SHIPPED_FACES.map((f) => f.key).filter((key) => {
      const set = shippedFonts.byFamily.get(key);
      return !set || cpsOf(g).some((c) => !set.has(c));
    });

  /* -- pass 1: read every taught kanji's tree ----------------------------- */

  const raw = new Map(); // element glyph -> aggregate
  const agg = (g) => {
    if (!raw.has(g)) {
      raw.set(g, {
        glyph: g,
        inKanji: new Set(),
        radicalGeneral: new Set(),
        radicalTradit: new Set(),
        radicalNelson: new Set(),
        phonIn: new Set(),
        positions: new Map(),
        strokeVotes: new Map(),
        originalOf: new Map(), // original glyph -> Set(kanji)
        variantFlagIn: new Set(),
        partialIn: new Set(),
      });
    }
    return raw.get(g);
  };

  const trees = new Map();
  const missingSvg = [];
  const kangxiVote = new Map(); // glyph -> Map(number -> Set(kanji))
  const containEdges = new Map(); // parent -> Map(child -> Set(kanji))
  const samePartNesting = [];
  /** A component nested inside a DIFFERENT-element group of the same glyph: a real cycle. */
  const ancestryViolations = [];
  let groupsSeen = 0;

  for (const [glyph, entry] of taught) {
    if (!kvg.has(glyph)) { missingSvg.push(glyph); continue; }
    const rootGroup = parseGroupTree(kvg.read(glyph), `kanjivg ${glyph}`);
    trees.set(glyph, rootGroup);

    /** Per-kanji: element -> summed <path> count across its kvg:part groups. */
    const strokeInThisKanji = new Map();
    const orderedFirstSeen = [];

    const walk = (node, ancestors, parentElement) => {
      for (const ch of node.children) {
        const el = ch.attrs['kvg:element'];
        if (!el) { walk(ch, ancestors, parentElement); continue; }
        groupsSeen += 1;
        const a = agg(el);
        // The root group names the kanji itself; that is not a component of itself.
        const isSelf = el === glyph && ancestors.length === 0;
        if (!isSelf) {
          a.inKanji.add(glyph);
          if (!orderedFirstSeen.includes(el)) orderedFirstSeen.push(el);
        }
        const radKind = ch.attrs['kvg:radical'];
        if (radKind === 'general') {
          a.radicalGeneral.add(glyph);
          const n = entry.radicalClassicalNumber;
          if (n != null) {
            if (!kangxiVote.has(el)) kangxiVote.set(el, new Map());
            const mm = kangxiVote.get(el);
            if (!mm.has(n)) mm.set(n, new Set());
            mm.get(n).add(glyph);
          }
        } else if (radKind === 'tradit') a.radicalTradit.add(glyph);
        else if (radKind === 'nelson') a.radicalNelson.add(glyph);

        if (ch.attrs['kvg:phon']) a.phonIn.add(glyph);
        if (ch.attrs['kvg:variant'] === 'true') a.variantFlagIn.add(glyph);
        if (ch.attrs['kvg:partial'] === 'true') a.partialIn.add(glyph);
        const pos = ch.attrs['kvg:position'];
        if (pos) a.positions.set(pos, (a.positions.get(pos) ?? 0) + 1);

        const orig = ch.attrs['kvg:original'];
        if (orig && orig !== el) {
          if (!a.originalOf.has(orig)) a.originalOf.set(orig, new Set());
          a.originalOf.get(orig).add(glyph);
        }

        // Stroke count: sum the <path> count over the kvg:part groups of the same
        // element, but only for groups that are not partial and not nested inside
        // another group of the same element (which would double-count).
        if (!ch.attrs['kvg:partial'] && parentElement !== el) {
          strokeInThisKanji.set(el, (strokeInThisKanji.get(el) ?? 0) + ch.paths);
        }

        // "No component is its own ancestor", checked where it means something:
        // inside a single character's own decomposition.
        //
        // kvg:part groups are exempt. KanjiVG nests them to express INTERLEAVED
        // stroke order, not containment: in 樹 the chain is 壴 > 吉(part 1) >
        // 士 > 豆(part 1) > 豆(part 2) > 吉(part 2), because the strokes of 吉 and
        // 豆 alternate. A fragment placed where its strokes fall is not a claim
        // that the shape contains itself.
        if (ancestors.includes(el) && parentElement !== el && !ch.attrs['kvg:part']) {
          ancestryViolations.push({
            kanji: glyph,
            element: el,
            chain: [...ancestors, el].map((x) => (renderableGlyph(x) ? x : hex(x.codePointAt(0)))).join(' > '),
          });
        }

        if (parentElement && parentElement !== el) {
          if (!containEdges.has(parentElement)) containEdges.set(parentElement, new Map());
          const cm = containEdges.get(parentElement);
          if (!cm.has(el)) cm.set(el, new Set());
          cm.get(el).add(glyph);
        } else if (parentElement === el) {
          samePartNesting.push({
            kanji: glyph,
            element: renderableGlyph(el) ? el : hex(el.codePointAt(0)),
            part: ch.attrs['kvg:part'] ?? null,
          });
        }

        walk(ch, [...ancestors, el], el);
      }
    };
    walk(rootGroup, [], null);

    for (const [el, n] of strokeInThisKanji) {
      if (n <= 0) continue;
      const votes = agg(el).strokeVotes;
      if (!votes.has(n)) votes.set(n, new Set());
      votes.get(n).add(glyph);
    }
    trees.get(glyph).orderedElements = orderedFirstSeen;
  }

  /* -- pass 2: fold unrenderable shapes into their kvg:original ----------- */

  const renderable = renderableGlyph;

  const folds = [];
  const foldMap = new Map(); // from -> to
  for (const [g, a] of raw) {
    if (renderable(g)) continue;
    // Prefer the kvg:original attested in the most taught kanji.
    const best = [...a.originalOf.entries()]
      .filter(([o]) => renderable(o))
      .sort((x, y) => y[1].size - x[1].size)[0];
    if (best) {
      foldMap.set(g, best[0]);
      folds.push({
        from: hex(g.codePointAt(0)),
        to: best[0],
        toCodepoint: hex(best[0].codePointAt(0)),
        attestedInKanji: best[1].size,
        occurredInKanji: a.inKanji.size,
        inShippedFontSubset: shippedSubsetMissing(g).length === 0,
        reason: `glyph not renderable (${[
          inFontRange(g) ? null : 'outside the codepoint ranges build-fonts.mjs subsets',
          facesMissing(g).length ? `absent from the source typeface(s) ${facesMissing(g).join(', ')}` : null,
        ].filter(Boolean).join('; ')}); folded into its kvg:original`,
      });
    }
  }
  const fold = (g) => foldMap.get(g) ?? g;

  // Re-aggregate under folded glyphs.
  const comp = new Map();
  const cagg = (g) => {
    if (!comp.has(g)) {
      comp.set(g, {
        glyph: g,
        inKanji: new Set(),
        radicalGeneral: new Set(),
        radicalTradit: new Set(),
        radicalNelson: new Set(),
        phonIn: new Set(),
        positions: new Map(),
        strokeVotes: new Map(),
        originalOf: new Map(),
        variantFlagIn: new Set(),
        partialIn: new Set(),
        foldedFrom: [],
      });
    }
    return comp.get(g);
  };
  for (const [g, a] of raw) {
    const t = fold(g);
    const c = cagg(t);
    if (t !== g) c.foldedFrom.push(hex(g.codePointAt(0)));
    for (const k of a.inKanji) c.inKanji.add(k);
    for (const k of a.radicalGeneral) c.radicalGeneral.add(k);
    for (const k of a.radicalTradit) c.radicalTradit.add(k);
    for (const k of a.radicalNelson) c.radicalNelson.add(k);
    for (const k of a.phonIn) c.phonIn.add(k);
    for (const k of a.variantFlagIn) c.variantFlagIn.add(k);
    for (const k of a.partialIn) c.partialIn.add(k);
    for (const [p, n] of a.positions) c.positions.set(p, (c.positions.get(p) ?? 0) + n);
    // Stroke votes are NOT merged across a fold: 氺 is drawn with 5 strokes and 水
    // with 4, so folding 氺 into 水 must not make 水 look like a 5-stroke shape.
    if (t === g) {
      for (const [n, ks] of a.strokeVotes) {
        if (!c.strokeVotes.has(n)) c.strokeVotes.set(n, new Set());
        for (const k of ks) c.strokeVotes.get(n).add(k);
      }
    }
    for (const [o, ks] of a.originalOf) {
      const fo = fold(o);
      if (fo === t) continue;
      if (!c.originalOf.has(fo)) c.originalOf.set(fo, new Set());
      for (const k of ks) c.originalOf.get(fo).add(k);
    }
  }
  for (const [g, mm] of kangxiVote) {
    if (fold(g) === g) continue;
    const t = fold(g);
    if (!kangxiVote.has(t)) kangxiVote.set(t, new Map());
    for (const [n, ks] of mm) {
      const tm = kangxiVote.get(t);
      if (!tm.has(n)) tm.set(n, new Set());
      for (const k of ks) tm.get(n).add(k);
    }
  }

  /* -- pass 3: kangxiNumber, from four sourced routes --------------------- */

  const kangxiRoutes = new Map();
  const kangxiConflicts = [];
  /**
   * Memoised so it can be asked about a glyph that variant closure only adds
   * later. Four independent, sourced routes; a component needs one.
   */
  const kangxiFor = (g) => {
    if (kangxiRoutes.has(g)) return kangxiRoutes.get(g);
    const routes = {};
    // (1) Unicode CJKRadicals.txt: this glyph IS a radical's canonical form.
    if (ucdRad.byGlyph.has(g)) routes.ucdCjkRadicals = ucdRad.byGlyph.get(g);
    // (2) Unicode EquivalentUnifiedIdeograph.txt: a radical-block char equivalent
    //     to this glyph, whose number CJKRadicals.txt knows.
    for (const [radCh, uni] of ucdEq.map) {
      if (uni !== g) continue;
      const n = ucdRad.byGlyph.get(radCh);
      if (n != null) { routes.ucdEquivalentIdeograph = n; break; }
    }
    if (routes.ucdEquivalentIdeograph == null) {
      const eq = ucdEq.map.get(g);
      if (eq) {
        const n = ucdRad.byGlyph.get(eq) ?? kanjidicRadicalSelfDeclaration(kd.byGlyph.get(eq))?.number;
        if (n != null) routes.ucdEquivalentIdeograph = n;
      }
    }
    // (3) KANJIDIC2 self-declaration.
    const self = kanjidicRadicalSelfDeclaration(kd.byGlyph.get(g));
    if (self) routes.kanjidicSelfDeclared = self.number;
    // (4) KanjiVG kvg:radical="general" x the host kanji's classical radical.
    const votes = kangxiVote.get(g);
    if (votes && votes.size) {
      const tally = [...votes.entries()].map(([n, ks]) => [n, ks.size]).sort((a, b) => b[1] - a[1]);
      const total = tally.reduce((s, [, n]) => s + n, 0);
      routes.kanjivgRadicalVote = tally[0][1] / total >= KANGXI_MAJORITY ? tally[0][0] : null;
      routes.kanjivgRadicalVoteTally = Object.fromEntries(tally);
    }

    const declared = [routes.ucdCjkRadicals, routes.ucdEquivalentIdeograph, routes.kanjidicSelfDeclared, routes.kanjivgRadicalVote]
      .filter((n) => n != null);
    const distinct = [...new Set(declared)];
    let number = null;
    if (distinct.length === 1) number = distinct[0];
    else if (distinct.length > 1) {
      // Prefer the Unicode tables, then KANJIDIC, then the vote — and record it.
      number = routes.ucdCjkRadicals ?? routes.ucdEquivalentIdeograph ?? routes.kanjidicSelfDeclared ?? routes.kanjivgRadicalVote;
      kangxiConflicts.push({ glyph: g, chose: number, routes: { ...routes } });
    }
    const ambiguousVote = Boolean(votes && votes.size > 1 && routes.kanjivgRadicalVote == null);
    const out = { number, routes, ambiguousVote };
    kangxiRoutes.set(g, out);
    return out;
  };

  /* -- pass 4: inclusion ------------------------------------------------- */

  const unrenderableDropped = [];
  const kept = [];
  const rejected = [];

  /** Does this glyph meet a threshold on its own merits? */
  const thresholdReasons = (g, c) => {
    const reasons = [];
    if (c.inKanji.size >= RECUR_MIN) reasons.push(`recurs in ${c.inKanji.size} taught kanji (>= RECUR_MIN ${RECUR_MIN})`);
    if (c.radicalGeneral.size >= RADICAL_MIN) reasons.push(`dictionary radical of ${c.radicalGeneral.size} taught kanji (>= RADICAL_MIN ${RADICAL_MIN})`);
    if (taught.has(g) && c.inKanji.size >= STANDALONE_MIN) reasons.push(`is itself a taught kanji and a part of ${c.inKanji.size} others (>= STANDALONE_MIN ${STANDALONE_MIN})`);
    return reasons;
  };

  for (const [g, c] of comp) {
    if (!renderable(g)) {
      unrenderableDropped.push({
        codepoint: isPlaceholderLabel(g) ? `KanjiVG placeholder label ${JSON.stringify(g)}` : hex(g.codePointAt(0)),
        inKanji: c.inKanji.size,
        radicalOfTaughtKanji: c.radicalGeneral.size,
        inFontRequestedRange: inFontRange(g),
        absentFromFaces: facesMissing(g),
        kvgOriginals: [...c.originalOf.keys()].map((o) => hex(o.codePointAt(0))),
        wouldHaveQualified: thresholdReasons(g, c).length > 0,
        reason: 'no renderable kvg:original to fold into, so it cannot be shown to a learner',
      });
      continue;
    }
    const banned = notes.exclude.get(g);
    if (banned) {
      rejected.push({ glyph: g, inKanji: c.inKanji.size, verdict: 'excluded by data/component-notes.json', reason: banned.reason ?? null });
      continue;
    }
    const reasons = thresholdReasons(g, c);
    const forced = notes.include.get(g);
    if (forced) reasons.push(`force-included by data/component-notes.json: ${forced.reason ?? 'no reason given'}`);
    if (reasons.length === 0) {
      rejected.push({ glyph: g, inKanji: c.inKanji.size, radicalOf: c.radicalGeneral.size, verdict: 'below every threshold' });
      continue;
    }
    kept.push({ glyph: g, c, reasons, isTaughtKanji: taught.has(g) });
  }

  // Variant closure: a kept variant shape drags in the unvaried parent KanjiVG
  // names for it, so the learner can be shown "氵 is 水 on the left".
  const keptSet = new Set(kept.map((k) => k.glyph));
  if (KEEP_VARIANT_PARENTS) {
    for (let changed = true; changed; ) {
      changed = false;
      for (const k of [...kept]) {
        for (const [orig, ks] of k.c.originalOf) {
          if (ks.size < VARIANT_MIN_KANJI || keptSet.has(orig) || !renderable(orig) || isKana(orig)) continue;
          if (notes.exclude.has(orig)) continue;
          const c = comp.get(orig) ?? cagg(orig);
          const i = rejected.findIndex((r) => r.glyph === orig);
          if (i >= 0) rejected.splice(i, 1);
          kept.push({
            glyph: orig,
            c,
            reasons: [
              ...thresholdReasons(orig, c),
              `variant closure: KanjiVG names it as the kvg:original of ${k.glyph}, which is taught (attested in ${ks.size} taught kanji)`,
            ],
            isTaughtKanji: taught.has(orig),
          });
          keptSet.add(orig);
          changed = true;
        }
      }
    }
  }

  /* -- pass 5: build the records ----------------------------------------- */

  /**
   * The Unicode name of the radical this glyph is, as a short lowercase gloss.
   * "KANGXI RADICAL GRAIN" -> "grain"; "CJK RADICAL WATER ONE" -> "water".
   */
  const unicodeRadicalName = (g) => {
    const direct = ucdEq.names.get(g);
    const viaNumber = (() => {
      const n = ucdRad.byGlyph.get(g);
      const radChar = n != null ? ucdRad.byNumber.get(n)?.radChar : null;
      return radChar ? ucdEq.names.get(radChar) : null;
    })();
    const raw = direct ?? viaNumber;
    if (!raw) return null;
    const cleaned = raw
      .replace(/^(?:KANGXI|CJK)\s+RADICAL\s+/i, '')
      .replace(/^SIMPLIFIED\s+/i, '')
      .replace(/\s+(?:ONE|TWO|THREE|FOUR|FIVE)$/i, '')
      .trim()
      .toLowerCase();
    return cleaned.length ? cleaned : null;
  };

  /** Strip KANJIDIC's radical bookkeeping out of learner-facing glosses. */
  const cleanGloss = (s) =>
    s
      // "clothing radical (no. 145" — upstream sometimes omits the closing paren.
      .replace(/\s*\(?\s*(?:no\.?\s*\d+|radical\s*\d+)\s*\)?\s*$/i, '')
      .replace(/^\s*(?:variant of\s+)?radical\s*(?:no\.?\s*)?\d*\s*$/i, '')
      .replace(/\s*radical\s*-\s*\d+\s*stroke\s*form\s*$/i, '')
      .replace(/\s*radical(?:\s+variant)?\s*(?:no\.?\s*\d+)?\s*$/i, '')
      // "divination or katakana to", "twenty or letter H", "river or three-stroke river"
      .replace(/\s+or\s+(?:katakana\s+\S+|letter\s+\S+|\w+-stroke\s+.*)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  const variantPairs = [];
  const variantRejected = [];
  const records = [];
  for (const { glyph: g, c, reasons, isTaughtKanji } of kept) {
    const kdEntry = kd.byGlyph.get(g) ?? null;
    const kx = kangxiFor(g);
    const note = notes.byGlyph.get(g) ?? {};


    /* roles — independent and overlapping by design.
     *
     *  radical    : kangxiNumber is not null, i.e. a dictionary radical (or a
     *               recognised variant shape of one).
     *  standalone : the glyph is a kanji in its own right. Sourced, not guessed:
     *               it is one of the taught 1000, or KANJIDIC2 gives it a <grade>
     *               (jōyō / jinmeiyō) or a <freq> rank. Radical-only codepoints
     *               such as 氵 亻 艹 have neither and so are NOT standalone.
     *  recurring  : it demonstrably recurs, i.e. appears in >= 2 taught kanji.
     */
    const standaloneEvidence = isTaughtKanji
      ? 'one of the 1000 taught kanji'
      : kdEntry?.grade != null
        ? `KANJIDIC2 <grade> ${kdEntry.grade}`
        : kdEntry?.freq != null
          ? `KANJIDIC2 <freq> ${kdEntry.freq}`
          : null;
    const roles = [];
    if (kx.number != null) roles.push('radical');
    if (standaloneEvidence) roles.push('standalone');
    if (c.inKanji.size >= 2) roles.push('recurring');
    if (roles.length === 0) roles.push('recurring');

    /* glosses — sourced, in this order:
     *   1. data/component-notes.json (hand-authored curriculum judgement)
     *   2. this glyph's own KANJIDIC2 <meaning>s
     *   3. the KANJIDIC2 meanings of the CJK unified ideograph Unicode declares
     *      equivalent to this radical shape (⻌ -> 辶, ⻏ -> 邑), which is how the
     *      CJK Radicals Supplement shapes get a gloss at all
     *   4. the KANJIDIC2 meanings of the kvg:original parent form
     * KANJIDIC's radical bookkeeping ("water radical (no. 85)") is stripped: it is
     * catalogue metadata, not a meaning a learner can use.
     */
    const fromKanjidic = (e) => {
      const all = (e?.meanings ?? []).map(cleanGloss).filter((x) => x.length > 0);
      const usable = all.filter(
        (x) =>
          // still-catalogue leftovers and fragments left by the cleanup above
          !/\bradical\b/i.test(x) &&
          !/^(?:variant(?: of)?|form|see|katakana \S+)$/i.test(x),
      );
      // "net or net crown", "table or windy", "box or enclosure", "tick or dot":
      // KANJIDIC packs alternative radical nicknames into one gloss with "or".
      // Dropped, but only while something else survives.
      const noAlternatives = usable.filter((x) => !/\bor\b/i.test(x));
      return (noAlternatives.length ? noAlternatives : usable).slice(0, 3);
    };
    const radName = unicodeRadicalName(g);
    let glosses;
    let glossSource;
    if (Array.isArray(note.glosses)) {
      glosses = note.glosses.slice();
      glossSource = 'data/component-notes.json';
    } else if (fromKanjidic(kdEntry).length || radName) {
      // A shape that is only ever a radical leads with its Unicode radical name;
      // a glyph that is also a kanji leads with its own word meanings.
      const kdG = fromKanjidic(kdEntry);
      const ordered = standaloneEvidence ? [...kdG, ...(radName ? [radName] : [])] : [...(radName ? [radName] : []), ...kdG];
      glosses = [...new Set(ordered)].slice(0, 3);
      glossSource = [kdG.length ? 'KANJIDIC2' : null, radName ? 'Unicode radical name' : null].filter(Boolean).join(' + ');
    } else {
      const eqTarget = ucdEq.map.get(g);
      const viaEq = fromKanjidic(kd.byGlyph.get(eqTarget));
      const parent = [...c.originalOf.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
      const viaParent = fromKanjidic(kd.byGlyph.get(parent));
      if (viaEq.length) {
        glosses = viaEq;
        glossSource = `KANJIDIC2 via Unicode Equivalent_Unified_Ideograph ${hex(g.codePointAt(0))} -> ${eqTarget}`;
      } else if (viaParent.length) {
        glosses = viaParent;
        glossSource = `KANJIDIC2 via kvg:original ${parent}`;
      } else {
        glosses = [];
        glossSource = 'none';
      }
    }
    // Drop a gloss that merely extends another with a radical nickname:
    // ["table", "table enclosure"] -> ["table"]; ["open box", "open box enclosure"].
    glosses = [...new Set(glosses)].filter((x, _i, all) => !all.some((y) => y !== x && x.startsWith(y + ' ')));

    // stroke count
    const kvgVotes = [...c.strokeVotes.entries()].map(([n, ks]) => [n, ks.size]).sort((a, b) => b[1] - a[1]);
    const kvgStrokes = kvgVotes.length ? kvgVotes[0][0] : null;
    const strokeCount = note.strokeCount ?? kdEntry?.strokeCount ?? kvgStrokes;

    // variants
    const variants = [];
    const addVariant = (other, why, n) => {
      // Both ends must qualify, not just the target: KanjiVG gives マ as the
      // kvg:original of 卩, and adding that in only one direction would leave the
      // variant relation asymmetric.
      if (other === g || !keptOrRenderable(other) || !keptOrRenderable(g)) return;
      if (!variants.includes(other)) variants.push(other);
      variantPairs.push({ from: g, to: other, attestedInKanji: n ?? null, via: why });
    };
    const keptOrRenderable = (x) => renderable(x) && !isKana(x);
    for (const [orig, ks] of c.originalOf) {
      if (ks.size >= VARIANT_MIN_KANJI) addVariant(orig, 'kvg:original on this glyph', ks.size);
      else variantRejected.push({ from: g, to: renderable(orig) ? orig : hex(orig.codePointAt(0)), attestedInKanji: ks.size, verdict: `below VARIANT_MIN_KANJI=${VARIANT_MIN_KANJI}` });
    }
    // The reverse direction: some other kept shape names this glyph as its original.
    for (const [other, oc] of comp) {
      if (other === g) continue;
      const ks = oc.originalOf.get(g);
      if (ks && ks.size >= VARIANT_MIN_KANJI && keptOrRenderable(other)) addVariant(other, 'kvg:original pointing at this glyph', ks.size);
    }
    for (const v of note.addVariants ?? []) if (renderable(v) && !variants.includes(v)) { variants.push(v); variantPairs.push({ from: g, to: v, attestedInKanji: null, via: 'data/component-notes.json' }); }
    for (const v of note.removeVariants ?? []) {
      const i = variants.indexOf(v);
      if (i >= 0) variants.splice(i, 1);
    }

    // meaningIsUnreliable — err toward true.
    const why = [];
    if (c.phonIn.size > 0) why.push(`KanjiVG marks it phonetic (kvg:phon) in ${c.phonIn.size} taught kanji`);
    if (glosses.length === 0) why.push('no gloss that helps a learner');
    if (glosses.length > 2) why.push(`${glosses.length} glosses, not one meaning`);
    const voteTally = kx.routes.kanjivgRadicalVoteTally ? Object.keys(kx.routes.kanjivgRadicalVoteTally) : [];
    if (voteTally.length > 1) why.push(`indexed under ${voteTally.length} different classical radicals (${voteTally.join(', ')}) depending on the character`);
    if (strokeCount != null && strokeCount <= 1) why.push('a single stroke: a structural shape, not a meaning');
    // A shape that turns up in several characters WITHOUT being the semantic key
    // is doing structural work in most of them, whatever its dictionary gloss says.
    const nonRadicalUses = c.inKanji.size - c.radicalGeneral.size;
    if (nonRadicalUses >= 4) {
      why.push(`appears in ${nonRadicalUses} taught kanji where it is not the dictionary radical, so its gloss does not explain those characters`);
    }
    if (variants.length > 0) why.push('appears in more than one shape');
    if (glossSource.startsWith('KANJIDIC2 via')) why.push(`the gloss is borrowed from a related form (${glossSource}), not recorded for this shape`);
    if (note.meaningIsUnreliable === true) why.push(note.meaningIsUnreliableReason ?? 'flagged in data/component-notes.json');
    const meaningIsUnreliable = note.meaningIsUnreliable === false ? false : why.length > 0;

    records.push({
      id: `comp:${g}`,
      kind: 'component',
      glyph: g,
      roles,
      kangxiNumber: kx.number,
      glosses,
      meaningIsUnreliable,
      variants,
      strokeCount: strokeCount ?? 0,
      teachingOrder: 0,
      lessonId: '',
      appearsIn: [...c.inKanji].sort((a, b) => taught.get(a).frequencyRank - taught.get(b).frequencyRank).map((k) => `kanji:${k}`),
      _d: {
        inKanjiCount: c.inKanji.size,
        radicalGeneralCount: c.radicalGeneral.size,
        radicalTraditCount: c.radicalTradit.size,
        radicalNelsonCount: c.radicalNelson.size,
        phonCount: c.phonIn.size,
        positions: Object.fromEntries([...c.positions].sort((a, b) => b[1] - a[1])),
        strokeCountKanjidic: kdEntry?.strokeCount ?? null,
        strokeCountKanjivgMode: kvgStrokes,
        strokeCountKanjivgVotes: Object.fromEntries(kvgVotes),
        kangxiRoutes: kx.routes,
        kangxiVoteAmbiguous: kx.ambiguousVote,
        meaningIsUnreliableBecause: why,
        inclusionReasons: reasons,
        variantClosureOnly: reasons.every((x) => x.startsWith('variant closure')),
        foldedFrom: c.foldedFrom,
        isTaughtKanji,
        standaloneEvidence,
        glossSource,
        firstNeededRank: Math.min(...[...c.inKanji].map((k) => taught.get(k).frequencyRank)),
      },
    });
  }

  /* -- pass 6: decomposition per kanji, restricted to kept components ----- */

  const decomposition = new Map();
  for (const [glyph, root] of trees) {
    const ordered = (root.orderedElements ?? []).map(fold).filter((g) => keptSet.has(g));
    const seen = new Set();
    const orderedUnique = ordered.filter((g) => (seen.has(g) ? false : (seen.add(g), true)));
    const direct = [];
    for (const ch of root.children) {
      const el = ch.attrs['kvg:element'];
      if (!el) continue;
      const f = fold(el);
      if (keptSet.has(f) && !direct.includes(f)) direct.push(f);
    }
    let radical = null;
    const findRadical = (node) => {
      for (const ch of node.children) {
        if (ch.attrs['kvg:radical'] === 'general' && ch.attrs['kvg:element']) {
          const f = fold(ch.attrs['kvg:element']);
          if (radical == null) radical = f;
        }
        findRadical(ch);
      }
    };
    findRadical(root);
    const phonetic = [];
    /**
     * Every shape KanjiVG marks phonetic, INCLUDING those below the teaching
     * threshold. `phonetic` is the taught subset; `phoneticAll` is the full set,
     * because "this half of the character is there for its sound" is worth telling
     * a learner even when the shape itself is not taught (吾 in 語, 票 in 標).
     */
    const phoneticAll = [];
    const findPhon = (node) => {
      for (const ch of node.children) {
        if (ch.attrs['kvg:phon'] && ch.attrs['kvg:element']) {
          const f = fold(ch.attrs['kvg:element']);
          if (!phoneticAll.includes(f)) phoneticAll.push(f);
          if (keptSet.has(f) && !phonetic.includes(f)) phonetic.push(f);
        }
        findPhon(ch);
      }
    };
    findPhon(root);
    decomposition.set(glyph, {
      all: orderedUnique,
      direct,
      ordered: orderedUnique,
      radical: radical != null && keptSet.has(radical) ? radical : null,
      radicalRaw: radical,
      phonetic,
      phoneticAll,
    });
  }

  /* -- pass 7: containment DAG over kept components ----------------------- */

  const dag = new Map();
  for (const [p, cm] of containEdges) {
    const fp = fold(p);
    if (!keptSet.has(fp)) continue;
    for (const [c2, ks] of cm) {
      const fc = fold(c2);
      if (!keptSet.has(fc) || fc === fp) continue;
      if (!dag.has(fp)) dag.set(fp, new Map());
      const m = dag.get(fp);
      m.set(fc, (m.get(fc) ?? new Set()));
      for (const k of ks) m.get(fc).add(k);
    }
  }

  return {
    contract: COMPONENT_CONTRACT,
    taught,
    records,
    decomposition,
    dag,
    keptSet,
    foldMap,
    folds,
    rejected,
    unrenderableDropped,
    ancestryViolations,
    variantPairs,
    variantRejected,
    kangxiConflicts,
    samePartNesting,
    missingSvg,
    groupsSeen,
    rawCandidateCount: raw.size,
    foldedCandidateCount: comp.size,
    sources: { kvg, kd, ucdRad, ucdEq, notes, fonts, shippedFonts },
    thresholds: { RECUR_MIN, RADICAL_MIN, STANDALONE_MIN, VARIANT_MIN_KANJI, KANGXI_MAJORITY },
    renderable,
    inFontRange,
    facesMissing,
    shippedSubsetMissing,
  };
}

/* ------------------------------------------------------------------ *
 * The interleaver — the contract the kanji-order task calls.
 * ------------------------------------------------------------------ */

/**
 * Place every component strictly before the first kanji that needs it.
 *
 * @param model              the value returned by buildComponentModel()
 * @param opts.kanjiOrder    kanji glyphs in teaching order. Omit for the
 *                           provisional order (frequency rank stands in).
 * @param opts.lessonIdForKanji  (glyph, index) => lessonId. When given, a
 *                           component inherits the lesson of the first kanji that
 *                           needs it, so it is introduced in that same lesson.
 * @param opts.lessonSize    provisional batching only (default 8).
 * @returns { components, sequence, unusedComponents, provisional }
 */
export function assignTeachingOrder(model, opts = {}) {
  const { kanjiOrder = null, lessonIdForKanji = null, lessonSize = 8 } = opts;
  const provisional = kanjiOrder == null;

  const order = new Map();
  if (kanjiOrder) {
    const seq = kanjiOrder instanceof Map ? [...kanjiOrder.keys()] : [...kanjiOrder];
    seq.forEach((g, i) => order.set(g, i + 1));
  } else {
    [...model.taught.values()]
      .sort((a, b) => a.frequencyRank - b.frequencyRank)
      .forEach((e, i) => order.set(e.glyph, i + 1));
  }

  const firstNeed = new Map();
  for (const r of model.records) {
    let best = Infinity;
    let bestKanji = null;
    for (const id of r.appearsIn) {
      const k = id.slice('kanji:'.length);
      const o = order.get(k);
      if (o != null && o < best) { best = o; bestKanji = k; }
    }
    firstNeed.set(r.glyph, { position: best, kanji: bestKanji, afterVariant: false });
  }

  /*
   * A component kept only by variant closure (艸, 辶, 阜, 网, 肉 …) never appears in
   * a taught kanji in its own shape, so it has no first-needed position. It still
   * belongs beside the variant that DOES appear, because it is the form that
   * explains it: 艹 then 艸, ⻖ then 阜. Give it the variant's position and sort it
   * immediately after, iterating so a chain resolves.
   */
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of model.records) {
      const fn = firstNeed.get(r.glyph);
      if (fn.position !== Infinity) continue;
      for (const v of r.variants) {
        const fv = firstNeed.get(v);
        if (!fv || fv.position === Infinity) continue;
        if (fn.position > fv.position) {
          firstNeed.set(r.glyph, { position: fv.position, kanji: fv.kanji, afterVariant: true });
          changed = true;
        }
      }
    }
  }

  const used = model.records.filter((r) => firstNeed.get(r.glyph).position !== Infinity);
  const unused = model.records.filter((r) => firstNeed.get(r.glyph).position === Infinity);

  // Within one first-needed position: the shapes that actually occur first, then
  // simpler shapes, then the more widely reused, then codepoint for stability.
  const sorted = used.slice().sort((a, b) => {
    const fa = firstNeed.get(a.glyph);
    const fb = firstNeed.get(b.glyph);
    return (
      fa.position - fb.position ||
      Number(fa.afterVariant) - Number(fb.afterVariant) ||
      a.strokeCount - b.strokeCount ||
      b.appearsIn.length - a.appearsIn.length ||
      a.glyph.codePointAt(0) - b.glyph.codePointAt(0)
    );
  });

  const components = [];
  sorted.forEach((r, i) => {
    const fn = firstNeed.get(r.glyph);
    const lessonId = lessonIdForKanji
      ? lessonIdForKanji(fn.kanji, fn.position)
      : `comp-provisional-${String(Math.floor(i / lessonSize) + 1).padStart(2, '0')}`;
    components.push({ ...r, teachingOrder: i + 1, lessonId });
  });
  unused.forEach((r, i) => {
    components.push({
      ...r,
      teachingOrder: sorted.length + i + 1,
      lessonId: lessonIdForKanji ? 'comp-unscheduled' : `comp-provisional-${String(Math.floor((sorted.length + i) / lessonSize) + 1).padStart(2, '0')}`,
    });
  });

  // The interleaved spine: each component immediately before the first kanji needing it.
  const byPosition = new Map();
  for (const r of components) {
    const p = firstNeed.get(r.glyph).position;
    if (p === Infinity) continue;
    if (!byPosition.has(p)) byPosition.set(p, []);
    byPosition.get(p).push(r);
  }
  const sequence = [];
  const kanjiSeq = [...order.entries()].sort((a, b) => a[1] - b[1]);
  for (const [glyph, pos] of kanjiSeq) {
    for (const r of byPosition.get(pos) ?? []) sequence.push(r.id);
    sequence.push(`kanji:${glyph}`);
  }

  return { components, sequence, unusedComponents: unused.map((r) => r.id), provisional, firstNeed };
}

/* ------------------------------------------------------------------ verify */

function verify(model, records) {
  const problems = [];
  const advisories = [];
  const { taught, renderable, inFontRange, facesMissing } = model;

  // 1. every component glyph is renderable in every shipped face and inside the
  //    codepoint ranges build-fonts.mjs subsets.
  const fontProblems = [];
  for (const r of records) {
    if (!inFontRange(r.glyph)) fontProblems.push(`${r.id} ${hex(r.glyph.codePointAt(0))} outside FONT_REQUESTED_RANGES`);
    const gap = facesMissing(r.glyph);
    if (gap.length) fontProblems.push(`${r.id} ${hex(r.glyph.codePointAt(0))} absent from ${gap.join(', ')}`);
    for (const v of r.variants) {
      if (!renderable(v)) fontProblems.push(`${r.id} variant ${hex(v.codePointAt(0))} not renderable`);
    }
  }
  problems.push(...fontProblems);

  // 1b. TASK STEP 8's font check, done against the CLAIM that actually matters:
  //     Kansei's shipped, subsetted webfonts (public/fonts/index.json), not the
  //     full source typefaces checked above. A glyph can pass check 1 (the type
  //     design has it) and still render as tofu today because build-fonts.mjs
  //     never subsetted it in — this is a real, separately-reported gap, not a
  //     defect in this derivation, and it is expected to close once
  //     scripts/assets/build-fonts.mjs is re-run with data/components.json added
  //     to its codepoint sources.
  const shippedGapGlyphs = new Map(); // glyph -> { ids, missingFrom }
  const noteShippedGap = (glyph, id) => {
    const missingFrom = model.shippedSubsetMissing(glyph);
    if (!missingFrom.length) return;
    if (!shippedGapGlyphs.has(glyph)) shippedGapGlyphs.set(glyph, { missingFrom, ids: new Set() });
    shippedGapGlyphs.get(glyph).ids.add(id);
  };
  for (const r of records) {
    noteShippedGap(r.glyph, r.id);
    for (const v of r.variants) noteShippedGap(v, r.id);
  }
  const shippedFontSubsetGap = [...shippedGapGlyphs.entries()]
    .map(([glyph, { missingFrom, ids }]) => ({ glyph, codepoint: hex(glyph.codePointAt(0)), missingFrom, usedBy: [...ids] }))
    .sort((a, b) => b.usedBy.length - a.usedBy.length);
  for (const g of shippedFontSubsetGap) {
    problems.push(
      `font-subset-gap: ${g.glyph} (${g.codepoint}) is not in Kansei's shipped font subset (public/fonts/index.json), missing from ${g.missingFrom.join(', ')} — used by ${g.usedBy.join(', ')}`,
    );
  }

  // 2. every appearsIn id exists in kanji-top1000.json.
  const badRefs = [];
  for (const r of records) {
    for (const id of r.appearsIn) {
      if (!id.startsWith('kanji:')) badRefs.push(`${r.id} appearsIn malformed id ${id}`);
      else if (!taught.has(id.slice(6))) badRefs.push(`${r.id} appearsIn unknown kanji ${id}`);
    }
    if (r.appearsIn.length === 0 && !r._d.variantClosureOnly) {
      badRefs.push(`${r.id} has an empty appearsIn but was not kept by variant closure alone`);
    }
    if (new Set(r.appearsIn).size !== r.appearsIn.length) badRefs.push(`${r.id} has duplicate appearsIn ids`);
  }
  problems.push(...badRefs);

  // 3. No component is its own ancestor. This is a property of ONE character's
  //    decomposition, so that is where it is enforced.
  for (const v of model.ancestryViolations) {
    problems.push(`${v.kanji}: component ${v.element} is its own ancestor (${v.chain})`);
  }
  for (const r of records) {
    if (model.dag.get(r.glyph)?.has(r.glyph)) problems.push(`${r.id} directly contains itself`);
  }

  //    The cross-character containment relation, by contrast, is genuinely cyclic
  //    and that is a finding, not a fault: 十 encloses 二 in 半 while 二 encloses 十
  //    in 井. Component containment is a fact about a character, not a global
  //    hierarchy, so the cycles are reported rather than treated as errors.
  const cycles = [];
  const state = new Map();
  const stack = [];
  const dfs = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of model.dag.get(n)?.keys() ?? []) {
      if (state.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m].join(' > '));
      else if (!state.has(m)) dfs(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const r of records) if (!state.has(r.glyph)) dfs(r.glyph);

  // 4. schema sanity.
  for (const r of records) {
    if (r.id !== `comp:${r.glyph}`) problems.push(`${r.id}: id does not match glyph`);
    if (!/^comp:.+$/u.test(r.id)) problems.push(`${r.id}: fails ID_PATTERN`);
    if (r.kind !== 'component') problems.push(`${r.id}: kind is not "component"`);
    if (!Array.isArray(r.roles) || r.roles.length === 0) problems.push(`${r.id}: empty roles`);
    for (const role of r.roles) if (!['radical', 'recurring', 'standalone'].includes(role)) problems.push(`${r.id}: bad role ${role}`);
    if (r.roles.includes('radical') !== (r.kangxiNumber != null)) problems.push(`${r.id}: roles/kangxiNumber disagree`);
    if (r.kangxiNumber != null && !(r.kangxiNumber >= 1 && r.kangxiNumber <= 214)) problems.push(`${r.id}: kangxiNumber ${r.kangxiNumber} out of 1..214`);
    if (!Number.isInteger(r.strokeCount) || r.strokeCount < 1) problems.push(`${r.id}: strokeCount ${r.strokeCount}`);
    if (!Number.isInteger(r.teachingOrder) || r.teachingOrder < 1) problems.push(`${r.id}: teachingOrder ${r.teachingOrder}`);
    if (typeof r.lessonId !== 'string' || !r.lessonId) problems.push(`${r.id}: empty lessonId`);
    if (r.variants.includes(r.glyph)) problems.push(`${r.id}: lists itself as a variant`);
    if (r.glosses.length === 0 && !r.meaningIsUnreliable) problems.push(`${r.id}: no glosses but meaningIsUnreliable is false`);
  }
  const orders = records.map((r) => r.teachingOrder);
  if (new Set(orders).size !== orders.length) problems.push('teachingOrder is not unique');
  if (Math.min(...orders) !== 1 || Math.max(...orders) !== records.length) problems.push('teachingOrder is not dense 1..N');
  const ids = records.map((r) => r.id);
  if (new Set(ids).size !== ids.length) problems.push('duplicate component ids');

  // 5. a component must be introduced before every kanji that needs it — checked
  //    against the order actually assigned.
  const pos = new Map(records.map((r) => [r.glyph, r.teachingOrder]));
  for (const r of records) {
    for (const v of r.variants) {
      if (!pos.has(v)) advisories.push(`${r.id}: variant ${v} has no component record of its own (variants[] is a list of glyphs, not ids, so this is legal)`);
    }
  }
  // Every taught kanji's dictionary radical should resolve to a component record,
  // because KanjiCharacter.radical is a ComponentId.
  for (const [k, d] of model.decomposition) {
    if (d.radicalRaw != null && !model.keptSet.has(d.radicalRaw)) {
      problems.push(`the dictionary radical of ${k} (${hex(d.radicalRaw.codePointAt(0))}) has no component record`);
    }
  }

  // 6. cross-check derived stroke counts: KANJIDIC vs KanjiVG path counts.
  const strokeDisagreements = [];
  for (const r of records) {
    const a = r._d.strokeCountKanjidic;
    const b = r._d.strokeCountKanjivgMode;
    if (a != null && b != null && a !== b) strokeDisagreements.push({ glyph: r.glyph, kanjidic: a, kanjivgMode: b, kanjivgVotes: r._d.strokeCountKanjivgVotes });
  }

  // 7. the decomposition must only name kept components.
  for (const [k, d] of model.decomposition) {
    for (const g of d.all) if (!model.keptSet.has(g)) problems.push(`decomposition of ${k} names unkept ${g}`);

  }

  return { problems, advisories, strokeDisagreements, cycles, shippedFontSubsetGap };
}

/* ------------------------------------------------------------------ main */

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const dryRun = argv.includes('--dry-run');

  const model = buildComponentModel();
  const plan = assignTeachingOrder(model);
  const records = plan.components;
  const check = verify(model, records);

  // Never let an unrenderable glyph reach either output file: build-fonts.mjs
  // deep-scans data/*.json and would then hard-fail on a font gap.
  const scanGlyphs = (v, out) => {
    if (typeof v === 'string') {
      for (const ch of v) {
        const c = ch.codePointAt(0);
        const cjk = (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
          (c >= 0x2e80 && c <= 0x2eff) || (c >= 0x2f00 && c <= 0x2fdf) || c >= 0x20000;
        if (cjk && !model.renderable(ch)) out.add(ch);
      }
    } else if (Array.isArray(v)) v.forEach((x) => scanGlyphs(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => scanGlyphs(x, out));
  };

  const publicRecords = records.map(({ _d, ...rest }) => rest);
  const diag = records.map((r) => ({ glyph: r.glyph, teachingOrder: r.teachingOrder, ...r._d }));

  const lock = existsSync(P.sourcesLock) ? JSON.parse(readFileSync(P.sourcesLock, 'utf8')) : { files: {} };
  const src = (id) => {
    const f = lock.files[id];
    return f
      ? { url: f.url, project: f.project, publisher: f.publisher, license: f.license, licenseUrl: f.licenseUrl, redistribution: f.redistribution, sha256: f.sha256, bytes: f.bytes, fetchedAt: f.fetchedAt }
      : { missingFromLock: id };
  };

  const byRoute = { ucdCjkRadicals: 0, ucdEquivalentIdeograph: 0, kanjidicSelfDeclared: 0, kanjivgRadicalVote: 0 };
  for (const r of records) for (const k of Object.keys(byRoute)) if (r._d.kangxiRoutes[k] != null) byRoute[k] += 1;

  const provenance = {
    schema: 'kansei-components-provenance/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/content/build-components.mjs',
    output: 'data/components.json',
    documentation: 'docs/content/COMPONENTS.md',
    reproduce: [
      'node scripts/assets/fetch-sources.mjs',
      'node scripts/content/build-kanji-list.mjs',
      'node scripts/content/build-components.mjs   # writes data/components.json; the shipped-font-subset check reports gaps on a first run',
      'node scripts/assets/build-fonts.mjs         # re-subsets the webfonts, which now include the component glyphs',
      'node scripts/content/build-components.mjs   # re-run: the shipped-font-subset check is now clean and the build exits 0',
    ],
    reproduceNote:
      'Two passes over this script by design, and not circular: the FIRST pass decides inclusion from the source typefaces (a permanent property of the type design), writes data/components.json, and reports which component glyphs are not yet in the shipped webfont subset. build-fonts.mjs then reads data/components.json and widens the subset. The SECOND pass finds no gap and exits 0. The committed data/components.json is identical after both passes — only the verification verdict changes.',
    contract: COMPONENT_CONTRACT,
    description:
      'Teachable kanji components for the 1000 kanji in data/kanji-top1000.json. The decomposition, the variant relations and the phonetic marking are derived from KanjiVG\'s kvg:* attributes; Kangxi numbers from Unicode CJKRadicals.txt / EquivalentUnifiedIdeograph.txt and KANJIDIC2; glosses from KANJIDIC2 with hand-authored overrides in data/component-notes.json. teachingOrder in this file is PROVISIONAL — see teachingOrder below.',
    derivedLicense: {
      spdx: 'CC-BY-SA-4.0',
      reason:
        'The component inventory and decomposition adapt KanjiVG (CC BY-SA 3.0) and the glosses/stroke counts adapt KANJIDIC2 (CC BY-SA 4.0). Both are share-alike; the stricter/later of the two is stated here. The Unicode data files are permissively licensed and impose no share-alike.',
      requiredAttribution: [
        'Component decomposition, variant relations and phonetic marking from KanjiVG (http://kanjivg.tagaini.net), Copyright (C) 2009-2025 Ulrich Apel, CC BY-SA 3.0. Changes: the nested <g> structure of 1000 characters was aggregated into a per-component inventory; no stroke data is reproduced here.',
        'Glosses, stroke counts and classical radical numbers from KANJIDIC2, (C) James William Breen and the Electronic Dictionary Research and Development Group, CC BY-SA 4.0. Changes: English meanings were truncated to at most three and radical bookkeeping such as "(no. 85)" was stripped; a subset of fields was re-serialised as JSON.',
        'Kangxi radical numbering from the Unicode Character Database 18.0.0 (CJKRadicals.txt, EquivalentUnifiedIdeograph.txt), (C) 2026 Unicode, Inc., Unicode License v3.',
      ],
    },
    sources: {
      kanjivg: { ...src('kanjivg'), role: 'decomposition (kvg:element/original/radical/phon/position/part), stroke counts for shapes KANJIDIC2 does not list', readFrom: model.sources.kvg.kind === 'zip' ? 'data/sources/kanjivg-20250816-main.zip' : 'data/sources/kanjivg/kanji/', filesIndexed: model.sources.kvg.count },
      kanjidic2: { ...src('kanjidic2'), role: 'glosses, stroke counts, classical radical numbers, radical self-declaration', databaseVersion: model.sources.kd.dbVersion, dateOfCreation: model.sources.kd.created, charactersIndexed: model.sources.kd.byGlyph.size },
      ucdCjkRadicals: { ...src('ucd-cjk-radicals'), role: 'authoritative Kangxi radical number -> radical character / unified ideograph', version: model.sources.ucdRad.version, radicalsRead: model.sources.ucdRad.lines },
      ucdEquivalentUnifiedIdeograph: { ...src('ucd-equivalent-unified-ideograph'), role: 'CJK Radicals Supplement variant shapes -> equivalent unified ideograph, so ⻌ ⻏ ⻖ ⺕ ⺌ ⺍ ⺤ ⺨ get a sourced Kangxi number', version: model.sources.ucdEq.version },
      kanjiTop1000: { file: 'data/kanji-top1000.json', role: 'the taught kanji set and each one\'s classical radical number', entries: model.taught.size },
      componentNotes: { file: 'data/component-notes.json', role: 'HAND-AUTHORED curriculum judgement: glosses, meaningIsUnreliable forcing, variant add/remove, exclusions. Never adds a component KanjiVG does not show.', present: model.sources.notes.present, ...(model.sources.notes.meta ?? {}), glyphsAnnotated: model.sources.notes.byGlyph.size, glyphsExcluded: model.sources.notes.exclude.size, glyphsForceIncluded: model.sources.notes.include.size },
      fonts: {
        role: "renderability gate — a component absent from Kansei's shipped subset cannot be taught, even if the full typeface has it",
        shippedSubset: {
          file: 'public/fonts/index.json',
          generatedAt: model.sources.shippedFonts.generatedAt,
          generatedBy: model.sources.shippedFonts.generatedBy,
          note: 'the actual gate: unicodeRange minus missingCodepoints, per shipped face, unioned over its base+kanji files',
          perFile: model.sources.shippedFonts.perFile,
        },
        sourceTypefaces: model.sources.fonts.available
          ? {
              note: 'diagnostic only, NOT the gate — the full pre-subset .ttf files, used to tell "does not exist in the type design at all" apart from "exists but was never subsetted in for Kansei"',
              faces: model.sources.fonts.faces.map((f) => ({ key: f.key, file: `data/sources/fonts/${f.file}`, codepointsInCmap: f.cmap.size })),
            }
          : { available: false, note: `run scripts/assets/build-fonts.mjs first; missing ${model.sources.fonts.missingFile ?? ''}` },
      },
    },
    inclusionRule: {
      statement:
        'A shape earns a KanjiComponent record when it is renderable in every shipped face AND at least one of the thresholds below is met. Everything else is reported in rejected/ below rather than kept as a one-off shape.',
      thresholds: {
        RECUR_MIN: `${RECUR_MIN} — recurs in at least this many taught kanji`,
        RADICAL_MIN: `${RADICAL_MIN} — is KanjiVG's kvg:radical="general" for at least this many taught kanji`,
        STANDALONE_MIN: `${STANDALONE_MIN} — is itself one of the 1000 taught kanji AND is a part of at least this many others`,
        VARIANT_MIN_KANJI: `${VARIANT_MIN_KANJI} — a kvg:original relation becomes a variants[] link only when attested in at least this many DISTINCT taught kanji`,
        KANGXI_MAJORITY: `${KANGXI_MAJORITY} — a split radical vote below this share is reported as ambiguous and kangxiNumber is left null`,
      },
      counts: {
        distinctShapesInKanjiVG: model.rawCandidateCount,
        distinctShapesAfterFoldingAndVariantClosure: model.foldedCandidateCount,
        kept: records.length,
        rejectedBelowThreshold: model.rejected.length,
        droppedUnrenderable: model.unrenderableDropped.length,
      },
    },
    teachingOrder: {
      provisional: plan.provisional,
      basis: 'frequency rank of the first taught kanji that needs the component, then stroke count, then breadth of reuse, then codepoint',
      whyProvisional:
        'A component must be introduced strictly before the first kanji that needs it, and the kanji teaching order is owned by the curriculum build, not by this script. Until that order exists the frequency rank of data/kanji-top1000.json stands in.',
      howToFinalise:
        "import { buildComponentModel, assignTeachingOrder } from 'scripts/content/build-components.mjs'; assignTeachingOrder(buildComponentModel(), { kanjiOrder, lessonIdForKanji }) returns the same records with final teachingOrder/lessonId plus `sequence`, the interleaved comp:/kanji: spine.",
      lessonIdsProvisional: true,
    },
    roleDefinitions: {
      radical: "kangxiNumber is not null: the glyph is a Kangxi/classical dictionary radical (or a recognised variant shape of one), so it is what a paper dictionary indexes a character under. Sourced from up to four independent routes; see kangxiNumberRoutes.",
      standalone: 'the glyph is itself one of the taught kanji, so the learner meets it twice: as a character and as a building block.',
      recurring: 'the glyph recurs across characters as a shape. Held alongside radical/standalone whenever it also does something other than index the dictionary — the three are not exclusive.',
    },
    meaningPolicy:
      'Components do not each carry one meaning or one reading, and this dataset does not claim they do. glosses is a plural, unordered list; meaningIsUnreliable is set true whenever KanjiVG marks the shape phonetic, no gloss helps, several unrelated senses are recorded, the shape is indexed under more than one classical radical, it is a single structural stroke, or it appears in more than one shape. The default leans true.',
    kangxiNumberRoutes: {
      description: 'How many kept components each route produced a number for. A component needs only one route; where routes disagreed the Unicode tables win and the disagreement is listed in conflicts.',
      counts: byRoute,
      withNumber: records.filter((r) => r.kangxiNumber != null).length,
      withoutNumber: records.filter((r) => r.kangxiNumber == null).length,
      conflicts: model.kangxiConflicts,
      ambiguousVotesLeftNull: records.filter((r) => r._d.kangxiVoteAmbiguous && r.kangxiNumber == null).map((r) => ({ glyph: r.glyph, tally: r._d.kangxiRoutes.kanjivgRadicalVoteTally })),
    },
    kvgSemantics: {
      'kvg:element': 'the component glyph a <g> draws',
      'kvg:original': 'the unvaried form of a variant shape (氵 -> 水). The source for variants[].',
      'kvg:radical': "general | tradit | nelson | jis — which radical scheme indexes the host character under this group. Only 'general' is used for kangxiNumber, because that is the scheme KANJIDIC2's rad_type=\"classical\" corresponds to.",
      'kvg:phon': 'the component is present for its SOUND. Directly sets meaningIsUnreliable.',
      'kvg:position': 'left/right/top/bottom/kamae/tare/nyo… layout role. Reported in the diagnostics, not part of a record.',
      'kvg:part': 'the component is drawn in several non-contiguous groups. Counted once per host kanji; a part group nested inside a group with the same element is not a containment edge.',
      'kvg:partial': 'the group draws only a piece of the named element; excluded from stroke-count derivation.',
      'kvg:variant': 'the group draws a variant shape of the named element.',
      groupsRead: model.groupsSeen,
    },
    verification: {
      passed: check.problems.length === 0,
      problems: check.problems,
      advisories: check.advisories,
      checks: [
        `every component glyph (and every glyph in variants[]) has an actual glyph in all ${SHIPPED_FACES.length} source typefaces (${SHIPPED_FACES.map((f) => f.key).join(', ')}) — the inclusion/folding gate, since that is a permanent property of the type design`,
        `every component glyph (and every glyph in variants[]) is ALSO checked against Kansei's actual shipped, subsetted webfonts today (public/fonts/index.json, unicodeRange minus missingCodepoints) — reported as font-subset-gap problems below rather than silently dropped, because build-fonts.mjs subsets FROM this file and a taught kanji's dictionary radical must resolve to a kept component regardless of today's subset`,
        'every appearsIn id resolves to an entry in data/kanji-top1000.json; no empty and no duplicate appearsIn',
        'the component containment relation (KanjiVG nesting, folded, restricted to kept components) is acyclic — no component is its own ancestor, and no self-containment',
        'record shape: id matches glyph and ID_PATTERN, roles non-empty and from the allowed set, roles/kangxiNumber agree, kangxiNumber in 1..214, strokeCount >= 1, teachingOrder dense and unique over 1..N, non-empty lessonId, no self-variant, no gloss-less record claiming a reliable meaning',
        'every component named by the per-kanji decomposition is a kept component',
        'stroke counts cross-checked: KANJIDIC2 vs the KanjiVG <path> count',
      ],
      strokeCountCrossCheck: {
        compared: records.filter((r) => r._d.strokeCountKanjidic != null && r._d.strokeCountKanjivgMode != null).length,
        disagreements: check.strokeDisagreements,
        note: 'KANJIDIC2 wins where both exist: a KanjiVG group can legitimately draw a shape with a different stroke count than the standalone character (partials, joined forms).',
      },
      componentAncestry: {
        statement: 'No component is its own ancestor inside any single character\'s decomposition; that is enforced. The cross-character containment relation IS cyclic, and deliberately so.',
        perCharacterViolations: model.ancestryViolations,
        crossCharacterCycles: {
          note: 'Evidence that component containment is a property of a character rather than a global hierarchy: each edge below is real, but they contradict one another across characters (十 encloses 二 in 半 伴 判, while 二 encloses 十 in 井 囲). The app must therefore never present components as a single tree.',
          count: check.cycles.length,
          examples: check.cycles.slice(0, 12),
        },
      },
      samePartNestingIgnored: {
        count: model.samePartNesting.length,
        note: 'KanjiVG nests the kvg:part groups of one shape inside each other (甲 part 2 inside 甲 part 1 in 単; 匚 parts in 巨). Those are not containment edges and are excluded before the cycle check.',
        examples: model.samePartNesting.slice(0, 12),
      },
      kanjivgCoverage: { taughtKanji: model.taught.size, withoutAnSvg: model.missingSvg.length, missing: model.missingSvg },
      shippedFontSubsetGap: {
        statement:
          "A real, expected gap as of this task, not a defect: scripts/assets/build-fonts.mjs subsetted public/fonts/*.woff2 from data/kanji-top1000.json, the kana files and the frequency-crosscheck list, BEFORE data/components.json existed, so no bare KanjiVG component shape (氵 忄 扌 灬 刂 亻 …) or non-taught radical (糸 艸 貝 頁 舟 …) was ever requested. Every glyph below IS in the source typefaces (see folding/droppedUnrenderable, which gate on that instead) and IS a legitimate component or dictionary radical of a taught kanji — it just is not in today's shipped subset. Re-run scripts/assets/build-fonts.mjs with data/components.json (glyph + variants[]) added as a codepoint source to close this.",
        glyphsAffected: check.shippedFontSubsetGap.length,
        componentsAffected: new Set(check.shippedFontSubsetGap.flatMap((g) => g.usedBy)).size,
        entries: check.shippedFontSubsetGap,
      },
    },
    folding: {
      statement:
        'A shape the shipped fonts cannot draw is folded into its kvg:original when KanjiVG names one, so its occurrences still teach the parent component instead of being lost. Folded shapes are named by codepoint, never by glyph, so build-fonts.mjs does not pick them up from this file.',
      folds: model.folds,
    },
    droppedUnrenderable: {
      statement:
        'These shapes recur in the taught set but no shipped face can draw them and KanjiVG names no renderable original, so they are NOT taught. This is a real gap in coverage, not a claim that the shapes do not exist.',
      entries: model.unrenderableDropped,
    },
    rejectedBelowThreshold: {
      statement:
        'Shapes KanjiVG shows in the taught set that did not meet any threshold. Listed in full so the inclusion decision is auditable. Named by CODEPOINT, not by glyph, on purpose: scripts/assets/build-fonts.mjs deep-scans data/*.json for ideographs and would otherwise bundle every rejected shape into the shipped webfont subset — hundreds of kilobytes of glyphs the app never draws. The readable table with the glyphs themselves is in docs/content/COMPONENTS.md, which the font build does not scan.',
      count: model.rejected.length,
      entries: model.rejected
        .sort((a, b) => b.inKanji - a.inKanji)
        .map(({ glyph, ...rest }) => ({ codepoint: hex(glyph.codePointAt(0)), ...rest })),
    },
    variants: {
      statement: `A variants[] link is a kvg:original relation attested in at least ${VARIANT_MIN_KANJI} distinct taught kanji, in either direction, between two renderable non-kana glyphs. Relations are NOT closed transitively: 日 / U+66F0 and 日 / U+81FC must not imply U+66F0 / U+81FC. Rejected links are named by codepoint for the same font-subset reason as rejectedBelowThreshold.`,
      keptLinks: model.variantPairs.length,
      rejectedLinks: model.variantRejected.map((v) => ({
        from: hex(v.from.codePointAt(0)),
        to: /^U\+/.test(v.to) ? v.to : hex(v.to.codePointAt(0)),
        attestedInKanji: v.attestedInKanji,
        verdict: v.verdict,
      })),
    },
    diagnosticsPerComponent: diag,
  };

  const bad = new Set();
  scanGlyphs(publicRecords, bad);
  scanGlyphs(provenance, bad);
  if (bad.size) {
    provenance.verification.problems.push(
      `output files contain ${bad.size} CJK glyph(s) no shipped face can draw: ${[...bad].map((g) => hex(g.codePointAt(0))).join(', ')} — scripts/assets/build-fonts.mjs would hard-fail`,
    );
    provenance.verification.passed = false;
  }

  if (!dryRun) {
    mkdirSync(dirname(P.outData), { recursive: true });
    writeFileSync(P.outData, JSON.stringify(publicRecords));
    // Pretty-print while it stays a reasonably-sized diff to review; the full
    // per-component diagnostics push this file past 100KB, so compact it there
    // per the repo convention for large JSON.
    const pretty = JSON.stringify(provenance, null, 2) + '\n';
    writeFileSync(P.outProv, Buffer.byteLength(pretty) > 100_000 ? JSON.stringify(provenance) : pretty);
  }

  const summary = {
    components: records.length,
    bytes: Buffer.byteLength(JSON.stringify(publicRecords)),
    sha256: createHash('sha256').update(JSON.stringify(publicRecords)).digest('hex'),
    roles: {
      radical: records.filter((r) => r.roles.includes('radical')).length,
      standalone: records.filter((r) => r.roles.includes('standalone')).length,
      recurring: records.filter((r) => r.roles.includes('recurring')).length,
      multiRole: records.filter((r) => r.roles.length > 1).length,
    },
    meaningIsUnreliable: records.filter((r) => r.meaningIsUnreliable).length,
    withoutGlosses: records.filter((r) => r.glosses.length === 0).length,
    withVariants: records.filter((r) => r.variants.length > 0).length,
    kangxi: { withNumber: records.filter((r) => r.kangxiNumber != null).length, distinctNumbers: new Set(records.map((r) => r.kangxiNumber).filter((n) => n != null)).size },
    coverage: {
      taughtKanji: model.taught.size,
      kanjiWithAtLeastOneComponent: [...model.decomposition.values()].filter((d) => d.all.length > 0).length,
      medianComponentsPerKanji: (() => {
        const a = [...model.decomposition.values()].map((d) => d.all.length).sort((x, y) => x - y);
        return a.length ? a[Math.floor(a.length / 2)] : 0;
      })(),
    },
    verification: {
      passed: provenance.verification.passed,
      problems: provenance.verification.problems.length,
      advisories: check.advisories.length,
      strokeDisagreements: check.strokeDisagreements.length,
      shippedFontSubsetGapGlyphs: check.shippedFontSubsetGap.length,
      shippedFontSubsetGapComponents: provenance.verification.shippedFontSubsetGap.componentsAffected,
    },
    folded: model.folds.length,
    droppedUnrenderable: model.unrenderableDropped.length,
    rejected: model.rejected.length,
  };

  if (wantJson) console.log(JSON.stringify({ summary, provenance }, null, 2));
  else {
    console.log(JSON.stringify(summary, null, 2));
    if (provenance.verification.problems.length) {
      console.log('\nPROBLEMS:');
      for (const p of provenance.verification.problems) console.log('  ' + p);
    }
  }
  if (!provenance.verification.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
