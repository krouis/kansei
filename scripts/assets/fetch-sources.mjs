#!/usr/bin/env node
/**
 * fetch-sources.mjs — download the upstream dictionaries and stroke data Kansei
 * derives its content from.
 *
 * Files land in data/sources/ (gitignored: large upstream archives are fetched,
 * never committed). Every download is recorded in data/sources/SOURCES.lock.json
 * with its SHA-256, byte size, upstream URL, licence and fetch timestamp, so the
 * provenance of every derived file is checkable.
 *
 * Behaviour:
 *   - idempotent: a file whose on-disk SHA-256 already matches the lock entry is
 *     skipped without touching the network.
 *   - resume-friendly: partial downloads are staged as `<name>.part` and resumed
 *     with an HTTP Range request when the server supports it (206); a server that
 *     ignores Range (200) restarts the file cleanly.
 *   - progress is printed to stderr.
 *
 * Usage:
 *   node scripts/assets/fetch-sources.mjs                # fetch everything missing/changed
 *   node scripts/assets/fetch-sources.mjs kanjidic2      # fetch only matching ids
 *   node scripts/assets/fetch-sources.mjs --force        # re-download even if digest matches
 *   node scripts/assets/fetch-sources.mjs --verify       # verify on-disk files only, no network
 *
 * No dependencies beyond Node builtins.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SOURCES_DIR = path.join(REPO, 'data', 'sources');
const LOCK_PATH = path.join(SOURCES_DIR, 'SOURCES.lock.json');

/**
 * The source manifest. `file` is the name on disk; `id` is the stable key used in
 * the lock file and by the build scripts.
 *
 * Licence fields are recorded verbatim from the upstream project's own statement;
 * see docs/content/ for the per-dataset provenance documents.
 */
const SOURCES = [
  {
    id: 'kanjidic2',
    file: 'kanjidic2.xml.gz',
    url: 'http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz',
    project: 'KANJIDIC2',
    publisher: 'Electronic Dictionary Research and Development Group (EDRDG)',
    homepage: 'http://www.edrdg.org/wiki/index.php/KANJIDIC_Project',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://www.edrdg.org/edrdg/licence.html',
    redistribution:
      'Redistribution and derivative works permitted under CC BY-SA 4.0 with attribution to the EDRDG and a statement of changes; derived works must be shared alike.',
    notes: 'Kanji dictionary: meanings, on/kun readings, radicals, stroke counts, grade, frequency rank.',
    expectGzip: true,
  },
  {
    id: 'kanjivg',
    file: 'kanjivg-20250816-main.zip',
    url: 'https://github.com/KanjiVG/kanjivg/releases/download/r20250816/kanjivg-20250816-main.zip',
    project: 'KanjiVG r20250816',
    publisher: 'Ulrich Apel / KanjiVG contributors',
    homepage: 'https://kanjivg.tagaini.net/',
    license: 'CC-BY-SA-3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    redistribution:
      'Redistribution and derivative works permitted under CC BY-SA 3.0 with attribution to Ulrich Apel and the KanjiVG project; derived works must be shared alike.',
    notes: 'Per-stroke SVG outlines and stroke order for kanji and kana.',
    expectZip: true,
  },
  {
    id: 'jmdict-e-examp',
    file: 'JMdict_e_examp.gz',
    url: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e_examp.gz',
    project: 'JMdict (English, with examples)',
    publisher: 'Electronic Dictionary Research and Development Group (EDRDG)',
    homepage: 'https://www.edrdg.org/jmdict/j_jmdict.html',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://www.edrdg.org/edrdg/licence.html',
    redistribution:
      'Redistribution and derivative works permitted under CC BY-SA 4.0 with attribution to the EDRDG and a statement of changes; derived works must be shared alike.',
    notes: 'Japanese-English dictionary with example sentence links; source of beginner vocabulary.',
    expectGzip: true,
  },
];

const USER_AGENT = 'kansei-content-fetcher/1.0 (+https://github.com/; offline Japanese learning PWA; contact via repo)';

/* ------------------------------------------------------------------ helpers */

