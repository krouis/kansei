# Content inventory and reproduction

The installable data contains 268 kana entries, 1,000 frequency-selected kanji,
263 component records, 250 kanji lessons, 67 kana lessons and 1,600 JMdict-derived
vocabulary entries. The kanji/vocabulary curriculum is generated draft material
requiring Japanese-language review. It is not a proficiency-certified syllabus.

**Audio is incomplete:** 71/104 modern kana sounds have recordings; all 33 yōon
sounds are missing. Only a small fraction of selected vocabulary has matched
recordings. Real speaker and license evidence is preserved, but human listening
review remains outstanding. Per-character kanji reading alignment intentionally
omits ambiguous cases; all selected words retain sourced whole-word readings.
`data/vocab-report.json` records exact counts and omitted reading coverage.
Canonical stroke references cover individual kana and all 1,000 kanji; combinations
are composed from individual characters. Accepted alternate stroke orders are not
comprehensively sourced. Handwriting assessment has synthetic validation only.

## Reproduce

With Node installed and the five source files in `data/sources` matching
`SOURCES.lock.json`:

```sh
node scripts/content/build-kanji-order.mjs
node scripts/content/build-vocab.mjs
npm run content:build
npm run content:validate
```

The source archives are not rewritten. Generated JSON is deterministic for the
locked inputs. The index uses content-derived pack versions, exact byte counts
and SHA-256 for every file. Its fixed generatedAt is a build-format epoch, not a
claim of source freshness. Installation verifies every file before readiness.
Interrupted installation resumes at verified-file boundaries; byte-range resume
within one file is not currently implemented. Packs are `kana`, `audio-kana`,
`kanji-1000`, `vocab`, and `audio-vocab`. Kanji lesson bands are not separate packs
yet. Bundled fonts and their license notices are app-shell assets precached by the
service worker, rather than duplicated inside content packs.

## Sources and redistribution

| Data | Source/version | License and derived work |
| --- | --- | --- |
| Kana inventory and teaching notes | Kansei-authored inventory; [inventory](content/KANA-INVENTORY.md) | Repository terms; modern, extended and historical forms explicitly distinguished |
| Kanji list/meanings/source readings | KANJIDIC2, locked 2026-09-28 snapshot | EDRDG CC BY-SA 4.0; top-1,000 selection and ordered runtime records are adaptations |
| Vocabulary/glosses | JMdict English, locked 2026-09-28 snapshot | EDRDG CC BY-SA 4.0; selection/reading alignment are adaptations, credited per entry |
| Stroke references/components | KanjiVG r20250816 | Ulrich Apel and contributors, CC BY-SA 3.0; paths resampled to polylines and component records derived |
| Radical equivalences | Unicode radical/equivalence source files in source lock | Unicode license; see component provenance and source lock |
| Audio | Wikimedia Commons recordings; per-file source URLs | Per-file PD/CC0/CC BY/CC BY-SA as recorded; exact authors, source URLs and licenses in AudioRef and pack credits |
| Japanese fonts | Noto Sans JP, Noto Serif JP, Klee One, pinned versions | SIL OFL 1.1; notices and source/version metadata in `public/fonts` |

The actual license URLs and upstream identities are retained in
`data/sources/SOURCES.lock.json`, component provenance, audio index and font index.
EDRDG terms: <https://www.edrdg.org/edrdg/licence.html>. KanjiVG:
<https://kanjivg.tagaini.net/>. Unicode terms:
<https://www.unicode.org/license.txt>. Asset redistribution must preserve these
notices and applicable share-alike terms, regardless of application-code license.

See [kanji frequency](content/KANJI-FREQUENCY.md), [teaching sequence](content/KANJI-ORDER.md),
[vocabulary](content/VOCABULARY.md), [components](content/COMPONENTS.md),
[audio](content/AUDIO.md), and [fonts](content/FONTS.md) for methodology and limits.
Scientific-reference metadata is bundled separately in `src/features/about`;
no copyrighted full papers are bundled. Pedagogical sources and licenses are
not experimental evidence.

## Validation boundaries

The validator checks source hashes, IDs, NFC, references, teaching-order density,
prerequisites, word gates, reciprocal word-reading examples, stroke counts,
AudioRef credits and hashes, manifest byte totals, file presence and integrity.
It does not claim editorial correctness, audio listening review, representative
human handwriting validation, device testing or pedagogical effectiveness.
