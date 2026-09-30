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
- [x] Derive all 1,000 kanji teaching positions and lessons; resolve prerequisite cycles explicitly.
- [x] Finalize component introductions and implement component exercises.
- [ ] Select useful JMdict vocabulary, gated on introduced characters.
- [ ] Derive word-specific readings conservatively; reject ambiguous alignment.
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
