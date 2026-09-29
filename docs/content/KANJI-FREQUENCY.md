# Kanji frequency: where Kansei's "top 1000" comes from

This document exists so that no claim the app makes about kanji frequency is
unsourced. It covers: which corpus the ranking comes from, how the ranking was
produced, what that corpus is biased towards, why the frequency rank is **not**
the order Kansei teaches in, what we are allowed to redistribute, and how an
independent modern corpus agrees with the list.

Everything below is either quoted from upstream documentation or computed by a
committed script. Where a figure is not documented upstream, this document says so
rather than estimating it.

- Derived data: [`data/kanji-top1000.json`](../../data/kanji-top1000.json)
- Cross-check evidence: [`data/kanji-frequency-crosscheck.json`](../../data/kanji-frequency-crosscheck.json)
- Scripts: [`scripts/assets/fetch-sources.mjs`](../../scripts/assets/fetch-sources.mjs),
  [`scripts/content/build-kanji-list.mjs`](../../scripts/content/build-kanji-list.mjs),
  [`scripts/content/crosscheck-kanji-frequency.mjs`](../../scripts/content/crosscheck-kanji-frequency.mjs)

---

## 1. Primary source

| | |
|---|---|
| Dataset | KANJIDIC2 |
| Field used | `<freq>` (the `F` field in the legacy KANJIDIC format) |
| Publisher | Electronic Dictionary Research and Development Group (EDRDG), Jim Breen |
| Download | `http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz` |
| Project page | `http://www.edrdg.org/wiki/KANJIDIC_Project.html` |
| File version | 4 |
| Database version | **2026-271** |
| Date of creation | **2026-09-28** |
| SHA-256 of the `.gz` used | `5a4c966cddba225f0a33cb866c66ceb4867a3534feb47c24e6f85e535fa42b9d` |
| Bytes | 1,488,576 |
| Licence | **CC BY-SA 4.0** (SPDX: `CC-BY-SA-4.0`), <https://www.edrdg.org/edrdg/licence.html> |

The downloaded file is recorded with its digest in
[`data/sources/SOURCES.lock.json`](../../data/sources/SOURCES.lock.json), which is
committed. The archive itself is **not** committed (`data/sources/*` is gitignored);
`scripts/content/build-kanji-list.mjs` re-checks the digest against the lock and
records an `integrity.inputWarnings` entry if it does not match.

Note that the EDRDG documentation wiki has been closed to scraping; the canonical
project page is now served as a static copy at
`http://www.edrdg.org/wiki/KANJIDIC_Project.html` (the old
`http://www.edrdg.org/wiki/index.php/KANJIDIC_Project` URL now returns only an
index of those static copies).

## 2. What corpus the frequency comes from, exactly

**Corpus: approximately four years of the Mainichi Shimbun (毎日新聞), the online
editions available in 1998.**

The chain of provenance, quoted verbatim:

> The 2,501 most-used characters have a ranking which expresses the relative
> frequency of occurrence of a character in modern Japanese. The data is based on an
> analysis of word frequencies in the Mainichi Shimbun over 4 years by Alexandre
> Girardi. Note: (a) these frequencies are biased towards words and kanji used in
> newspaper articles, and (b) the relative frequencies for the last few hundred kanji
> so graded is quite imprecise.
>
> — KANJIDIC Project page, "Frequency-of-use ranking"

> In 1998 Alexandre Girardi produced a word-frequency list based on 4 years of the
> Mainichi Shimbun. It contains about 300,000 words.
>
> — `http://ftp.edrdg.org/pub/Nihongo/00INDEX.html`

> In 1998 I was contacted by Alexandre Girardi who was at that time a graduate
> student at NAIST (Shikano-lab). He had been using my EDICT file and also had access
> to online copies of the previous 4 years of the Mainichi Shimbun. He had processed
> (all?, part?) of the newspaper material through a morphological analyzed and
> produced a word-list with Part-of-Speech and frequency attached. […] Alexandre sent
> me a copy of the file with about 300,000 words marked.
>
> — Jim Breen, `http://ftp.edrdg.org/pub/Nihongo/wordfreq.README`, May 2003

### Ranking methodology

