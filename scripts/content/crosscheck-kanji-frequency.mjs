#!/usr/bin/env node
/**
 * crosscheck-kanji-frequency.mjs — independent check on the primary kanji ranking.
 *
 * Kansei ranks kanji by KANJIDIC2's <freq> field, which derives from a 1990s
 * Mainichi Shimbun word-frequency analysis (see docs/content/KANJI-FREQUENCY.md).
 * That is one corpus, from one register, from one decade. This script measures how
 * much a top-N cut from it agrees with a completely independent, modern set of
 * character counts, so the app can state the robustness of its list instead of
 * asserting it.
 *
 * It does NOT change the primary ranking. Output is evidence only:
 *   data/kanji-frequency-crosscheck.json
 *
 * Comparison source: scriptin/kanji-frequency (Dmitry Shpika), CC BY 4.0 —
 * three corpora counted directly as characters: Japanese Wikipedia, Aozora Bunko,
 * Japanese Wikinews.
 *
 * Usage:
 *   node scripts/content/crosscheck-kanji-frequency.mjs
 *   node scripts/content/crosscheck-kanji-frequency.mjs --offline   # reuse cached CSVs
 *
 * No dependencies beyond Node builtins.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CACHE = path.join(REPO, 'data', 'sources', 'kanji-frequency');
const PRIMARY = path.join(REPO, 'data', 'kanji-top1500.json');
const OUT = path.join(REPO, 'data', 'kanji-frequency-crosscheck.json');

const REPO_REF = 'master';
const BASE = `https://raw.githubusercontent.com/scriptin/kanji-frequency/${REPO_REF}/data`;

/**
 * Corpora, with the upstream project's own description of each. Sizes are quoted
 * from https://scriptin.github.io/kanji-frequency/ and are re-derived from the
 * CSV "all" row at run time, which is checked against the quoted figure.
 */
const CORPORA = [
  {
    id: 'wikipedia',
    file: 'wikipedia_characters.csv',
    label: 'Japanese Wikipedia',
    description: '100,000 randomly sampled Japanese Wikipedia articles, collected January 2023. All modern Japanese.',
    statedTexts: 100_000,
    statedTotalKanji: 59_301_009,
    statedUniqueKanji: 8_483,
  },
  {
    id: 'aozora',
    file: 'aozora_characters.csv',
    label: 'Aozora Bunko',
    description:
      'Books from Aozora Bunko: 17,115 texts. Mostly out-of-copyright literature, so the majority is more than 70 years old; some texts have been modernised.',
    statedTexts: 17_115,
    statedTotalKanji: 67_805_014,
    statedUniqueKanji: 7_914,
  },
  {
    id: 'news',
    file: 'news_characters.csv',
    label: 'Japanese Wikinews',
    description:
      'News articles from Japanese Wikinews: 3,753 texts, distributed across roughly 2005-2023. The smallest of the three corpora.',
    statedTexts: 3_753,
    statedTotalKanji: 1_117_683,
    statedUniqueKanji: 2_939,
  },
];

const SOURCE_META = {
  project: 'kanji-frequency',
  author: 'Dmitry Shpika (scriptin)',
  repository: 'https://github.com/scriptin/kanji-frequency',
  ref: REPO_REF,
  website: 'https://scriptin.github.io/kanji-frequency/',
  license: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attributionRequired:
    'Kanji usage frequency data © 2015-2026 Dmitry Shpika, used under CC BY 4.0. Used here for comparison only; the counts themselves are not redistributed in Kansei content packs.',
  redistribution:
    'CC BY 4.0: share and adapt freely, including commercially, with credit, a link to the licence and an indication of changes. No share-alike obligation.',
  methodology:
    'Characters are counted directly in the corpus text (a raw character tally), not derived from word frequencies. Counts are per corpus; the project explicitly warns that ranks do not match across corpora.',
  notes: [
    'The repository layout changed since the JSON era: data/wikipedia.json, data/aozora.json and data/news.json now return HTTP 404. The current files are CSVs of the form rank,code_point_hex,char,char_count, with rank 0 being an "all" total row.',
    'Each corpus also has an *_ext.csv variant which additionally resolves the iteration mark 々 into entries such as "(日)々". Those are multi-character strings, so the plain *_characters.csv files are used here.',
  ],
};

/* ---------------------------------------------------------------- utilities */

