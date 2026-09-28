# Question generation

Implements `Generator` (`src/learning/ports.ts`): given a `SelectedTarget` from
the selector and a `GenerationContext`, produce one `Question`, or explain why
none could be produced. Generation never decides *when* a pair is reviewed
(the scheduler) or *which* pairs make up a series (the selector) — it only
turns one chosen pair into a concrete, safe question.

## The ten formats

`specs.ts` is the single source of truth for what each format claims to
measure. It is rendered verbatim in About & Science, so treat the `scoring`
and `ambiguityChecks` prose in that file as user-facing copy, not as an
internal comment.

| # | Type | Skill | Evidence | Response |
|---|------|-------|----------|----------|
| 1 | `audio-to-character-choice` | listening | weak | choice |
| 2 | `romaji-to-kana-choice` | recognition | weak | choice |
| 3 | `character-to-reading-choice` | recognition | weak | choice |
| 4 | `character-to-reading-typed` | readingRecall | strong | typed |
| 5 | `match-pairs` | recognition | weak | matching |
| 6 | `audio-to-typed` | listening | strong | typed |
| 7 | `prompt-to-handwriting` | handwriting | strong | handwriting |
| 8 | `confusable-discrimination` | recognition | moderate | choice |
| 9 | `word-reading` | readingRecall | strong | typed |
| 10 | `kanji-in-word-context` | readingRecall | strong | typed |

Each format's module lives under `types/` and exports one function:
`(target, ctx) => { question: Question | null; rejected: string | null }`.
A generator returns `null` rather than emitting a degraded question — missing
audio, missing stroke data, too few safe distractors, or a kanji reading with
no example word are all reasons to reject, never reasons to guess.

## The ambiguity rules, and where each is enforced

- **Specify the script.** `romaji-to-kana-choice` always distractors from the
  *same* script and names it in the instruction; `confusable-discrimination`
  does the same, so a cross-script look-alike (り/リ) is a genuinely wrong
  option rather than a second right one.
- **Never force a unique answer from ambiguous audio.** `homophones.ts` splits
  this into the standalone case (じ/ぢ, ず/づ, を/お — audio alone truly cannot
  decide) and the in-a-word case, which additionally excludes は/へ: those two
  only diverge from their spelling in particle position, and expanding はな to
  わな because "は sounds like わ" would accept a different word as correct.
  Choice formats (`audio-to-character-choice`) resolve this by **excluding**
  homophones from the distractor pool, so the single option shown is
  unambiguous; typed formats (`audio-to-typed`) resolve it by **accepting**
  every homophonous spelling via `expandHomophoneSpellings`.
- **Kanji homophones and multiple readings need context.** Every kanji reading
  format (`character-to-reading-choice`'s kanji branch, `character-to-reading-
  typed` refuses kanji outright, `word-reading`, `kanji-in-word-context`,
  `prompt-to-handwriting`'s kanji branch) requires a taught word that actually
  demonstrates the reading, via `PoolIndex.wordsDemonstrating`. A reading with
  no example word is not taught and is never asked about.
- **No second valid answer among distractors.** Enforced twice: each
  generator's own distractor selection (`distractors.ts`'s `forbid` callback),
  and then mechanically by `validate.ts`, which every generated question must
  pass before the composite generator will return it — a question with two
  correct options, a duplicate option, or a distractor that is itself an
  accepted answer is rejected, not merely logged.
- **Copying displayed rōmaji is not recall.** `scaffold.ts`'s
  `scaffoldWouldLeakAnswer` withholds the rōmaji scaffold whenever showing it
  would let the learner type it back (directly, or via an IME into kana).
  `character-to-reading-typed` withholds the scaffold unconditionally, because
  on that format the scaffold *is* the answer.
- **IME practice is tracked apart from reading recall.** `audio-to-typed`,
  `word-reading` and `kanji-in-word-context` all set `alsoExercises:
  ['imeInput']` in their spec; the session engine records IME use against the
  auxiliary counters, never against `readingRecall`.

## The difficulty ladder

`ladder.ts` maps a pair's `SkillState` to one rung, monotonically — more
evidence never lowers the rung, so difficulty cannot oscillate between
screens. Exactly one axis changes per rung:

```
0 baseline    rōmaji shown, unrelated distractors, gothic face, single
              character, primary reading only
1 scaffolding rōmaji withdrawn
2 distractors distractors become related (same row/column/component/reading,
              real confusables)
3 spacing     the scheduler's axis — nothing changes here, kept in the list so
              the ladder as documented matches the ladder as implemented
4 rendering   prompt face varies (gothic / serif / textbook); the reference
              model in feedback is ALWAYS the textbook face
5 length      short words instead of single characters
6 mixed-script vocabulary mixing kanji and kana
7 extra-readings readings beyond the kanji's first-taught one, in context
```

`composite.ts`'s `candidatesFor` uses the ladder only to decide *which order*
to try formats in for `recognition` (confusable-discrimination first once
related distractors are allowed) — it does not gate a format on/off by rung
beyond that, since the harder rungs (5-7) are expressed through which
*target* the selector chose (a longer word, a secondary reading) rather than
through the generator refusing a rung it considers too low.

## Known, disclosed gaps

- **Components have no question format.** `GenerationContext.pool` does not
  carry the component table (it is `{ characters, vocab, readings? }`), so
  even though the selector can choose a component as a handwriting or
  recognition target, no generator here can act on one. The composite
  generator's `candidatesFor` still returns handwriting/recognition
  candidates for a component target, every one of which rejects the target
  as an unrecognised kind, and the caller sees an honest "every candidate was
  rejected" rather than a silent skip. Fixing this requires widening the pool
  type, which is a port change beyond this module's scope.
- **`word-reading`'s `inputScript` override.** The spec table says `'kana'`
  for this format, which is correct for a kanji word; a kana-only word (ねこ)
  overrides it to `'romaji'` at generation time, because the reading of an
  all-kana word IS its own spelling, and asking for it back in kana would put
  the answer on screen. This is documented in the generator itself
  (`types/wordReading.ts`) rather than in the frozen spec table, since the
  override is a per-question fact, not a per-format one.
- **Match-pairs is kana-only.** A kanji reading needs word context to be
  unambiguous, and a three-pair matching screen has none to give (a bare
  glyph next to a bare reading is exactly the "reading without context"
  problem the ambiguity rules forbid). Kanji recognition is asked instead via
  `character-to-reading-choice` or `confusable-discrimination`.
- **No synthesised audio, ever.** Every audio-dependent format checks
  `ctx.hasAudio` and pulls the real `AudioRef` via `ctx.audio`; if either is
  absent, the format rejects. There is no fallback path, by design.

## Determinism

Every random decision — which distractors, which permutation, which face —
goes through the `random: () => number` function on `GenerationContext`
(`rng.ts`'s `mulberry32` is the seeded implementation used in tests and for
session replay). `Math.random` is never called anywhere under this directory;
a grep for it in CI would be a reasonable regression test.