1. Roughly four years of Mainichi Shimbun text was run through a **morphological
   analyser**, producing a word list with part-of-speech tags and occurrence counts
   — about **300,000 word entries**.
2. Per-kanji **relative frequencies were derived from those word frequencies**. The
   ranking is therefore *word-frequency-derived*, not a raw tally of characters in
   running text. This is a real distinction: a kanji that appears in many distinct
   moderately-common words is treated differently from one concentrated in a single
   very common word.
3. The resulting ordering became the `F`/`<freq>` field in KANJIDIC.

### Corpus size and date: what is and is not known

- **Size in tokens or characters: not documented.** Upstream states the intermediate
  word list contains "about 300,000 words" (word *entries* with frequencies), and Jim
  Breen explicitly records that he does not know whether all or only part of the
  newspaper material was processed. No token count, article count, or byte size is
  published. **This document does not estimate one.**
- **Date: the four years preceding 1998.** Upstream says "the previous 4 years"
  relative to 1998 and gives no exact start or end date, so no precise range is
  asserted. The material was released by the EDRDG in May 2003.
- Earlier editions of KANJIDIC used a different ranking, from the National Language
  Research Institute (Tokyo) as interpreted by Jack Halpern. That is **not** the data
  in use today.

### Documented biases — repeat these to the learner, do not hide them

- Biased towards newspaper vocabulary: politics, economics, administration,
  institutions.
- Reflects mid-1990s Japan. Upstream notes proper nouns such as "Clinton" occur more
  often than they would now. Kanji like 貿 (trade), 僚 (bureaucrat/colleague),
  邸 (official residence) and 賃 (wages/rent) rank far higher here than in general
  modern text — see the cross-check in §6.
- "The relative frequencies for the last few hundred kanji so graded is quite
  imprecise." Discrimination between infrequent kanji is weak. Kansei only uses the
  top 1000 of 2501, which is the better-determined end, but even within the top 1000
  a difference of a few dozen ranks is not meaningful.
- A word-frequency-derived ranking is not the same measurement as a character count
  over running text.

## 3. Selection and integrity checks

`scripts/content/build-kanji-list.mjs` takes the 1000 lowest (most frequent)
`<freq>` values. Measured from database version 2026-271:

| Check | Result |
|---|---|
| Characters in KANJIDIC2 | 13,108 |
| Characters carrying a `<freq>` | **2,501** |
| Maximum rank present | **2,501** |
| Ranks selected | 1..1000 |
| Characters selected | **exactly 1000** |
| Gaps in ranks 1..1000 | **none** |
| Tied ranks in 1..1000 | **none** |
| Tied ranks anywhere in the file | **none** |
| Duplicate glyphs | none (1000 distinct) |
| Selected entries with an English meaning | 1000 / 1000 |
| Selected entries with at least one on or kun reading | 1000 / 1000 |
| Selected entries with a classical radical number | 1000 / 1000 |
| Selected entries with a stroke count | 1000 / 1000 |

### One documented anomaly

The KANJIDIC2 DTD comment says:

> The frequency is a number from 1 to 2,500 … (Actually there are 2,501 kanji ranked
> as there was a tie.)

In database version **2026-271 that is no longer true of the data**: there are 2,501
ranked kanji with **distinct, gapless ranks 1..2,501** and **no tie anywhere**. The
data is used exactly as published; the DTD comment appears to be stale. This is
recorded in `integrity.dtdCommentVsData` in `data/kanji-top1000.json`, and the build
script re-derives it on every run rather than trusting either statement.

Because the ranking is a dense permutation, the top-1000 cut is unambiguous — no
tie-breaking judgement was needed or made.

### Fields carried, and two naming warnings

Per entry: `glyph`, `id` (`kanji:日`), `ucsCodepointHex`, `frequencyRank`,
`teachingOrder` (always `null`), `meanings`, `on`, `kun`, `kunBareKana`, `nanori`,
`radicalClassicalNumber`, `radicalNelsonNumber`, `strokeCount`,
`strokeCountMiscounts`, `grade`, `jlptOldLevel`, `variants`.

