# Kansei implementation checklist

The original product brief is the acceptance target. A module or dataset is not
a delivered feature until it is connected to the application and verified.
Updated as implementation proceeds; unchecked items are not release claims.

## Baseline and reliability
- [x] Inspect repository, Claude session/workflow records, and temporary artifacts.
- [x] Verify all five downloaded source archives/files against the source lock.
- [x] Establish baseline: 53 automated tests; 32 independent kana checks and schema check pass.
- [x] Preserve useful independent content verifiers in the repository.
- [x] Commit inherited unfinished work in focused, reviewed changes.
- [x] Fix TypeScript configuration and establish reproducible build/check commands.
- [x] Save first attempts, scheduling, and session state atomically.
- [x] Award question XP after feedback acknowledgement; atomically save cursor and bonus.
- [x] Persist linked-round length across reloads; reject stale/concurrent answers.
- [x] Await delayed revisits and preserve their skill and reading across series.
- [x] Schedule uncertain handwriting rechecks without a memory penalty.

## First usable offline learning flow
- [x] Assemble reproducible kana packs with byte counts, hashes, and attribution.
- [x] Wire database, settings, content, audio, grader, scheduler, and session engine.
- [x] Add application entry point and error/loading states.
- [x] Add brief onboarding: goal, scripts/modes, install size/progress, honest offline status.
- [x] Implement choice, typed/IME, and keyboard matching exercises.
- [x] Implement handwriting canvas, undo/clear, trace/recall, coaching and reference replay.
- [x] Add hints, reveal, decline, audio replay, corrective feedback and guided retry.
- [x] Complete ten screens, retain first attempt, award 20 XP, resume after closure.
- [x] Verify production build and network-disabled cold start with real content.

## Complete curriculum
- [x] Derive all 1,500 kanji teaching positions and lessons; resolve prerequisite cycles explicitly.
- [x] Finalize component introductions and implement component exercises.
- [ ] Select useful JMdict vocabulary, gated on introduced characters.
- [x] Derive word-specific readings conservatively; reject ambiguous alignment.
- [x] Assemble complete curriculum packs and validate IDs, prerequisites, assets, hashes and licenses.
- [ ] Expand real native-speaker audio coverage; review recording quality and matching.
- [ ] Source legitimate handwriting variants; validate using real human input.

## Product workflows
- [x] Character explorer: gojuon, groups, search, filters, separate skill states/due status.
- [x] Revision view: readings, components, words, audio, animation, trace, recall, history, focused practice.
- [x] Placement assessing only the skills actually tested.
- [x] Progress: historical goals, XP ranges/calendar, sessions/time, skill accuracy, retention and confusions.
- [x] Settings: modes, theme, text/motion, storage, content management, versioned backup transfer.
- [x] Reminders: in-app schedule, quiet hours/snooze/pause, honest recurring calendar export.
- [x] Offline About & Science and teaching/content sources, with research limitations.

## Release qualification and documentation
- [ ] Test ambiguity, Unicode/IME, keyboard shortcuts/matching and accessibility.
- [x] Test XP/history across time zones and daylight-saving boundaries.
- [ ] Test failed writes, quota/missing assets, interrupted downloads and migrations.
- [ ] Test update activation with existing progress and interrupted sessions.
- [ ] Test every exercise, audio, animation and About after offline cold start.
- [ ] Test representative phone/tablet/desktop layouts and actual input devices.
- [x] Publish setup/build/deployment, architecture/data model and learning/XP documentation.
- [ ] Publish exact content inventory, provenance/licenses, test results and remaining limitations.

## Known baseline limitations
No app entry point or feature pages existed at takeover. Kanji ordering,
vocabulary and pack assembly were interrupted by Claude usage limits. Audio
currently covers 71/104 modern kana sounds and 358 word spellings; the latter
is not a curated vocabulary course. Handwriting validation is synthetic only.
Temporary reference files named `.pdf` are error pages, not retrieved papers.

## Commit convention
Follow the existing history: imperative descriptive subject, blank line,
plain-language explanation of behavior and relevant validation. Keep each
commit scoped to one coherent change. Preserve Claude attribution on inherited
work; use truthful Codex attribution for new work. Do not commit build caches.

