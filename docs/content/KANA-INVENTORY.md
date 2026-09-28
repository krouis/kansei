# Kana inventory

What Kansei's kana curriculum actually contains, counted from the files rather than
claimed. Every number below is reproducible with `node scripts/content/build-kana.mjs`,
which prints the same breakdown and refuses to write output that fails its assertions.

| File | Contents |
| --- | --- |
| `data/kana.json` | 268 `KanaCharacter` records (compact JSON, 104 KB) |
| `data/kana-lessons.json` | 67 `Lesson` records |
| `data/kana.provenance.json` | provenance for both files |
| `scripts/content/build-kana.mjs` | the hand-authored source of truth **and** the derivation |

## What "all the modern basic characters" means here

The claim Kansei makes is precise, and it is the reason `CurriculumTier` and
`KanaGroup` exist as separate fields:

> **46 basic hiragana and 46 basic katakana** — the modern gojūon set: the five
> vowels, the nine consonant rows k/s/t/n/h/m/y/r/w, and ん. The y row has three
> cells (や ゆ よ), the w row has two (わ を), and ん closes the table, which is
> how 5 + 5×5 + 3 + 2 + 1 = 46.

That count deliberately does **not** include:

- voiced (dakuten) or plosive (handakuten) forms — が, ぱ are the *same* 46 shapes
  with a mark added, counted separately as 20 + 5 per script;
- contracted (yōon) combinations — きゃ is two kana, counted separately (33 per script);
- the small kana っ ゃ ゅ ょ ぁぃぅぇぉ or the katakana long-vowel mark ー;
- extended katakana for loanwords (ファ, ティ, ヴォ …);
- the historical kana ゐ ゑ ヰ ヱ, which are **not** on the beginner path.

Anything that folds those into "46" is counting something else. The app's
beginner path is `tier: 'modern-core'` only, and that is 211 of the 268 records.

## Counts by script, group and tier

| script | group | tier | count |
| --- | --- | --- | --- |
| hiragana | basic | modern-core | 46 |
| hiragana | dakuten | modern-core | 20 |
| hiragana | handakuten | modern-core | 5 |
| hiragana | yoon | modern-core | 33 |
| hiragana | yoon | extended | 3 |
| hiragana | special | modern-core | 1 |
| hiragana | special | extended | 8 |
| hiragana | historical | historical | 2 |
| **hiragana total** | | | **118** |
| katakana | basic | modern-core | 46 |
| katakana | dakuten | modern-core | 20 |
| katakana | handakuten | modern-core | 5 |
| katakana | yoon | modern-core | 33 |
| katakana | yoon | extended | 3 |
| katakana | special | modern-core | 2 |
| katakana | special | extended | 8 |
| katakana | extended | extended | 31 |
| katakana | historical | historical | 2 |
| **katakana total** | | | **150** |
| **all** | | | **268** |

### Tier split

| tier | count | on the beginner path? |
| --- | --- | --- |
| `modern-core` | 211 | yes |
| `extended` | 53 | no — available in the Character Explorer, never required |
| `historical` | 4 | no — recognition only, flagged as retired from ordinary use |

### What each group holds, exactly

- **basic (46 + 46).** あ–ん and ア–ン. Verified against a separately typed
  canonical gojūon string, not against the builder's own table.
- **dakuten (20 + 20).** が ぎ ぐ げ ご / ざ じ ず ぜ ぞ / だ ぢ づ で ど / ば び ぶ べ ぼ.
- **handakuten (5 + 5).** ぱ ぴ ぷ ぺ ぽ.
- **yoon (33 + 33 modern-core, 3 + 3 extended).** The 33 are きゃ-series ×11:
  k, s, t, n, h, m, r, g, j, b, p. The extended 3 are ぢゃ ぢゅ ぢょ / ヂャ ヂュ ヂョ,
  which are real but practically never the correct spelling; their notes say so.
