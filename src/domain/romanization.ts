/**
 * Romanisation policy.
 *
 * Displayed convention: **modified Hepburn**, because it is what most learner
 * material and most Japanese signage uses. Long vowels are written with a
 * macron in words (とうきょう → Tōkyō) but kana are taught with their plain
 * syllable value (と → to).
 *
 * Three things are kept distinct throughout the app, because conflating them is
 * a common source of learner confusion:
 *
 *  1. **Romanisation** — how the word is spelled in Latin letters: shi, chi, tsu.
 *  2. **Pronunciation** — how it actually sounds, including allophones and the
 *     contextual readings of the particles は (wa), へ (e) and を (o).
 *  3. **IME keystrokes** — what you physically type to produce the kana, which
 *     may be none of the above: し is `shi` *or* `si`, ふ is `fu` *or* `hu`,
 *     じ is `ji` *or* `zi`, and ん often needs `nn`.
 *
 * `displayed` is the Hepburn form shown to the learner. `inputVariants` is the
 * set of typed answers the grader accepts, and always includes the IME spellings
 * so a learner is never marked wrong for typing what their keyboard needs.
 */

export type RomanizationConvention = 'hepburn-modified';

export const DISPLAY_CONVENTION: RomanizationConvention = 'hepburn-modified';

export interface RomanizationEntry {
  kana: string;
  /** Hepburn form shown in the UI. */
  displayed: string;
  /** All accepted typed spellings, lowercase, including Kunrei and IME forms. */
  inputVariants: string[];
  /** Set when pronunciation differs from the romanisation in some context. */
  pronunciationNote: string | null;
  /** Set when the keystrokes needed differ from the displayed romanisation. */
  imeNote: string | null;
}

/**
 * Particles whose pronunciation differs from their spelling. The app teaches the
 * spelling and the contextual sound separately, and grading accepts both where
 * the question does not disambiguate.
 */
export const CONTEXTUAL_PARTICLES: ReadonlyArray<{
  kana: string;
  asCharacter: string;
  asParticle: string;
  explanation: string;
}> = [
  {
    kana: 'は',
    asCharacter: 'ha',
    asParticle: 'wa',
    explanation: 'Written は, but pronounced "wa" when it marks the topic of a sentence.',
  },
  {
    kana: 'へ',
    asCharacter: 'he',
    asParticle: 'e',
    explanation: 'Written へ, but pronounced "e" when it marks a direction or destination.',
  },
  {
    kana: 'を',
    asCharacter: 'wo',
    asParticle: 'o',
    explanation: 'Written を, pronounced "o". It is used almost only as the object marker.',
  },
];

/**
 * Pairs that sound identical in modern standard Japanese. A question generated
 * from audio alone must never demand one specific member of a pair.
 */
export const HOMOPHONOUS_KANA_SETS: ReadonlyArray<{ members: string[]; note: string }> = [
  { members: ['じ', 'ぢ'], note: 'じ and ぢ are pronounced the same; ぢ appears only in a few words.' },
  { members: ['ず', 'づ'], note: 'ず and づ are pronounced the same; づ appears only in a few words.' },
  { members: ['お', 'を'], note: 'を is pronounced like お; it is written only as the object particle.' },
  { members: ['え', 'へ'], note: 'へ as a particle is pronounced like え.' },
  { members: ['わ', 'は'], note: 'は as the topic particle is pronounced like わ.' },
];

/** True when a prompt made only of audio cannot have a single correct spelling. */
export function audioIsAmbiguous(target: string): { ambiguous: boolean; alternatives: string[]; note: string | null } {
  for (const set of HOMOPHONOUS_KANA_SETS) {
    if (set.members.includes(target)) {
      return { ambiguous: true, alternatives: set.members.filter((m) => m !== target), note: set.note };
    }
  }
  return { ambiguous: false, alternatives: [], note: null };
}