## Validation log
- Session reliability: 12 integration tests pass, including snapshot-write failure rollback, feedback-gated XP, stale tabs, three-series reloads, and uncertain rechecks.
- Inherited audio, components/fonts/source mappings, and database migration/pack-state work preserved in separate commits.
- Parallel continuation attempted; all three subagents hit account usage limits. Root continues integration locally.

- Production build passes. Chromium installed real kana packs, completed ten questions for 20 XP, then cold-started a new page offline and loaded audio, stroke references, About and progress. Browser viewport checks are not physical-device validation.
- Reminder module: nine tests pass for local schedules, quiet hours, elapsed-day reminders, DST keys and calendar export. UI integration remains pending.
- Exercise components: nine tests pass for IME, keyboard matching, retries, first-attempt feedback, draft recovery and stroke-direction coaching. Drafts are tab-local; physical input validation remains pending.
- Progress page now includes historical XP charts/calendar, session history, separate skill accuracy, confusion records and delayed-recall trends. Three summary regression tests pass; integration into the shell follows with the application commit.

- Integrated milestone: production build and Chromium offline acceptance pass; 82 unit/integration tests pass across eight files. Kana practice is usable locally. Kanji/vocabulary data is installed but explorer/course integration remains unfinished.
- Separate commits preserve reminders, practice controls, progress reporting, kanji ordering, vocabulary, pack assembly and offline runtime. Subagents completed independent modules before reaching usage limits; root integrated and checked their work.

## GitHub Pages delivery
- [x] Respect the deployment base path for content, audio, service-worker registration and navigation.
- [x] Generate section entrypoints and a scoped PWA manifest for static hosting.
- [x] Verify installation, ten-screen XP and offline cold start under `/kansei/`; both Chromium acceptance tests pass.
- [x] Add the build/test/publish workflow and document repository setup.
- [x] Observe a successful GitHub-hosted deployment after pushing the workflow.

- Workflow checks use Node 22 and locked npm dependencies. Runtime-only content validation checks all distributed assets without downloading mutable upstream dictionaries; the default validator still checks local source hashes. GitHub-hosted execution passed in run 36618038902.

## Updates without losing user data
- [x] Close superseded database connections without deleting or resetting records.
- [x] Test reopening/upgrading with settings, XP, skills, history and sessions.
- [x] Check for upstream app updates on launch, reconnect and hourly while visible.
- [x] Notify with Update now / Later; defer while practising or saving and protect other tabs.
- [x] Stage and verify changed curriculum separately before switching active content.
- [x] Test a real service-worker replacement and compare user-data stores before/after.
- [x] Commit, push and inspect GitHub Actions results.
- Staged-content module: four tests pass for network discovery, digest failure, interruption/resume and schema rejection. Failed staging preserves the installed generation and never writes learner data.

- Final local update validation: 93 unit/integration tests and both Chromium acceptance tests pass. The browser installs a replacement worker, blocks activation with another tab or active session, switches a verified content generation, compares all learner/settings stores unchanged, and cold-starts offline.

