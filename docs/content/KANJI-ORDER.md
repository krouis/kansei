# Kanji teaching sequence

`data/kanji-top1500.json` remains the unmodified frequency selection (see
[`KANJI-FREQUENCY.md`](KANJI-FREQUENCY.md) for where that list and its 1500 cut
come from). Run `node scripts/content/build-kanji-order.mjs` to generate
`kanji-ordered.json`, `kanji-order.json`, `kanji-lessons.json`, and
`components-ordered.json`.

## The algorithm

Ordering is **pedagogical tier first, frequency and stroke count second** —
this changed from a pure frequency+stroke sort after a 2026-09-30 review found
it put kanji like 氏 ("Mr./Ms.", old-JLPT level 1 — the hardest pre-2010 tier)
inside the first 40 characters taught, purely because news articles say
"Yamada-shi" constantly. No real beginner course does that, and cross-checking
against Minna no Nihongo Shokyu I confirmed it: under the old algorithm only
48% of that course's kanji landed in Kansei's own first 220 teaching slots.

**Tier** is `4 − jlptOldLevel` (so old level 4/elementary → tier 0, level
1/advanced → tier 3), which is KANJIDIC2's `<jlpt>` field — the pre-2010
four-level JLPT, not the current N1–N5 scale (see KANJI-FREQUENCY.md's
`jlptOldLevel` field note for why that distinction matters and must never be
shown to a learner as an "N" level). Where a character has no jlptOldLevel
(rare — mostly jinmeiyō name kanji), MEXT's jōyō school `grade` stands in,
banded to the same four tiers (1–2 → 0, 3–4 → 1, 5–6 → 2, 8/9/null → 3).

Within one tier, the original heuristic still applies: the lowest
`frequencyRank + 18 × strokeCount`, frequency rank as the final tie-break.
That part was always reasonable — it just was never allowed to matter *first*.

## Prerequisites

A taught standalone component is a prerequisite when its stroke count is
strictly lower than the target's, **and its tier is no harder than the
target's**. The tier condition is new, and fixes a real problem the pure
stroke condition alone could not: containment is a visual relationship, not a
semantic one, and without it an elementary kanji could get stuck waiting on an
obscure "shape" prerequisite that happens to have fewer strokes. Concretely:
年 (year), 午 (noon) and 南 (south) all contain 干 as a sub-shape and 干 has
fewer strokes — but 干 is itself old-JLPT level 2 (far harder than these three
elementary level-4 kanji), so under the old rule all three were dragged down
to just after 干, off past position 1000. The tier condition drops that
specific edge (excluded and logged, exactly like a non-strictly-simpler edge
always was) rather than letting a harder character block an easier one.

A strict stroke decrease makes cycles impossible among the *kept* edges.
Self-edges are ignored. Every excluded edge — for either reason — is written
to `kanji-order.json`'s `excludedContainmentEdges`, rather than silently
becoming (or silently failing to become) a prerequisite; there are 184 in the
current data. KanjiVG containment describes graphical decomposition and is
not an etymological claim. This is intentionally not a topological sort of
arbitrary variant/equivalence relationships, which can be cyclic.

## Layout

The 1,500 kanji occupy positions 269–1768 after the kana inventory and are
grouped into 375 lessons of four. Component references are introduced in or
before their first useful lesson. Dictionary radical shapes and related forms
with no direct containment occurrence are introduced with the earliest
character using their radical number or related component. Components retain
a separate dense 1–357 order; their lesson, not that independent counter,
determines availability. Lessons list actual prerequisite lessons. All 1,500
characters have an ordered position. The raw source and provisional component
dataset (`data/kanji-top1500.json`, `data/components.json`) are never
rewritten by this script.

## What the result actually looks like

Tier composition by teaching-position hundred (tier 0 = old-JLPT N5-equivalent
… tier 3 = N1-equivalent or ungraded):

| Position | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| 1–100 | 100 | | | |
| 101–200 | 3 | 97 | | |
| 201–300 | | 89 | 11 | |
| 301–900 | | | 600 | |
| 901–1000 | | | 77 | 23 |
| 1001–1500 | | | | 500 |

Every old-JLPT N5 kanji is taught before any N4 kanji; every N4 before any
N3/N2; every N3/N2 before any N1 or ungraded kanji. This is the property the
2026-09-30 change was for — the previous algorithm had N1-tier kanji as early
as position 33.

Mean frequency rank by teaching decile is no longer monotonic (191.9, 526.1,
259.8, 514.3, 760.7, 981.6, 819.9, 899.0, 1176.3, 1377.2) — under a
tier-primary sort it cannot be: frequency now only orders characters *within*
a tier, and a decile boundary can straddle two tiers with very different
frequency ranges. This is expected and is not a regression; the property that
matters (graded difficulty, above) holds throughout. The executable validator
checks character order density, every prerequisite, and component
introduction timing.