1. **`jlptOldLevel` is the pre-2010 four-level JLPT** (4 = most elementary, 1 = most
   advanced), which is what KANJIDIC2's `<jlpt>` records. It is **not** the current
   N1–N5 scale, and the field is deliberately *not* called `jlptLevel` so it cannot be
   rendered as "N4" by mistake. No official kanji lists exist for the current levels,
   so Kansei must not claim any. Distribution in the top 1000: level 1 → 192,
   level 2 → 540, level 3 → 162, level 4 → 101, absent → 5 (韓 岡 阪 狙 埼).
   *(Note for implementers: `KanjiCharacter` in `src/domain/content.ts` has a field
   named `jlptLevel`. Whatever populates it from this file must carry the old-scale
   caveat forward or leave it null.)*
2. **`strokeCountMiscounts` are miscounts, not variants.** KANJIDIC2 documents
   second-and-later `<stroke_count>` values as *common miscounts*. 46 of the top 1000
   have one. They are useful for tolerating a learner's error, never for teaching.
3. `variants` are encoding-level cross-references (`jis208`, `jis212`, `jis213`,
   `ucs`, `nelson_c`, `oneill`, `deroo`, `njecd`, `s_h`) — 310 of the top 1000 have at
   least one. They are **not** a curated "looks confusable to a learner" list; that is
   separate, human-authored curriculum data.
4. `kun` keeps KANJIDIC's positional notation: a leading `-` means the reading occurs
   as a suffix, a trailing `-` as a prefix, and `.` separates the kanji's reading from
   its okurigana (`あたら.しい`). `kunBareKana` is that with `-` and `.` stripped,
   derived mechanically — not a second source claim.
5. Two of the top 1000 have no on reading at all (込 rank 675, 枠 rank 922); 137 have
   no kun reading. This is upstream's data, not a gap in extraction.

All 1000 are jōyō or jinmeiyō kanji: grade 1–6 (kyōiku) 821, grade 8 (remaining jōyō)
178, grade 9 (jinmeiyō) 1.

## 4. Frequency rank is NOT teaching order

`teachingOrder` is `null` for every entry in `data/kanji-top1000.json`, and this file
must never be used as a curriculum sequence. Reasons:

1. **Frequency says nothing about writability.** 験, 議, 機 and 職 are all common and
   all 18+ strokes. 一, 二, 十 are trivial to write. Teaching by frequency puts
   hard-to-write characters in week one.
2. **It destroys component reuse.** Kansei teaches components so that later kanji
   decompose into things already known. A frequency ordering scatters the members of
   a component family across hundreds of positions, so nothing is ever reused while
   it is still fresh.
3. **It is newspaper frequency.** §2's biases are exactly wrong for a beginner: a
   learner needs 犬, 猫, 食, 飲, 水 long before 措, 貿, 僚, 邸 or 賃 — which this
   ranking places inside the top 1000 while the everyday words sit lower or outside.
4. **A reading cannot be taught without a word.** Kansei only teaches a reading once
   at least one vocabulary item demonstrates it. Whether suitable beginner vocabulary
   exists is a constraint frequency rank knows nothing about.
5. **The rank is imprecise at this resolution anyway.** Upstream warns the tail is
   imprecise, and a word-derived ranking from one 1990s newspaper cannot justify
   claiming #412 should be taught before #413.

What the frequency rank *is* good for: choosing the **set** (a documented, defensible
answer to "which 1000?"), telling a learner how much of typical text a character
earns them, and breaking ties among candidates that are otherwise equally teachable.
Sequencing is owned by the curriculum build, which orders by stroke complexity,
component reuse and vocabulary availability.

## 5. Redistribution rights

**KANJIDIC2 — CC BY-SA 4.0.** We may redistribute and adapt, including in a content
pack shipped with the app, provided we:

- credit the EDRDG / Jim Breen,
- link the licence,
- state that changes were made, and
- license the derived data under the same terms (share-alike).

Kansei's changes, stated: a subset of fields (glyph, frequency rank, English
meanings, on/kun/nanori readings, classical and Nelson radical numbers, stroke count
and documented miscounts, grade, old-JLPT level, variant code points) was extracted
for the 1000 most frequent kanji and re-serialised as JSON. No dictionary content was
edited, corrected or added. The exact attribution string to ship is stored in
`source.attributionRequired` in `data/kanji-top1000.json`.

