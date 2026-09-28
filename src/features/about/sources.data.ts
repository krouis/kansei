/**
 * sources.data.ts — the teaching material, data sets, audio and fonts Kansei is
 * built from, with each one's licence and how Kansei actually uses it.
 *
 * WHY THIS IS A SEPARATE FILE FROM references.data.ts
 * ---------------------------------------------------
 * `references.data.ts` holds experimental evidence: controlled studies and
 * meta-analyses about how people learn. This file holds content sources:
 * dictionaries, corpora, stroke data, recordings, coursebook syllabi, typefaces.
 *
 * The two are kept strictly apart because mixing them produces a specific and
 * common dishonesty. A "Science" or "Sources" page that lists a peer-reviewed
 * meta-analysis next to a coursebook and a frequency list invites the reader to
 * transfer the authority of the first to the others — to read "NINJAL corpus" as
 * if it were evidence that Kansei's teaching order works, or "Marugoto" as if a
 * published syllabus were an experimental result. It is not. A frequency list is
 * a measurement of a corpus; a coursebook is professional teaching judgement; a
 * stroke database is a drawing. None of them is evidence about learning outcomes,
 * and none of the studies in `references.data.ts` says anything about which words
 * a beginner should meet first.
 *
 * So: claims about *how* to learn cite `references.data.ts`. Claims about *what*
 * Kansei contains and where it came from cite this file. Kansei's own curriculum
 * order is neither — it is hand-authored judgement, labelled as such in
 * data/ and in docs/CONTENT.md.
 *
 * Every URL below was fetched and confirmed to resolve on the date in
 * `SOURCES_VERIFIED_ON`, and every `licence` string reflects what that source's
 * own licence or terms page says, not a guess. Where a source is NOT openly
 * licensed, that is stated plainly rather than softened.
 */

export interface ContentSource {
  /** Stable key for deep links and tests. */
  id: string;
  /** Name as the project itself uses. */
  name: string;
  /** Canonical, verified-resolving URL. */
  url: string;
  /** What the source actually is and what data it provides. */
  whatItProvides: string;
  /**
   * Licence as stated by the source. An SPDX identifier where one applies;
   * otherwise a plain description, because pretending a bespoke permission is an
   * SPDX licence is how attribution goes wrong.
   */
  licence: string;
  /** SPDX id alone where one cleanly applies, else null. Machine-readable field. */
  spdxId: string | null;
  /** Where that licence or terms statement can be read. */
  licenceUrl: string;
  /** Concretely, what Kansei does with it — including what it does NOT do. */
  howKanseiUsesIt: string;
  /**
   * True when the licence permits Kansei to ship the source's data inside the
   * app. False means Kansei may consult it but must not redistribute it, which
   * changes what can go in a content pack.
   */
  redistributable: boolean;
}

/** Date on which every `url` and `licenceUrl` below was fetched and confirmed to resolve. */
export const SOURCES_VERIFIED_ON = '2026-09-29';