- **special, hiragana (1 modern-core + 8 extended).** っ is modern-core. The small
  vowels ぁ ぃ ぅ ぇ ぉ and small ゃ ゅ ょ are `extended`, because a beginner meets
  them only *inside* another form.
- **special, katakana (2 modern-core + 8 extended).** ッ and ー are modern-core;
  ャ ュ ョ and ァ ィ ゥ ェ ォ are `extended`, same reasoning.
- **extended katakana (31).** ファ フィ フェ フォ · ティ ディ · トゥ ドゥ ·
  ウィ ウェ ウォ · ヴ ヴァ ヴィ ヴェ ヴォ · シェ ジェ チェ · ツァ ツィ ツェ ツォ ·
  クァ クヮ グァ · キェ ニェ ヒェ ミェ リェ.
  Five of these (キェ ニェ ヒェ ミェ リェ) are genuinely marginal, and their notes
  say that plainly instead of inventing a familiar-looking example: only キェ has
  a spelling worth quoting (キェルケゴール). The rest carry a real loanword —
  ファイル, フィルム, カフェ, フォーク, パーティー, ディズニー, タトゥー, ヒンドゥー,
  ウィスキー, ウェブ, ウォーター, ヴァイオリン, シェフ, ジェット, チェック,
  モーツァルト, ライプツィヒ, ツェッペリン, カンツォーネ, クァルテット, グァテマラ.
- **historical (2 + 2).** ゐ ゑ ヰ ヱ, all `tier: 'historical'`.

### Deliberately excluded

Recorded so the gap is visible rather than accidental:

- `ゎ ヮ` (small wa), `ゕ ゖ ヵ ヶ` (small ka/ke), `ゝ ゞ ヽ ヾ` (iteration marks),
  `ヷ ヸ ヹ ヺ` (ワ-row with dakuten), `ゔ` (hiragana vu). The small ヮ is *used* by
  クヮ, which derives from ク + ワ and explains ヮ in its note; the rest have no
  place in a beginner curriculum.
- Half-width katakana. Handled as an input-normalisation concern in
  `src/domain/normalization.ts`, not as separate characters.
- Vertical-writing forms of ー and small kana. Mentioned in ー's note; not modelled.

## Teaching order and lessons

`teachingOrder` is one dense, unique sequence 1…268 over every record in the file,
and it follows the lesson order exactly. The order is:

1. **Hiragana** (1–116): vowels; k, s, t, n, h, m, y, r, w rows (ん closes the w row,
   as it does in the gojūon table); the small kana っ ゃ ゅ ょ then ぁぃぅぇぉ;
   the voiced rows g, z, d, b and then p; the yōon sets in row order, ぢゃ last.
2. **Katakana** (117–264): the same sequence, with ー added to the small-kana
   lesson, followed by the eight extended-katakana lessons (234–264).
3. **Historical** (265–268): ゐ ゑ ヰ ヱ, one mixed-script lesson at the very end.
   They have a teaching order because the field is non-optional and the sequence
   must stay dense; their `tier: 'historical'` is what keeps them off the path.

67 lessons, each introducing 3–5 characters: 29 hiragana, 37 katakana, 1 mixed.
52 lessons are pure `modern-core`; the other 15 introduce `extended` or
`historical` material and are skippable without leaving a gap in the core path.
`prerequisites` are semantic, not a single chain — a yōon lesson requires its base
row *and* the small-kana lesson, each katakana row requires the matching hiragana
row, extended lessons require the small vowels. No lesson requires a later lesson.

## Field-by-field policy

