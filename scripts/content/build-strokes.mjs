#!/usr/bin/env node
/**
 * build-strokes.mjs — derive Kansei runtime StrokeReference packs from KanjiVG.
 *
 * Source dataset: KanjiVG r20250816 (kanjivg-20250816-main.zip), CC BY-SA 3.0.
 *   https://github.com/KanjiVG/kanjivg  —  http://kanjivg.tagaini.net
 * KanjiVG is a *reference* dataset: it documents one documented stroke order and
 * one median path per stroke. It is NOT a grader and carries no tolerance model.
 *
 * Output (one file per character, so the runtime can cache individually):
 *   public/content/strokes/<hex>.json   — a StrokeReference (src/domain/content.ts)
 *   public/content/strokes/index.json   — metadata + glyph -> {file,strokeCount,bytes,sha256}
 *
 * Reproduce:
 *   npm run content:fetch     # KanjiVG + KANJIDIC2 into data/sources/
 *   npm run content:strokes   # this script
 *
 * No unzip or gunzip step: the archive is read directly, and KANJIDIC2 is accepted
 * as either kanjidic2.xml or kanjidic2.xml.gz. An already-extracted KanjiVG
 * directory is used when present; all input forms produce identical output.
 * KANJIDIC2 is used only to verify stroke counts — if it is absent the report says
 * so rather than quietly passing.
 *
 * Node builtins only — no npm dependencies. The SVG path parser and the ZIP reader
 * below are deliberately minimal and FAIL LOUDLY on anything they were not audited
 * against, rather than silently emitting wrong data.
 *
 * See docs/content/STROKES.md for provenance, licence obligations, coverage and the
 * verification results; data/provenance/strokes.json is the machine-readable copy.
 */