Share-alike means any content pack containing this derived data is itself under
CC BY-SA 4.0. Curriculum material that does not embed KANJIDIC2 content (hand-authored
teaching order, mnemonics, notes) is a separate work and is not made share-alike by
this. The app's own code is GPL-2.0-or-later; keep the data licence notice distinct
from the code licence notice in the UI.

**Fields deliberately not extracted:** SKIP codes are under CC BY-NC-SA 4.0 —
*non-commercial* — and other descriptor systems (De Roo, Spahn & Hadamitzky, Halpern,
Heisig indices) carry their own permissions. None of them are in
`data/kanji-top1000.json`, so its share-alike obligation is the only licence
constraint that travels with the data.

**Cross-check source (scriptin/kanji-frequency) — CC BY 4.0**, no share-alike. It is
used as *evidence only*: the comparison CSVs are cached under `data/sources/`
(gitignored) and their counts are **not** redistributed in any content pack. Only the
derived agreement statistics in `data/kanji-frequency-crosscheck.json` are committed,
with attribution to Dmitry Shpika.

## 6. Cross-check against an independent modern corpus

The primary ranking is one corpus, one register, one decade. To say something honest
about robustness, the top-1000 set was compared with
[scriptin/kanji-frequency](https://github.com/scriptin/kanji-frequency) (Dmitry
Shpika, CC BY 4.0), which counts **characters directly** in three unrelated modern
corpora. **The primary ranking was not changed by this comparison.**

Note on the source URLs: the JSON files named in earlier documentation
(`data/wikipedia.json`, `data/aozora.json`, `data/news.json`) **now return HTTP 404**.
The current layout is CSV — `data/{wikipedia,aozora,news}_characters.csv`, columns
`rank,code_point_hex,char,char_count`, with `rank` 0 being an "all" total row. The
`*_characters_ext.csv` variants additionally resolve the iteration mark 々 into
multi-character entries such as `(日)々`, so the plain files are used.

Overlap of Kansei's top 1000 (KANJIDIC2) with each corpus's own top 1000:

| Corpus | What it is | Corpus size (kanji) | Overlap | Bounds¹ | Spearman ρ² |
|---|---|---|---|---|---|
| Japanese Wikinews | 3,753 news articles, ~2005–2023 | 1,117,683 | **90.1 %** | 89.7–90.2 % | 0.785 |
| Japanese Wikipedia | 100,000 articles, sampled Jan 2023 | 59,301,009 | **87.0 %** | 87.0–87.1 % | 0.726 |
| Aozora Bunko | 17,115 literary texts, mostly pre-war | 67,805,014 | **75.7 %** | 75.6–75.7 % | 0.571 |

Mean overlap **84.3 %**. Every corpus total re-derived from the CSV matched the figure
published on the project website.

¹ The comparison ranks use competition ranking, so equal counts share a rank and a
cut at exactly 1000 can split a tie. The bounds are the overlap with the whole
boundary tie included and with it excluded. The spread is at most 0.5 pp, so the
figures are not an artefact of tie-breaking — even for Wikinews, whose 1000th row
sits inside a 9-way tie at 135 occurrences because that corpus is small.

² Spearman rank correlation over the characters present in both top-1000 lists. It is
well short of 1.0, which is the expected and correct result: the two lists agree
strongly on *membership* and only loosely on *exact order*. That is a further reason
not to treat rank as teaching order (§4).

**All 1000 of Kansei's characters occur in all three corpora.** None is absent
anywhere. 972 of 1000 (97.2 %) are in the top 1000 of at least one comparison corpus.

**The 28 corroborated by none** are, in rank order:
貿 (652), 僚 (709), 狙 (745), 努 (749), 葬 (754), 措 (818), 抑 (834), 拒 (863),
喪 (885), 邸 (905), 汚 (908), 縮 (909), 慮 (916), 枠 (922), 緩 (933), 需 (935),
貢 (956), 賃 (961), 徹 (968), 焦 (973), 析 (980), 預 (981), 簡 (983), 挑 (989),
紛 (994), 貸 (995), 促 (998), 慎 (999).

