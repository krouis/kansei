# Kanji teaching sequence

`data/kanji-top1000.json` remains the unmodified frequency selection. Run
`node scripts/content/build-kanji-order.mjs` to generate `kanji-ordered.json`,
`kanji-order.json`, `kanji-lessons.json`, and `components-ordered.json`.

The algorithm uses KANJIDIC2 frequency rank and stroke complexity, not frequency
rank as a teaching sequence. Among currently available characters it chooses the
lowest `frequencyRank + 18 × strokeCount`, with frequency rank as the tie-breaker.
The weight is a product heuristic requiring evaluation, not a research result.
Vocabulary utility currently influences the *word selection after ordering*, not
the character ordering score. This is a remaining curriculum refinement.

A taught standalone component is a prerequisite when its stroke count is strictly
lower than the target's. A strict decrease makes cycles impossible. Self-edges are
ignored; any other excluded containment edge is written explicitly to the order
report, rather than silently becoming a prerequisite. Current data has no such
excluded edges. KanjiVG containment describes graphical decomposition and is not
an etymological claim. This is intentionally not a topological sort of arbitrary
variant/equivalence relationships, which can be cyclic.

The 1,000 kanji occupy positions 269–1268 after the kana inventory and are grouped
into 250 lessons of four. Component references are introduced in or before their
first useful lesson. Dictionary radical shapes and related forms with no direct
containment occurrence are introduced with the earliest character using their
radical number or related component. Components retain a separate dense 1–263
order; their lesson, not that independent counter, determines availability.
Lessons list actual prerequisite lessons. All 1,000 characters have an ordered
position. The raw source and provisional component dataset are never rewritten.

Mean frequency rank by teaching decile is 89.90, 164.98, 295.54, 386.46, 474.07,
524.08, 644.68, 665.77, 829.82, 929.70. Lower ranks are more frequent. This shows
frequency preference while permitting simpler prerequisites to appear first; it
does not establish educational effectiveness. The executable validator checks
character order density, every prerequisite, and component introduction timing.
