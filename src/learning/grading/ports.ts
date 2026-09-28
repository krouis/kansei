import type {
  AudioRef, Grade, ItemId, Question, StrokeReference,
} from '@/domain';
import type { AnswerSubmission } from '@/domain';
import type { Grader } from '@/learning/ports';
import type { ToleranceProfile } from '@/handwriting/ports';

/**
 * Grading ports — additive, local to the grader.
 *
 * `Grader` in @/learning/ports is `grade(question, submission)`. Two things the
 * grader genuinely cannot derive from those two arguments alone:
 *
 *  1. The attempt ordinal. `unaidedFirstAttempt` is false for every corrected
 *     retry, and only the session engine knows which attempt this is. It is
 *     passed as an OPTIONAL third argument, so `ContextualGrader` is still
 *     assignable to `Grader` and no shared type changed.
 *  2. The handwriting tolerance profile, which depends on the canvas size and
 *     pointer type the UI actually rendered — physical facts the grader has no
 *     access to. Without one, handwriting is graded against a conservative
 *     default and the default is named in the verdict.
 *
 * `GraderContent` is the read-only content lookup the grader needs for
 * corrective feedback. Every method may legitimately return nothing: when the
 * content pack has no note for a pair, the grader says something true and
 * general rather than inventing a linguistic claim.
 */

export interface GradingContext {
  /** 0 for the graded first attempt; 1+ for corrected retries. Defaults to 0. */
  attemptOrdinal?: number;
  /** Tolerance actually applicable to the surface the learner drew on. */
  tolerance?: ToleranceProfile;
}

export interface ContextualGrader extends Grader {
  grade(question: Question, submission: AnswerSubmission, context?: GradingContext): Promise<Grade>;
}

export interface GraderContent {
  /** Reference strokes for a glyph, or undefined when the pack has none. */
  strokeReference(glyph: string): Promise<StrokeReference | undefined>;
  /**
   * Stroke references for the glyphs this one is documented as confusable with,
   * so the assessor can report a better-matching alternative.
   */
  confusableReferences(glyph: string): Promise<StrokeReference[]>;
  /**
   * The documented note distinguishing two confusable items, verbatim from the
   * content pack. Returns null when the pack documents none — the grader then
   * falls back to a statement that is true without being specific.
   */
  confusableNote(itemId: ItemId, confusedWith: ItemId): string | null;
  /**
   * The item for which `normalisedAnswer` would itself have been correct, if
   * any. This is what makes the confusion table meaningful: "you wrote the
   * reading of シ" is information, "wrong" is not.
   */
  itemForAnswer(normalisedAnswer: string, question: Question): ItemId | null;
  itemForGlyph(glyph: string): ItemId | null;
  /** A recording for the correct answer, for corrective feedback. */
  audioFor(question: Question): AudioRef | null;
}

/**
 * What the feedback panel shows after a graded screen.
 *
 * `Grade` carries only `message` and `distinction` because that is the shared
 * contract; this is the fuller, presentation-ready shape assembled from the
 * question, the grade and the content pack. It adds no new claims — every field
 * is either copied from the question or produced by the grader.
 */
export interface CorrectiveFeedback {
  outcome: Grade['outcome'];
  /** One short line naming what happened. */
  headline: string;
  /** The canonical correct answer, always shown, including after a correct answer. */
  correctAnswer: string;
  /** Answers that are also right but outside what was asked. */
  alsoAcceptable: string | null;
  /** A recording of the answer, where one exists. Never synthesised. */
  audio: AudioRef | null;
  /** ONE sentence naming the specific distinction, or null when none is known. */
  distinction: string | null;
  /** Per-stroke coaching notes, handwriting only. */
  strokeNotes: Array<{ strokeIndex: number; note: string; severity: 'info' | 'warn' }>;
  /** Set when the assessor could not decide; shown verbatim, never as a failure. */
  uncertaintyReason: string | null;
  /** True when a retry is worth offering for this screen. */
  offerRetry: boolean;
}