export const CONTENT_SOURCES: readonly ContentSource[] = Object.freeze([
  Object.freeze({
    id: 'marugoto',
    name: 'Marugoto — Teachers’ Page (The Japan Foundation Japanese-Language Institute, Urawa)',
    url: 'https://marugoto.jpf.go.jp/en/teacher/',
    whatItProvides:
      'The teacher-facing half of the Japan Foundation’s Marugoto coursebook series. It sets out the concept behind the series and the design of each level, publishes teacher’s notes and downloadable classroom resources, hosts videos walking through how a lesson is run, and keeps an archive of the academic papers written during the series’ development. Marugoto’s levels are pegged to the JF Standard for Japanese-Language Education and through it to the CEFR bands, running Starter (A1) through Intermediate (B1), and each level is split into a Katsudoo (activities) and a Rikai (understanding) volume.',
    licence:
      'Not open. All rights reserved — © 2017 The Japan Foundation Japanese-Language Institute, Urawa. The site’s Terms of Use permit reprinting or reproducing site information only for personal use. Support materials and teacher resources that are downloadable without registration (audio files excluded) may be reproduced, edited and distributed for educational or training purposes, but distributing them for a fee is prohibited, and so is publicly distributing any edited or modified version of them. Audio files, available only to registered users, may not be modified or redistributed at all.',
    spdxId: null,
    licenceUrl: 'https://marugoto.jpf.go.jp/en/sitepolicy/',
    howKanseiUsesIt:
      'As a reference point for beginner scope and sequencing only: which everyday situations and functions a published, professionally designed A1/A2 syllabus introduces early, so Kansei’s hand-authored teaching order can be sanity-checked against something better than intuition, and so the app can honestly describe its own level in JF/CEFR terms. Kansei copies no Marugoto text, no wordlists, no illustrations, and no audio, and ships nothing derived from Marugoto material. The influence is on ordering decisions recorded in data/, which are Kansei’s own judgement and labelled as such.',
    redistributable: false,
  }),

  Object.freeze({
    id: 'ninjal-bccwj-freqlist',
    name: 'NINJAL — BCCWJ Word List (frequency lists)',
    url: 'https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html',
    whatItProvides:
      'Frequency lists derived from the Balanced Corpus of Contemporary Written Japanese, a ~100-million-word balanced corpus of modern written Japanese built by the National Institute for Japanese Language and Linguistics. The page publishes short-unit-word and long-unit-word frequency lists, part-of-speech and word-classification lists, and a usage manual, plus companion lists from NINJAL’s language-policy research group: a BCCWJ principal word list, a school textbook corpus word list, a school-versus-society comparison list, subject-specific word lists, and an NDC genre-specific kanji frequency list. Note the 2025 renaming: what was released as "BCCWJ" is now "Balanced Corpus of Contemporary Written Japanese, Part 1" (BCCWJ1), with a BCCWJ2 under development and documented separately.',
    licence:
      'Not an open licence and no SPDX identifier. The page states the word list "is free for use for research or educational purposes"; copyright is held by NINJAL. The corpus itself is separately gated — free online search via Shonagon and Chunagon, a paid offline edition under a usage contract — and NINJAL states that commercial use requests are considered case by case.',
    spdxId: null,
    licenceUrl: 'https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html',
    howKanseiUsesIt:
      'As the documented frequency authority behind `frequencyRank` on vocabulary entries and the kanji frequency ordering the curriculum is checked against, so "common" is a measurement with a citation rather than an assertion. Because the licence does not clearly permit redistribution, Kansei does not ship the NINJAL lists: the download lands in data/sources/ (gitignored), a build script reduces it to a rank per item Kansei already teaches, and only those ranks — a small derived subset, not the list — appear in a content pack. If that reduction is ever judged too close to redistribution, the ranks come out and the field goes null.',
    redistributable: false,
  }),

  Object.freeze({
    id: 'kanjivg',
    name: 'KanjiVG',
    url: 'https://kanjivg.tagaini.net/',
    whatItProvides:
      'Per-character SVG files giving the shape, direction and order of every stroke for the kanji and kana used in Japanese, with each file annotated with the character’s components, its radical, and the type of each stroke. Maintained by Ulrich Apel and contributors; releases are tagged on GitHub.',
    licence: 'Creative Commons Attribution-ShareAlike 3.0. Copyright © 2009–2026 Ulrich Apel.',
    spdxId: 'CC-BY-SA-3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    howKanseiUsesIt:
      'It is the stroke data behind every writing exercise: stroke-order animation, the tracing guide, and the reference medians the handwriting assessor compares your strokes against. A build script converts the SVG paths into the precomputed `StrokeReference` polylines shipped in the stroke pack, so the app never parses SVG at runtime. Because the licence is share-alike, that derived stroke data is redistributed under CC BY-SA 3.0 with attribution to Ulrich Apel and the KanjiVG project, and the fact that Kansei resampled the paths is stated as a change.',
    redistributable: true,
  }),

  Object.freeze({
    id: 'edrdg',
    name: 'EDRDG — KANJIDIC2 and JMdict',
    url: 'https://www.edrdg.org/',
    whatItProvides:
      'The Electronic Dictionary Research and Development Group, founded by Jim Breen, maintains the two dictionary files Kansei’s content is derived from. KANJIDIC2 is an XML database of the kanji in the JIS X 0208/0212/0213 standards, giving English meanings, on and kun readings, radical and component indices, stroke counts, school grade, JLPT level and frequency rank. JMdict is a multilingual Japanese dictionary with a detailed sense structure, part-of-speech tagging, usage and frequency markers, and links to example sentences; Kansei uses the English edition.',
    licence:
      'Creative Commons Attribution-ShareAlike 4.0. Copyright held by James William Breen and the EDRDG. The licence sets out attribution requirements explicitly, and for a smartphone or tablet app it requires the acknowledgement to appear on a dedicated screen reached from a menu — one labelled "About" or "Sources" — and says that mentioning it only on a launch screen is not sufficient.',
    spdxId: 'CC-BY-SA-4.0',
    licenceUrl: 'https://www.edrdg.org/edrdg/licence.html',
    howKanseiUsesIt:
      'KANJIDIC2 supplies kanji meanings, the candidate reading set, radical and stroke data, grade and frequency rank; JMdict supplies vocabulary spellings, kana readings, glosses and part-of-speech tags. Build scripts select the beginner subset, drop any kanji reading with no example word attached to it, and emit the content packs. Kansei ships that derived data under CC BY-SA 4.0 with a statement of changes, and this About screen is the dedicated acknowledgement screen the licence requires — which is part of why it exists at all rather than being a nicety.',
    redistributable: true,
  }),

  Object.freeze({
    id: 'wikimedia-commons-lingualibre',
    name: 'Wikimedia Commons and Lingua Libre (pronunciation recordings)',
    url: 'https://commons.wikimedia.org/',
    whatItProvides:
      'Wikimedia Commons is the Wikimedia movement’s free media repository and holds a large number of single-word Japanese pronunciation recordings, each with a file description page naming the speaker, the recording date and the licence. Lingua Libre is Wikimédia France’s participatory recording tool, built so that speakers can record many words in one session; its output is uploaded to Commons. Its recordings have covered well over a hundred languages. The Lingua Libre wiki that hosted this material now lives at archive.lingualibre.org, with a newer application at lingualibre.org.',
    licence:
      'Per file, not per repository — Commons files carry their own licence, commonly CC BY-SA 4.0, CC BY 4.0, CC0 1.0 or public domain, and Lingua Libre wiki content is CC BY-SA 4.0 unless otherwise noted. There is therefore no single SPDX id for this source: the licence that governs a clip is the one on that clip’s file page.',
    spdxId: null,
    licenceUrl: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
    howKanseiUsesIt:
      'It is the only source of spoken audio in the app. Every clip Kansei ships carries an `AudioAttribution` recording the source, the file page URL, the credited author, the clip’s own SPDX licence id and licence URL, and whether the source documents the speaker as a native speaker — and the file is verified by SHA-256 at install time. Kansei never substitutes speech synthesis for a missing recording: where no suitably licensed clip exists, `audio` is null and the listening exercise is simply not generated for that item, so a learner never hears a robot approximation presented as Japanese pronunciation.',
    redistributable: true,
  }),

  Object.freeze({
    id: 'fonts',
    name: 'Bundled typefaces — Noto Sans JP, Noto Serif JP, Klee One, Inter',
    url: 'https://fonts.google.com/',
    whatItProvides:
      'The four typefaces the interface asks for. Noto Sans JP and Noto Serif JP (Google, via the noto-cjk project) cover Japanese in a modern gothic and a mincho serif — the printed forms a learner meets in the wild. Klee One (Fontworks) is a textbook/pen style whose kana and kanji are drawn closer to how the characters are actually handwritten, including the detached final strokes that gothic faces join. Inter (Rasmus Andersson) is the Latin interface face.',
    licence:
      'All four are under the SIL Open Font License 1.1: noto-cjk (Sans and Serif), Klee (© 2020 The Klee Project Authors, licence confirmed as OFL-1.1 on the fontworks-fonts/Klee repository), and Inter (© 2016 The Inter Project Authors).',
    spdxId: 'OFL-1.1',
    licenceUrl: 'https://openfontlicense.org/',
    howKanseiUsesIt:
      'Japanese glyphs get their own font stack rather than a global font, so the Latin interface and the Japanese content can be styled separately. The handwriting-style face matters pedagogically rather than decoratively: it is used wherever the app shows a character as it should be written, so that the `printVsHandwritten` note on characters like き and さ has something to point at. The fonts are subset by a build script and precached with the app shell so the app works offline. Full licence texts ship with the build, as OFL-1.1 requires, and the subset files keep the Reserved Font Names rules in mind — a subset is redistributed under the same licence and is not renamed.',
    redistributable: true,
  }),
]);

/** Lookup by id. Returns undefined for an unknown id rather than throwing. */
export function findContentSource(id: string): ContentSource | undefined {
  return CONTENT_SOURCES.find((s) => s.id === id);
}

/**
 * The sources whose licence requires attribution to be shown in the app. All of
 * them, in practice — which is why the About screen lists every entry rather
 * than a selection.
 */
export const ATTRIBUTION_REQUIRED: readonly ContentSource[] = Object.freeze(
  CONTENT_SOURCES.filter((s) => s.spdxId !== 'CC0-1.0'),
);
