# Audio

Kansei plays **real human recordings only**.

There is no browser `SpeechSynthesis` call anywhere in the app, no server-side
text-to-speech, no neural voice, and no placeholder or silent clip presented as
a recording. When a recording for an item does not exist, the item's
`AudioRef` is `null` and **the listening exercise for that item is not
generated at all**. Missing audio removes a question type; it never triggers a
substitute voice.

That rule is why this document is mostly a list of gaps. The gaps are the
honest result of what is actually available under a licence that lets us
redistribute it offline, not a to-do list we quietly papered over.

- Fetcher: `scripts/assets/fetch-audio.mjs` (`npm run audio:fetch`)
- Output: `public/content/audio/` — clips, `index.json`, `ATTRIBUTION.md`
- Provenance record: `data/audio-provenance.json`
- Survey and fetch date: **2026-09-28 / 2026-09-29**
- Built: **436 files, 36,948,012 bytes**, 507 clip keys

---

## 1. Measured coverage

### 1.1 Kana syllable sounds — 71 of 104

The modern kana inventory Kansei teaches is **104 syllable sounds**: 46 basic,
25 dakuten/handakuten (が ざ だ ば ぱ rows), and 33 yōon (きゃ しゅ ちょ …).

| Group | Sounds | With audio | Without |
|---|---:|---:|---:|
| basic (46, incl. ん) | 46 | **46** | 0 |
| dakuten (が ざ だ ば rows) | 20 | **20** | 0 |
| handakuten (ぱ row) | 5 | **5** | 0 |
| yōon (きゃ きゅ きょ …) | 33 | **0** | **33** |
| **total** | **104** | **71** | **33** |

**Every one of the 33 yōon sounds has NO audio**: `kya kyu kyo sha shu sho cha
chu cho nya nyu nyo hya hyu hyo mya myu myo rya ryu ryo gya gyu gyo ja ju jo
bya byu byo pya pyu pyo`.

One yōon recording does exist on Commons — `File:Ja-Ryu.oga` (りゅ), public
domain — but it is **excluded** because its uploader
(`Spacecat2~commonswiki`) has no user page anywhere and therefore no
documentation that they speak Japanese natively. See §3. With
`--allow-undocumented-speaker` the count becomes 72/104; the default build is
71/104.

Commons was searched exhaustively for yōon before concluding they do not exist:

- `File:Japanese <romaji>.ogg` and `.oga`
- `File:Ja-<Romaji>.oga` and `.ogg`
- both Hepburn and Kunrei spellings (`sha`/`sya`, `cha`/`tya`, `ja`/`zya`/`jya`)
- `intitle:きゃ filetype:audio` and the equivalent for しゃ ちゃ りゃ ぎゃ じゃ びゃ ぴゃ にゃ ひゃ みゃ

That is 932 candidate titles plus 11 in-title searches. Only `Ja-Ryu.oga`
matched. The probe list is kept in `PROBED_NAME_PATTERNS` in the fetcher so the
claim stays falsifiable.

**One recording serves both scripts.** あ and ア are the same sound, so the same
file is indexed under both `kana/hi/a` and `kana/ka/a`. This is a property of
the language, not a shortcut: there is no separate "katakana pronunciation".
The app should not imply the learner is hearing a katakana-specific recording.

**Homophones.** を is indexed at `kana/hi/wo` but is pronounced identically to
お; ぢ/づ (`di`/`du`) are identical to じ/ず. An audio-prompt question over any
of these cannot have one correct spelling — `audioIsAmbiguous()` in
`src/domain/romanization.ts` is the gate for that, and it applies regardless of
which clip is playing.

### 1.2 Words — 365 clips, 358 distinct words

All from Lingua Libre, by three speakers who declare Japanese as a **native**
language on Lingua Libre. (365 clips but 358 words: seven words were recorded by
two of the three speakers. The second clip stays addressable at
`vocab/<word>#<speaker>`.)

