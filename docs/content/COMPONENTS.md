# Kanji components

How Kansei decides which building blocks of a kanji are worth teaching, where the
data comes from, and — most importantly — what this dataset does **not** claim.

| | |
|---|---|
| Derived data | `data/components.json` — `KanjiComponent[]` (`src/domain/content.ts`), 263 records, 114 KB compact |
| Machine-readable provenance | `data/components.provenance.json` |
| Hand-authored judgement | `data/component-notes.json` |
| Build script | `scripts/content/build-components.mjs` |
| Contract test | `tests/unit/components-dataset.test.ts` |
| Reproduce | see *Reproducing* below |

---

## Reproducing

```sh
npm run content:fetch                          # KanjiVG, KANJIDIC2, the two UCD files
node scripts/content/build-kanji-list.mjs      # data/kanji-top1000.json
npm run content:components                     # pass 1 — writes data/components.json
npm run fonts:build                            # widens the webfont subset to cover it
npm run content:components                     # pass 2 — exits 0
```

Two passes over the component build, and it is not circular. Inclusion is decided
from the **source typefaces** — whether Noto Sans JP / Noto Serif JP / Klee One
contain the glyph at all, a permanent property of the type design. The *shipped
subset* is a separate, softer question: `build-fonts.mjs` derives its code-point
list by scanning `data/*.json`, so it cannot know about a component glyph until
`data/components.json` exists. Pass 1 writes the data and reports the pending
subset gaps; the font build closes them; pass 2 verifies. `data/components.json`
is byte-identical after both passes (sha256
`69990814e744c7ce4dc2362714144eeadb5dc103533aa176ee6ba70109fd47b0`, 113,995 B) —
only the verification verdict changes. Three consecutive runs produce identical
bytes, and the build works equally from the extracted `data/sources/kanjivg/`
directory or straight from the release zip.

---

## The one thing to read

**A component does not have a meaning. A component does not have a reading.**

Kansei never presents one. **249 of the 263** components carry
`meaningIsUnreliable: true`, and `glosses` is a **plural, unordered** list on
every record — including the empty case. Only 14 records claim a dependable sense
— 糸 thread, 囗 enclosure, 金 gold, 石 stone, 雨 rain, 廴 long stride, 走 run,
舟 boat, 馬 horse, 林 grove, 魚 fish, 血 blood, ⺷ ram, 歯 tooth — and each of those
is a derived conclusion about that particular shape, never the default.

This is a product requirement, not a hedge. The popular "every radical means one
thing" model is wrong often enough to actively mislead:

- **月 is two different radicals.** In 明 期 朝 it is radical 74, the moon. In
  育 脳 背 筋 脱 it is radical 130, 肉 "meat", written identically. The KanjiVG
  data records both; the record for 月 lists 肉 in `variants` and is flagged
  unreliable.
- **A phonetic component contributes sound, not sense.** KanjiVG marks a
  phonetic component in **529 of the 1000 taught kanji**. In 語 the right half 吾
  is there because 語 sounds like 吾 — "five" and "mouth" explain nothing.
- **Component containment is a property of a character, not a global tree.**
  十 encloses 二 in 半 伴 判, while 二 encloses 十 in 井 囲. 厂 > 戈 > 弋 > 厂 is a
  real chain of real edges. Eight such cycles exist in the taught set. There is
  no single decomposition hierarchy, and the app must not draw one.
- **Some shapes have no meaning at all.** 丿 recurs in 226 of the 1000 taught
  kanji and is Kangxi radical 4, whose dictionary gloss is literally "katakana
  no". It is a stroke. Its record says so.

---

## Derivation

Nothing in the decomposition is transcribed by hand. KanjiVG already encodes it
as nested `<g>` elements, one per component, and the build script reads **4,596
component groups** across the 1000 taught kanji.

### KanjiVG's `kvg:*` attributes, and what each is used for

