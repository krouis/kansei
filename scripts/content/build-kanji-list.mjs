#!/usr/bin/env node
/**
 * build-kanji-list.mjs — derive data/kanji-top1000.json from KANJIDIC2.
 *
 * Input:  data/sources/kanjidic2.xml.gz  (fetched by scripts/assets/fetch-sources.mjs)
 * Output: data/kanji-top1000.json
 *
 * What this script does NOT do:
 *   - it does not decide teaching order. `teachingOrder` is emitted as null for
 *     every entry; curriculum sequencing is owned elsewhere and is deliberately
 *     not the frequency rank (see docs/content/KANJI-FREQUENCY.md).
 *   - it does not invent data. Absent fields are null / empty arrays, never guessed.
 *
 * Usage:
 *   node scripts/content/build-kanji-list.mjs
 *   node scripts/content/build-kanji-list.mjs --limit 500     # different cut, for inspection
 *   node scripts/content/build-kanji-list.mjs --stdout        # print, do not write
 *
 * No dependencies beyond Node builtins. The XML is parsed with a purpose-built
 * block scanner rather than a generic DOM parser: KANJIDIC2 is a flat, regular
 * <character> list, and this keeps the toolchain dependency-free and auditable.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SRC_GZ = path.join(REPO, 'data', 'sources', 'kanjidic2.xml.gz');
const LOCK = path.join(REPO, 'data', 'sources', 'SOURCES.lock.json');
const OUT = path.join(REPO, 'data', 'kanji-top1000.json');

const DEFAULT_LIMIT = 1000;

/**
 * Documented provenance of the ranking, quoted from upstream. Recorded in the
 * output so the app can state where its "most frequent 1000" claim comes from
 * without a reader having to trust this script.
 */
const FREQUENCY_PROVENANCE = {
  field: 'KANJIDIC2 <freq>',
  rankedCharactersInFile: null, // filled in from the data
  corpus: 'Mainichi Shimbun (毎日新聞), approximately four years of online editions',
  corpusPeriod:
    "The four years preceding 1998, when the underlying word-frequency list was produced. The EDRDG documentation does not state exact start/end dates, so no precise range is asserted here.",
  corpusSizeTokens: null,
  corpusSizeNote:
    'Not documented upstream as a token count. What IS documented: the intermediate word-frequency list contains "about 300,000 words" (distinct word entries with frequencies attached), and Jim Breen records uncertainty about whether all or only part of the newspaper material was processed ("He had processed (all?, part?) of the newspaper material").',
  methodology:
    'Alexandre Girardi (then a graduate student at NAIST) ran approximately four years of Mainichi Shimbun text through a morphological analyser, producing a word list with part-of-speech tags and occurrence frequencies (~300,000 words). Per-kanji relative frequencies were then derived from those WORD frequencies — the ranking is word-frequency-derived, not a raw character tally — and the resulting ordering was loaded into KANJIDIC as the F/<freq> field.',
  authorOfAnalysis: 'Alexandre Girardi (1998)',
  releasedBy: 'Jim Breen / EDRDG (released May 2003 as the "wordfreq" file)',
  documentedCaveats: [
    'Biased towards words and kanji used in newspaper articles (politics, current affairs, institutional vocabulary).',
    'Reflects the vocabulary of the mid-1990s; upstream notes proper nouns such as "Clinton" occur more often than they would today.',
    'The relative frequencies of the last few hundred ranked kanji are "quite imprecise" per upstream; discrimination between rarely used kanji is weak.',
    'A word-frequency-derived ranking is not identical to a character-frequency ranking over running text.',
  ],
  documentationUrls: [
    'http://www.edrdg.org/wiki/KANJIDIC_Project.html',
    'http://www.edrdg.org/kanjidic/kanjidic_doc_legacy.html',
    'http://ftp.edrdg.org/pub/Nihongo/wordfreq.README',
    'http://ftp.edrdg.org/pub/Nihongo/00INDEX.html',
  ],
  upstreamQuotes: [
    {
      source: 'KANJIDIC Project page (edrdg.org/wiki/KANJIDIC_Project.html), "Frequency-of-use ranking"',
      text: 'The 2,501 most-used characters have a ranking which expresses the relative frequency of occurrence of a character in modern Japanese. The data is based on an analysis of word frequencies in the Mainichi Shimbun over 4 years by Alexandre Girardi. Note: (a) these frequencies are biased towards words and kanji used in newspaper articles, and (b) the relative frequencies for the last few hundred kanji so graded is quite imprecise.',
    },
    {
      source: 'kanjidic2.xml DTD comment on <freq>',
      text: 'A frequency-of-use ranking. The 2,500 most-used characters have a ranking; those characters that lack this field are not ranked. The frequency is a number from 1 to 2,500 that expresses the relative frequency of occurrence of a character in modern Japanese. This is based on a survey in newspapers, so it is biassed towards kanji used in newspaper articles. The discrimination between the less frequently used kanji is not strong. (Actually there are 2,501 kanji ranked as there was a tie.)',
    },
    {
      source: 'ftp.edrdg.org/pub/Nihongo/00INDEX.html',
      text: 'In 1998 Alexandre Girardi produced a word-frequency list based on 4 years of the Mainichi Shimbun. It contains about 300,000 words.',
    },
    {
      source: 'ftp.edrdg.org/pub/Nihongo/wordfreq.README (Jim Breen, May 2003)',
      text: 'In 1998 I was contacted by Alexandre Girardi who was at that time a graduate student at NAIST (Shikano-lab). He had been using my EDICT file and also had access to online copies of the previous 4 years of the Mainichi Shimbun. He had processed (all?, part?) of the newspaper material through a morphological analyzed and produced a word-list with Part-of-Speech and frequency attached. […] Alexandre sent me a copy of the file with about 300,000 words marked.',
    },
  ],
};

