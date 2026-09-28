# Stroke references

How Kansei gets the stroke data it animates and traces, what that data is, and —
importantly — what it is **not**.

## What this dataset is not

**KanjiVG is a reference, not a grader.** It records *one* documented stroke order
and *one* median path per stroke, drawn by hand in a 109×109 design box. It carries
no tolerance model, no stroke-width information, no record of acceptable variation,
and no notion of "close enough". Nothing in these files says how far a learner's
stroke may deviate before it is wrong.

Any judgement about a learner's handwriting is therefore a decision Kansei makes,
using its own tolerances, and must be presented as Kansei's opinion — never as
"KanjiVG says you are wrong". `orderVariants` is empty for every character (see
below), so the app must not treat the canonical order as the only correct order
without separately sourced evidence.

## Source

| | |
|---|---|
| Dataset | KanjiVG |
| Release | `r20250816` (archive `kanjivg-20250816-main.zip`) |
| Release URL | <https://github.com/KanjiVG/kanjivg/releases/tag/r20250816> |
| Project home | <http://kanjivg.tagaini.net> — <https://github.com/KanjiVG/kanjivg> |
| Copyright | Copyright © 2009–2025 Ulrich Apel |
| Licence | **CC BY-SA 3.0** (`CC-BY-SA-3.0`) |
| Licence URL | <https://creativecommons.org/licenses/by-sa/3.0/> |
| Archive SHA-256 | `69a2944ec1183086fdee5ba9c1f48bc306b867480a95b2f337f3203bf50689a3` |
| Fetched | 2026-09-28 |

### Redistribution terms, and what we owe

CC BY-SA 3.0 permits redistribution and adaptation — our resampled polylines are an
adaptation — under two conditions that bind Kansei:

