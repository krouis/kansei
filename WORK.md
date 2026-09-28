# Kansei implementation checklist

The original product brief is the acceptance target. A module or dataset is not
a delivered feature until it is connected to the application and verified.
Updated as implementation proceeds; unchecked items are not release claims.

## Baseline and reliability
- [x] Inspect repository, Claude session/workflow records, and temporary artifacts.
- [x] Verify all five downloaded source archives/files against the source lock.
- [x] Establish baseline: 53 automated tests; 32 independent kana checks and schema check pass.
- [ ] Preserve useful independent content verifiers in the repository.
- [ ] Commit inherited unfinished work in focused, reviewed changes.
- [ ] Fix TypeScript configuration and establish reproducible build/check commands.
- [ ] Save first attempts, scheduling, and session state atomically.
- [ ] Award question XP after feedback acknowledgement; atomically save cursor and bonus.
- [ ] Persist linked-round length across reloads; reject stale/concurrent answers.
- [ ] Await delayed revisits and preserve their skill and reading across series.
- [ ] Schedule uncertain handwriting rechecks without a memory penalty.

## First usable offline learning flow
- [ ] Assemble reproducible kana packs with byte counts, hashes, and attribution.
- [ ] Wire database, settings, content, audio, grader, scheduler, and session engine.
- [ ] Add application entry point and error/loading states.
- [ ] Add brief onboarding: goal, scripts/modes, install size/progress, honest offline status.
- [ ] Implement choice, typed/IME, and keyboard matching exercises.
- [ ] Implement handwriting canvas, undo/clear, trace/recall, coaching and reference replay.
- [ ] Add hints, reveal, decline, audio replay, corrective feedback and guided retry.
- [ ] Complete ten screens, retain first attempt, award 20 XP, resume after closure.
- [ ] Verify production build and network-disabled cold start with real content.

## Complete curriculum
- [ ] Derive all 1,000 kanji teaching positions and lessons; resolve prerequisite cycles explicitly.
- [ ] Finalize component introductions and implement component exercises.
- [ ] Select useful JMdict vocabulary, gated on introduced characters.
- [ ] Derive word-specific readings conservatively; reject ambiguous alignment.
- [ ] Assemble complete curriculum packs and validate IDs, prerequisites, assets, hashes and licenses.
- [ ] Expand real native-speaker audio coverage; review recording quality and matching.
- [ ] Source legitimate handwriting variants; validate using real human input.

## Product workflows
- [ ] Character explorer: gojuon, groups, search, filters, separate skill states/due status.
- [ ] Revision view: readings, components, words, audio, animation, trace, recall, history, focused practice.
- [ ] Placement assessing only the skills actually tested.
- [ ] Progress: historical goals, XP ranges/calendar, sessions/time, skill accuracy, retention and confusions.
- [ ] Settings: modes, theme, text/motion, storage, content management, versioned backup transfer.
- [ ] Reminders: in-app schedule, quiet hours/snooze/pause, honest recurring calendar export.
- [ ] Offline About & Science and teaching/content sources, with research limitations.

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
