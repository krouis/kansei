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
- [ ] Finalize component introductions and implement component exercises.
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

## Claude Sonnet 5 documentation consolidation pass
- README.md rewritten for a human reader: leads with what the app does, a two-command quick start, known limits, and a table linking out to the full doc set — GitHub Pages/CI internals moved to docs/DEPLOYMENT.md rather than opening the file.
- Added docs/ARCHITECTURE.md (system map), docs/DATA-MODEL.md (schema, transaction/migration guarantees, backup format), docs/LEARNING-AND-XP.md (session structure, question formats, grading, learning stages, the full XP rule table), and docs/DEPLOYMENT.md (build/hosting/CI detail extracted from README).
- Wrote the three missing engine-module READMEs (scheduler, selection, persistence) that inline comments covered but no navigable file did.
- Found and fixed a real license inconsistency while writing this: package.json/package-lock.json and four content docs declared AGPL-3.0-or-later; the actual committed LICENSE file is GPL-2.0(-or-later). Corrected the metadata to match the license file, not the reverse.
- Found and fixed a stale number in the previous README (vocabulary-with-audio: stated as 67, actually 61 after the word-specific-reading content regeneration) by checking data/vocab-report.json directly rather than carrying the old figure forward.
- Surfaced while writing the scheduler README, not previously tracked: the scheduler has no dedicated test file, only indirect coverage through session-engine.test.ts. Recorded as a real gap.