- GitHub Actions run [36618038902](https://github.com/krouis/kansei/actions/runs/36618038902) successfully built, tested and deployed commit `5a4e3bf` to https://krouis.github.io/kansei/.

## Claude Sonnet 5 review and integration pass
- Reviewed the full Codex-continued history: confirmed HEAD built and tested clean before touching anything, then found the working tree held genuinely good but unfinished and currently-broken work (a real fix for components having no practice format).
- Fixed the broken working tree (a strict-null test issue) and verified it: full build, 112 tests, `content:validate --runtime-only`, `check:kana`, all pass. Committed as two focused changes: word-specific reading ids (1050 -> 1242 records, each tied to one demonstrating word) and the component/meaning recognition formats plus the reading-selection and applicability bugs their tests caught along the way.
- Found and fixed a real integration defect: `CharactersPage.tsx` and `explorer.ts` were fully built and independently unit-tested but never imported — the shipped app used a much cruder duplicate defined inline in `App.tsx` (no kanji/vocabulary view, substring-only search, single-reading progress lookups that could hide an unpracticed reading behind a retained one). Wired in the real component, deleted the duplicate, verified with the full unit suite, a production build, and the real Chromium offline E2E spec.
- Added `tests/integration/xp-ledger.test.ts` (9 tests): the XP ledger's day-boundary logic had no direct test before this. Covers real 2026 America/New_York DST transitions (23-hour spring-forward, 25-hour fall-back), a UTC/local-date disagreement, a session split across local midnight, a timezone change verified against a single instant that is genuinely a different calendar date in Tokyo vs. Los Angeles, and the frozen-daily-goal rule. No bugs found — the existing `stamp()`/`localDateIn()` implementation held up — but this closes a real gap in regression coverage.
- 121 unit/integration tests and both Chromium E2E specs pass at the end of this pass.

- Placement: added the missing onboarding choice (beginner start vs. an optional ten-question placement check), implemented as a real SessionKind sampled evenly across taught kana and scored through the exact same generator/grader/scheduler path as ordinary practice — recognition only, with the scope limit stated in the UI both before and after the check. 6 unit tests, 1 integration test, 1 new Chromium E2E spec; 127 unit/integration tests and all 3 E2E specs pass.

- Re-audited two items marked unchecked but already fully implemented and verified: the handwriting canvas (Writing.tsx: undo, clear, blank-canvas recall mode by default with guides only on retry or explicit hint, live trace coaching, reference replay respecting reduced motion, graded through the real worker-based stroke assessor) and Settings (theme/motion/goal/series-length/active-scripts/silent/keyboard-only/extended/historical toggles, storage usage and persistent-storage request, pack install/verify, and versioned merge-or-replace backup transfer with a pre-apply effects preview). Checked off.
- Remaining known gap, not attempted this pass: component teachingOrder/lessonId in data/components.json is still entirely placeholder ('comp-provisional-01' for all 263 records) — the documented interleave with the now-finalized kanji teaching order was never run. The selector already handles this reasonably (newMaterial.ts mixes a couple of components alongside real kanji rather than isolating them), so nothing is broken, but the ordering is not the considered one the content pipeline's own contract calls for.
  - **Correction (later pass):** this was checking the wrong file. `data/components.json` is intentionally provisional — it is `build-components.mjs`'s own documented output before the kanji order exists (see that file's header). The real ordering already runs one stage later: `scripts/content/build-kanji-order.mjs` reads `data/components.json` + the finalized `data/kanji-ordered.json` and writes `data/components-ordered.json` with every component's `teachingOrder`/`lessonId` set from the first kanji lesson that needs it — zero placeholders (verified: 263/263 real, 0 provisional/unscheduled). `build-content.mjs` reads `components-ordered.json` (not `components.json`) into the shipped `data/kanji.json`. `npm run content:build` reproduces this byte-for-byte from tracked source data, and `npm run content:validate` passes clean. Component exercises are also real, not just data: `component-in-kanji-choice` (src/learning/generation/types/visualKanjiChoice.ts) asks "which kanji contains this recurring component", sourced from the actual KanjiVG decomposition with no invented reading/meaning credit, and `newMaterial.ts` already selects components as introduceable targets. One real gap remains: `build-kanji-order.mjs`'s component ordering is its own inline reimplementation (assign the component to the same lesson as the first kanji needing it) rather than calling the more careful `assignTeachingOrder()` interleaver that `build-components.mjs` exports and documents as the contract (which places a component in a lesson strictly *before* the kanji that needs it, not alongside it). Both items are now checked off since the curriculum is genuinely complete and shipping; the interleaver-vs-inline-logic mismatch is tracked below as tech debt, not a missing feature.

## Claude Sonnet 5 documentation consolidation pass
- README.md rewritten for a human reader: leads with what the app does, a two-command quick start, known limits, and a table linking out to the full doc set — GitHub Pages/CI internals moved to docs/DEPLOYMENT.md rather than opening the file.
- Added docs/ARCHITECTURE.md (system map), docs/DATA-MODEL.md (schema, transaction/migration guarantees, backup format), docs/LEARNING-AND-XP.md (session structure, question formats, grading, learning stages, the full XP rule table), and docs/DEPLOYMENT.md (build/hosting/CI detail extracted from README).
- Wrote the three missing engine-module READMEs (scheduler, selection, persistence) that inline comments covered but no navigable file did.
- Found and fixed a real license inconsistency while writing this: package.json/package-lock.json and four content docs declared AGPL-3.0-or-later; the actual committed LICENSE file is GPL-2.0(-or-later). Corrected the metadata to match the license file, not the reverse.
- Found and fixed a stale number in the previous README (vocabulary-with-audio: stated as 67, actually 61 after the word-specific-reading content regeneration) by checking data/vocab-report.json directly rather than carrying the old figure forward.
- Surfaced while writing the scheduler README, not previously tracked: the scheduler has no dedicated test file, only indirect coverage through session-engine.test.ts. Recorded as a real gap.