This list is itself the strongest evidence for the bias described in §2: trade,
bureaucracy, official residences, wages, suppression, funerals, demand, contribution.
It is newspaper Japanese. Note also that every one of the 28 sits at rank 652 or
deeper — the disagreement is entirely at the tail of the cut, never near the top. The
curriculum is expected to defer these.

Aozora's lower agreement is expected and is not evidence against the list: it is
largely pre-war literary prose, the register least like either a newspaper or a
beginner's needs. 27 of Kansei's characters rank worse than 2000 in Aozora, against 1
in Wikipedia and 0 in Wikinews.

### What the app may state

> Kansei's 1000 kanji are the 1000 most frequent in KANJIDIC2's frequency ranking,
> which is derived from a word-frequency analysis of about four years of the Mainichi
> Shimbun (Girardi, 1998). Independent modern character counts of Japanese Wikipedia,
> Wikinews and Aozora Bunko agree with 76–90 % of that set (mean 84 %), and 97 % of it
> is corroborated by at least one of them. The ranking is newspaper-biased and about
> thirty years old; it chooses *which* kanji Kansei teaches, never the order.

### One unexplained discrepancy

For all three corpora, the number of distinct kanji in the CSV is **exactly one more**
than the "Uniq. kanji" figure published on the project's own website (8,484 vs 8,483;
7,915 vs 7,914; 2,940 vs 2,939). The cause was not determined. It cannot affect a
top-1000 cut, and it is recorded here and in the crosscheck JSON's
`summary.caveats` rather than smoothed over.

(Also handled: the Wikipedia CSV has a tail of Kangxi-radical-block glyphs — ⽉ ⼤ ⾦,
U+2F00 block — which are `Script=Han` but are radical symbols, not kanji. They sit at
rank 2700+ and are filtered out by a `\p{Unified_Ideograph}` test.)

## 7. Reproducing this exactly

```sh
# 1. fetch upstream sources; records SHA-256 + size into data/sources/SOURCES.lock.json
#    (idempotent: a file whose digest already matches is skipped)
node scripts/assets/fetch-sources.mjs

# ...or just the one needed here:
node scripts/assets/fetch-sources.mjs kanjidic2

# verify what is on disk against the lock, without touching the network
node scripts/assets/fetch-sources.mjs --verify

# 2. derive the ranked list -> data/kanji-top1000.json
#    prints the integrity checks from §3 to stderr and stores them in the JSON
node scripts/content/build-kanji-list.mjs

# 3. cross-check against the independent corpora -> data/kanji-frequency-crosscheck.json
node scripts/content/crosscheck-kanji-frequency.mjs

# re-run the cross-check from cached CSVs, no network
node scripts/content/crosscheck-kanji-frequency.mjs --offline
```

Node 20 or later; no dependencies beyond Node builtins. `data/sources/` is gitignored
apart from `SOURCES.lock.json`, so a fresh clone must run step 1 before step 2.

`data/kanji-top1000.json` is written compact (single line, no pretty-printing) because
it is well over 100 KB; the crosscheck file is small and is pretty-printed so diffs
are readable.

## 8. Upstream documents consulted

| Document | URL |
|---|---|
| KANJIDIC project page (static copy) | `http://www.edrdg.org/wiki/KANJIDIC_Project.html` |
| EDRDG wiki index (wiki itself closed) | `http://www.edrdg.org/wiki/index.php/KANJIDIC_Project` |
| Legacy KANJIDIC documentation | `http://www.edrdg.org/kanjidic/kanjidic_doc_legacy.html` |
| `wordfreq` README (Jim Breen, May 2003) | `http://ftp.edrdg.org/pub/Nihongo/wordfreq.README` |
| EDRDG Nihongo file index | `http://ftp.edrdg.org/pub/Nihongo/00INDEX.html` |
| EDRDG general dictionary licence | `https://www.edrdg.org/edrdg/licence.html` |
| kanjidic2.xml internal DTD comments | inside the distributed file |
| kanji-frequency dataset description | `https://scriptin.github.io/kanji-frequency/` |
| kanji-frequency repository / licence | `https://github.com/scriptin/kanji-frequency` |

Consulted 2026-09-28/29 against KANJIDIC2 database version 2026-271 and
scriptin/kanji-frequency at branch `master`.
