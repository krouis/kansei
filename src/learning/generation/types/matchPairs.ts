import { asItemId, itemKind, type KanaCharacter, type MatchPair, type Question } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { indexPool } from '../pool';
import { soundAlikeStandalone } from '../homophones';
import { shuffle } from '../rng';
import { baseEnvelope, emptyPrompt, reject } from '../support';

/**
 * Type 5 — Match three character/reading pairs on one screen.
 *
 * Recognition, kana only: pairing a bare glyph with "a reading" is exactly what
 * the ambiguity rules forbid for kanji (a kanji reading needs word context, and
 * a matching screen has none to give), so kanji and vocabulary targets are
 * refused here rather than asked unsafely. All three characters come from one
 * script and no two romanisations — nor any two characters — sound alike, so
 * every pairing has exactly one correct match. The screen is one unit of XP,
 * and per-pair forced-by-elimination bookkeeping happens in the grader
 * (grading/matching.ts), not here: this module only has to make sure the THREE
 * pairs it emits are individually unambiguous.
 */
export function generateMatchPairs(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  if (itemKind(target.itemId) !== 'kana') {
    return reject('match-pairs only applies to kana: a kanji reading needs word context a matching screen cannot give.');
  }
  const index = indexPool(ctx.pool);
  const targetEntry = index.characterById(String(target.itemId)) as KanaCharacter | undefined;
  if (!targetEntry) return reject('Target kana not found in the generation pool.');

  const sameScript = index.kana(targetEntry.script).filter((k) => String(k.id) !== String(targetEntry.id));
  const shuffled = shuffle(sameScript, ctx.random);

  const chosen: KanaCharacter[] = [targetEntry];
  for (const candidate of shuffled) {
    if (chosen.length >= 3) break;
    const clashes = chosen.some(
      (c) => c.romaji === candidate.romaji || soundAlikeStandalone(c.glyph, candidate.glyph),
    );
    if (!clashes) chosen.push(candidate);
  }
  if (chosen.length < 3) return reject('Could not find two more kana with distinct, non-sound-alike readings.');

  const pairs: MatchPair[] = chosen.map((c, i) => ({
    pairId: `p${i}`,
    left: { display: c.glyph, itemId: asItemId(String(c.id)) },
    right: { display: c.romaji, itemId: asItemId(String(c.id)) },
  }));

  const base = baseEnvelope('match-pairs', target, ctx.random);
  const question: Question = {
    ...base,
    prompt: emptyPrompt('Match each character with its reading.'),
    options: null,
    pairs,
    // A matching screen's grade is per-pair; the top-level accepted answer is
    // kept as the target's own reading so a caller that only reads
    // `acceptedAnswers` (e.g. a generic history view) still sees something true.
    acceptedAnswers: [targetEntry.romaji],
    canonicalAnswer: targetEntry.romaji,
    alsoAcceptableNote: null,
    distinction: null,
  };
  return { question, rejected: null };
}