/* ---------------------------------------------------------------- utilities */

const dec = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** All text contents of <tag ...>…</tag> within `block`, in document order. */
function all(block, tag, attrFilter = null) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  for (const m of block.matchAll(re)) {
    const attrs = m[1] ?? '';
    if (attrFilter && !attrFilter(attrs)) continue;
    out.push({ text: dec(m[2]).trim(), attrs });
  }
  return out;
}

const first = (block, tag, attrFilter = null) => all(block, tag, attrFilter)[0]?.text ?? null;
const attr = (attrs, name) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
const intOrNull = (s) => (s == null || !/^\d+$/.test(s) ? null : Number(s));

/**
 * KANJIDIC kun readings carry positional notation:
 *   `-び`   this reading occurs as a suffix
 *   `お-`   this reading occurs as a prefix
 *   `あたら.しい`  the part after `.` is okurigana, written in kana
 * The raw form is kept (it is teaching-relevant), and a bare-kana form is
 * derived mechanically for matching.
 */
const bareKana = (r) => r.replace(/[-.・]/g, '');

/* ------------------------------------------------------------------- parsing */

function parseHeader(xml) {
  const h = /<header>([\s\S]*?)<\/header>/.exec(xml)?.[1] ?? '';
  return {
    fileVersion: first(h, 'file_version'),
    databaseVersion: first(h, 'database_version'),
    dateOfCreation: first(h, 'date_of_creation'),
  };
}