## Curriculum content pass
- Fixed a real word-specific-reading alignment bug in scripts/content/build-vocab.mjs: KANJIDIC2 genuinely double-lists a handful of kanji's bare reading as both on and kun with identical kana (気="キ"/on and "き"/kun; also 医, 死, 画, 差…), and the segmenter counted that as two different solutions, discarding the word as "ambiguous" even though the character boundaries were identical and only the on/kun label was unsettled. Traced all 16 currently-ambiguous words and confirmed every one was this exact false ambiguity (zero genuine multi-segmentation cases). Resolved the label deterministically using the ordinary textbook signal — kun reading carries okurigana, on reading appears in a bare kanji compound — restricted to undecorated stems only, so a real phonological difference (rendaku/gemination) is never merged.
- First attempt at the fix caused a real regression (937 aligned -> 927) by exposing a second, unrelated dormant collision: a kanji's on-reading can coincidentally equal another on-reading's own rendaku-voiced form (分's ブン beside フン's voiced ぶん), which the original single-stage dedup silently collapsed by key coincidence. Fixed by keeping that original per-surface+type fold as stage one, unchanged, and layering the new cross-type on/kun collapse on top as stage two. Caught before committing by re-running content:build/content:validate and diffing the exact unmatched-word list against the pre-fix set, not just the counts.
- Net result, verified via `npm run content:build` + `npm run content:validate` + full test suite (127/127) + production build: 953 aligned words (was 937), 0 ambiguous (was 16), 48 unaligned unchanged (verified identical word-for-word — these are genuine jukujikun/irregular readings like 今日・明日・大人 that cannot be honestly segmented per character, correctly still excluded), 1,270 word-specific readings (was 1,242), 41 kanji without an aligned reading (was 54). Updated docs/content/VOCABULARY.md's cited counts to match.
- Corrected a stale finding from the prior pass (see above): re-verified that component teaching order and component exercises are both already complete and shipping — see the "Correction (later pass)" note under Complete curriculum.
- Confirmed genuinely still open in curriculum content, not attempted this pass: the 48 remaining unaligned words and vocabulary selection generally still need native-Japanese editorial review (dictionary-frequency selection is not a reviewed beginner syllabus); real audio coverage is thin (71/104 kana sounds, 61/1,600 vocabulary words); handwriting variant data and validation remain synthetic-only. None of these are safely fixable by widening automated heuristics without either fabricating linguistic judgment or sourcing real external data.