import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const SOURCE_ID = 'kanjivg-20250816';
const SOURCE_VERSION = 'r20250816';
const VIEWBOX = { width: 109, height: 109 };
/** Resampled points per stroke. Fixed so the assessor can compare strokes cheaply. */
const POINTS_PER_STROKE = 24;
/** Target chord length (design units) when flattening cubics before resampling. */
const FLATTEN_CHORD = 0.25;
const MAX_FLATTEN_STEPS = 400;
/** Coordinate rounding: 2dp in a 109-unit box is ~0.01% of the glyph box. */
const COORD_DP = 2;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    kanjivgDir: join(REPO, 'data', 'sources', 'kanjivg'),
    outDir: join(REPO, 'public', 'content', 'strokes'),
    kanjiList: join(REPO, 'data', 'kanji-top1500.json'),
    kanjidic: join(REPO, 'data', 'sources', 'kanjidic2.xml'),
    verify: true,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const [k, v] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], argv[i + 1]];
    const eat = () => {
      if (!argv[i].includes('=')) i += 1;
      return v;
    };
    switch (k) {
      case '--kanjivg-dir': opts.kanjivgDir = resolve(eat()); break;
      case '--out': opts.outDir = resolve(eat()); break;
      case '--kanji-list': opts.kanjiList = resolve(eat()); break;
      case '--kanjidic': opts.kanjidic = resolve(eat()); break;
      case '--no-verify': opts.verify = false; break;
      case '--help': console.log('see header comment'); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${k}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Character set
// ---------------------------------------------------------------------------

/**
 * Every kana Kansei may need a stroke reference for, enumerated from the Unicode
 * blocks rather than hand-listed so the set is reproducible and cannot silently
 * drop a character:
 *
 *   U+3041..U+3096  hiragana ぁ..ゖ  — 86 chars: the 46 basic, the dakuten/
 *                   handakuten forms が..ぽ, ゔ, the small kana ぁぃぅぇぉっゃゅょゎ,
 *                   ん, and the historical ゐゑ / small ゕゖ.
 *   U+30A1..U+30FA  katakana ァ..ヺ  — 90 chars: same coverage plus ヷヸヹヺ, ヵヶ.
 *   U+30FC          ー  the long-vowel mark.
 *
 * Deliberately excluded: the iteration marks ゝゞヽヾ, U+30FB ・, and U+3099..U+309C
 * (combining/standalone dakuten) — they are not written characters Kansei teaches.
 * Yōon combinations (きゃ) are two code points and compose from their parts, so
 * they get no reference of their own.
 */
function enumerateKana() {
  const out = [];
  const ranges = [[0x3041, 0x3096], [0x30a1, 0x30fa], [0x30fc, 0x30fc]];
  for (const [lo, hi] of ranges) {
    for (let cp = lo; cp <= hi; cp += 1) out.push(String.fromCodePoint(cp));
  }
  return out;
}

/**
 * Read the taught kanji set from data/kanji-top1500.json when another build step
 * has produced it. Tolerant of several plausible shapes; returns null when the
 * file is absent so the caller can report "kanji strokes pending" honestly
 * instead of pretending coverage.
 */
function loadKanjiList(path) {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const glyphs = [];
  /** glyph -> strokeCount as the curriculum file itself declares it, when it does. */
  const declared = new Map();
  const push = (g) => {
    if (typeof g === 'string' && [...g].length === 1) glyphs.push(g);
  };
  const walkEntry = (e) => {
    if (typeof e === 'string') push(e);
    else if (e && typeof e === 'object') {
      const g = e.glyph ?? e.kanji ?? e.character ?? e.char;
      push(g);
      if (typeof g === 'string' && typeof e.strokeCount === 'number') declared.set(g, e.strokeCount);
    }
  };
  const arr = Array.isArray(raw)
    ? raw
    : (raw.kanji ?? raw.characters ?? raw.entries ?? raw.items ?? null);
  if (Array.isArray(arr)) arr.forEach(walkEntry);
  else if (arr && typeof arr === 'object') Object.keys(arr).forEach(push);
  else throw new Error(`Cannot find a kanji array in ${path}`);
  const seen = new Set();
  const uniq = glyphs.filter((g) => (seen.has(g) ? false : seen.add(g)));
  if (uniq.length === 0) throw new Error(`No kanji glyphs recognised in ${path}`);
  return { glyphs: uniq, declared };
}

const hex5 = (glyph) => glyph.codePointAt(0).toString(16).toLowerCase().padStart(5, '0');

// ---------------------------------------------------------------------------
// SVG path parsing — M m L l C c S s only; anything else throws.
// ---------------------------------------------------------------------------

/**
 * Note: tokenizePath splits on ANY ASCII letter, so scientific notation (1e-5)
 * would be mis-split and then rejected as an unknown command 'e'. Audited: the
 * r20250816 dataset uses only M m C c S s and plain decimals, so this cannot
 * silently mis-parse — it would throw.
 */
const NUMBER_RX = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;

/** Split a path 'd' string into [{cmd, args:number[]}] tokens. */
function tokenizePath(d) {
  const tokens = [];
  const cmdRx = /[A-Za-z]/g;
  const positions = [];
  let m;
  while ((m = cmdRx.exec(d)) !== null) positions.push([m.index, m[0]]);
  if (positions.length === 0 || positions[0][0] !== 0) {
    throw new Error(`Path does not start with a command: ${d.slice(0, 40)}`);
  }
  for (let i = 0; i < positions.length; i += 1) {
    const [at, cmd] = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1][0] : d.length;
    const body = d.slice(at + 1, end);
    const args = (body.match(NUMBER_RX) ?? []).map(Number);
    if (args.some((n) => !Number.isFinite(n))) throw new Error(`Bad number in path: ${body}`);
    tokens.push({ cmd, args });
  }
  return tokens;
}

/**
 * Convert a path into a flat list of cubic segments
 * [{p0,p1,p2,p3}] in absolute coordinates, plus the start point.
 * Lines are promoted to degenerate cubics so downstream code has one shape.
 */
