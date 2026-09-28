import type { Settings, SkillState } from '@/domain';

/**
 * The difficulty ladder.
 *
 * The rule the whole ladder exists to enforce: **raise difficulty along one axis
 * at a time**. If scaffolding is withdrawn, distractors sharpened, the font
 * changed and the target lengthened all in the same step, a wrong answer says
 * nothing — there is no way to tell which change caused it, so neither the
 * learner nor the scheduler learns anything from the failure.
 *
 * The rungs, in order. Each adds exactly one axis and keeps everything below it:
 *
 *   0  baseline          rōmaji support on, unrelated distractors, gothic face,
 *                        single character, the kanji's primary reading only.
 *   1  scaffolding       rōmaji support withdrawn (see scaffold.ts).
 *   2  distractors       distractors become related: same row, same column,
 *                        same component, same reading, the real confusables.
 *   3  spacing           NOTHING changes in generation. The review interval
 *                        lengthens, which is the scheduler's axis. This rung is
 *                        kept in the list so the ladder as documented is the
 *                        ladder as implemented, with one rung visibly not ours.
 *   4  rendering         the prompt is shown in a different legitimate face
 *                        (gothic / serif / textbook), and recorded voices vary
 *                        where more than one clip exists.
 *   5  length            short words and longer kana sequences instead of single
 *                        characters.
 *   6  mixed script      vocabulary that mixes kanji with kana.
 *   7  extra readings    readings beyond the kanji's primary one, in context.
 *
 * The rung is derived from the pair's own state, not from a global level: a
 * learner can be at rung 6 for か and rung 0 for ぬ on the same screen.
 */
export const LADDER_RUNGS = [
  'baseline',
  'scaffolding',
  'distractors',
  'spacing',
  'rendering',
  'length',
  'mixed-script',
  'extra-readings',
] as const;

export type LadderRungName = (typeof LADDER_RUNGS)[number];

export const MAX_RUNG = LADDER_RUNGS.length - 1;

export interface LadderConfig {
  rung: number;
  rungName: LadderRungName;
  /** Distractors may be drawn from confusables and other close neighbours. */
  relatedDistractors: boolean;
  /** The prompt face may vary from the default gothic. */
  varyFace: boolean;
  /** Longest kana reading a target word may have. */
  maxWordReadingLength: number;
  /** Vocabulary mixing kanji and kana may be used. */
  allowMixedScript: boolean;
  /** Readings other than the kanji's first-declared one may be asked. */
  allowSecondaryReadings: boolean;
  /** One-line explanation, for the practice screen's "why this question" panel. */
  explanation: string;
}

/**
 * Map a pair's state onto a rung.
 *
 * The thresholds are a product choice, not a validated finding, and are labelled
 * as such in About & Science. What matters for correctness is that the function
 * is monotone: more evidence never lowers the rung, so difficulty cannot
 * oscillate between screens.
 */
export function ladderRung(state: SkillState | null): number {
  if (state === null) return 0;
  switch (state.stage) {
    case 'unseen':
      return 0;
    case 'learning':
      // One unaided success is not enough to take the rōmaji away.
      return state.streak >= 2 ? 1 : 0;
    case 'consolidating':
      // Rung 3 is the scheduler's; entering it from here is what "longer spacing
      // before anything else changes" means in practice.
      return state.streak >= 3 ? 3 : 2;
    case 'retained': {
      // Spaced successes, not raw streak: a run of correct answers inside one
      // session is not evidence of retention over days.
      const extra = Math.min(3, Math.max(0, state.spacedSuccesses - 2));
      return 4 + extra;
    }
    default:
      return 0;
  }
}

export function ladderFor(state: SkillState | null, settings: Settings): LadderConfig {
  const rung = Math.min(MAX_RUNG, ladderRung(state));
  const rungName = LADDER_RUNGS[rung] as LadderRungName;
  return {
    rung,
    rungName,
    relatedDistractors: rung >= 2,
    varyFace: rung >= 4,
    // Two kana at the baseline means single characters and yōon only; the limit
    // rises one rung at a time rather than jumping to "any word".
    maxWordReadingLength: rung >= 6 ? 8 : rung >= 5 ? 4 : 2,
    allowMixedScript: rung >= 6 && settings.activeScripts.includes('kanji'),
    allowSecondaryReadings: rung >= 7,
    explanation: RUNG_EXPLANATIONS[rungName],
  };
}

export const RUNG_EXPLANATIONS: Record<LadderRungName, string> = {
  baseline: 'New material: rōmaji support is on and the other options are unrelated characters.',
  scaffolding: 'The rōmaji support has been taken away — everything else is unchanged.',
  distractors: 'The other options are now characters that look or sound close to this one.',
  spacing: 'The question is the same; the gap since you last saw it has grown.',
  rendering: 'Shown in a different typeface, so the character is recognised rather than the font.',
  length: 'Asked inside a short word instead of on its own.',
  'mixed-script': 'Asked in a word that mixes kanji with kana.',
  'extra-readings': 'Asked for a reading beyond this kanji’s most common one.',
};