| field | policy |
| --- | --- |
| `romaji` | Modified Hepburn, the form the app displays: し = shi, ちゃ = cha, じゃ = ja, ぢ = ji, づ = zu. The three records with no syllable value carry an explicit placeholder rather than a misleading syllable: っ/ッ → `(sokuon)`, ー → `(long vowel)`. |
| `inputVariants` | 441 spellings across 268 records, all lowercase. Hepburn, Kunrei (si, ti, tu, hu, zi) and IME keystrokes (sya, tya, jya, zya, xtu/ltu, xya, thi, dhi, twu, dwu, n/nn/n'/xn). を also accepts `o` and ん also accepts `m`, because that is how they are pronounced and traditionally romanised. |
| `position` | Set for `basic`, `dakuten`, `handakuten`. `null` for yōon, special, extended, historical — and for ん, which has no column in the table. |
| `derivesFrom` | が → か; ぱ → は; きゃ → き + や (the full-size や, per the id grammar); ゃ → や; っ → つ; ファ → フ + ア; ヴァ → ヴ + ア; ヴ → ウ. Empty for the basic 46 and for the historical kana. |
| `confusableWith` | 105 symmetric pairs over 136 records (both directions are stored). Four kinds, all real learner errors: shape (ね/れ/わ, は/ほ, る/ろ, さ/き, い/り, め/ぬ, あ/お, シ/ツ, ソ/ン, ク/ワ/ケ, ス/ヌ, ナ/メ, マ/ム, チ/テ, コ/ユ, ハ/ヘ, ラ/ウ …); mark (ば/ぱ …); size (つ/っ, や/ゃ, ア/ァ …); and same-sound spelling choices (じ/ぢ, ず/づ, ウォ/ヲ, ヴァ/バ, ティ/チ). Eight cross-script pairs where the two scripts nearly coincide: へ/ヘ, り/リ, か/カ, せ/セ, も/モ, や/ヤ, い/イ, う/ウ. |
| `strokeCount` | **The only field not authored here.** Counted from KanjiVG — see provenance below. |
| `printVsHandwritten` | Set on exactly 8 records, and only where the forms genuinely differ: き さ ふ り そ (hiragana) and シ ソ ツ (katakana, where print cannot show the stroke direction that distinguishes them). `null` on the other 260. Derived forms do not repeat their base's warning — a consumer resolves it through `derivesFrom` (ぎ → き). |
| `note` | 98 records carry a teaching note; the rest are `null` rather than padded. Mandatory coverage is asserted by the verifier: は as topic particle "wa", へ as direction "e", を as object "o"; っ as consonant length with きって; ん as [m] before b/p/m with しんぶん plus the IME `nn`; おう vs おお with とうきょう and おおきい; じ/ぢ and ず/づ with つづく and ちぢむ; ー contrasted with hiragana vowel doubling. |

## Provenance

### Authored content (everything except `strokeCount`)

Coverage, romanisation, input variants, gojūon positions, derivations, confusion
pairs, print-vs-handwritten warnings, teaching notes, teaching order and the
lesson plan are **hand-authored curriculum judgement**. They are not derivable
from a dictionary and are not claimed to come from one.

- Source of truth: the tables at the top of `scripts/content/build-kana.mjs`,
  committed and labelled as such. `data/kana.json` and `data/kana-lessons.json`
  are generated from them and should never be edited by hand.
- Author: Kansei curriculum author. Licence: AGPL-3.0-or-later, as the repository.
- Reference works consulted for the standard inventory, the 1946 spelling reform,
  and the extended-katakana conventions: the Japanese Cabinet notifications on
  modern kana usage (現代仮名遣い) and on loanword spelling (外来語の表記), which
  are the authority for which extended forms are conventional. No text from any
  source is reproduced in the data.

### `strokeCount`

| | |
| --- | --- |
| Source | KanjiVG |
| Version | r20250816 |
| URL | https://github.com/KanjiVG/kanjivg/releases/tag/r20250816 |
| Fetched | recorded in `data/sources/SOURCES.lock.json` (SHA-256 + size) |
| Licence | CC-BY-SA-3.0 — https://creativecommons.org/licenses/by-sa/3.0/ |
| Redistribution | Attribution to Ulrich Apel and the KanjiVG project; derivative works share-alike. Only integer stroke **counts** are taken; no KanjiVG path data is copied into `data/kana.json`. |

Method: `strokeCount` = the number of `<path>` elements in
`data/sources/kanjivg/kanji/<codepoint>.svg`, summed over the code points of a
multi-kana glyph (きゃ = き 4 + ゃ 3 = 7; ファ = フ 1 + ァ 2 = 3). Voiced kana are
single code points in KanjiVG, which draws the dakuten as 2 strokes and the
handakuten as 1 — the conventional Japanese counting (が = 5, ぱ = 4).

Two counts worth flagging, because charts differ:

- **そ** is 1 stroke in KanjiVG. The two-stroke handwritten form is equally
  correct and is described in that record's `printVsHandwritten`.
- **ゐ = 1 and ゑ = 1** per KanjiVG. Some stroke-order charts give 2 for these
  historical kana. Kansei reports its source rather than splitting the difference;
  both are `tier: 'historical'` and are never drilled.

### Reproduce

```sh
node scripts/assets/fetch-sources.mjs
unzip -q -o data/sources/kanjivg-20250816-main.zip -d data/sources/kanjivg
node scripts/content/build-kana.mjs
```

Output is a pure function of (the authored tables + the KanjiVG release), so a
re-run on the same inputs produces byte-identical files. `data/sources/` is
gitignored; `data/sources/SOURCES.lock.json` is committed so the download is
verifiable.

## Verification

`build-kana.mjs` asserts all of the following before writing, and exits non-zero
on any failure. A separate throwaway check re-verified the **emitted** files
against the real `ID_PATTERN` read out of `src/domain/ids.ts` and against
canonical kana strings typed independently of the builder's tables. 32 assertions,
0 failures:

- exactly 46 basic hiragana and exactly 46 basic katakana, and the two sets equal
  the canonical あ–ん / ア–ン strings;
- 20 dakuten, 5 handakuten and 33 modern-core yōon per script, with the hiragana
  dakuten/handakuten/yōon sets equal to independently typed canonical strings;
- every id unique, and every id matching `ID_PATTERN`;
- every `derivesFrom` and `confusableWith` id resolving to a record in the file,
  no self-reference, and every confusion pair symmetric;
- every glyph NFC-normalised, and no glyph repeated within a script;
- every hiragana record having the matching katakana record, with the glyph equal
  to the hiragana glyph shifted by the U+0060 Unicode offset and the same romaji;
- `teachingOrder` dense and unique over 1…268, and equal to the order the lessons
  introduce records in;
- every record's `lessonId` resolving, every lesson introducing 3–5 characters,
  lessons covering every record exactly once, `order` dense, every prerequisite
  resolving and no lesson requiring a later one;
- `position` present for basic/dakuten/handakuten (except ん) and absent elsewhere;
- input variants non-empty and lowercase, with the Kunrei/IME forms si, ti, tu,
  hu, zi, nn, sya, jya, tya present where they belong;
- Hepburn spellings shi / chi / tsu / fu / sha / ja / cha correct;
- the mandatory teaching notes present (は wa, へ e, を o, きって, しんぶん, `nn`,
  とうきょう, おおきい, つづく, ちぢむ, コーヒー);
- `printVsHandwritten` set on exactly き さ そ ふ り シ ソ ツ and nowhere else;
- stroke counts matching hand-asserted chart values on 15 spot checks;
- every record matching the `KanaCharacter` field list and literal unions parsed
  out of `src/domain/content.ts`, with no extra fields, and every lesson matching
  `Lesson`.

### Known limits

- `strokeCount` is KanjiVG's decomposition. Where a chart disagrees (そ, ゐ, ゑ)
  this file says so above rather than silently choosing.
- The marginal extended forms キェ ニェ ヒェ ミェ リェ carry no attested example
  word, and their notes state that instead of inventing one.
- `pitchAccent`-style phonetic detail, audio and stroke *paths* are not part of
  this inventory; see `docs/content/AUDIO.md` and `docs/content/STROKES.md`.