1. **Attribution.** The licence header in every KanjiVG file asks specifically that
   you state your use of KanjiVG in your own copyright header and link to the
   KanjiVG website. The generated `index.json` carries an `attribution` string for
   this purpose, and any UI or About page that shows stroke animations must display
   it:

   > Stroke data from KanjiVG (http://kanjivg.tagaini.net), Copyright © 2009–2025
   > Ulrich Apel, CC BY-SA 3.0.

2. **Share-alike.** The derived stroke files in `public/content/strokes/` are a
   derivative work and must stay under CC BY-SA 3.0 or a compatible licence. This is
   a *narrower* licence than the rest of the repository may use, so it must be stated
   per-directory, not assumed. Shipping these files inside the PWA distributes them.

A secondary source is used **only for verification**, and none of its content is
redistributed:

| | |
|---|---|
| Dataset | KANJIDIC2 (EDRDG) |
| Version | `database_version` 2026-271, `date_of_creation` 2026-09-28 |
| URL | <http://www.edrdg.org/kanjidic/kanjidic2.xml.gz> — <http://www.edrdg.org/wiki/index.php/KANJIDIC_Project> |
| Licence | CC BY-SA 4.0 (Electronic Dictionary Research and Development Group) |

## Reproducing

Everything under `public/content/strokes/` is generated. Do not hand-edit it.

```sh
npm run content:fetch      # downloads KanjiVG + KANJIDIC2 into data/sources/
npm run content:strokes    # = node scripts/content/build-strokes.mjs
```

`content:fetch` records each archive in `data/sources/SOURCES.lock.json` with its
SHA-256; the KanjiVG hash the build was made from is
`69a2944e…f50689a3`, matching that lock. Or fetch by hand:

```sh
mkdir -p data/sources && cd data/sources
curl -sSL -O https://github.com/KanjiVG/kanjivg/releases/download/r20250816/kanjivg-20250816-main.zip
curl -sSL -o kanjidic2.xml.gz http://www.edrdg.org/kanjidic/kanjidic2.xml.gz
cd ../.. && node scripts/content/build-strokes.mjs
```

The script is `scripts/content/build-strokes.mjs` — **Node builtins only, no npm
dependencies**, including a purpose-written SVG path parser and a minimal ZIP reader.
It prints a JSON report and exits non-zero if any verification fails.
`data/sources/` is gitignored: upstream archives are fetched, never committed.

No unzip or gunzip step is needed. The script reads the `.zip` directly (stored and
deflate entries; it throws on ZIP64 or encryption rather than guessing) and accepts
KANJIDIC2 as either `kanjidic2.xml` or `kanjidic2.xml.gz`. If an already-extracted
directory exists it is preferred; building from the zip and from an extracted
directory was verified to produce byte-identical output. The archive lays files out
as `kanji/XXXXX.svg`, not `svg/XXXXX.svg` — the script locates the directory itself
and accepts either.

Output is deterministic: rebuilding produces byte-identical files (verified by
comparing SHA-256 of the whole output tree across runs).

## Output

```
public/content/strokes/<hex>.json    one StrokeReference per character
public/content/strokes/index.json    metadata + glyph -> {file, strokeCount, bytes, sha256}
```

`<hex>` is the character's code point as lowercase zero-padded 5-digit hex, matching
KanjiVG's own filenames (ね → `0306d.json`). One file per character so a service
worker can cache exactly the characters a learner has reached, rather than a single
monolith.

Each file is a `StrokeReference` exactly as declared in `src/domain/content.ts`:
`{ glyph, source, viewBox, strokes[], orderVariants }`, where each stroke is
`{ path, points, type, length }`.

### Coverage

| | |
|---|---|
| Characters | **1,177** |
| — kana | 177 |
| — kanji | 1,000 |
| Strokes | 10,211 |
| Per-character files | 4,876,101 bytes (min 561, median 4,135, max 9,804) |
| `index.json` | 157,834 bytes |
| **Total** | **5,033,935 bytes** (≈1.67 MB gzipped) |
| Missing | none — every requested character had a KanjiVG file |

The 177 kana are enumerated from the Unicode blocks rather than hand-listed, so the
set cannot silently lose a character: U+3041–U+3096 (hiragana ぁ–ゖ, 86), U+30A1–U+30FA
(katakana ァ–ヺ, 90) and U+30FC (ー). That covers the 46 basic characters of each
script, every dakuten/handakuten form が–ぽ / ガ–ポ, ゔ/ヴ, the small kana
ぁぃぅぇぉっゃゅょゎ / ァィゥェォッャュョヮ, ん/ン, and the historical ゐゑヰヱ and small ゕゖヵヶ.

Deliberately **excluded**: the iteration marks ゝゞヽヾ, U+30FB ・, and the combining
dakuten U+3099–U+309C — none are written characters Kansei teaches. Yōon combinations
like きゃ are two code points and compose from their parts, so they get no reference
of their own.

The 1,000 kanji are whatever `data/kanji-top1000.json` lists; the stroke build does
not choose the taught set.

## Method

### Stroke order

Each `<path>` inside the `kvg:StrokePaths_*` group, **in document order**, is one
stroke, and that order *is* the stroke order. Where KanjiVG numbers the paths
(`id="kvg:XXXXX-sN"`) the script asserts the numbers ascend 1..n, so a reordering
upstream would fail the build rather than silently produce a wrong animation.

The original `d` attribute is kept verbatim in `strokes[].path`, so the UI can
animate the real curve rather than the resampled approximation.

### Resampling

For the assessor, each stroke's median is also stored as a fixed-length polyline so
the runtime never parses an SVG path:

1. Parse the path into absolute cubic Bézier segments. Straight lines are promoted
   to cubics so downstream code has one shape to handle.
2. Flatten each cubic at a target chord length of 0.25 design units (min 4, max 400
   steps per segment), accumulating arc length. Duplicate samples are dropped so the
   polyline always progresses.
3. Resample **24 points** per stroke at equal arc-length intervals, endpoints
   inclusive, by linear interpolation along the flattened polyline.
4. Round coordinates to 2 dp (≈0.01% of the 109-unit box) and `length` to 3 dp.

`strokes[].length` is the stroke's true arc length in design units, not the length of
the 24-point polyline.

**A fixed 24 points is coarse for a few very long strokes.** 6 of the 10,211 strokes
have a 24-sample polyline shorter than 95% of their true arc length, because they
curl back on themselves faster than the samples follow: ゑ stroke 1 (arc length 335.5,
polyline 87.1%), そ/ぞ stroke 1 (92.9%), れ stroke 2 (94.3%), え stroke 2 (94.6%),
ぇ stroke 2 (94.7%). The build lists them as advisories. Any assessor comparing a
learner's stroke to `points` should use `length` — not the polyline's chord sum — as
the stroke's size, and should expect reduced angular fidelity on these six.

### Path commands

The r20250816 dataset was audited: across all 79,907 paths in the archive only
`M m C c S s` occur (168,103 `c`, 79,772 `M`, 8,992 `C`, 1,101 `s`, 135 `m`, 91 `S`),
every path has exactly one subpath, and no coordinate uses scientific notation. The
parser implements `M m L l C c S s` and **throws** on anything else — `H V Q T A Z`
included — so an upstream change cannot silently yield a wrong polyline.

### `kvg:type`

Copied verbatim into `strokes[].type` when the `<path>` carries it, `null` otherwise.
69 distinct type values occur in our set. All 9,695 kanji strokes have a type; 514 of
the 516 kana strokes do not (KanjiVG simply does not annotate kana — the two
exceptions are both strokes of マ). Treat `type` as optional metadata, never as
something the UI requires.

### `orderVariants`

**Empty (`[]`) for every character.** KanjiVG's `-main` archive contains no variant
files at all (verified: zero filenames matching `<hex>-<name>.svg`), and the dataset
ships no machine-readable "this alternative order is also accepted" data. Rather than
invent permutations, the field is left empty and the script records any variant files
it *does* find under `variantFilesAvailable` in `index.json` — currently `{}`.

Alternative *glyph forms* (Kaisho etc.) live in the separate `kanjivg-20250816-all.zip`,
which we do not fetch. Those are different drawings of a character, not documented
alternative orders for the same drawing, so they would not populate this field
either. **Accepted stroke-order variation for Japanese is genuinely unsourced here**
and remains an open gap — see the limitation below.

## Verification

The build verifies rather than assumes, and exits non-zero on any failure. On the
current output: **0 failures.**

- **Stroke counts, spot check.** 8 characters spanning simple to complex, checked
  against an authority: 一 1, 川 3, 水 4, 曜 18, 語 14, 議 20 — all matching KANJIDIC2's
  `<stroke_count>`. ね 2 and ツ 3 also match, but their expected values are
  **hand-asserted** from standard kana stroke-order charts, because KANJIDIC2 has no
  kana entries and we have no machine-readable authority for kana counts. That
  weaker basis is labelled as such in the script (`SPOT_CHECK[].via`).
  If KANJIDIC2 is not present the report says `stroke counts NOT cross-checked`
  rather than quietly passing.
- **Stroke counts, everything.** Not just the 8: all 1,000 kanji are compared against
  KANJIDIC2 (**1,000 checked, 0 disagreements**) *and* against the `strokeCount` that
  `data/kanji-top1000.json` declares (**1,000 checked, 0 disagreements**). A mismatch
  fails the build, because the animation contradicting the taught count is a real
  defect. The 177 kana have no KANJIDIC2 entry and are skipped, which the report says.
- **Geometry.** Every stroke: exactly 24 finite points; every point inside the
  0–109 box (actual extent 8.25–102.50 x, 5.77–101.76 y); strictly positive distance
  between consecutive samples, i.e. the polyline always progresses and never repeats
  or backtracks onto a sample; the resampled chord sum never exceeds the true arc
  length beyond the allowance implied by 2 dp rounding.
- **Endpoints.** The first and last sample of every stroke match the path's own start
  (`M`) and end (last cubic's terminus) to within 0.02 design units.
- **Independent cross-check** (one-off, not committed). The parser and resampler were
  re-implemented separately in Python — different tokenizer, t-uniform De Casteljau
  at 4,000 steps per segment instead of chord-targeted flattening — and compared
  against the committed output for all 10,211 strokes. Worst arc-length disagreement
  0.0054 design units (on 導); worst resampled point disagreement 0.0094 design units
  (on 島). Both are within the 2 dp rounding budget, so the two implementations agree
  to the precision the files store.

### Known upstream disagreement, measured

KanjiVG and KANJIDIC2 do not always count strokes the same way, usually because
KanjiVG draws a different glyph form (辶, 食 and 曷 are the recurring culprits).
Measured across all 6,416 KanjiVG kanji that KANJIDIC2 also covers: **98.3% agreement
(6,307 agree, 109 disagree)**. 45 of the 109 are jōyō, e.g. 葛 (KanjiVG 12 / KANJIDIC2 11),
謎 (17/16), 賭 (16/15), 餅 (15/14), 辻 (6/5), 牙 (4/5).

None of the 109 falls in KANJIDIC2's top 1,000 by frequency, and none is in our taught
set — hence the 0 disagreements above. This is a fact about the current taught set,
not a guarantee: if the taught set grows, the build will fail on the first affected
character and a human will have to choose which count Kansei teaches.

## Limitations

- **No accepted-variation data.** `orderVariants` is empty everywhere and nothing in
  this dataset licenses the claim that the canonical order is the *only* correct one.
  Real Japanese handwriting admits documented variation (and 上/right-to-left
  orderings taught differently in different eras and countries). Sourcing that is
  outstanding work.
- **KanjiVG's own accuracy is not audited here.** We verified internal consistency,
  our own parsing, and stroke *counts* against a second source. We did not verify
  that each path is drawn in the order Japanese schools teach.
- **Kana stroke counts have no machine-readable authority in our sources.** They come
  from the number of KanjiVG paths, spot-checked by hand against standard charts.
- **One glyph form only.** KanjiVG's plain file is used and alternative forms
  (Kaisho, traditional variants) are not fetched. Where a printed font in the app
  differs from the drawn form, the app is showing two different shapes; the
  `printVsHandwritten` field on the character entry, not this dataset, is where that
  gets explained.
- **Six strokes are coarsely sampled** at 24 points, listed above.