## Audio sourcing research (live re-check, 2026-09-30)
- Re-ran `scripts/assets/fetch-audio.mjs --dry-run` live against Wikimedia Commons and Lingua Libre (both APIs reachable) to verify the codebase's "surveyed exhaustively" claim about the 33 missing yōon kana sounds is still current, not stale.
- Confirmed exhaustively unavailable, via three independent checks beyond the script's own candidate table: (1) listed every file in Commons' `Category:Pronunciation of Japanese syllables` directly (23 files; only `Ja-Ryu.oga`/りゅ is yōon-shaped) instead of trusting only the guessed-filename probe list; (2) broad Commons title/glyph searches for all 33 sounds under several naming conventions — zero relevant hits; (3) enumerated the complete Lingua Libre Japanese file list (1,057 files, any speaker) and confirmed none is a bare yōon syllable recorded as a standalone "word". The one real candidate, `Ja-Ryu.oga`, is correctly rejected because its uploader has no documented native-Japanese Babel declaration — verified this is the actual (correct) reason, not a pipeline bug, by re-running with `--allow-undocumented-speaker` and confirming it then passes. Nothing more can be sourced here without loosening the native-speaker-documentation policy, which should not happen.
- Quantified the vocabulary-audio gap precisely: 102 of the 1,600 selected words already have a matching native recording, but only 61 get wired into `VocabEntry.audio`. The other 41 (一, 一日, 上, 行く, 山, 先生, 明日…) are correctly withheld by the existing `possible.size===1` check in build-vocab.mjs — their spelling has more than one dictionary-attested reading across JMdict, so a filename-only match can't prove the recording says the specific reading being taught. This is the script's own documented "awaiting human listening review" limitation, not a bug, and was not touched.
- Found one real, unactioned opportunity: 162 more words with a genuine native recording and only kana+top-1000-kanji characters exist but are not in the current 1,600-word selection at all. Recovering audio for them would mean re-weighting vocabulary selection (score() already gives a -100 audio bonus, but teaching-order/frequency/common-priority terms currently outweigh it for these), which changes which words the curriculum actually teaches — a content decision, not a technical fix, so left for an explicit decision rather than done unilaterally.
- **Actioned in the next pass** (user approved re-weighting): raised the audio score bonus from 100 to 300, chosen empirically (coverage climbs steeply to here then plateaus) and verified by diffing the entire word-set swap before committing — see the "Re-weight vocabulary selection" commit. 98 words now have wired audio (was 61). Also found and excluded two JMdict entries (おっぱい, コンドーム) that the reweighting would otherwise have pulled in: both pass every automated content filter but are not appropriate for a beginner-facing app, so a short human-reviewed exclusion list was added specifically for this class of gap.

## Cross-check against real beginner courses (2026-09-30, research only — no code changed)
User asked to check authoritative Japanese-learning methods (named Minna no Nihongo)
against which characters Kansei teaches and in what order. Two distinct findings,
one already-known/accepted, one newly discovered and unaddressed.

**1. Kanji SELECTION bias is real, already documented, and independently confirmed.**
docs/content/KANJI-FREQUENCY.md already states the source (KANJIDIC2's `<freq>`
field, a word-frequency analysis of ~4 years of Mainichi Shimbun newspaper text,
Girardi 1998) is newspaper-biased, and even names 犬 as an example everyday word
this pushes out of the top 1000. Cross-checked this directly against Minna no
Nihongo Shokyu I (via two independent web sources — en-nihongo.com and
nihongokyoshi-net.com — which agree closely but not exactly, 243 vs 220 kanji;
the lower figure matches the publisher's (3anet.co.jp/Bonjinsha) own stated count
for the 2nd edition, so treat 243 as the upper bound of an approximate scrape, not
a verified exact list). Of that course's ~223 overlapping kanji, **20 are entirely
absent from Kansei's kanji set**: 兄 姉 弟 妹 (siblings), 犬 魚 (dog, fish), 茶 酒
(tea, alcohol — 茶's absence was already known, see vocab-report.json's
`starterWordsUnavailable`), 昼 晩 冬 (noon, evening, winter), 耳 (ear), 勉 窓 寝
暗 飯 奥 堂 漢 (as in 勉強, 漢字 itself). This is a known, accepted tradeoff of
the corpus choice (KANJI-FREQUENCY.md §6 shows 84% mean agreement with three
independent modern corpora), not a new bug — flagged here for visibility, not
fixed. Fixing it for real means picking a different or blended frequency source
and re-deriving the whole 1000-kanji set, which cascades through every kanji,
vocab, reading, component and audio file built on top of it — too large a change
to make without an explicit decision to widen the character set itself.