function pathToCubics(d) {
  const tokens = tokenizePath(d);
  const segs = [];
  let cur = null;      // current point [x,y]
  let start = null;    // subpath start
  let prevCtl = null;  // previous second control point, for S/s reflection
  let prevWasCurve = false;

  const line = (to) => {
    // A straight line as a cubic: controls at the 1/3 and 2/3 points.
    const p0 = cur;
    const p1 = [p0[0] + (to[0] - p0[0]) / 3, p0[1] + (to[1] - p0[1]) / 3];
    const p2 = [p0[0] + (2 * (to[0] - p0[0])) / 3, p0[1] + (2 * (to[1] - p0[1])) / 3];
    segs.push({ p0, p1, p2, p3: to });
    cur = to;
    prevCtl = null;
    prevWasCurve = false;
  };
  const cubic = (c1, c2, to) => {
    segs.push({ p0: cur, p1: c1, p2: c2, p3: to });
    cur = to;
    prevCtl = c2;
    prevWasCurve = true;
  };

  for (const { cmd, args } of tokens) {
    const rel = cmd === cmd.toLowerCase();
    const R = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case 'M': {
        if (args.length < 2 || args.length % 2 !== 0) {
          throw new Error(`M needs pairs of coordinates, got ${args.length}`);
        }
        // First pair is the moveto; any further pairs are implicit linetos.
        const first = rel && cur ? [cur[0] + args[0], cur[1] + args[1]] : [args[0], args[1]];
        if (segs.length > 0) {
          throw new Error('Multiple subpaths in one stroke path — not expected in KanjiVG');
        }
        cur = first;
        start = first;
        prevCtl = null;
        prevWasCurve = false;
        for (let i = 2; i < args.length; i += 2) line(R(args[i], args[i + 1]));
        break;
      }
      case 'L': {
        if (args.length < 2 || args.length % 2 !== 0) throw new Error('L needs coordinate pairs');
        for (let i = 0; i < args.length; i += 2) line(R(args[i], args[i + 1]));
        break;
      }
      case 'C': {
        if (args.length < 6 || args.length % 6 !== 0) throw new Error('C needs groups of 6');
        for (let i = 0; i < args.length; i += 6) {
          cubic(R(args[i], args[i + 1]), R(args[i + 2], args[i + 3]), R(args[i + 4], args[i + 5]));
        }
        break;
      }
      case 'S': {
        if (args.length < 4 || args.length % 4 !== 0) throw new Error('S needs groups of 4');
        for (let i = 0; i < args.length; i += 4) {
          // Reflect the previous second control point about the current point.
          const c1 = prevWasCurve && prevCtl
            ? [2 * cur[0] - prevCtl[0], 2 * cur[1] - prevCtl[1]]
            : [cur[0], cur[1]];
          cubic(c1, R(args[i], args[i + 1]), R(args[i + 2], args[i + 3]));
        }
        break;
      }
      default:
        // Fail loudly: H, V, Q, T, A, Z and anything else are unhandled by design.
        throw new Error(`Unhandled SVG path command '${cmd}' in: ${d.slice(0, 60)}`);
    }
  }
  if (cur === null || start === null) throw new Error(`Path produced no geometry: ${d}`);
  return { segs, start };
}

const bez = (a, b, c, d2, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d2;
};

/** Flatten cubics into a fine polyline with cumulative arc length. */
function flatten({ segs, start }) {
  const pts = [start.slice()];
  const cum = [0];
  let total = 0;
  const add = (p) => {
    const prev = pts[pts.length - 1];
    const dx = p[0] - prev[0];
    const dy = p[1] - prev[1];
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return; // skip duplicate samples; keeps the polyline progressing
    total += dist;
    pts.push(p);
    cum.push(total);
  };
  for (const s of segs) {
    const poly = Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1])
      + Math.hypot(s.p2[0] - s.p1[0], s.p2[1] - s.p1[1])
      + Math.hypot(s.p3[0] - s.p2[0], s.p3[1] - s.p2[1]);
    const steps = Math.max(4, Math.min(MAX_FLATTEN_STEPS, Math.ceil(poly / FLATTEN_CHORD)));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      add([bez(s.p0[0], s.p1[0], s.p2[0], s.p3[0], t), bez(s.p0[1], s.p1[1], s.p2[1], s.p3[1], t)]);
    }
  }
  return { pts, cum, total };
}

