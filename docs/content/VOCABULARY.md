# Reproducible vocabulary and reading alignment

This is an **automatically selected draft curriculum**, not a Japanese-teacher
reviewed beginner syllabus. The source is the locally locked JMdict English
snapshot, fetched 2026-09-28, published by EDRDG under CC BY-SA 4.0. See
`data/sources/SOURCES.lock.json` for its SHA-256 and source URL. Entry sequence
numbers are retained in each word's `source`; selection, gloss extraction,
gating and reading alignment are Kansei adaptations. Derived data is shared
under the source's CC BY-SA 4.0 terms.

Reproduce with `node scripts/content/build-vocab.mjs` after ordering the kanji.
No external services or language models are used by the generator. The script
reads the dictionary's XML blocks, resolves its internal entities, observes
reading/spelling/sense restrictions, and excludes unusual orthographies,
marked unusual readings (but retains legitimate gikun/jukujikun), specialist-field
(except food/cooking) and dialect senses, bound auxiliary-only exercises, and senses marked
archaic, obsolete, vulgar, derogatory, slang, or rare. It retains one concise
gloss and at most three additional glosses from the selected sense. It does not
redistribute JMdict's example sentences.

Eligibility requires at least one `ichi1`, `news1`, `spec1` or `gai1` priority
marker. Per JMdict's header: news1 denotes the first 12,000 entries in the
Mainichi-derived wordfreq list; ichi1 derives from Ichimango goi bunruishuu;
spec1 marks additional common words; gai1 identifies common loanwords. These
are heterogeneous frequency signals, not JLPT levels or exact frequency ranks.
`frequencyRank` is therefore null. Spelling is at most six Unicode BMP
characters and reading at most ten; all spellings must segment into taught kana
(including combined kana) and the selected kanji. Kana-only variants are emitted
only for the specific matching 'usually written using kana alone' sense, with
eight explicit pedagogical exceptions listed in `starterKana` in the generator.
Those exceptions use an identified JMdict entry's own reading and first eligible
sense (cat, dog, mountain, water, eat, sing, go, tea), and label the spelling as a
Kansei pedagogical adaptation in its source. They do not claim that JMdict marks
that sense as normally kana-written. This avoids selecting an unrelated
homophone or borrowing a kana-only label from a later slang/auxiliary sense.

When an entry supplies priority-marked readings, only those readings are eligible;
a common kanji spelling cannot confer commonness on an unmarked alternative.
Within each entry, the first eligible dictionary reading is preferred, not the
shortest reading. Thus 今日/明日/昨日 retain きょう/あした/きのう without inventing
per-character breakdowns. All dictionary reading alternatives still participate
in the conservative audio ambiguity check.

A small explicit starter list is preferred where eligible, then each kanji gets
its earliest eligible word, then common, short, early-available words fill the
1,600-entry target. Available source audio gives a modest preference. Words are
gated on **all** spelling characters, including combinations, and assigned the
last required character's position and lesson. This selection can still include
vocabulary that is not useful to a particular beginner. Native-language editorial
review remains a release requirement. `data/vocab-report.json` reports starter
words unavailable under these rules and all remaining coverage limitations.

## Word-specific reading evidence

The complete JMdict word reading is authoritative. Kanji segmentation tests
KANJIDIC2 on-readings and kun stems before the okurigana dot, together with the
literal kana in the word. It permits initial voicing and a final small-tsu
replacement before eligible following consonants. It enumerates complete paths;
zero paths or more than one path means **no per-character reading is asserted**.
Whole-word reading practice is still valid. No per-character segmentation is
invented for jukujikun/ateji, and no unsupported universal pronunciation is
assigned to a character. Each retained reading has reciprocal example-word
references. IDs include the example spelling (`reading:字:reading:word`), so
success in one word never grants reading mastery in another. Existing older
aggregate-reading progress is preserved in storage but is not automatically
transferred to these new word-specific IDs. Frequency share and pitch accent remain null. Sound changes are
identified as contextual examples, not universal rules.

Romanization is syllabic Hepburn with kana vowel sequences retained (`ou`, `ei`,
etc.) rather than automatically inventing macrons across morpheme boundaries.
Small-tsu consonant doubling and n-apostrophe separation are explicit. This is a
practical current limitation relative to the desired dictionary-level macron
convention; kana reading is the primary answer. Future editorial data can supply
lexically validated displayed romanization. Greeting は is rendered as `wa`
only where the selected source sense explicitly documents that pronunciation;
the Japanese spelling remains unchanged.

## Audio

A real recording is linked only when its source spelling matches and the complete
JMdict spelling has a single unambiguous reading (including readings excluded
from vocabulary selection). No speech synthesis or placeholder recording is used.
Every AudioRef retains source, author, license, digest and size. This is a
conservative *metadata match*, not a listening review. Human review must still
check pronunciation, clipping, noise and word identity. Missing audio disables
listening for that item; it never prevents non-listening practice.

## Current review and limitations

The automated regression review covers common irregular readings, homophone
selection, source sense restrictions, pedagogical kana adaptations, greeting
pronunciation and reciprocal word-specific reading links. It is not a human
Japanese editorial certification of all 1,600 words. The generated report records
current coverage and missing source-aligned readings. Every selected kanji has
a vocabulary example, but not every example can be segmented confidently.

The retained target size is 1,600 entries. The current build has 953 uniquely
aligned kanji words and 48 unaligned words (the latter mostly jukujikun and
other irregular readings that cannot be honestly segmented per character, by
design — not a gap in the aligner), and 1,270 word-specific reading records.
There are 61 metadata-matched recordings. The requested お茶 spelling is
unavailable because 茶 falls outside this selected frequency list; its
source-backed pedagogical form おちゃ is included instead.
