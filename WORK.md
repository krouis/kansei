# Kansei implementation checklist

The original product brief is the acceptance target. A module or dataset is not
a delivered feature until it is connected to the application and verified.
Updated as implementation proceeds; unchecked items are not release claims.

## Baseline and reliability
- [x] Inspect repository, Claude session/workflow records, and temporary artifacts.
- [x] Verify all five downloaded source archives/files against the source lock.
- [x] Establish baseline: 53 automated tests; 32 independent kana checks and schema check pass.
- [x] Preserve useful independent content verifiers in the repository.
- [ ] Commit inherited unfinished work in focused, reviewed changes.
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
- [ ] Implement handwriting canvas, undo/clear, trace/recall, coaching and reference replay.
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
- [ ] Character explorer: gojuon, groups, search, filters, separate skill states/due status.
- [ ] Revision view: readings, components, words, audio, animation, trace, recall, history, focused practice.
- [ ] Placement assessing only the skills actually tested.
- [x] Progress: historical goals, XP ranges/calendar, sessions/time, skill accuracy, retention and confusions.
- [ ] Settings: modes, theme, text/motion, storage, content management, versioned backup transfer.
- [x] Reminders: in-app schedule, quiet hours/snooze/pause, honest recurring calendar export.
- [x] Offline About & Science and teaching/content sources, with research limitations.

## Release qualification and documentation
- [ ] Test ambiguity, Unicode/IME, keyboard shortcuts/matching and accessibility.
- [ ] Test XP/history across time zones and daylight-saving boundaries.
- [ ] Test failed writes, quota/missing assets, interrupted downloads and migrations.
- [ ] Test update activation with existing progress and interrupted sessions.
- [ ] Test every exercise, audio, animation and About after offline cold start.
- [ ] Test representative phone/tablet/desktop layouts and actual input devices.
- [ ] Publish setup/build/deployment, architecture/data model and learning/XP documentation.
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
- [ ] Observe a successful GitHub-hosted deployment after pushing the workflow.

- Workflow checks use Node 22 and locked npm dependencies. Runtime-only content validation checks all distributed assets without downloading mutable upstream dictionaries; the default validator still checks local source hashes. GitHub-hosted execution has not yet occurred.

## Updates without losing user data
- [x] Close superseded database connections without deleting or resetting records.
- [x] Test reopening/upgrading with settings, XP, skills, history and sessions.
- [x] Check for upstream app updates on launch, reconnect and hourly while visible.
- [x] Notify with Update now / Later; defer while practising or saving and protect other tabs.
- [x] Stage and verify changed curriculum separately before switching active content.
- [x] Test a real service-worker replacement and compare user-data stores before/after.
- [ ] Commit, push and inspect GitHub Actions results.
- Staged-content module: four tests pass for network discovery, digest failure, interruption/resume and schema rejection. Failed staging preserves the installed generation and never writes learner data.

- Final local update validation: 93 unit/integration tests and both Chromium acceptance tests pass. The browser installs a replacement worker, blocks activation with another tab or active session, switches a verified content generation, compares all learner/settings stores unchanged, and cold-starts offline.
