#!/usr/bin/env node
/**
 * build-fonts.mjs — download, subset and emit Kansei's bundled Japanese webfonts.
 *
 * Kansei is offline-first: every glyph the curriculum can display must be in the
 * app bundle, because there is no network to fall back on. Shipping three full
 * CJK faces would be ~32 MB, so each face is subset to exactly the characters
 * the curriculum uses and emitted as woff2.
 *
 * All three faces are SIL Open Font License 1.1. See docs/content/FONTS.md.
 *
 *   node scripts/assets/build-fonts.mjs [options]
 *
 *     --force          re-download upstream TTFs even if already cached
 *     --all-features   keep every OpenType layout feature (--layout-features='*').
 *                      Verified to render identically to the curated set for
 *                      Kansei's character set, but ~2-4x larger. See FEATURES below.
 *     --quiet          suppress per-file progress
 *
 * Upstream files are cached in data/sources/fonts/ (gitignored, not committed).
 * Output goes to public/fonts/ together with public/fonts/index.json and the
 * upstream OFL licence texts, which the OFL requires us to redistribute.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SRC_DIR = path.join(REPO, 'data', 'sources', 'fonts');
const OUT_DIR = path.join(REPO, 'public', 'fonts');
const LIC_DIR = path.join(OUT_DIR, 'licenses');
const DATA_DIR = path.join(REPO, 'data');
const STROKES_DIR = path.join(REPO, 'public', 'content', 'strokes');

const argv = new Set(process.argv.slice(2));
const FORCE = argv.has('--force');
const ALL_FEATURES = argv.has('--all-features');
const QUIET = argv.has('--quiet');

const log = (...a) => { if (!QUIET) console.log(...a); };

/* ------------------------------------------------------------------ *
 * OpenType layout features kept in the subset.
 *
 * Passing --layout-features='*' keeps every feature in the font, including the
 * JIS-variant and alternate-form features (aalt, expt, hojo, nalt, jp78, jp83,
 * jp90, jp04, trad, nlck, ruby, and the width variants fwid/hwid/pwid/twid/qwid).
 * Each of those pulls an entire parallel set of alternate glyphs into the
 * subset, which Kansei never requests: it renders plain horizontal text and
 * never sets font-variant-* or font-feature-settings for those features.
 *
 * Measured cost on Klee One, kana+Latin subset (548 codepoints):
 *     --layout-features='*'   4240 glyphs   283,232 bytes
 *     curated list below       827 glyphs    72,684 bytes
 *
 * The curated list keeps every feature that actually affects how Kansei draws
 * text: the default-on shaping features, kerning and mark attachment, the
 * Japanese proportional/half-width metric features, and the vertical-writing
 * features so vertical text stays available. Rendering was verified
 * pixel-identical to the '*' build across the full curriculum character set
 * (all hiragana, katakana, halfwidth katakana, Japanese punctuation, Latin with
 * macrons, and all 1000 curriculum kanji) for all three faces; see
 * docs/content/FONTS.md. Re-run with --all-features to compare.
 * ------------------------------------------------------------------ */
const LAYOUT_FEATURES = [
  // Default-on shaping
  'ccmp', 'locl', 'liga', 'clig', 'calt', 'rlig',
  // Vertical writing
  'vert', 'vrt2',
  // Positioning
  'kern', 'mark', 'mkmk',
  // Japanese metric alternates (GPOS only — no extra glyphs)
  'palt', 'halt', 'vpal', 'vhal', 'vkrn', 'chws', 'vchw',
];

/* ------------------------------------------------------------------ *
 * Faces. `commit` pins the google/fonts tree the TTF is fetched from, so a
 * re-run months later reproduces the same bytes rather than whatever is on
 * main that day.
 * ------------------------------------------------------------------ */