**2. Kanji teaching ORDER contradicts its own documented design intent — new finding.**
docs/content/KANJI-FREQUENCY.md §4 states plainly: "Sequencing is owned by the
curriculum build, which orders by stroke complexity, component reuse and
vocabulary availability" — i.e. frequency rank should pick the *set*, never the
*order*. But scripts/content/build-kanji-order.mjs's actual sort key is
`frequencyRank + 18 × strokeCount` (plus a topological pass only for genuine
component prerequisites) — frequency rank is a full, undiluted term in the
ordering itself, not excluded from it. Concretely: 氏 (surname/"Mr./Ms.", old-JLPT
level 1 — the hardest pre-2010 tier, frequency rank 84 purely because news
articles constantly say "Yamada-shi") lands at teaching position 33, ahead of
hundreds of genuinely elementary characters. Quantified with data already
verified and licensed in the repo (KANJIDIC2's `jlptOldLevel` field, no new
sourcing needed): of Kansei's first 100 taught kanji, only 47 are old-JLPT-N5
(the beginner tier); 25 are N4, 27 are N3/N2, and one (氏) is N1. Cross-checked
against the same Minna no Nihongo Shokyu I list: of its ~223 kanji that do exist
in Kansei's set, only 107 (48%) land within Kansei's own first 220 teaching
positions (matching that course's own scope), median position 497 — more than
half of what a real beginner course teaches first gets deferred, in some cases
past position 1200. This is a genuine implementation/documentation mismatch,
not a content-sourcing problem, and it is fixable without touching which 1000
kanji are taught or requiring any new external data (jlptOldLevel and grade are
already in data/kanji-top1000.json). Not yet acted on — awaiting a decision on
scope, since re-deriving order for all 1000 kanji also reshuffles
data/components-ordered.json, data/kanji-lessons.json and every vocabulary
entry's teachingOrder/lessonId that depends on it.

Sources consulted: docs/content/KANJI-FREQUENCY.md (in-repo, already cites
KANJIDIC/EDRDG/scriptin-kanji-frequency); https://en-nihongo.com/japanesetips/kanji/kanji-list-for-minna-no-nihongo/;
https://nihongokyoshi-net.com/minnano-nihongo-kanji/; https://www.3anet.co.jp/np/books/2358/
(publisher page, confirms 220/536 kanji counts for Shokyu I / I+II).

## Widened the kanji curriculum to 1500 and fixed teaching order (2026-09-30)
User approved acting on both findings from the research pass above ("I'm not
set on 1000... maybe 1500 ... go ahead"). Two changes, developed and verified
together since the second was partly discovered while testing the first, but
described separately here:

**1. Widened `data/kanji-top1000.json` (1000) to `data/kanji-top1500.json`
(1500).** Every old-JLPT N5/N4 kanji in the full KANJIDIC2 ranking (284 of
them) has a frequency rank of 1487 or better — confirmed by scanning the
complete 2501-ranked file, not just the previously-missing 20 — so 1500 is
the smallest round cut with zero N5/N4 exceptions, using the same source and
method as before (nothing new sourced). All 20 kanji Minna no Nihongo Shokyu I
teaches that were missing at 1000 (兄 姉 弟 妹 犬 魚 茶 酒 昼 晩 冬 耳 勉 窓 寝
暗 飯 奥 堂 漢) are now in, each with real demonstrating vocabulary — お茶
itself is now buildable, closing the exact gap `vocab-report.json`'s
`starterWordsUnavailable` had flagged. Re-running the Minna no Nihongo
Shokyu I comparison end to end: 0 of its 243 kanji missing (was 20), 185/243
within Kansei's own first-220 teaching slots (was 107/223), median teaching
position 405 (was 497). Re-running the independent-corpus cross-check
(§6/§9 of KANJI-FREQUENCY.md) found agreement *improved*, 87.5% mean overlap
vs 84.3% at 1000 — the widening added ordinary vocabulary, not corpus-tail
noise.
  - One exclusion, found during the widening and handled the way this project
    always handles a genuine source conflict — documented, not guessed away:
    rank 1241 (煕) has KanjiVG (14 strokes) and KANJIDIC2 (13, no listed
    miscount) genuinely disagreeing, which `build-strokes.mjs`'s cross-check
    correctly treats as a hard failure (a wrong count would corrupt both the
    writing animation and the handwriting grader). 煕 is not jōyō/jinmeiyō
    either, so excluding it costs nothing; rank 1501 (添, ordinary grade-8
    jōyō) was taken instead to keep the round 1500 total. Added a small,
    documented `EXCLUDED_GLYPHS` mechanism to `build-kanji-list.mjs` for
    exactly this class of problem, mirroring the vocabulary editorial
    exclusion list added earlier this session.
  - Rebuilt the entire dependent pipeline from scratch and verified each
    stage: components (263 -> 357 records, font subset needed a rebuild to
    cover ~25 new component glyphs, done via `npm run fonts:build`), kanji
    order, strokes (1177 -> 1677 characters, 10,211 -> 15,686 strokes, 0
    disagreements after the 煕 exclusion), vocab (still capped at 1600 words,
    but 1406 aligned / 1930 word-specific readings now that more characters
    are available to build words from), content pack, `content:validate`.
    15 of the 1500 kanji (place/name
    characters: 茨 栃 李 彦 浩 阿 之 宏 菱 也 曽 貞 梶 孜 盧) have no
    demonstrating vocabulary at all — a new, honest gap `content:validate`
    now surfaces (was 0 at 1000), not something forced closed.

**2. Fixed kanji teaching order to respect pedagogical tier, not just
frequency.** `build-kanji-order.mjs` now sorts primarily by old-JLPT tier
(`4 - jlptOldLevel`, or MEXT `grade` banded the same way where jlptOldLevel is
absent), with the original `frequencyRank + 18*strokeCount` heuristic
demoted to a tie-breaker *within* a tier. Result, verified against the
rebuilt data: every one of the 103 old-N5 kanji is taught before any N4
kanji, every N4 before any N3/N2, every N3/N2 before any N1/ungraded — a
completely clean graded progression (tier-by-hundred breakdown recorded in
`kanji-order.json` and `KANJI-ORDER.md`). 氏 ("Mr./Ms.", old-JLPT level 1)
moved from teaching position 33 to 1246.
  - Fixing the primary sort surfaced a second, real bug in the *existing*
    prerequisite mechanism, not something the tier change introduced: basic
    N5 kanji like 年 (year), 午 (noon), 南 (south) were structurally blocked
    behind 干 — a rare, harder (old-JLPT level 2) standalone kanji that
    happens to be a simpler-stroke-count visual sub-shape of all three — so
    the "wait for a simpler component" rule was dragging elementary
    vocabulary down to position 1000+ purely because it shared a shape with
    something obscure. Traced the exact dependency chains for every kanji
    this affected (年, 午, 南, 週, 何, 空, 店, 駅, 国, 飲, 時, 読 — all 12
    confirmed to be blocked on a harder-tier "shape" prerequisite, nothing
    else) before changing anything. Fixed by requiring a component
    prerequisite's tier to be no harder than its dependent's; the excluded
    edge is now logged in `excludedContainmentEdges` exactly like a
    not-strictly-simpler edge always was (184 total, was 1).
  - Verified with a fresh, complete rebuild of every dependent file — same
    pipeline as above — plus full app verification: `tsc --noEmit` clean,
    127/127 unit+integration tests, production build, all 3 Playwright E2E
    specs (`offline.spec.ts`), each run to completion after the final data
    state, not against an intermediate one.

**Renamed throughout**, since the filename itself said "1000": every script
(`build-kanji-order.mjs`, `build-components.mjs`, `build-strokes.mjs`,
`crosscheck-kanji-frequency.mjs`, `build-fonts.mjs`), test
(`components-dataset.test.ts`, `curriculum-generation.test.ts`), the
`kanji-1000` content pack id (-> `kanji-1500`), and every doc/UI string citing
the old count (`README.md`, `docs/CONTENT.md`, `docs/content/KANJI-FREQUENCY.md`
— substantially rewritten, all its measured numbers re-derived from the 1500
set rather than search-replaced — `docs/content/KANJI-ORDER.md` — rewritten
for the tier algorithm — `docs/content/STROKES.md`, `docs/content/COMPONENTS.md`,
`src/app/App.tsx`, `src/learning/generation/README.md`). Where a specific
narrative statistic in `COMPONENTS.md` would have needed re-running internal,
not-otherwise-exposed build diagnostics to verify honestly (the phonetic-
component count, 丿's recurrence count, the pre-threshold shape count, the
containment-cycle count), left a dated caveat naming exactly which four
numbers are unverified rather than guessing new ones or silently leaving old
ones uncorrected.

**Found but not fixed, recorded for whoever touches this next:**
`data/provenance/strokes.json` is stale and orphaned — its comment says
`build-strokes.mjs` writes it, but the script only ever writes to
`public/content/strokes/`; the file still says "1000"/"top 1000" and was
never regenerated by any committed script. `STROKES.md` now flags this
inline rather than silently trusting the file's numbers.

## Core functionality audit + wired up kanji/vocabulary practice (2026-09-30)
User asked what core functionality (not tests/docs) was still missing. Traced
the actual data flow rather than trusting the checklist, and found the real
answer: despite a complete, tested kanji/component/vocab pipeline, **nothing
in the UI could ever add `'kanji'` to `settings.activeScripts`** — the
onboarding "Start with" dropdown and the Settings page's script checkboxes
only ever offered hiragana/katakana, and `passesNewMaterialGate()` requires
every script an item needs to already be in that array. Confirmed this was
a complete dead end, not a partial gap, by grepping every place `'kanji'`
appears as a UI value in the app — only the Characters explorer's browse-tab
filter, never `activeScripts`. Not documented anywhere as a deliberate
decision (checked WORK.md, docs/, comments) — reads like an oversight left
over from when the content was too raw to expose.

Added the missing toggle: a "Kanji & vocabulary (draft, not yet reviewed)"
checkbox next to the existing script checkboxes in Settings, and a
same-worded opt-in checkbox on the onboarding/install screen, both writing
into the same `activeScripts` array via the identical pattern the existing
hiragana/katakana checkboxes already use. Updated the install-screen and
About-page copy, which previously said kanji's "practice UI is unfinished"
— no longer accurate; reworded to say the curriculum is unreviewed draft
content, not that it doesn't work. Confirmed the new-material selector's
lesson-order walk already handles sequencing correctly with no extra
gating needed: kana lessons sort before kanji lessons, so turning kanji on
from day one does not skip ahead of an unfinished kana curriculum.

**Live-verified in a real browser, not just unit tests** (Playwright, real
production build): installed with the onboarding checkbox visible, then
enabled the Settings checkbox and confirmed `activeScripts` persisted
correctly to IndexedDB. Seeded realistic `SkillState` rows for every kana
item (via direct IndexedDB writes, matching the domain's full `SkillState`
shape field-for-field rather than a partial guess) to simulate a learner who
already finished kana, then started a new session.

**This surfaced a second real, previously-unreachable bug**: the very first
screen attempted was `vocab:いい` for `recognition`, and question generation
failed outright — "Every candidate format was rejected" for all four
recognition generators, none of which accept a vocab target.
`src/learning/selection/items.ts` claimed `applicable(vocab).recognition =
true`, but no generator in `composite.ts`'s `candidatesFor('recognition')`
list (romaji-to-kana-choice, character-to-reading-choice, match-pairs,
confusable-discrimination, plus component/kanji-only formats) implements a
whole-word recognition format — the exact same reason `handwriting: false`
is already correctly excluded for vocab ("the drawing assessor accepts one
character, not a whole word") applies to recognition too, just was never
noticed because vocab was never reachable before this pass. Checked the one
other consumer of this flag (`selector.ts`'s skill-choice fallthrough) before
changing it — safe, since it just moves to the next applicable skill.
Fixed by setting `recognition: false` for vocab, so `readingRecall`
(`word-reading`, the real, implemented, primary skill for a word) is tried
first instead, matching `NEW_ITEM_SKILL_ORDER`'s intent.

Re-ran the same live scenario after the fix: `vocab:いい` and `vocab:あう`
both generated real `word-reading` questions and rendered correctly
end-to-end (prompt, input field, check/reveal/don't-know buttons) —
screenshotted and visually confirmed, not just asserted programmatically.
Full verification: `tsc --noEmit` clean, 127/127 tests, production build,
all 3 Playwright E2E specs (kana-only flow unaffected, since default
`activeScripts` still excludes kanji for a fresh install).

Not yet exercised live: an actual standalone kanji character (only
kana-extension screens and all-kana vocab words appeared in the one
10-screen sample pulled, since `pickNewMaterial` lets ready vocabulary
crowd out a lesson-level kanji introduction within the same pick when
enough all-kana words are immediately eligible). Not a new bug — the
existing `curriculum-generation.test.ts` unit test already exercises
question generation for all 1,500 kanji directly and passes, both before
and after this fix, so kanji's own recognition path (`meaning-to-kanji-
choice`/`component-in-kanji-choice`) was never in question. Worth a
follow-up live check specifically reaching a kanji lesson if anyone wants
belt-and-suspenders confirmation.