function parseCharacter(block) {
  const glyph = first(block, 'literal');
  if (!glyph) return null;

  const misc = /<misc>([\s\S]*?)<\/misc>/.exec(block)?.[1] ?? '';
  const rm = /<reading_meaning>([\s\S]*?)<\/reading_meaning>/.exec(block)?.[1] ?? '';

  const strokeCounts = all(misc, 'stroke_count').map((x) => Number(x.text)).filter(Number.isFinite);

  // English meanings are <meaning> with NO m_lang attribute.
  const meanings = all(rm, 'meaning', (a) => !/m_lang=/.test(a)).map((x) => x.text);

  const onRaw = all(rm, 'reading', (a) => attr(a, 'r_type') === 'ja_on').map((x) => x.text);
  const kunRaw = all(rm, 'reading', (a) => attr(a, 'r_type') === 'ja_kun').map((x) => x.text);

  const radicals = all(block, 'rad_value').map((x) => ({ type: attr(x.attrs, 'rad_type'), value: Number(x.text) }));
  const classical = radicals.find((r) => r.type === 'classical') ?? null;
  const nelson = radicals.find((r) => r.type === 'nelson_c') ?? null;

  return {
    glyph,
    ucsCodepointHex: all(block, 'cp_value', (a) => attr(a, 'cp_type') === 'ucs')[0]?.text ?? null,
    frequencyRank: intOrNull(first(misc, 'freq')),
    radicalClassicalNumber: classical ? classical.value : null,
    radicalNelsonNumber: nelson ? nelson.value : null,
    strokeCount: strokeCounts.length ? strokeCounts[0] : null,
    strokeCountMiscounts: strokeCounts.slice(1),
    grade: intOrNull(first(misc, 'grade')),
    jlptOldLevel: intOrNull(first(misc, 'jlpt')),
    meanings,
    on: onRaw,
    kun: kunRaw,
    kunBareKana: kunRaw.map(bareKana),
    nanori: all(rm, 'nanori').map((x) => x.text),
    variants: all(block, 'variant').map((x) => ({ type: attr(x.attrs, 'var_type'), value: x.text })),
  };
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const limitArg = argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : DEFAULT_LIMIT;
  const toStdout = argv.includes('--stdout');
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, got ${limit}`);

  const gz = await readFile(SRC_GZ);
  const sha256 = createHash('sha256').update(gz).digest('hex');
  const xml = gunzipSync(gz).toString('utf8');

  // Cross-check the input against the provenance lock, so a silently changed or
  // corrupted download cannot slip into committed derived data unremarked.
  let lockEntry = null;
  try {
    lockEntry = JSON.parse(await readFile(LOCK, 'utf8')).files?.kanjidic2 ?? null;
  } catch {
    /* lock missing — reported below */
  }
  const inputWarnings = [];
  if (!lockEntry) inputWarnings.push('data/sources/SOURCES.lock.json has no kanjidic2 entry; input digest is unverified.');
  else if (lockEntry.sha256 !== sha256)
    inputWarnings.push(`kanjidic2.xml.gz sha256 ${sha256} does not match SOURCES.lock.json (${lockEntry.sha256}).`);

  const header = parseHeader(xml);

  const blocks = xml.split('<character>').slice(1);
  const parsed = [];
  for (const b of blocks) {
    const end = b.indexOf('</character>');
    const entry = parseCharacter(end >= 0 ? b.slice(0, end) : b);
    if (entry) parsed.push(entry);
  }

  const ranked = parsed.filter((e) => e.frequencyRank != null).sort((a, b) => a.frequencyRank - b.frequencyRank);

  /* ----- integrity checks on the ranking itself; reported, never silently fixed */
  const byRank = new Map();
  for (const e of ranked) {
    if (!byRank.has(e.frequencyRank)) byRank.set(e.frequencyRank, []);
    byRank.get(e.frequencyRank).push(e.glyph);
  }
  const maxRank = ranked.length ? ranked[ranked.length - 1].frequencyRank : 0;
  const ties = [...byRank.entries()].filter(([, g]) => g.length > 1).map(([r, g]) => ({ rank: r, glyphs: g }));
  const gapsFull = [];
  for (let r = 1; r <= maxRank; r += 1) if (!byRank.has(r)) gapsFull.push(r);

  const selected = ranked.filter((e) => e.frequencyRank <= limit);
  const selTies = ties.filter((t) => t.rank <= limit);
  const selGaps = gapsFull.filter((r) => r <= limit);

  const anomalies = [];
  if (selected.length !== limit)
    anomalies.push(`Selected ${selected.length} characters for ranks 1..${limit}; expected exactly ${limit}.`);
  if (selGaps.length) anomalies.push(`Missing ranks within 1..${limit}: ${selGaps.join(', ')}.`);
  if (selTies.length)
    anomalies.push(`Tied ranks within 1..${limit}: ${selTies.map((t) => `${t.rank} (${t.glyphs.join(' ')})`).join('; ')}.`);
  if (ties.length)
    anomalies.push(
      `Tied ranks anywhere in the file: ${ties.map((t) => `${t.rank} (${t.glyphs.join(' ')})`).join('; ')}.`,
    );
  if (gapsFull.length)
    anomalies.push(
      `Missing ranks in the full ranked set 1..${maxRank}: ${gapsFull.length} (${gapsFull.slice(0, 20).join(', ')}${gapsFull.length > 20 ? ', …' : ''}).`,
    );
  // The DTD comment claims 2,500 ranks with one tie giving 2,501 characters.
  // Assert what the data actually shows instead of trusting the comment.
  if (ranked.length !== maxRank)
    anomalies.push(
      `Ranked character count (${ranked.length}) differs from the maximum rank (${maxRank}); the ranking is not a dense 1..N permutation.`,
    );
  const withoutMeaning = selected.filter((e) => e.meanings.length === 0).map((e) => e.glyph);
  const withoutReadings = selected.filter((e) => e.on.length === 0 && e.kun.length === 0).map((e) => e.glyph);
  const withoutRadical = selected.filter((e) => e.radicalClassicalNumber == null).map((e) => e.glyph);
  const withoutStrokeCount = selected.filter((e) => e.strokeCount == null).map((e) => e.glyph);

  const doc = {
    schema: 'kansei-kanji-frequency-list/1',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/content/build-kanji-list.mjs',
    reproduce: [
      'node scripts/assets/fetch-sources.mjs kanjidic2',
      'node scripts/content/build-kanji-list.mjs',
    ],
    description:
      `The ${limit} most frequent kanji by KANJIDIC2's <freq> ranking. frequencyRank is a FREQUENCY rank, ` +
      'not a teaching order: teachingOrder is null here and is assigned by the curriculum build, which sequences ' +
      'by stroke complexity, component reuse and available vocabulary. See docs/content/KANJI-FREQUENCY.md.',
    source: {
      dataset: 'KANJIDIC2',
      publisher: 'Electronic Dictionary Research and Development Group (EDRDG)',
      url: 'http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz',
      homepage: 'http://www.edrdg.org/wiki/KANJIDIC_Project.html',
      fileVersion: header.fileVersion,
      databaseVersion: header.databaseVersion,
      dateOfCreation: header.dateOfCreation,
      sha256OfGz: sha256,
      bytesOfGz: gz.length,
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://www.edrdg.org/edrdg/licence.html',
      attributionRequired:
        'This file contains data derived from KANJIDIC2, © James William Breen and the Electronic Dictionary Research and Development Group, used under CC BY-SA 4.0. Changes: a subset of fields was extracted for the most frequent kanji and re-serialised as JSON; no dictionary content was altered.',
      redistribution:
        'Redistribution and derivative works permitted under CC BY-SA 4.0, with attribution, a statement of changes, and share-alike on the derived data.',
    },
    frequency: { ...FREQUENCY_PROVENANCE, rankedCharactersInFile: ranked.length, maxRankInFile: maxRank },
    fieldNotes: {
      frequencyRank: 'KANJIDIC2 <freq>. 1 = most frequent. Lower is more frequent.',
      teachingOrder: 'Always null in this file. Owned by the curriculum build, deliberately not the frequency rank.',
      meanings: 'English glosses: <meaning> elements with no m_lang attribute, in file order. Other languages dropped.',
      on: "On'yomi from <reading r_type=\"ja_on\">, in katakana, exactly as upstream records them.",
      kun: 'Kun\'yomi from <reading r_type="ja_kun">, in hiragana, with KANJIDIC positional notation preserved: a leading "-" marks a suffix use, a trailing "-" a prefix use, and "." separates the kanji reading from its okurigana (あたら.しい).',
      kunBareKana: 'kun with "-" and "." removed. Derived mechanically for matching; not a separate source claim.',
      nanori: 'Name-only readings from <nanori>. Not part of the beginner curriculum; carried for completeness.',
      radicalClassicalNumber:
        'Kangxi/classical radical number from <rad_value rad_type="classical">. A number, not a component id — the component table maps these.',
      radicalNelsonNumber:
        "Nelson's radical from <rad_value rad_type=\"nelson_c\">, present only where it differs from the classical one.",
      strokeCount: 'First <stroke_count> value, which KANJIDIC2 documents as the accepted count.',
      strokeCountMiscounts:
        'Subsequent <stroke_count> values. KANJIDIC2 documents these as COMMON MISCOUNTS, not as alternative correct counts.',
      grade:
        'KANJIDIC2 <grade>: 1-6 = kyōiku kanji taught in that elementary grade; 8 = remaining jōyō kanji (junior high); 9, 10 = jinmeiyō (name) kanji. null = not jōyō or jinmeiyō.',
      jlptOldLevel:
        'KANJIDIC2 <jlpt>. THIS IS THE PRE-2010 FOUR-LEVEL JLPT (4 = most elementary … 1 = most advanced). It is NOT the current N1-N5 scale, and must never be displayed as "N" levels: no official kanji lists exist for the current levels. Named jlptOldLevel for exactly this reason.',
      jlptOldLevelScale: 'old-jlpt-1-to-4',
      variants:
        'Code points of similar or related kanji from <variant>, with their var_type (jis208/jis212/jis213/ucs/nelson_c/oneill/deroo/njecd/s_h). Encoding-level variants, NOT a curated "looks confusable to a learner" list.',
    },
    counts: {
      charactersInFile: parsed.length,
      rankedCharactersInFile: ranked.length,
      maxRankInFile: maxRank,
      requestedLimit: limit,
      selected: selected.length,
      denseRanksWithinLimit: selGaps.length === 0 && selTies.length === 0 && selected.length === limit,
      missingEnglishMeaning: withoutMeaning.length,
      missingAllReadings: withoutReadings.length,
      missingClassicalRadical: withoutRadical.length,
      missingStrokeCount: withoutStrokeCount.length,
    },
    integrity: {
      inputWarnings,
      anomalies,
      tiedRanksWithinLimit: selTies,
      missingRanksWithinLimit: selGaps,
      tiedRanksInFile: ties,
      missingRanksInFile: gapsFull,
      selectedWithoutEnglishMeaning: withoutMeaning,
      selectedWithoutAnyReading: withoutReadings,
      selectedWithoutClassicalRadical: withoutRadical,
      selectedWithoutStrokeCount: withoutStrokeCount,
      dtdCommentVsData:
        ties.length === 0 && ranked.length === maxRank
          ? `The KANJIDIC2 DTD comment states ranks run 1..2,500 with one tie producing 2,501 ranked kanji. In database version ${header.databaseVersion} the data instead has ${ranked.length} ranked kanji with distinct, gapless ranks 1..${maxRank} — no tie is present. The data is used as-is; the comment appears to be stale.`
          : `Data: ${ranked.length} ranked kanji, max rank ${maxRank}, ${ties.length} tied rank(s).`,
    },
    entries: selected.map((e) => ({
      id: `kanji:${e.glyph}`,
      glyph: e.glyph,
      ucsCodepointHex: e.ucsCodepointHex,
      frequencyRank: e.frequencyRank,
      teachingOrder: null,
      meanings: e.meanings,
      on: e.on,
      kun: e.kun,
      kunBareKana: e.kunBareKana,
      nanori: e.nanori,
      radicalClassicalNumber: e.radicalClassicalNumber,
      radicalNelsonNumber: e.radicalNelsonNumber,
      strokeCount: e.strokeCount,
      strokeCountMiscounts: e.strokeCountMiscounts,
      grade: e.grade,
      jlptOldLevel: e.jlptOldLevel,
      variants: e.variants,
    })),
  };

  const json = JSON.stringify(doc);
  if (toStdout) {
    process.stdout.write(`${json}\n`);
  } else {
    // Compact (no pretty-printing): this file is well over 100KB.
    await writeFile(OUT, `${json}\n`, 'utf8');
    process.stderr.write(`wrote ${path.relative(REPO, OUT)} (${(json.length / 1024).toFixed(1)} KiB)\n`);
  }

  process.stderr.write(
    `KANJIDIC2 ${header.databaseVersion} (created ${header.dateOfCreation}): ` +
      `${parsed.length} characters, ${ranked.length} ranked, max rank ${maxRank}; selected ${selected.length} for ranks 1..${limit}.\n`,
  );
  for (const w of inputWarnings) process.stderr.write(`INPUT WARNING: ${w}\n`);
  for (const a of anomalies) process.stderr.write(`ANOMALY: ${a}\n`);
  if (!anomalies.length) process.stderr.write(`Ranks 1..${limit} are dense with no gaps and no ties.\n`);
  process.stderr.write(
    `Coverage: meanings ${limit - withoutMeaning.length}/${limit}, readings ${limit - withoutReadings.length}/${limit}, ` +
      `classical radical ${limit - withoutRadical.length}/${limit}, stroke count ${limit - withoutStrokeCount.length}/${limit}.\n`,
  );
}

await main();
