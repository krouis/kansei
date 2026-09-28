import { CONTEXTUAL_PARTICLES, HOMOPHONOUS_KANA_SETS, audioIsAmbiguous } from '@/domain';

/**
 * Which characters sound the same as which, and — crucially — *where*.
 *
 * `audioIsAmbiguous` in domain/romanization.ts answers the question for a
 * character standing on its own. That is not the same question as "does this
 * character sound the same inside a word", and conflating the two would make the
 * grader accept wrong answers:
 *
 *   - じ/ぢ and ず/づ are the same sound everywhere. Position-independent.
 *   - を is only ever the object particle, and is always pronounced o. Also
 *     position-independent, though it cannot occur inside a word anyway.
 *   - は and へ are pronounced ha and he everywhere EXCEPT when they stand alone
 *     as particles. Expanding はな to わな because "は sounds like わ" would
 *     accept a different word as correct.
 *
 * So the standalone case delegates to the domain helper, and the in-a-word case
 * uses only the sets that hold regardless of position. The particle members are
 * derived from CONTEXTUAL_PARTICLES rather than re-listed, so the two files
 * cannot drift apart.
 */

/** は and へ: spelled one way, pronounced another only in particle position. */
const POSITION_DEPENDENT: ReadonlySet<string> = new Set(
  CONTEXTUAL_PARTICLES.filter((p) => p.asCharacter !== p.asParticle && p.kana !== 'を').map((p) => p.kana),
);

/** Homophone sets whose members sound alike no matter where they appear. */
const POSITION_INDEPENDENT_SETS = HOMOPHONOUS_KANA_SETS.filter(
  (set) => !set.members.some((m) => POSITION_DEPENDENT.has(m)),
);

export interface AudioAmbiguity {
  ambiguous: boolean;
  /** Characters other than the target that produce the same sound. */
  alternatives: string[];
  note: string | null;
}

/** Ambiguity for a character presented on its own (it may be a particle). */
export function standaloneAmbiguity(glyph: string): AudioAmbiguity {
  return audioIsAmbiguous(glyph);
}

/** Ambiguity for a character appearing inside a word. */
export function inWordAmbiguity(glyph: string): AudioAmbiguity {
  for (const set of POSITION_INDEPENDENT_SETS) {
    if (set.members.includes(glyph)) {
      return { ambiguous: true, alternatives: set.members.filter((m) => m !== glyph), note: set.note };
    }
  }
  return { ambiguous: false, alternatives: [], note: null };
}

/** True when `a` and `b` are indistinguishable from audio alone, standing alone. */
export function soundAlikeStandalone(a: string, b: string): boolean {
  if (a === b) return true;
  return standaloneAmbiguity(a).alternatives.includes(b);
}

/**
 * Guard against a combinatorial explosion. A reading with four ambiguous
 * characters would otherwise produce sixteen accepted spellings, which is a sign
 * the question is not worth asking rather than a reason to accept everything.
 */
export const MAX_ACCEPTED_HOMOPHONE_VARIANTS = 8;

export interface HomophoneExpansion {
  /** Every spelling that sounds identical to `reading`, including `reading`. */
  variants: string[];
  /** Notes for each ambiguity that was expanded, de-duplicated. */
  notes: string[];
  /** True when the expansion was abandoned because it grew too large. */
  tooMany: boolean;
}

/**
 * Expand a whole reading into every spelling that sounds the same.
 *
 * Used by the audio→typed format so a learner who hears /hanaji/ and writes
 * はなぢ is not marked wrong for choosing the other legal spelling of the sound.
 */
export function expandHomophoneSpellings(reading: string): HomophoneExpansion {
  let variants: string[] = [''];
  const notes: string[] = [];
  const chars = Array.from(reading);

  for (const ch of chars) {
    const amb = inWordAmbiguity(ch);
    const options = amb.ambiguous ? [ch, ...amb.alternatives] : [ch];
    if (amb.ambiguous && amb.note && !notes.includes(amb.note)) notes.push(amb.note);
    if (variants.length * options.length > MAX_ACCEPTED_HOMOPHONE_VARIANTS) {
      return { variants: [reading], notes, tooMany: true };
    }
    const next: string[] = [];
    for (const prefix of variants) for (const o of options) next.push(prefix + o);
    variants = next;
  }

  // The target spelling first: it is the canonical answer shown in feedback.
  const ordered = [reading, ...variants.filter((v) => v !== reading)];
  return { variants: ordered, notes, tooMany: false };
}