function fmtBytes(n) {
  if (n == null) return '?';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`;
}

async function sha256File(p) {
  const h = createHash('sha256');
  await pipeline(createReadStream(p), h);
  return h.digest('hex');
}

async function fileSize(p) {
  try {
    return (await stat(p)).size;
  } catch {
    return null;
  }
}

async function readLock() {
  try {
    const raw = await readFile(LOCK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object') return parsed;
  } catch {
    /* no lock yet, or unreadable — start fresh */
  }
  return { schema: 'kansei-sources-lock/1', generatedAt: null, files: {} };
}

/**
 * Merge our entries into whatever the lock already holds. Other fetch scripts
 * (fonts, audio) record their own downloads here, so never rewrite wholesale.
 */
async function writeLock(lock) {
  lock.schema = 'kansei-sources-lock/1';
  lock.generatedAt = new Date().toISOString();
  lock.note =
    'SHA-256 and size of every upstream file fetched into data/sources/. data/sources/ is gitignored; this lock is committed so downloads are verifiable and reproducible.';
  const ordered = {};
  for (const k of Object.keys(lock.files).sort()) ordered[k] = lock.files[k];
  lock.files = ordered;
  await writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

/** Sniff magic bytes so a truncated file or an HTML error page is caught early. */
async function sniff(p, bytes = 4) {
  const fh = await open(p, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function checkMagic(src, p) {
  const head = await sniff(p, 4);
  if (src.expectGzip) {
    if (!(head[0] === 0x1f && head[1] === 0x8b)) {
      return `expected gzip magic 1f 8b, got ${[...head].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    }
  }
  if (src.expectZip) {
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
      return `expected zip magic 50 4b ("PK"), got ${[...head].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    }
  }
  return null;
}

/* ----------------------------------------------------------------- download */

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(
      u,
      { method: 'GET', headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity', ...headers } },
      (res) => resolve(res),
    );
    req.on('error', reject);
    req.setTimeout(120_000, () => req.destroy(new Error('timed out after 120s')));
    req.end();
  });
}

/** GET with redirect following; returns the final response stream. */
async function get(url, headers, hops = 0) {
  if (hops > 6) throw new Error(`too many redirects for ${url}`);
  const res = await request(url, headers);
  const code = res.statusCode ?? 0;
  if (code >= 300 && code < 400 && res.headers.location) {
    res.resume();
    return get(new URL(res.headers.location, url).toString(), headers, hops + 1);
  }
  return { res, code, url };
}

async function download(src, { force }) {
  const dest = path.join(SOURCES_DIR, src.file);
  const part = `${dest}.part`;

  let startAt = 0;
  if (!force) {
    const have = await fileSize(part);
    if (have != null && have > 0) startAt = have;
  } else {
    await rm(part, { force: true });
  }

  const headers = startAt > 0 ? { range: `bytes=${startAt}-` } : {};
  const { res, code } = await get(src.url, headers);

  if (code === 416) {
    // Range not satisfiable: the .part is already >= the full length. Restart.
    res.resume();
    await rm(part, { force: true });
    return download(src, { force: true });
  }
  if (code !== 200 && code !== 206) {
    res.resume();
    throw new Error(`HTTP ${code} for ${src.url}`);
  }

  let appending = code === 206;
  if (startAt > 0 && !appending) {
    process.stderr.write(`  server ignored Range; restarting ${src.file} from 0\n`);
    await rm(part, { force: true });
    startAt = 0;
  }
  if (code === 206) {
    process.stderr.write(`  resuming ${src.file} at ${fmtBytes(startAt)}\n`);
  }

  const lenHeader = Number(res.headers['content-length']);
  const total = Number.isFinite(lenHeader) ? lenHeader + (appending ? startAt : 0) : null;

  let got = appending ? startAt : 0;
  let lastPrint = 0;
  res.on('data', (chunk) => {
    got += chunk.length;
    const now = Date.now();
    if (now - lastPrint > 250) {
      lastPrint = now;
      const pct = total ? ` (${((got / total) * 100).toFixed(1)}%)` : '';
      process.stderr.write(`\r  ${src.file}: ${fmtBytes(got)}${total ? ` / ${fmtBytes(total)}` : ''}${pct}   `);
    }
  });

  await pipeline(res, createWriteStream(part, { flags: appending ? 'a' : 'w' }));
  process.stderr.write(`\r  ${src.file}: ${fmtBytes(got)} downloaded${' '.repeat(20)}\n`);

  if (total != null && got !== total) {
    throw new Error(`${src.file}: short read — got ${got} bytes, expected ${total}`);
  }

  const magicProblem = await checkMagic(src, part);
  if (magicProblem) {
    await rm(part, { force: true });
    throw new Error(`${src.file}: ${magicProblem} (discarded; upstream may have served an error page)`);
  }

  await rename(part, dest);
  return dest;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const verifyOnly = argv.includes('--verify');
  const filters = argv.filter((a) => !a.startsWith('--'));

  await mkdir(SOURCES_DIR, { recursive: true });
  const lock = await readLock();

  const selected = filters.length
    ? SOURCES.filter((s) => filters.some((f) => s.id.includes(f) || s.file.includes(f)))
    : SOURCES;
  if (!selected.length) {
    process.stderr.write(`No sources match ${filters.join(', ')}. Known ids: ${SOURCES.map((s) => s.id).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const src of selected) {
    const dest = path.join(SOURCES_DIR, src.file);
    const prior = lock.files[src.id];
    process.stderr.write(`${src.id} (${src.project})\n`);

    try {
      const size = await fileSize(dest);
      const digest = size == null ? null : await sha256File(dest);

      // --verify never touches the network: it only reports what is on disk
      // against the lock. Checked before the up-to-date shortcut so that a
      // verified-good file is still reported explicitly rather than silently.
      if (verifyOnly) {
        if (size == null) {
          process.stderr.write(`  MISSING (run without --verify to fetch)\n`);
          failures += 1;
        } else if (!prior) {
          process.stderr.write(`  UNRECORDED: present (${fmtBytes(size)}, sha256 ${digest}) but absent from the lock\n`);
          failures += 1;
        } else if (prior.sha256 !== digest || prior.bytes !== size) {
          process.stderr.write(`  MISMATCH: on disk ${digest} (${size} B), lock ${prior.sha256} (${prior.bytes} B)\n`);
          failures += 1;
        } else {
          const magicProblem = await checkMagic(src, dest);
          if (magicProblem) {
            process.stderr.write(`  FORMAT: ${magicProblem}\n`);
            failures += 1;
          } else {
            process.stderr.write(`  verified ${fmtBytes(size)}, sha256 ${digest}\n`);
          }
        }
        continue;
      }

      if (size != null && !force) {
        if (prior && prior.sha256 === digest && prior.bytes === size) {
          const magicProblem = await checkMagic(src, dest);
          if (magicProblem) throw new Error(`on-disk file fails format check: ${magicProblem}`);
          process.stderr.write(`  up to date (${fmtBytes(size)}, sha256 ${digest.slice(0, 12)}…)\n`);
          continue;
        }
        if (prior && prior.sha256 !== digest) {
          process.stderr.write(`  digest differs from lock — upstream changed or file corrupt; re-fetching\n`);
        }
      }

      const wroteTo = size != null && !force && !prior ? dest : await download(src, { force });
      const finalSize = await fileSize(wroteTo);
      const finalDigest = await sha256File(wroteTo);

      lock.files[src.id] = {
        id: src.id,
        file: path.relative(REPO, wroteTo).split(path.sep).join('/'),
        url: src.url,
        project: src.project,
        publisher: src.publisher,
        homepage: src.homepage,
        license: src.license,
        licenseUrl: src.licenseUrl,
        redistribution: src.redistribution,
        notes: src.notes,
        bytes: finalSize,
        sha256: finalDigest,
        fetchedAt: new Date().toISOString(),
        fetchedBy: 'scripts/assets/fetch-sources.mjs',
      };
      process.stderr.write(`  ok ${fmtBytes(finalSize)}, sha256 ${finalDigest}\n`);
    } catch (err) {
      failures += 1;
      process.stderr.write(`  FAILED: ${err.message}\n`);
    }
  }

  if (!verifyOnly) await writeLock(lock);
  if (failures) {
    process.stderr.write(`\n${failures} source(s) ${verifyOnly ? 'failed verification' : 'failed'}.\n`);
    process.exitCode = 1;
  } else if (verifyOnly) {
    process.stderr.write(`\nAll ${selected.length} source(s) match ${path.relative(REPO, LOCK_PATH)}.\n`);
  } else {
    process.stderr.write(`\nAll ${selected.length} source(s) present and recorded in ${path.relative(REPO, LOCK_PATH)}.\n`);
  }
}

await main();