| Attribute | Meaning | Used for |
|---|---|---|
| `kvg:element` | the component glyph this group draws, e.g. `氵` | the component inventory, `appearsIn` |
| `kvg:original` | the unvaried form of a variant shape: `氵` → `水` | `variants[]`, and folding unrenderable shapes |
| `kvg:radical` | `general` \| `tradit` \| `nelson` \| `jis` — which radical scheme indexes the host character under this group | only `general` feeds `kangxiNumber`, because that is the scheme KANJIDIC2's `rad_type="classical"` corresponds to. `tradit`/`nelson` counts are kept in the diagnostics |
| `kvg:phon` | **the component is present for its sound** | sets `meaningIsUnreliable` directly — this is the signal the task asks for |
| `kvg:position` | `left`/`right`/`top`/`bottom`/`kamae`/`tare`/`nyo`… | diagnostics only; layout is not part of a `KanjiComponent` |
| `kvg:part` | a shape drawn in several non-contiguous groups (甲 in 単 is part 1 + part 2) | counted once per host kanji; see *ancestry* below |
| `kvg:partial` | the group draws only a piece of the named element | excluded from stroke-count derivation |
| `kvg:variant` | this group draws a variant shape of the named element | diagnostics |

### Sources

| Source | Version / date | Licence | Role |
|---|---|---|---|
| [KanjiVG](http://kanjivg.tagaini.net) | r20250816 | CC BY-SA 3.0 | the decomposition, variant relations, phonetic marking, and stroke counts for shapes KANJIDIC2 does not list |
| [KANJIDIC2](http://www.edrdg.org/wiki/index.php/KANJIDIC_Project) | db 2026-271, created 2026-09-28 | CC BY-SA 4.0 | glosses, stroke counts, classical radical numbers, radical self-declaration |
| [UCD `CJKRadicals.txt`](https://www.unicode.org/Public/18.0.0/ucd/CJKRadicals.txt) | Unicode 18.0.0 (2026-02-03) | Unicode-3.0 | authoritative Kangxi radical number → radical character → unified ideograph |
| [UCD `EquivalentUnifiedIdeograph.txt`](https://www.unicode.org/Public/18.0.0/ucd/EquivalentUnifiedIdeograph.txt) | Unicode 18.0.0 (2026-02-03) | Unicode-3.0 | CJK Radicals Supplement shapes (⻌ ⻏ ⻖ ⺕ ⺌ ⺍ ⺤ ⺨) → equivalent unified ideograph, plus the official radical *names* |
| `data/kanji-top1000.json` | — | derived (CC BY-SA 4.0) | the taught kanji set and each one's classical radical number |
| `data/component-notes.json` | — | hand-authored | curriculum judgement: gloss and stroke-count overrides, forced unreliability flags |

Every upstream file's URL, SHA-256, byte size and fetch timestamp is recorded in
`data/sources/SOURCES.lock.json`; `node scripts/assets/fetch-sources.mjs --verify`
re-checks them offline.

**Derived licence: CC BY-SA 4.0.** The inventory adapts KanjiVG (CC BY-SA 3.0)
and the glosses adapt KANJIDIC2 (CC BY-SA 4.0); both are share-alike, so
`data/components.json` is too. The Unicode files are permissive and add no
share-alike obligation. Full attribution strings are in
`data/components.provenance.json` → `derivedLicense.requiredAttribution`.

---

## Inclusion threshold

KanjiVG shows **583 distinct shapes** inside the 1000 taught kanji. 254 of them
occur in exactly one character. Keeping all of them would produce a table of
one-off shapes that teaches nothing, so a shape earns a record only when it is
**renderable in every shipped typeface** *and* meets at least one threshold:

| Constant | Value | Rule |
|---|---|---|
| `RECUR_MIN` | 4 | recurs in at least 4 taught kanji |
| `RADICAL_MIN` | 1 | is KanjiVG's `kvg:radical="general"` for at least 1 taught kanji |
| `STANDALONE_MIN` | 2 | is itself one of the 1000 taught kanji **and** a part of at least 2 others |
| `KEEP_VARIANT_PARENTS` | on | is the `kvg:original` parent of a kept variant shape (variant closure) |

`RADICAL_MIN` is deliberately **1**, not a recurrence threshold: the app offers
radical lookup and `KanjiCharacter.radical` is a `ComponentId`, so every
dictionary radical of a taught kanji must resolve to a record. The build fails if
one does not.

*Variant closure* keeps the unvaried parent of any kept variant — 艹 pulls in 艸,
⻖ pulls in 阜, 氵 already had 水. The parent is what carries the sense, so
teaching the variant without it would strand the explanation. 18 records exist
for this reason alone (18); 13 of those have an empty `appearsIn`, because the shape
never occurs in its unvaried form in the taught set. That is honest rather than
broken: you meet 艸 *as* 艹, and `variants` says so.

### The result

| | |
|---|---|
| Distinct shapes in KanjiVG across the taught set | 583 |
| After folding unrenderable variants and variant closure | 594 |
| **Kept** | **263** |
| Rejected below every threshold | 277 |
| Dropped because no shipped typeface can draw them (incl. 2 KanjiVG placeholder labels) | 54 |
| Taught kanji with at least one kept component | 951 / 1000 |
| Median kept components per kanji | 4 |

Rejected shapes are listed **in full** in
`data/components.provenance.json` → `rejectedBelowThreshold`, by code point. 213
of the 277 occur in exactly one taught kanji; 50 in two. The 14 that occur in
three are 幺 戍 壬 冊 亦 兌 僉 尺 ⺦ 冓 才 奇 尹 昔.

> They are named by code point in the JSON on purpose:
> `scripts/assets/build-fonts.mjs` deep-scans `data/*.json` for ideographs and
> would otherwise bundle all 277 rejected glyphs into the shipped webfont subset —
> about 90 KB of glyphs the app never draws. Markdown is not scanned, which is why
> the readable forms are here.

---

## Roles: radical vs. recurring vs. standalone

`roles` is a **list**, and the overlap is the point — a shape can index the
dictionary, be a character in its own right, and recur as a part, all at once.
Collapsing the three would lose exactly the distinction a learner needs.

| Role | Definition (all sourced, none guessed) | Count |
|---|---|---|
| `radical` | `kangxiNumber` is not null: a Kangxi/classical dictionary radical, or a recognised variant shape of one | 176 |
| `standalone` | the glyph is a kanji in its own right: one of the 1000 taught kanji, or KANJIDIC2 gives it a `<grade>` (jōyō/jinmeiyō) or a `<freq>` rank | 188 |
| `recurring` | it demonstrably recurs — appears in ≥ 2 taught kanji | 238 |

246 of 263 records hold more than one role. The combinations:

| Roles | Count | Example |
|---|---|---|
| radical + standalone + recurring | 93 | 月 — radical 74, a kanji, and a part of 40 others |
| standalone + recurring | 80 | 各 — a kanji and a recurring part, but never the radical |
| radical + recurring | 60 | 氵 — radical 85 and a part of 40 kanji, but not a kanji itself |
| radical + standalone | 13 | 阜 — radical 170 and a kanji, but only ever met as ⻖ |
| radical | 10 | 辶 — a radical shape only |
| recurring | 5 | マ — a shape KanjiVG names after a katakana; neither radical nor kanji |
| standalone | 2 | |

Deliberately, `standalone` is **not** "is in the taught 1000". 氵 亻 艹 扌 are
KANJIDIC2 literals but have neither a grade nor a frequency rank, so they are not
claimed to be kanji in their own right.

### `kangxiNumber`: four independent routes

A component needs one route; where two disagreed, the Unicode tables win and the
disagreement is recorded.

| Route | Produced a number for |
|---|---|
| `CJKRadicals.txt`: this glyph is a radical's canonical form | 148 |
| `EquivalentUnifiedIdeograph.txt`: a radical-block character equivalent to this glyph | 154 |
| KANJIDIC2 self-declaration (its own gloss states "… radical (no. N)" matching its own `rad_value`) | 82 |
| KanjiVG `kvg:radical="general"` × the host kanji's KANJIDIC2 classical radical (majority ≥ 60 %) | 129 |

**87 records have `kangxiNumber: null`** and therefore no `radical` role. That is
the honest answer for 甲 幵 三 千 中 丁 — recurring shapes that no scheme indexes a
character under.

**One recorded conflict:** ⺌. Unicode says radical 42 (小); the KanjiVG vote says
58, from a single character whose KANJIDIC2 classical radical is 彐. Unicode wins;
the full tally is in `kangxiNumberRoutes.conflicts`.

---

## Glosses

Sourced, in this order, and the source is recorded per record in
`diagnosticsPerComponent[].glossSource`:

1. `data/component-notes.json` — hand-authored override (29 components)
2. the glyph's own KANJIDIC2 `<meaning>`s
3. the **Unicode radical name** — `KANGXI RADICAL GRAIN` → `grain`. Authoritative,
   terse, and better than KANJIDIC2's entry for a radical-only code point, which
   is sometimes a shape description (`two-branch tree` for 禾) or the sense of a
   rare standalone word
4. KANJIDIC2 for the Unicode-equivalent ideograph (this is how ⻌ ⻏ ⻖ ⺤ ⺨ get a
   gloss at all)
5. KANJIDIC2 for the `kvg:original` parent form

A shape that is *only* ever a radical leads with its Unicode radical name; a glyph
that is also a kanji leads with its own word meanings. Glosses are capped at 3.

Mechanical cleanup strips KANJIDIC2's catalogue bookkeeping, which is metadata
rather than meaning: trailing `(no. 85)` (including the unbalanced
`clothing radical (no. 145` upstream actually ships), `radical - 2 stroke form`,
`or katakana to`, fragments like `variant of`, and any gloss that merely extends
another with a nickname (`table` / `table enclosure` → `table`). Glosses that pack
alternative radical nicknames behind "or" are dropped while something else
survives. All of this is in `cleanGloss`/`fromKanjidic` in the build script.

### `meaningIsUnreliable`

Set true — and the reasons are recorded per record — when **any** of:

- KanjiVG marks the shape phonetic (`kvg:phon`) in any taught kanji
- no gloss helps
- more than two glosses: several senses, not one meaning
- the shape is indexed under more than one classical radical (月 → 74 and 130)
- it is a single stroke: structural, not semantic
- it appears in more than one shape (`variants` is non-empty)
- the gloss is borrowed from a related form rather than recorded for this shape
- **it appears in ≥ 4 taught kanji where it is not the dictionary radical** — a
  shape doing that much structural work is not explained by its dictionary gloss,
  whatever the gloss says
- `data/component-notes.json` forces it, with a reason

The default leans true, as required. 249 / 263.

---

## Variants

`variants[]` holds real shape variants: 水/氵, 人/亻, 心/忄, 火/灬, 手/扌, 刀/刂,
邑/⻏, 阜/⻖, 艸/艹, 网/罒, 老/耂, 爪/⺤, 犬/⺨, 彑/⺕, 辶/⻌, 襾/覀, 肉/月, 日/曰,
攴/攵 … **62 links across 61 records**, every one of them a `kvg:original` relation
KanjiVG itself asserts.

Three rules keep it honest:

1. **Attestation.** A link needs `VARIANT_MIN_KANJI = 2` **distinct** taught kanji,
   in either direction. Counting group occurrences instead of characters would
   have admitted 匚/工, which comes entirely from the three `kvg:part` groups of a
   single character, 巨. 7 rejected links are listed in the provenance.
2. **No transitive closure.** 日/曰 and 日/臼 must not imply 曰/臼. Links are
   direct assertions only.
3. **No kana, at either end.** KanjiVG gives つ as the `kvg:original` of ⺍ and マ
   as the `kvg:original` of 卩; a kana is not a shape variant of a kanji component.
   The rule is applied symmetrically — an earlier version filtered only the target
   and left 卩/マ asymmetric, which the contract test in
   `tests/unit/components-dataset.test.ts` caught.

`variants` is a list of **glyphs**, not ids, so a variant need not have its own
record — though after variant closure, all but a handful do.

---

## Stroke counts

KANJIDIC2 wins where the glyph is a literal; otherwise the count comes from the
number of `<path>` elements in the KanjiVG group, summed across `kvg:part` groups
and excluding `kvg:partial` ones, taking the mode across the taught kanji. Both
numbers are kept per record and cross-checked: **237 compared, 5 disagreements**,
all recorded in `verification.strokeCountCrossCheck`.

Two are hand-overridden in `data/component-notes.json`, because KANJIDIC2's
figure is for the standalone code point and not the strokes the learner draws:

| Component | KANJIDIC2 | KanjiVG | Kept | Why |
|---|---|---|---|---|
| 艹 | 6 | 3 (in all 27 taught kanji) | **3** | KANJIDIC2 treats U+8279 as the old 艸-derived form. Nobody writes 花 with a six-stroke top |
| 覀 | 7 | 6 (in all 4 taught kanji) | **6** | KanjiVG draws 6 in 要 票 標 |

The other three (甲 5 vs 6, 毋 4 vs 3, 舛 6 vs 7) keep KANJIDIC2: the KanjiVG
count there comes from a single character's partial or interleaved groups.

---

## Teaching order — provisional, and how to finalise it

A component must be introduced **strictly before the first kanji that needs it**,
and the kanji teaching order is owned by the curriculum build, not by this script.
So `data/components.json` ships a **provisional** order, and the interleaver is
exported for the kanji-order task to call.

Provisional basis: frequency rank of the first taught kanji needing the component,
then stroke count, then breadth of reuse, then code point.
`lessonId` is `comp-provisional-NN` (33 batches of 8) and is **superseded**.

### The contract

```js
import { buildComponentModel, assignTeachingOrder, COMPONENT_CONTRACT }
  from './scripts/content/build-components.mjs';   // COMPONENT_CONTRACT.version === 1

const model = buildComponentModel();               // pure derivation
const plan  = assignTeachingOrder(model, {
  kanjiOrder: ['一', '人', '十', …],               // kanji glyphs in teaching order
  lessonIdForKanji: (glyph, position) => 'kanji-lesson-003',   // optional
});

plan.components        // KanjiComponent[] with final teachingOrder + lessonId
plan.sequence          // interleaved ['comp:丿', 'kanji:九', …] — the curriculum spine
plan.unusedComponents  // kept components no kanji in kanjiOrder needs
plan.provisional       // false once kanjiOrder is supplied
```

`assignTeachingOrder` guarantees every component appears in `sequence` before
every kanji in its `appearsIn`. Verified: with a stroke-complexity kanji order all
263 components place with **0 order violations** and 0 left unscheduled.

A component kept only by variant closure has no first-needed position, so it
inherits its variant's and sorts immediately after it — 艹 then 艸, ⻖ then 阜.

`model.decomposition` is the other half of the contract:
`Map<kanjiGlyph, { all, direct, ordered, radical, radicalRaw, phonetic, phoneticAll }>`.
`ordered` is the kept components in KanjiVG writing order and is what
`KanjiCharacter.components` should be populated from, so the two datasets cannot
drift. `phoneticAll` includes phonetic shapes below the teaching threshold —
529 taught kanji have one, but only 264 of those phonetic shapes are themselves
taught, and "this half is here for its sound" is worth saying either way.

---

## Verification

`node scripts/content/build-components.mjs` exits non-zero on any problem. The
current run: **0 problems, 0 advisories.**

1. **Font coverage.** Every component glyph — and every glyph in `variants[]` —
   lies inside the code-point ranges `scripts/assets/build-fonts.mjs` subsets and
   is present in the cmap of all three shipped faces (Noto Sans JP, Noto Serif JP,
   Klee One). The script reads the TrueType `cmap` tables directly, with its own
   minimal format-4/format-12 reader, and separately checks `public/fonts/index.json`
   so the claim is about the **shipped subset**, not merely the source typeface:
   **0 glyphs and 0 components missing.**
2. **Referential integrity.** All `appearsIn` ids resolve to entries in
   `data/kanji-top1000.json`; none duplicated; empty only for the 13
   variant-closure-only records, which is asserted rather than tolerated.
3. **No component is its own ancestor.** Enforced where it means something —
   inside a single character's decomposition. **0 violations.**
4. **Schema.** `id` matches `glyph` and `ID_PATTERN`; `roles` non-empty and from
   the allowed set; `roles`/`kangxiNumber` agree; `kangxiNumber` in 1–214;
   `strokeCount ≥ 1`; `teachingOrder` dense and unique over 1..263; non-empty
   `lessonId`; no self-variant; no gloss-less record claiming a reliable meaning.
5. Every component named by a per-kanji decomposition is a kept component.
6. Every taught kanji's dictionary radical resolves to a component record.
7. Stroke counts cross-checked between KANJIDIC2 and KanjiVG.
8. No CJK glyph reaches either output file that the shipped faces cannot draw —
   which also stops the font build being poisoned by a diagnostic string.

### `kvg:part` is stroke interleaving, not containment

In 樹 the chain is 壴 > 吉(part 1) > 士 > 豆(part 1) > 豆(part 2) > 吉(part 2),
because the strokes of 吉 and 豆 alternate. 吉 is not inside itself. 9 such
nestings exist (単, 巨, 構, 講, 購, 戦, 弾, 樹); `kvg:part` groups are exempt from
the ancestry check and from the containment relation, and the exemptions are
listed in `verification.samePartNestingIgnored`.

---

## Known gaps — stated, not hidden

**5 shapes that met a threshold are not taught, because no shipped typeface can
draw them.** Every one is a real recurring component; this is a coverage gap, not
a claim the shapes do not exist:

| Shape | Code point | Recurs in | Absent from |
|---|---|---|---|
| 𠂉 | U+20089 | 34 taught kanji (年 毎 気 先 知 …) | Klee One; also outside the ranges `build-fonts.mjs` subsets (Plane 2) |
| 䒑 | U+4491 | 14 | Klee One |
| 龶 | U+9FB6 | 14 | all three faces |
| 龰 | U+9FB0 | 11 | all three faces |
| 畐 | U+7550 | 4 | Klee One |

Klee One is the kyōkasho face whose letterforms the app teaches, so a glyph it
lacks cannot be shown in the form being taught. Fixing 𠂉 in particular would mean
either a fourth face or drawing components from stroke data instead of text —
neither is in this dataset's scope.

**6 shapes are folded into their `kvg:original`** rather than lost, because
KanjiVG names a renderable parent: U+2008A → 勹 (18 kanji), U+6C3A (氺) → 水 (10),
U+5F00 (开) → 幵 (5), U+3452 → 僉 (3), U+620B → 戔 (1), U+26951 → 臼 (1). Folded
shapes are named by code point in the provenance so the font build does not pick
them up.

**2 KanjiVG placeholder labels** (`CDP-8BC4`, `CDP-8CB8`) name shapes no code
point encodes. They are excluded up front and reported.

**49 taught kanji have no kept component**, being single indivisible shapes or
built only from rejected one-offs.

**Other limits.** `kvg:position` is derived but not carried on a record — the
schema has no field for it, and it is per-occurrence, not per-component. Nanori
and reading-level questions are out of scope here; readings belong to
`KanjiReading`, and per the curriculum rule are taught through words, never
attached to a component. The `general`/`tradit`/`nelson` radical schemes disagree
for many characters; only `general` feeds `kangxiNumber`, and the other two are
diagnostics.