const FACES = [
  {
    key: 'noto-sans-jp',
    family: 'Noto Sans JP',
    role: 'UI and large character display',
    dir: 'notosansjp',
    ttf: 'NotoSansJP[wght].ttf',
    commit: '66a36c8c94b1a5d992ee4e7f392fccfe4945767c',
    style: 'normal',
    // Partial variable font: one file covers every weight in 400-700.
    // Measured cheaper than shipping static 400/500/700 (363 KB vs 414 KB for
    // just 400+700), and it gives 500 for free.
    instance: 'wght=400:700',
    cssWeight: '400 700',
    license: {
      spdx: 'OFL-1.1',
      file: 'OFL.txt',
      copyright: "Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'",
      reservedFontNames: ['Source'],
    },
  },
  {
    key: 'noto-serif-jp',
    family: 'Noto Serif JP',
    role: 'reading and display (Mincho); shows the printed joined forms of き/さ/ふ',
    dir: 'notoserifjp',
    ttf: 'NotoSerifJP[wght].ttf',
    commit: '8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5',
    style: 'normal',
    // Static 400 only. A 400-700 partial VF measured 511 KB against 272 KB for
    // the single static weight, and the serif is used at one weight.
    instance: 'wght=400',
    cssWeight: '400',
    license: {
      spdx: 'OFL-1.1',
      file: 'OFL.txt',
      copyright: 'Copyright 2012 Google Inc. All Rights Reserved.',
      reservedFontNames: [],
    },
  },
  {
    key: 'klee-one',
    family: 'Klee One',
    role: 'kyōkasho (textbook) face: the handwritten letterforms the app teaches',
    dir: 'kleeone',
    ttf: 'KleeOne-Regular.ttf',
    commit: '130fcfb0ff422fec96b335616b2ca99f91914792',
    style: 'normal',
    instance: null, // not a variable font
    cssWeight: '400',
    license: {
      spdx: 'OFL-1.1',
      file: 'OFL.txt',
      copyright: 'Copyright 2020 The Klee Project Authors (https://github.com/fontworks-fonts/Klee)',
      reservedFontNames: [],
    },
  },
];

const rawUrl = (f, name) =>
  `https://raw.githubusercontent.com/google/fonts/${f.commit}/ofl/${f.dir}/${encodeURIComponent(name)}`;

/* ------------------------------------------------------------------ *
 * Python with fonttools + brotli.
 * ------------------------------------------------------------------ */
function pythonHasFontTools(py) {
  if (!py) return false;
  const r = spawnSync(py, ['-c', 'import fontTools, brotli'], { stdio: 'ignore' });
  return r.status === 0;
}

function resolvePython() {
  const managed = path.join(REPO, '.venv-fonttools', 'bin', 'python');
  const candidates = [process.env.KANSEI_PYTHON, managed, 'python3'].filter(Boolean);
  for (const c of candidates) if (pythonHasFontTools(c)) return c;

  log('  fonttools not found; creating a virtualenv at .venv-fonttools');
  const base = process.env.KANSEI_PYTHON || 'python3';
  execFileSync(base, ['-m', 'venv', path.join(REPO, '.venv-fonttools')], { stdio: 'inherit' });
  execFileSync(managed, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], { stdio: 'inherit' });
  execFileSync(managed, ['-m', 'pip', 'install', '--quiet', 'fonttools[woff]>=4.50'], { stdio: 'inherit' });
  if (!pythonHasFontTools(managed)) {
    throw new Error('Could not provision fonttools+brotli. Set KANSEI_PYTHON to a python that has them.');
  }
  return managed;
}

function pythonVersions(py) {
  const out = execFileSync(py, ['-c',
    'import fontTools,brotli,sys;print(sys.version.split()[0]);print(fontTools.version)'],
    { encoding: 'utf8' }).trim().split('\n');
  return { python: out[0], fonttools: out[1] };
}

/* ------------------------------------------------------------------ *
 * The glyph set Kansei needs.
 * ------------------------------------------------------------------ */