| Speaker | Lingua Libre item | Clips | Bytes | Licences |
|---|---|---:|---:|---|
| 葵心 | Q1392056 | 219 | 20,299,428 | 219 CC0-1.0 |
| Zsrtrgh | Q1564396 | 132 | 13,160,944 | 96 CC BY-SA 4.0, 36 CC0-1.0 |
| Higa4 | Q287558 | 14 | 1,373,776 | 13 CC0-1.0, 1 CC BY-SA 4.0 |
| **total** | | **365** | **34,834,148** | **268 CC0-1.0, 97 CC BY-SA 4.0** |

Licences are read per file from `extmetadata.License`, never assumed from the
source's usual practice.

Coverage against Kansei's own beginner vocabulary list is **not yet known** —
that list is built by a separate task. The audio pack is keyed by the Japanese
spelling as it appears in the Lingua Libre filename (`vocab/ねこ`,
`vocab/学生`), and `scripts/content/build-content.mjs` must join on
`VocabEntry.spelling`. Any vocabulary entry with no matching key keeps
`audio: null`. **Do not assume beginner coverage is high**: Zsrtrgh's 132
recordings read like a JLPT N5 list (あさ、あした、あたま、いしゃ、あるく…), but
葵心's 219 skew to loanwords and low-frequency compounds (ベリリウム、五里霧中、
万里の長城), so the usable beginner overlap will be materially smaller than 358.
Two further caveats the content build must respect: the key is the **spelling**
in the filename, so a word written in kana in the filename will not match a
`VocabEntry` spelled with kanji (and vice versa); and Lingua Libre records no
reading, so a clip for a spelling with more than one reading (e.g. 上) cannot be
attached to a specific reading without a human check.

### 1.3 What has NO audio at all

- **All 33 yōon syllables** (§1.1).
- **Every kanji character on its own.** Kanji are not words and are not
  pronounced in isolation; Kansei teaches readings through words, and a reading
  gets audio only if a word demonstrating it happens to have a clip.
- **Every kanji reading (`ReadingId`) on its own.** No source records audio per
  reading.
- **Every component / radical.** Components are graphical, not spoken.
- **Every vocabulary word outside the 358 above** — which, once the beginner
  vocabulary list exists, will be most of it.
- **Sentences and example phrases.** None were sourced.
- **The small っ/ッ, the long mark ー.** These have no independent sound.

---

## 2. Sources

### 2.1 Wikimedia Commons — isolated kana syllables