const round = (n, dp = COORD_DP) => {
  const f = 10 ** dp;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Resample a flattened polyline to N points evenly spaced by arc length. */
function resample({ pts, cum, total }, n = POINTS_PER_STROKE) {
  if (total === 0) {
    const p = [round(pts[0][0]), round(pts[0][1])];
    return Array.from({ length: n }, () => [p[0], p[1]]);
  }
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (total * i) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j += 1;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen === 0 ? 0 : (target - cum[j]) / segLen;
    const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t;
    const y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
    out.push([round(x), round(y)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (stored + deflate), so the build works straight from the
// archive that scripts/assets/fetch-sources.mjs downloads — no unzip step, and
// still node-builtins only. Fails loudly on anything it does not understand.
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Read a zip's central directory: basename -> {offset, method, compressedSize, size}. */
function readZipCentralDirectory(buf) {
  // EOCD is at the end, after a comment of up to 65535 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip archive: no end-of-central-directory record');
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) {
    throw new Error('ZIP64 archive — unsupported by this reader');
  }
  const entries = new Map();
  let p = cenOffset;
  for (let n = 0; n < entryCount; n += 1) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error(`Bad central directory entry at ${p}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if ((flags & 0x0001) !== 0) throw new Error(`Encrypted zip entry: ${name}`);
    if (!name.endsWith('/')) entries.set(basename(name), { name, offset, method, compressedSize, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extract one entry's bytes. */
function readZipEntry(buf, entry) {
  if (buf.readUInt32LE(entry.offset) !== LOC_SIG) {
    throw new Error(`Bad local header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(entry.offset + 26);
  const extraLen = buf.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  let out;
  if (entry.method === 0) out = raw;
  else if (entry.method === 8) out = inflateRawSync(raw);
  else throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
  if (out.length !== entry.size) {
    throw new Error(`Size mismatch for ${entry.name}: ${out.length} != ${entry.size}`);
  }
  return out;
}

/** Locate the KanjiVG archive next to (or at) the given path. */
function findKanjivgZip(target) {
  // The path may BE the zip, or a directory holding it, or that directory's parent
  // (data/sources/kanjivg -> data/sources/kanjivg-20250816-main.zip).
  if (target.endsWith('.zip') && existsSync(target)) return target;
  for (const base of [target, dirname(target)]) {
    let names;
    try { names = readdirSync(base); } catch { continue; }
    const hit = names.filter((f) => /^kanjivg-\d+-main\.zip$/.test(f)).sort();
    if (hit.length > 0) return join(base, hit[hit.length - 1]); // newest release
  }
  return null;
}

// ---------------------------------------------------------------------------
// KanjiVG reading
// ---------------------------------------------------------------------------

/** Locate the directory holding <hex>.svg files (the zip uses kanji/, docs say svg/). */
function findSvgDir(root) {
  // `root` may be a file (a .zip), a missing path, or a directory — readdirSync
  // throws ENOTDIR on the first of those, so every read is guarded.
  const list = (dir, opts) => {
    try { return readdirSync(dir, opts); } catch { return null; }
  };
  for (const c of [root, join(root, 'kanji'), join(root, 'svg')]) {
    const names = list(c);
    if (names && names.some((f) => /^[0-9a-f]{5}(-[A-Za-z0-9]+)?\.svg$/.test(f))) return c;
  }
  // one level of nesting (e.g. kanjivg-20250816/kanji)
  for (const d of list(root, { withFileTypes: true }) ?? []) {
    if (!d.isDirectory()) continue;
    const found = findSvgDir(join(root, d.name));
    if (found) return found;
  }
  return null;
}

/** Index the svg directory: hex -> {plain, variants:[{name,file}]}. */
function indexSvgDir(dir) {
  const map = new Map();
  for (const f of readdirSync(dir)) {
    const m = /^([0-9a-f]{5})(?:-([A-Za-z0-9]+))?\.svg$/.exec(f);
    if (!m) continue;
    const entry = map.get(m[1]) ?? { plain: null, variants: [] };
    if (m[2] === undefined) entry.plain = join(dir, f);
    else entry.variants.push({ name: m[2], file: f });
    map.set(m[1], entry);
  }
  for (const e of map.values()) e.variants.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

const PATH_TAG_RX = /<path\b[^>]*>/g;
const D_RX = /\sd="([^"]*)"/;
const TYPE_RX = /\skvg:type="([^"]*)"/;
const STROKEPATHS_RX = /<g id="kvg:StrokePaths_[^"]*"[\s\S]*?(?=<g id="kvg:StrokeNumbers_|$)/;

/**
 * Extract the stroke paths of one KanjiVG file in document order.
 * Document order IS the stroke order — KanjiVG's -sN ids follow it.
 */