/** Latin, punctuation and kana — everything the UI chrome needs before any kanji. */
function baseCodepoints() {
  const cps = new Set();
  const add = (a, b) => { for (let c = a; c <= (b ?? a); c++) cps.add(c); };

  add(0x0020, 0x007e);            // ASCII printable
  add(0x00a0, 0x00ff);            // Latin-1 supplement: punctuation, ¥ £ ° × ÷ …
  // Macron vowels for modified Hepburn (Tōkyō, shūkan). Upper and lower case:
  // romaji is shown capitalised at the start of example sentences.
  for (const ch of 'ĀāĒēĪīŌōŪū') cps.add(ch.codePointAt(0));
  add(0x3000, 0x303f);            // CJK symbols and punctuation 、。〜「」『』…
  add(0x3040, 0x30ff);            // Hiragana + Katakana (the whole curriculum's kana)
  add(0x31f0, 0x31ff);            // Katakana phonetic extensions (small kana)
  add(0xff61, 0xff9f);            // Halfwidth katakana
  // General punctuation the UI actually types.
  for (const ch of '‘’“”„†‡•…‰′″‹›€₂₃←↑→↓↔⇄∀∞≈≠≤≥　') cps.add(ch.codePointAt(0));
  // Fullwidth forms used in Japanese example text.
  for (const ch of '！？（）［］｛｝：；，．　') cps.add(ch.codePointAt(0));
  return cps;
}