- API: `https://commons.wikimedia.org/w/api.php`
- Category surveyed: [Pronunciation of Japanese syllables](https://commons.wikimedia.org/wiki/Category:Pronunciation_of_Japanese_syllables),
  [Japanese pronunciation](https://commons.wikimedia.org/wiki/Category:Japanese_pronunciation),
  [Audio files of hiragana (set by Hakatanoshio117117)](https://commons.wikimedia.org/wiki/Category:Audio_files_of_hiragana_(set_by_Hakatanoshio117117))
- Version: live query, surveyed 2026-09-28.
- **All 71 selected syllable clips are by one speaker, `Hakatanoshio117117`,
  released `PD-self` (public domain).** SPDX: `PD`.
  Licence page: e.g. <https://commons.wikimedia.org/wiki/File:Japanese_ka.ogg>
- Format: Ogg Vorbis (`application/ogg`), `.ogg`/`.oga`. Not transcoded.
- **Attribution requirement: none.** Public domain files require no credit.
  Kansei credits them anyway in `ATTRIBUTION.md`, as courtesy, not obligation.
- **Redistribution: unrestricted.**

A caveat the app must not hide: all 71 syllables are **one voice, one dialect
background**. The speaker's own user page says they write about Kagoshima; a
single speaker cannot represent standard Tokyo pronunciation authoritatively,
and the learner should not be told these are "the" pronunciation.

### 2.2 Lingua Libre (hosted on Wikimedia Commons) — words

- Files live on Commons under the prefix `LL-Q5287 (jpn)-`, enumerated with
  `action=query&list=allimages&aiprefix=LL-Q5287 (jpn)-`.
- Total Japanese Lingua Libre files on Commons: **1057** (~118 MB), surveyed
  2026-09-28.
- Licences present: CC0-1.0 and CC-BY-SA-4.0 (both verified per file).
- **Attribution requirement for CC BY-SA 4.0: yes.** Per-file credit is
  mandatory — speaker name, licence name, licence URL, and a link to the
  Commons file page. Share-alike applies to *adaptations*; Kansei redistributes
  the files byte-for-byte and adapts nothing, so no share-alike obligation
  attaches to the app's own code or content.
  Licence text: <https://creativecommons.org/licenses/by-sa/4.0/>
- Generated credit list: `public/content/audio/ATTRIBUTION.md`, regenerated on
  every fetch from `index.json`. **The app must surface it**; a CC BY-SA
  attribution that ships in the repo but is unreachable from the UI does not
  discharge the obligation. Each `AudioRef.attribution` carries everything
  needed to render the credit next to the clip that is playing.

**Lingua Libre's own wiki API is gone.** `lingualibre.org/api.php` and
`/w/api.php` now serve a single-page app, so speaker data cannot be read the
way it once could. The Blazegraph SPARQL endpoint at
`https://lingualibre.org/sparql` still works and is what the fetcher uses.
If it goes away, the fetcher **refuses to ship any Lingua Libre audio** rather
than guess at speaker proficiency.

### 2.3 Rejected sources

| Source | Status | Why rejected |
|---|---|---|
| **Shtooka** `shtooka.net` | **Dead / domain lost** | `shtooka.net` and `www.shtooka.net` 301-redirect to `xoilaczzw.cc`, an unrelated Vietnamese commercial site. `download.shtooka.net` and `packs.shtooka.net` do not resolve. The domain is no longer under project control — **do not fetch anything from it**, and treat any archived "Shtooka" tarball as unverified provenance. |
| **swac-collections.org** (Shtooka/SWAC mirror) | **Dead** | HTTP 503 behind an expired TLS certificate. |
| Commons `Ja-<romaji-word>.ogg` word files | Not used | Filenames are romaji with English glosses appended (`Ja-hana-flower or nose etc.ogg`), which cannot be mapped to a Japanese spelling reliably. Many are explicitly non-native: the `-anglonative` suffix (e.g. `Ja-neko-anglonative.oga`) marks a recording by a native *English* speaker. Many others are sentences, not words. |
| Wiktionary audio | Not a separate source | Wiktionary's Japanese audio is hosted on Commons and is already covered above. |
| Forvo | Not used | No redistribution licence. |
| JapanesePod101 / Tatoeba audio / Anki shared decks | Not used | No clear redistribution licence, or licences that forbid it. |
| **Any TTS** (browser `SpeechSynthesis`, cloud TTS, neural voices) | **Forbidden** | Product rule. Not a licensing question. |

---

## 3. Speaker policy

`AudioAttribution.nativeSpeakerDocumented` is `true` **only when a source page
actually documents it**. It is never inferred from a Japanese-looking username,
a Japanese-language file description, or a Japan-related edit history.

Two documentation routes are accepted, both checked live by the fetcher:

1. **Babel declaration on a user page.** `{{#babel:ja|…}}` (a bare language code
   means native), `{{#babel:…|ja-N|…}}`, or `{{User ja}}` / `{{User ja-N}}` on
   ja.wikipedia (which renders 「この利用者は日本語を母語としています」).
   `Hakatanoshio117117` qualifies on both wikis:
   `{{#babel:ja|en-1|…}}` on Commons and `{{User ja}}` on ja.wikipedia.
2. **Lingua Libre speaker proficiency.** The speaker item's *language* (P4)
   statement for *Japanese* (Q389) carries the qualifier *language level* (P16)
   = *native* (Q15), read from the SPARQL endpoint. The exact evidence per
   speaker is written into `index.json` → `speakerNativenessEvidence`.

**By default, a clip whose speaker's nativeness is not documented is not
shipped.** This is not pedantry. Of Lingua Libre's 1057 Japanese recordings:

| Contributor | Clips | Self-declared Japanese level | Kept? |
|---|---:|---|---|
| CKali | 531 | **beginner** | no |
| 葵心 | 219 | native | **yes** |
| Zsrtrgh | 132 | native | **yes** |
| I JethroBT | 128 | average level | no |
| フィリピン人 | 14 | beginner | no |
| Higa4 (Q273320 + Q287558) | 14 | native | **yes** |
| LaKoalita | 13 | good level | no |
| AureaCapra | 2 | average level | no |
| Yug | 2 | not declared for Japanese | no |
| DiasAushakhman | 1 | good level | no |
| Wiktionairy | 1 | beginner | no |

**The largest single contributor is a self-declared beginner.** Shipping 531
beginner-learner recordings as pronunciation models would have been worse for
the learner than shipping nothing, and a naive "download everything CC0 from
Lingua Libre" fetcher would have done exactly that. Nativeness declarations are
self-reported and we record them as such — `nativeSpeakerDocumented: true`
means *the source documents the claim*, not that we verified the voice.

---

## 4. What the app must tell the learner

The learner is entitled to know where the sound stops. Required behaviour:

1. **Never synthesise.** No `SpeechSynthesis`, ever, including as a "temporary"
   fallback.
2. **No audio → no listening question.** `AudioRef === null` must remove the
   question type for that item, not degrade it.
3. **Say so on the yōon lessons.** When introducing きゃ/しゅ/ちょ etc., state
   plainly that no recording of the isolated syllable exists, so those lessons
   are writing- and reading-only.
4. **Show the coverage figure honestly** where the app describes its audio:
   *71 of 104 kana syllable sounds, and 358 words, have native-speaker
   recordings. All 33 yōon syllables (きゃ しゅ ちょ …) have none. Kanji,
   readings and components have none. Nothing is synthesised.*
5. **Show the credit with the clip.** For CC BY-SA files the credit must be
   reachable from the player, from `AudioRef.attribution`.
6. **Do not present one voice as the standard.** All 71 syllable clips are one
   speaker; word clips are three speakers. Say so.
7. **Do not require a spelling that audio cannot distinguish.** を/お, ぢ/じ,
   づ/ず, and particle は/へ — see `HOMOPHONOUS_KANA_SETS`.

---

## 5. Reproducing

```sh
npm run audio:fetch                    # full fetch into public/content/audio/
node scripts/assets/fetch-audio.mjs --dry-run          # coverage report only
node scripts/assets/fetch-audio.mjs --skip-words       # kana only
node scripts/assets/fetch-audio.mjs --allow-undocumented-speaker
```

The fetcher is polite by construction: a descriptive `User-Agent` identifying
the project and a contact address, a per-host minimum request gap (250 ms
Commons API, 600 ms upload host, 1 s Lingua Libre), `maxlag=5` on the Commons
API, `Retry-After`-aware exponential backoff on 429/5xx, and a local cache that
skips re-downloading a file whose size already matches.

Every file's SHA-256 is recorded in `index.json` and is meant to be verified at
install time (`AudioRef.sha256`). Nothing is transcoded, so the hashes match the
bytes Wikimedia serves and can be re-checked against the source at any time.

### Index shape

`public/content/audio/index.json`:

- `clips` — the map the app consumes: logical key → `AudioRef` exactly as typed
  in `src/domain/content.ts`. Keys are `kana/hi/<sound>`, `kana/ka/<sound>`,
  `vocab/<spelling>` (and `vocab/<spelling>#<speaker>` for a second voice).
- `kanaKeyGlyphs` — `<sound> → {hiragana, katakana, group, note}`, so the
  content build joins on the glyph instead of guessing the romanisation key.
- `coverage`, `sources`, `sourcesRejected`, `policy`,
  `speakerNativenessEvidence`, `rejectedCandidates` — provenance and the
  machine-readable record of every gap and every rejection, with its reason.

### Pack size

As built: **436 files, 36,948,012 bytes (36.9 MB)** — 71 kana clips
(2,113,864 B, Ogg Vorbis) and 365 word clips (34,834,148 B, uncompressed WAV as
Lingua Libre publishes them, because the fetcher transcodes nothing).

For an offline-first PWA, 37 MB is large enough to need a decision — on-demand
download per lesson, or a build step that writes a compressed derivative
alongside the pristine original. That decision is **not made here**, and
`public/content/audio/` is currently committed in full. A human should decide
whether 37 MB of WAV belongs in git before this lands.
