import type { CharacterEntry, PromptFace } from '@/domain';
import type { Rng } from './rng';
import type { LadderConfig } from './ladder';

/**
 * Prompt typeface selection — rung 4 of the difficulty ladder.
 *
 * A learner who has only ever seen Noto Sans has learned Noto Sans, not the
 * character: printed き and さ join their final stroke, a serif 令 looks unlike a
 * gothic one, and the textbook face matches what a hand actually writes. So once
 * a pair is retained, the prompt face varies among the three the app bundles.
 *
 * Two hard rules override the variation:
 *  - A character whose printed form differs from its taught handwritten form is
 *    shown in the textbook face whenever the learner is being asked to *produce*
 *    it. Copying a joined printed き and being told the shape is wrong would be
 *    the app's fault, not the learner's.
 *  - Below rung 4 the face is always gothic, so font is not a second variable
 *    changing at the same time as something else.
 */
export type FacePurpose =
  /** The learner reads the prompt and answers about it. */
  | 'read'
  /** The learner reproduces the shape (handwriting, or a model in feedback). */
  | 'produce';

const VARIABLE_FACES: readonly PromptFace[] = ['gothic', 'serif', 'textbook'];

export function chooseFace(
  entry: CharacterEntry | null,
  purpose: FacePurpose,
  ladder: LadderConfig,
  random: Rng,
): PromptFace {
  if (purpose === 'produce') return 'textbook';
  if (!ladder.varyFace) return 'gothic';
  if (entry && entry.printVsHandwritten !== null) {
    // Reading a joined printed form is legitimate practice, but pair it with the
    // note content already carries rather than with a silent shape change.
    return VARIABLE_FACES[Math.floor(random() * VARIABLE_FACES.length)] as PromptFace;
  }
  return VARIABLE_FACES[Math.floor(random() * VARIABLE_FACES.length)] as PromptFace;
}

/** Human-readable face name, for the diagnostics panel and for tests. */
export const FACE_LABELS: Record<PromptFace, string> = {
  gothic: 'Gothic (Noto Sans JP)',
  serif: 'Serif (Noto Serif JP)',
  textbook: 'Textbook (Klee One)',
};