/** Every CJK ideograph the curriculum can put on screen. */
function curriculumKanji() {
  const cps = new Set();
  const isCjk = (c) =>
    (c >= 0x3400 && c <= 0x4dbf) ||   // Ext A
    (c >= 0x4e00 && c <= 0x9fff) ||   // CJK Unified
    (c >= 0xf900 && c <= 0xfaff) ||   // Compatibility ideographs
    (c >= 0x2e80 && c <= 0x2eff) ||   // CJK Radicals Supplement (氵-style component forms)
    (c >= 0x2f00 && c <= 0x2fdf);     // Kangxi Radicals
  const sources = [];

  // 1. The frequency list: the authoritative kanji set.
  const top = path.join(DATA_DIR, 'kanji-top1000.json');
  if (fs.existsSync(top)) {
    const doc = JSON.parse(fs.readFileSync(top, 'utf8'));
    const entries = Array.isArray(doc) ? doc : (doc.entries ?? []);
    let n = 0;
    for (const e of entries) {
      const g = e?.glyph ?? e?.character ?? e?.literal;
      if (typeof g === 'string') for (const ch of g) { const c = ch.codePointAt(0); if (isCjk(c)) { cps.add(c); n++; } }
    }
    sources.push({ source: 'data/kanji-top1000.json', kanji: n });
  } else {
    sources.push({ source: 'data/kanji-top1000.json', kanji: 0, missing: true });
  }

  // 2. Stroke-reference data, whose filenames are the codepoints the app can
  //    animate. This is where component glyphs that are not in the frequency
  //    list (radicals taught on their own) come from.
  if (fs.existsSync(STROKES_DIR)) {
    let n = 0;
    for (const f of fs.readdirSync(STROKES_DIR)) {
      const m = /^([0-9a-f]{4,6})\.json$/i.exec(f);
      if (!m) continue;
      const c = parseInt(m[1], 16);
      if (isCjk(c)) { if (!cps.has(c)) n++; cps.add(c); }
    }
    sources.push({ source: 'public/content/strokes/*.json', newKanji: n });
  }

  // 3. Any other committed curriculum JSON in data/ — components, curriculum
  //    order, vocabulary. Deep-scanned for ideographs so a new content file
  //    cannot silently ship a glyph the fonts do not carry.
  if (fs.existsSync(DATA_DIR)) {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json') || f === 'kanji-top1000.json') continue;
      let n = 0;
      const scan = (v) => {
        if (typeof v === 'string') {
          for (const ch of v) { const c = ch.codePointAt(0); if (isCjk(c)) { if (!cps.has(c)) n++; cps.add(c); } }
        } else if (Array.isArray(v)) v.forEach(scan);
        else if (v && typeof v === 'object') Object.values(v).forEach(scan);
      };
      try { scan(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'))); } catch { continue; }
      sources.push({ source: `data/${f}`, newKanji: n });
    }
  }

  return { cps, sources };
}

/* ------------------------------------------------------------------ *
 * Download + subset
 * ------------------------------------------------------------------ */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url, dest) {
  if (fs.existsSync(dest) && !FORCE) return { cached: true, bytes: fs.statSync(dest).size };
  const res = await fetch(url, { headers: { 'user-agent': 'kansei-build-fonts/1.0 (+https://github.com/)' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { cached: false, bytes: buf.length };
}

/** Read the version string and family name straight out of the TTF name table. */
function readFontVersion(py, ttf) {
  const code = `
import json,sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1], lazy=True)
n = {}
for r in f['name'].names:
    n.setdefault(r.nameID, r.toUnicode())
print(json.dumps({
  'version': n.get(5), 'family': n.get(16) or n.get(1),
  'fontRevision': round(f['head'].fontRevision, 4),
  'unitsPerEm': f['head'].unitsPerEm, 'numGlyphs': f['maxp'].numGlyphs,
}))`;
  return JSON.parse(execFileSync(py, ['-c', code, ttf], { encoding: 'utf8' }));
}

function countGlyphs(py, file) {
  const code = `
import sys
from fontTools.ttLib import TTFont
print(TTFont(sys.argv[1], lazy=True)['maxp'].numGlyphs)`;
  return Number(execFileSync(py, ['-c', code, file], { encoding: 'utf8' }).trim());
}

function writeUnicodesFile(cps, dest) {
  const body = [...cps].sort((a, b) => a - b).map((c) => c.toString(16).toUpperCase().padStart(4, '0')).join('\n');
  fs.writeFileSync(dest, body + '\n');
}

/** Turn a sorted codepoint set into a compact CSS unicode-range value. */
function unicodeRange(cps) {
  const s = [...cps].sort((a, b) => a - b);
  const parts = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    const hex = (c) => 'U+' + c.toString(16).toUpperCase();
    parts.push(i === j ? hex(s[i]) : `${hex(s[i])}-${s[j].toString(16).toUpperCase()}`);
    i = j + 1;
  }
  return parts.join(', ');
}

async function main() {
  const py = resolvePython();
  const vers = pythonVersions(py);
  log(`python ${vers.python}, fonttools ${vers.fonttools}`);

  fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(LIC_DIR, { recursive: true });

  const base = baseCodepoints();
  const { cps: kanji, sources: kanjiSources } = curriculumKanji();
  for (const c of base) kanji.delete(c); // the two groups must not overlap

  const kanjiListPresent = fs.existsSync(path.join(DATA_DIR, 'kanji-top1000.json'));
  if (!kanjiListPresent) {
    console.warn('WARNING: data/kanji-top1000.json is absent.');
    console.warn('         Building a kana + Latin subset only. Re-run this script after');
    console.warn('         the kanji list is generated — the fonts will NOT render kanji.');
  }

  log(`base codepoints: ${base.size}`);
  log(`curriculum kanji: ${kanji.size}`);
  for (const s of kanjiSources) log(`  ${JSON.stringify(s)}`);

  const tmp = fs.mkdtempSync(path.join(SRC_DIR, '.build-'));
  const uniBase = path.join(tmp, 'base.txt');
  const uniKanji = path.join(tmp, 'kanji.txt');
  writeUnicodesFile(base, uniBase);
  writeUnicodesFile(kanji, uniKanji);

  const featureArg = ALL_FEATURES ? '*' : LAYOUT_FEATURES.join(',');
  const groups = [
    { id: 'base', unicodes: uniBase, cps: base, label: 'Latin + kana + punctuation' },
    ...(kanji.size ? [{ id: 'kanji', unicodes: uniKanji, cps: kanji, label: 'curriculum kanji' }] : []),
  ];

  const index = {
    schema: 'kansei-font-index/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/assets/build-fonts.mjs',
    reproduce: ['node scripts/assets/build-fonts.mjs'],
    toolchain: { node: process.version, python: vers.python, fonttools: vers.fonttools },
    layoutFeatures: ALL_FEATURES ? '*' : LAYOUT_FEATURES,
    coverage: {
      baseCodepoints: base.size,
      kanjiCodepoints: kanji.size,
      kanjiListPresent,
      kanjiSources,
      note: kanjiListPresent
        ? 'Subset covers exactly the curriculum glyph set. Any character outside it falls back to a system font.'
        : 'INCOMPLETE: built without data/kanji-top1000.json. Kanji are NOT in these files. Re-run required.',
    },
    files: [],
  };

  let totalBefore = 0;
  let totalAfter = 0;

  for (const face of FACES) {
    log(`\n=== ${face.family} ===`);
    const url = rawUrl(face, face.ttf);
    const ttf = path.join(SRC_DIR, face.ttf);
    const dl = await download(url, ttf);
    const beforeBytes = fs.statSync(ttf).size;
    totalBefore += beforeBytes;
    const meta = readFontVersion(py, ttf);
    log(`  upstream ${face.ttf} ${dl.cached ? '(cached)' : '(downloaded)'} ${beforeBytes} bytes`);
    log(`  version  ${meta.version}  (${meta.numGlyphs} glyphs)`);

    // Licence text — the OFL requires it travel with the font.
    const licUrl = rawUrl(face, face.license.file);
    const licDest = path.join(LIC_DIR, `${face.key}-OFL.txt`);
    await download(licUrl, path.join(SRC_DIR, `OFL-${face.dir}.txt`));
    fs.copyFileSync(path.join(SRC_DIR, `OFL-${face.dir}.txt`), licDest);

    // Optional weight instancing / axis narrowing.
    let input = ttf;
    if (face.instance) {
      input = path.join(tmp, `${face.key}-inst.ttf`);
      execFileSync(py, ['-m', 'fontTools.varLib.instancer', ttf, face.instance, '-o', input], { stdio: 'ignore' });
      log(`  instanced ${face.instance} -> ${fs.statSync(input).size} bytes`);
    }

    for (const g of groups) {
      const outName = `${face.key}-${g.id}.woff2`;
      const out = path.join(OUT_DIR, outName);
      execFileSync(py, [
        '-m', 'fontTools.subset', input,
        `--unicodes-file=${g.unicodes}`,
        `--layout-features=${featureArg}`,
        '--flavor=woff2',
        `--output-file=${out}`,
      ], { stdio: ['ignore', 'ignore', 'inherit'] });

      const buf = fs.readFileSync(out);
      totalAfter += buf.length;
      const glyphs = countGlyphs(py, out);
      log(`  ${outName.padEnd(28)} ${String(buf.length).padStart(8)} bytes  ${String(glyphs).padStart(5)} glyphs  (${g.label})`);

      index.files.push({
        file: outName,
        path: `/fonts/${outName}`,
        family: face.family,
        role: face.role,
        style: face.style,
        weight: face.cssWeight,
        variable: Boolean(face.instance && face.instance.includes(':')),
        axis: face.instance && face.instance.includes(':') ? face.instance : null,
        group: g.id,
        codepoints: g.cps.size,
        glyphs,
        bytes: buf.length,
        sha256: sha256(buf),
        unicodeRange: unicodeRange(g.cps),
        upstream: {
          url,
          repository: 'https://github.com/google/fonts',
          commit: face.commit,
          file: face.ttf,
          version: meta.version,
          fontRevision: meta.fontRevision,
          upstreamBytes: beforeBytes,
          upstreamGlyphs: meta.numGlyphs,
        },
        license: {
          spdx: face.license.spdx,
          name: 'SIL Open Font License 1.1',
          url: 'https://scripts.sil.org/OFL',
          text: `/fonts/licenses/${face.key}-OFL.txt`,
          upstreamTextUrl: licUrl,
          copyright: face.license.copyright,
          reservedFontNames: face.license.reservedFontNames,
        },
      });
    }
  }

  index.totals = {
    upstreamBytes: totalBefore,
    subsetBytes: totalAfter,
    reductionPercent: Number((100 * (1 - totalAfter / totalBefore)).toFixed(2)),
  };

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });

  log(`\ntotal upstream ${totalBefore} bytes -> subset ${totalAfter} bytes (${index.totals.reductionPercent}% smaller)`);
  log(`wrote ${path.relative(REPO, path.join(OUT_DIR, 'index.json'))}`);
  if (!kanjiListPresent) process.exitCode = 2;
}

main().catch((err) => { console.error(err); process.exit(1); });