function readStrokes(svg, label) {
  const scoped = STROKEPATHS_RX.exec(svg);
  const region = scoped ? scoped[0] : svg;
  const strokes = [];
  for (const tag of region.match(PATH_TAG_RX) ?? []) {
    const d = D_RX.exec(tag);
    if (!d) throw new Error(`<path> without d in ${label}`);
    strokes.push({ d: d[1].trim(), type: TYPE_RX.exec(tag)?.[1] ?? null, tag });
  }
  if (strokes.length === 0) throw new Error(`No stroke paths in ${label}`);
  // Sanity: ids, when present, must ascend 1..n so we know order is intact.
  const nums = strokes
    .map((s) => /id="kvg:[0-9a-f]+(?:-[^"]*?)?-s(\d+)"/.exec(s.tag)?.[1])
    .map((n) => (n === undefined ? null : Number(n)));
  if (nums.every((n) => n !== null)) {
    for (let i = 0; i < nums.length; i += 1) {
      if (nums[i] !== i + 1) {
        throw new Error(`Stroke ids out of order in ${label}: ${nums.join(',')}`);
      }
    }
  }
  return strokes.map(({ d, type }) => ({ d, type }));
}

/** Build a StrokeReference for one glyph. */
function buildReference(glyph, svg, label) {
  const raw = readStrokes(svg, label);
  const strokes = raw.map(({ d, type }) => {
    const flat = flatten(pathToCubics(d));
    return {
      path: d,
      points: resample(flat),
      type,
      length: round(flat.total, 3),
    };
  });
  return {
    glyph,
    source: SOURCE_ID,
    viewBox: { ...VIEWBOX },
    strokes,
    orderVariants: [],
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Parse KANJIDIC2 for glyph -> first <stroke_count>. Returns null if absent.
 * Accepts either the plain XML or the gzip the repo's own fetcher stores
 * (scripts/assets/fetch-sources.mjs writes data/sources/kanjidic2.xml.gz), so the
 * cross-check works from a fresh clone with no manual gunzip step.
 */
function loadKanjidicStrokeCounts(path) {
  const gz = path.endsWith('.gz') ? path : `${path}.gz`;
  const plain = path.endsWith('.gz') ? path.slice(0, -3) : path;
  let xml;
  if (existsSync(plain)) xml = readFileSync(plain, 'utf8');
  else if (existsSync(gz)) xml = gunzipSync(readFileSync(gz)).toString('utf8');
  else return null;
  const counts = new Map();
  const entryRx = /<character>([\s\S]*?)<\/character>/g;
  let m;
  while ((m = entryRx.exec(xml)) !== null) {
    const body = m[1];
    const lit = /<literal>(.*?)<\/literal>/.exec(body)?.[1];
    const sc = /<stroke_count>(\d+)<\/stroke_count>/.exec(body)?.[1];
    if (lit && sc) counts.set(lit, Number(sc));
  }
  return counts;
}

/**
 * Expected stroke counts for the spot-check set.
 * Kanji are checked against KANJIDIC2 (machine-readable, EDRDG). Kana are NOT in
 * KANJIDIC2 and we have no machine-readable authority for them in our sources, so
 * their expected values are hand-asserted from standard kana stroke-order charts
 * and labelled as such — see docs/content/STROKES.md.
 */
const SPOT_CHECK = [
  { glyph: '一', expected: null, via: 'kanjidic2' },
  { glyph: '川', expected: null, via: 'kanjidic2' },
  { glyph: '水', expected: null, via: 'kanjidic2' },
  { glyph: '曜', expected: null, via: 'kanjidic2' },
  { glyph: '語', expected: null, via: 'kanjidic2' },
  { glyph: '議', expected: null, via: 'kanjidic2' },
  { glyph: 'ね', expected: 2, via: 'hand-asserted (standard kana stroke-order chart)' },
  { glyph: 'ツ', expected: 3, via: 'hand-asserted (standard kana stroke-order chart)' },
];

/**
 * Strokes whose 24-sample polyline loses more than this fraction of the true arc
 * length are *coarse*, not wrong: a long, tightly curling stroke (ゑ, ゐ) chords
 * across its own curvature at a fixed sample count. Reported as an advisory.
 */
const COARSE_RATIO = 0.95;

function verifyReference(ref, problems, advisories) {
  const { glyph } = ref;
  ref.strokes.forEach((s, i) => {
    const where = `${glyph} stroke ${i + 1}`;
    if (s.points.length !== POINTS_PER_STROKE) {
      problems.push(`${where}: ${s.points.length} points, expected ${POINTS_PER_STROKE}`);
    }
    for (const [x, y] of s.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) problems.push(`${where}: non-finite point`);
      if (x < 0 || x > VIEWBOX.width || y < 0 || y > VIEWBOX.height) {
        problems.push(`${where}: point (${x},${y}) outside 0..109 box`);
      }
    }
    // Monotonic progression: arc length along the resampled polyline must strictly
    // increase, i.e. no repeated or backtracked-to-identical sample points.
    let acc = 0;
    for (let k = 1; k < s.points.length; k += 1) {
      const d = Math.hypot(s.points[k][0] - s.points[k - 1][0], s.points[k][1] - s.points[k - 1][1]);
      if (!(d > 0)) problems.push(`${where}: non-progressing at sample ${k} (step ${d})`);
      acc += d;
    }
    // The resampled chord total can never meaningfully exceed the true arc length
    // (a chord is shorter than its arc). It can exceed it by a hair purely from
    // output rounding: each coordinate is rounded to COORD_DP, which can lengthen
    // each of the 23 chords by up to sqrt(2)*10^-COORD_DP, and `length` itself is
    // stored rounded. Anything beyond that allowance means broken geometry.
    if (s.length > 0) {
      const roundingSlack = (POINTS_PER_STROKE - 1) * Math.SQRT2 * 10 ** -COORD_DP + 0.001;
      const ratio = acc / s.length;
      if (acc > s.length + roundingSlack) {
        problems.push(`${where}: polyline ${acc} exceeds arc length ${s.length}`);
      } else if (ratio < COARSE_RATIO) {
        advisories.push({
          glyph,
          stroke: i + 1,
          arcLength: s.length,
          polylineLength: round(acc, 3),
          ratio: round(ratio, 4),
          spacing: round(s.length / (POINTS_PER_STROKE - 1), 2),
        });
      }
    }
    // Endpoint fidelity: the first and last samples must be the path's own ends.
    const ends = pathEndpoints(s.path);
    for (const [label, want, got] of [
      ['start', ends.start, s.points[0]],
      ['end', ends.end, s.points[s.points.length - 1]],
    ]) {
      if (Math.hypot(want[0] - got[0], want[1] - got[1]) > 0.02) {
        problems.push(`${where}: ${label} ${got} does not match path ${want}`);
      }
    }
  });
}

/** Independent-ish endpoint read: the M coordinates, and the last cubic's p3. */
function pathEndpoints(d) {
  const { segs, start } = pathToCubics(d);
  const last = segs.length > 0 ? segs[segs.length - 1].p3 : start;
  return { start: [round(start[0]), round(start[1])], end: [round(last[0]), round(last[1])] };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * A uniform view over KanjiVG regardless of how it is on disk: an extracted
 * directory if one exists, otherwise the downloaded zip read in memory.
 * Returns { describe, index } where index is hex -> {plain, variants, read()}.
 */
function openKanjivg(kanjivgDir) {
  const dir = findSvgDir(kanjivgDir);
  if (dir) {
    const byHex = indexSvgDir(dir);
    const index = new Map();
    for (const [hex, e] of byHex) {
      index.set(hex, {
        plain: e.plain,
        variants: e.variants,
        read: () => readFileSync(e.plain, 'utf8'),
      });
    }
    return { describe: dir, index };
  }
  const zipPath = findKanjivgZip(kanjivgDir);
  if (!zipPath) {
    throw new Error(
      `No KanjiVG data under ${kanjivgDir}: expected either an extracted svg/kanji directory or kanjivg-*-main.zip. Run \`npm run content:fetch\` first.`,
    );
  }
  const buf = readFileSync(zipPath);
  const entries = readZipCentralDirectory(buf);
  const index = new Map();
  for (const [base, entry] of entries) {
    const m = /^([0-9a-f]{5})(?:-([A-Za-z0-9]+))?\.svg$/.exec(base);
    if (!m) continue;
    const rec = index.get(m[1]) ?? { plain: null, variants: [], read: null };
    if (m[2] === undefined) {
      rec.plain = `${basename(zipPath)}!${entry.name}`;
      rec.read = () => readZipEntry(buf, entry).toString('utf8');
    } else rec.variants.push({ name: m[2], file: base });
    index.set(m[1], rec);
  }
  for (const e of index.values()) e.variants.sort((a, b) => a.name.localeCompare(b.name));
  if (index.size === 0) throw new Error(`No <hex>.svg entries in ${zipPath}`);
  return { describe: zipPath, index };
}

function main() {
  const opts = parseArgs(process.argv);
  const { describe: svgDir, index: svgIndex } = openKanjivg(opts.kanjivgDir);

  const kana = enumerateKana();
  const kanjiList = loadKanjiList(opts.kanjiList);
  const kanji = kanjiList === null ? null : kanjiList.glyphs;
  const declaredCounts = kanjiList === null ? new Map() : kanjiList.declared;
  const kanjiPending = kanji === null;
  const requested = [...kana, ...(kanji ?? [])];

  mkdirSync(opts.outDir, { recursive: true });

  const characters = {};
  const missing = [];
  const variantsSeen = {};
  const problems = [];
  const advisories = [];
  let totalBytes = 0;
  let strokeTotal = 0;

  for (const glyph of requested) {
    const hex = hex5(glyph);
    const entry = svgIndex.get(hex);
    if (!entry || !entry.plain) {
      missing.push({ glyph, hex, reason: entry ? 'only variant files present' : 'no KanjiVG file' });
      continue;
    }
    if (entry.variants.length > 0) variantsSeen[glyph] = entry.variants.map((v) => v.name);
    const ref = buildReference(glyph, entry.read(), entry.plain);
    if (opts.verify) verifyReference(ref, problems, advisories);
    const json = JSON.stringify(ref);
    const file = `${hex}.json`;
    writeFileSync(join(opts.outDir, file), json);
    const bytes = Buffer.byteLength(json);
    characters[glyph] = {
      file,
      strokeCount: ref.strokes.length,
      bytes,
      sha256: createHash('sha256').update(json).digest('hex'),
    };
    totalBytes += bytes;
    strokeTotal += ref.strokes.length;
  }

  // --- spot check against KANJIDIC2 --------------------------------------
  const kanjidic = opts.verify ? loadKanjidicStrokeCounts(opts.kanjidic) : null;
  const spot = [];
  for (const c of SPOT_CHECK) {
    const got = characters[c.glyph]?.strokeCount ?? null;
    let expected = c.expected;
    let via = c.via;
    if (expected === null && via === 'kanjidic2') {
      if (kanjidic === null) via = 'KANJIDIC2 not fetched — NOT CHECKED';
      else {
        expected = kanjidic.get(c.glyph) ?? null;
        if (expected === null) via = 'kanjidic2 has no entry — NOT CHECKED';
      }
    }
    if (got === null) {
      // Not generated. When the kanji set is pending this is expected, not a fault.
      const why = kanjiPending
        ? 'SKIPPED — kanji set pending (data/kanji-top1500.json absent)'
        : 'NOT GENERATED — glyph missing from the requested set';
      spot.push({ glyph: c.glyph, got: null, expected, via, ok: null, status: why });
      if (!kanjiPending) problems.push(`spot-check glyph ${c.glyph} was not generated`);
      continue;
    }
    const ok = expected === null ? null : got === expected;
    spot.push({ glyph: c.glyph, got, expected, via, ok, status: ok === null ? 'NOT CHECKED' : (ok ? 'ok' : 'MISMATCH') });
    if (ok === false) problems.push(`stroke count mismatch for ${c.glyph}: KanjiVG ${got} vs ${via} ${expected}`);
  }

  // --- full cross-check: every generated character that KANJIDIC2 knows -----
  // KanjiVG and KANJIDIC2 occasionally count differently, almost always because
  // KanjiVG draws a different glyph form (the 辶 / 食 / 曷 components are the usual
  // culprits). Measured over all 6,416 KanjiVG kanji that KANJIDIC2 covers the two
  // agree on 98.3%, and on ALL of KANJIDIC2's top-1000-frequency kanji. So for a
  // beginner set this should never fire — and if it does, it is a real conflict
  // between the animation and whatever strokeCount the curriculum records, so it is
  // reported as a failure for a human to resolve rather than silently tolerated.
  const strokeCountDisagreements = [];
  if (kanjidic !== null) {
    for (const [glyph, meta] of Object.entries(characters)) {
      const expected = kanjidic.get(glyph);
      if (expected === undefined) continue; // kana and a few rare glyphs are absent
      if (expected !== meta.strokeCount) {
        strokeCountDisagreements.push({ glyph, kanjivg: meta.strokeCount, kanjidic2: expected });
        problems.push(
          `stroke count disagreement for ${glyph}: KanjiVG ${meta.strokeCount} vs KANJIDIC2 ${expected}`,
        );
      }
    }
  }

  // The curriculum file usually declares its own strokeCount (KANJIDIC2-derived).
  // If it disagrees with the number of KanjiVG paths, the animation and the taught
  // count would contradict each other in the UI — a real defect, so it fails.
  const curriculumDisagreements = [];
  for (const [glyph, want] of declaredCounts) {
    const got = characters[glyph]?.strokeCount;
    if (got !== undefined && got !== want) {
      curriculumDisagreements.push({ glyph, kanjivg: got, declared: want });
      problems.push(
        `stroke count disagreement for ${glyph}: KanjiVG ${got} vs ${basename(opts.kanjiList)} ${want}`,
      );
    }
  }

  const index = {
    source: SOURCE_ID,
    sourceVersion: SOURCE_VERSION,
    sourceUrl: 'https://github.com/KanjiVG/kanjivg',
    license: 'CC-BY-SA-3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution:
      'Stroke data from KanjiVG (http://kanjivg.tagaini.net), Copyright (C) 2009-2025 Ulrich Apel, CC BY-SA 3.0.',
    generatedBy: 'scripts/content/build-strokes.mjs',
    viewBox: { ...VIEWBOX },
    pointsPerStroke: POINTS_PER_STROKE,
    note: 'Reference data only — KanjiVG documents one stroke order per character and is not a grader.',
    counts: {
      characters: Object.keys(characters).length,
      kanaRequested: kana.length,
      kanjiRequested: kanji === null ? 0 : kanji.length,
      strokes: strokeTotal,
      bytes: totalBytes,
    },
    kanjiPending,
    variantFilesAvailable: variantsSeen,
    coarselySampledStrokes: advisories.length,
    strokeCountDisagreementsVsKanjidic2: strokeCountDisagreements,
    strokeCountDisagreementsVsCurriculum: curriculumDisagreements,
    missing,
    characters,
  };
  const indexJson = JSON.stringify(index);
  writeFileSync(join(opts.outDir, 'index.json'), indexJson);

  // --- report ------------------------------------------------------------
  const report = {
    kanjivgSource: svgDir,
    characters: Object.keys(characters).length,
    kana: kana.length,
    kanji: kanji === null ? 'PENDING — data/kanji-top1500.json does not exist' : kanji.length,
    strokes: strokeTotal,
    bytesPerCharFiles: totalBytes,
    bytesIndex: Buffer.byteLength(indexJson),
    bytesTotal: totalBytes + Buffer.byteLength(indexJson),
    missing,
    variantFilesAvailable: Object.keys(variantsSeen).length,
    spotCheck: spot,
    strokeCountCrossCheck: kanjidic === null
      ? 'KANJIDIC2 not present — stroke counts NOT cross-checked'
      : {
          checked: Object.keys(characters).filter((g) => kanjidic.has(g)).length,
          notInKanjidic2: Object.keys(characters).filter((g) => !kanjidic.has(g)).length,
          disagreements: strokeCountDisagreements,
        },
    curriculumStrokeCountCrossCheck: declaredCounts.size === 0
      ? 'no declared strokeCount in the kanji list — NOT cross-checked'
      : { checked: declaredCounts.size, disagreements: curriculumDisagreements },
    coarseSamplingAdvisories: {
      count: advisories.length,
      threshold: `resampled polyline < ${COARSE_RATIO * 100}% of true arc length`,
      worst: advisories.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 10),
    },
    problems,
  };
  console.log(JSON.stringify(report, null, 2));
  if (problems.length > 0) {
    console.error(`\nFAILED verification with ${problems.length} problem(s).`);
    process.exitCode = 1;
  }
}

main();