function fetchText(url, hops = 0) {
  if (hops > 5) return Promise.reject(new Error(`too many redirects: ${url}`));
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'user-agent': 'kansei-content-fetcher/1.0', accept: 'text/csv,text/plain,*/*' } },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          fetchText(new URL(res.headers.location, url).toString(), hops + 1).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`HTTP ${code} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timed out')));
  });
}

/**
 * A single CJK unified ideograph and nothing else.
 *
 * `\p{Unified_Ideograph}` rather than `\p{Script=Han}` on purpose: the Wikipedia
 * CSV contains a tail of Kangxi-radical-block glyphs (⽉ ⼤ ⾦ …, U+2F00 block),
 * which are Script=Han but are radical symbols, not the kanji themselves. They sit
 * at rank 2700+ so they do not affect the top-N cut, but counting them as kanji
 * would be wrong. The iteration mark 々 is likewise excluded by this test.
 */
const isSingleKanji = (s) => [...s].length === 1 && /\p{Unified_Ideograph}/u.test(s);

function parseCharacterCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const head = lines[0].split(',');
  const need = ['rank', 'code_point_hex', 'char', 'char_count'];
  for (const col of need) if (!head.includes(col)) throw new Error(`CSV missing column "${col}"; header was: ${lines[0]}`);
  const iRank = head.indexOf('rank');
  const iChar = head.indexOf('char');
  const iCount = head.indexOf('char_count');

  let total = null;
  const rows = [];
  const skipped = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const rank = Number(f[iRank]);
    const char = f[iChar];
    const count = Number(f[iCount]);
    if (rank === 0 || char === 'all') {
      total = count;
      continue;
    }
    if (!isSingleKanji(char)) {
      skipped.push(char);
      continue;
    }
    rows.push({ rank, char, count });
  }
  rows.sort((a, b) => a.rank - b.rank);
  return { rows, total, skipped };
}

/** Spearman rank correlation over the items present in both lists. */
function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(pairs.map((p) => p[0]));
  const rb = rank(pairs.map((p) => p[1]));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

const pct = (x) => Math.round(x * 10000) / 100;

/* --------------------------------------------------------------------- main */

async function main() {
  const offline = process.argv.includes('--offline');
  await mkdir(CACHE, { recursive: true });

  const primary = JSON.parse(await readFile(PRIMARY, 'utf8'));
  const primaryEntries = primary.entries;
  const N = primaryEntries.length;
  const primaryRank = new Map(primaryEntries.map((e) => [e.glyph, e.frequencyRank]));
  const primarySet = new Set(primaryRank.keys());

  const comparisons = [];
  /** Full "in our top N but not in theirs" sets, kept out of the serialised doc. */
  const missedSets = [];
  const fetchedAt = new Date().toISOString();

  for (const corpus of CORPORA) {
    const cached = path.join(CACHE, corpus.file);
    let text;
    if (offline) {
      text = await readFile(cached, 'utf8');
    } else {
      text = await fetchText(`${BASE}/${corpus.file}`);
      await writeFile(cached, text, 'utf8');
    }
    const sha256 = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    const { rows, total, skipped } = parseCharacterCsv(text);

    const theirTop = rows.slice(0, N);
    const theirTopSet = new Set(theirTop.map((r) => r.char));
    const theirRankAll = new Map(rows.map((r) => [r.char, r.rank]));

    /*
     * Their `rank` column uses competition ranking, so characters with equal
     * char_count share a rank. Cutting at exactly N therefore splits any tie that
     * straddles the boundary, and which member lands inside is an artefact of file
     * order, not of the data. Quantify that instead of ignoring it: report how many
     * rows share the boundary count, and give overlap bounds where the whole
     * boundary tie is included and where it is excluded.
     */
    const boundaryCount = theirTop.length === N ? theirTop[N - 1].count : null;
    const tiedAtBoundary = boundaryCount == null ? [] : rows.filter((r) => r.count === boundaryCount);
    const firstTiedIndex = boundaryCount == null ? null : rows.findIndex((r) => r.count === boundaryCount);
    const inclusiveSet = new Set(
      boundaryCount == null ? [] : rows.filter((r, i) => i < N || r.count === boundaryCount).map((r) => r.char),
    );
    const exclusiveSet = new Set(
      boundaryCount == null ? [] : rows.filter((r) => r.count > boundaryCount).map((r) => r.char),
    );
    const overlapInclusive = [...primarySet].filter((g) => inclusiveSet.has(g)).length;
    const overlapExclusive = [...primarySet].filter((g) => exclusiveSet.has(g)).length;

    const shared = [...primarySet].filter((g) => theirTopSet.has(g));
    const onlyPrimary = [...primarySet].filter((g) => !theirTopSet.has(g));
    const onlyTheirs = theirTop.map((r) => r.char).filter((g) => !primarySet.has(g));

    // Where our characters land in their FULL ranking (not just their top N).
    const positions = [];
    const absentEntirely = [];
    for (const g of primarySet) {
      const r = theirRankAll.get(g);
      if (r == null) absentEntirely.push(g);
      else positions.push(r);
    }
    positions.sort((a, b) => a - b);
    const median = positions.length ? positions[Math.floor(positions.length / 2)] : null;

    const rho = spearman(shared.map((g) => [primaryRank.get(g), theirRankAll.get(g)]));
    missedSets.push(new Set(onlyPrimary));

    comparisons.push({
      id: corpus.id,
      label: corpus.label,
      description: corpus.description,
      file: `${BASE}/${corpus.file}`,
      cachedAt: path.relative(REPO, cached).split(path.sep).join('/'),
      sha256,
      bytes: Buffer.byteLength(text, 'utf8'),
      fetchedAt: offline ? null : fetchedAt,
      corpusTotalKanjiFromCsv: total,
      corpusTotalKanjiStatedOnSite: corpus.statedTotalKanji,
      corpusTotalMatchesStatedFigure: total === corpus.statedTotalKanji,
      statedTexts: corpus.statedTexts,
      distinctKanjiInCsv: rows.length,
      distinctKanjiStatedOnSite: corpus.statedUniqueKanji,
      distinctKanjiMatchesStatedFigure: rows.length === corpus.statedUniqueKanji,
      nonKanjiRowsSkipped: skipped.length,
      nonKanjiRowsSkippedSample: skipped.slice(0, 20),
      comparedTopN: N,
      overlapCount: shared.length,
      overlapPercent: pct(shared.length / N),
      boundary: {
        charCountAtRowN: boundaryCount,
        rowsSharingThatCount: tiedAtBoundary.length,
        firstRowIndexWithThatCount: firstTiedIndex,
        note:
          tiedAtBoundary.length > 1
            ? `The 1000th row sits inside a ${tiedAtBoundary.length}-way tie at char_count ${boundaryCount}; which tied characters fall inside the cut is decided by file order, not by the data.`
            : 'No tie straddles the top-N boundary.',
        overlapPercentIfWholeBoundaryTieIncluded: boundaryCount == null ? null : pct(overlapInclusive / N),
        overlapPercentIfWholeBoundaryTieExcluded: boundaryCount == null ? null : pct(overlapExclusive / N),
      },
      inKanjidicTopNButNotTheirs: onlyPrimary.length,
      inTheirsButNotKanjidicTopN: onlyTheirs.length,
      spearmanRhoOnSharedCharacters: rho == null ? null : Math.round(rho * 10000) / 10000,
      ourCharactersAbsentFromTheirCorpusEntirely: absentEntirely,
      medianRankOfOurCharactersInTheirFullRanking: median,
      ourCharactersRankedWorseThan2000ByThem: positions.filter((r) => r > 2000).length,
      examplesOnlyInKanjidicTopN: onlyPrimary
        .sort((a, b) => primaryRank.get(a) - primaryRank.get(b))
        .slice(0, 40)
        .map((g) => ({ glyph: g, kanjidicRank: primaryRank.get(g), theirRank: theirRankAll.get(g) ?? null })),
      examplesOnlyInTheirTopN: onlyTheirs
        .slice(0, 40)
        .map((g) => ({ glyph: g, theirRank: theirRankAll.get(g), kanjidicRank: null })),
    });
  }

  // Characters in our list that no comparison corpus puts in its own top N — the
  // weakest-corroborated part of the list, and the honest thing to surface.
  const missedByAll = [...primarySet].filter((g) => missedSets.every((s) => s.has(g)));
  // Characters corroborated by at least one independent corpus.
  const corroboratedByAtLeastOne = [...primarySet].filter((g) => missedSets.some((s) => !s.has(g)));

  const doc = {
    schema: 'kansei-kanji-frequency-crosscheck/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/content/crosscheck-kanji-frequency.mjs',
    reproduce: [
      'node scripts/assets/fetch-sources.mjs kanjidic2',
      'node scripts/content/build-kanji-list.mjs',
      'node scripts/content/crosscheck-kanji-frequency.mjs',
    ],
    purpose:
      'Evidence of robustness only. The primary ranking in data/kanji-top1500.json is KANJIDIC2 <freq> and is NOT modified by this comparison.',
    primary: {
      file: 'data/kanji-top1500.json',
      ranking: 'KANJIDIC2 <freq> (Mainichi Shimbun word-frequency analysis, Girardi 1998)',
      kanjidicDatabaseVersion: primary.source?.databaseVersion ?? null,
      topN: N,
    },
    comparisonSource: SOURCE_META,
    comparisons,
    summary: {
      overlapPercentByCorpus: Object.fromEntries(comparisons.map((c) => [c.id, c.overlapPercent])),
      overlapPercentRange: [
        Math.min(...comparisons.map((c) => c.overlapPercent)),
        Math.max(...comparisons.map((c) => c.overlapPercent)),
      ],
      meanOverlapPercent:
        Math.round((comparisons.reduce((s, c) => s + c.overlapPercent, 0) / comparisons.length) * 100) / 100,
      charactersCorroboratedByAtLeastOneCorpusTopN: corroboratedByAtLeastOne.length,
      charactersCorroboratedByAtLeastOneCorpusPercent: pct(corroboratedByAtLeastOne.length / N),
      charactersMissedByEveryComparisonCorpusTopN: missedByAll.length,
      charactersMissedByEveryComparisonCorpusTopNGlyphs: missedByAll
        .sort((a, b) => primaryRank.get(a) - primaryRank.get(b))
        .map((g) => ({ glyph: g, kanjidicRank: primaryRank.get(g) })),
      overlapBoundsByCorpus: Object.fromEntries(
        comparisons.map((c) => [
          c.id,
          [c.boundary.overlapPercentIfWholeBoundaryTieExcluded, c.boundary.overlapPercentIfWholeBoundaryTieIncluded],
        ]),
      ),
      caveats: [
        'The comparison corpora count characters directly; KANJIDIC2 <freq> is derived from WORD frequencies. The two are measuring related but not identical things.',
        'The comparison corpora are modern (Wikipedia sampled 2023, Wikinews ~2005-2023); KANJIDIC2 <freq> reflects mid-1990s newspaper text. Some disagreement is genuine language change, not error in either list.',
        `The Wikinews corpus is small (1.1M kanji), so its tail counts are low integers with heavy ties; its top-${N} boundary is correspondingly soft. See each comparison's \`boundary\` block.`,
        'Aozora is literary and largely pre-war, which is the least similar register to a beginner curriculum; its lower overlap is expected and is not evidence against the primary list.',
        'For every corpus, the number of distinct kanji found in the CSV is exactly one more than the "Uniq. kanji" figure published on the project website. The cause was not determined; it does not affect a top-N cut. Reported here rather than smoothed over.',
      ],
      interpretation:
        `A top-${N} cut is a threshold on a continuous, heavy-tailed distribution, so exact set equality between corpora is not expected and would be suspicious. Disagreement concentrates at the boundary and on register-specific vocabulary (newspaper/administrative kanji versus literary kanji). Read the overlap figure as: this fraction of the list is corroborated by an independent modern character count of a different corpus.`,
    },
  };

  await writeFile(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stderr.write(`wrote ${path.relative(REPO, OUT)}\n`);
  for (const c of comparisons) {
    process.stderr.write(
      `${c.id.padEnd(10)} overlap ${String(c.overlapCount).padStart(4)}/${N} = ${c.overlapPercent}%  ` +
        `spearman rho ${c.spearmanRhoOnSharedCharacters}  ` +
        `[bounds ${c.boundary.overlapPercentIfWholeBoundaryTieExcluded}-${c.boundary.overlapPercentIfWholeBoundaryTieIncluded}%, ` +
        `boundary tie ${c.boundary.rowsSharingThatCount}-way]  ` +
        `absent from corpus: ${c.ourCharactersAbsentFromTheirCorpusEntirely.length}  ` +
        `csv total == site figure: ${c.corpusTotalMatchesStatedFigure}, distinct == site figure: ${c.distinctKanjiMatchesStatedFigure}\n`,
    );
  }
  process.stderr.write(
    `mean overlap ${doc.summary.meanOverlapPercent}%; ${missedByAll.length} of our ${N} are outside the top ${N} of all three comparison corpora.\n`,
  );
}

await main();
