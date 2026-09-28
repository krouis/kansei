import type { CapturedStroke, HandwritingVerdict, StrokeReference } from '@/domain';

/**
 * Handwriting ports.
 *
 * Assessment is stroke-aware and local: it compares the ordered strokes the
 * learner produced against a validated reference, and reports identity, count,
 * order, direction and shape as separate results. It is not image OCR, and it
 * never fabricates a verdict — when the evidence does not support a decision it
 * returns `uncertain`, which the UI presents as "not sure", never as a failure.
 */

export interface AssessRequest {
  /** The character the learner was asked to write. */
  targetGlyph: string;
  reference: StrokeReference;
  strokes: CapturedStroke[];
  /** 'learning' gives per-stroke coaching; 'recall' assesses after submission. */
  mode: 'learning' | 'recall';
  /**
   * Tolerance profile. A finger on a 3-inch canvas is held to looser geometry
   * than a stylus on a tablet; the profile is chosen from the pointer type and
   * the canvas size, not from the learner's skill.
   */
  tolerance: ToleranceProfile;
  /**
   * Characters that could plausibly have been written instead, so the assessor
   * can report a better-matching alternative. Usually the target's confusables.
   */
  alternatives: StrokeReference[];
}

export interface ToleranceProfile {
  id: string;
  /** Canvas edge length in CSS pixels, which bounds achievable precision. */
  canvasPx: number;
  pointerType: 'touch' | 'pen' | 'mouse' | 'unknown';
  /** Max mean point-to-reference distance, in normalised units, still 'ok'. */
  shapeOkDistance: number;
  shapeCloseDistance: number;
  /** Angular tolerance for stroke direction, in degrees. */
  directionDegrees: number;
  /** How far a stroke's start may sit from the reference start and still match. */
  endpointDistance: number;
  /**
   * The three confidence bands, in order:
   *   < uncertainBelow                        → 'incorrect' (confidently wrong)
   *   >= uncertainBelow and < correctAtOrAbove → 'uncertain' (genuinely ambiguous)
   *   >= correctAtOrAbove                     → 'correct'
   * The middle band exists because a confidence near the boundary is not weak
   * evidence of failure, it is an assessment the geometry cannot decide — and
   * the product rule is that such cases say so rather than guessing wrong.
   */
  uncertainBelow: number;
  correctAtOrAbove: number;
}

export interface Assessor {
  readonly id: string;
  readonly version: string;
  assess(request: AssessRequest): Promise<HandwritingVerdict>;
}

/** Per-stroke coaching while tracing, delivered as each stroke finishes. */
export interface TraceCoach {
  /** Which reference stroke the learner should draw next. */
  expectedStrokeIndex: number;
  evaluateStroke(stroke: CapturedStroke, expectedStrokeIndex: number, request: Omit<AssessRequest, 'strokes'>): {
    accepted: boolean;
    /** One short, specific, non-judgemental sentence. */
    coaching: string;
    /** Direction/start-point problems worth showing inline. */
    issues: Array<'wrong-direction' | 'wrong-start' | 'too-short' | 'out-of-order' | 'off-guide'>;
  };
}

/** Off-main-thread execution. Assessment must never block a stroke being drawn. */
export interface AssessorClient {
  assess(request: AssessRequest): Promise<HandwritingVerdict>;
  /** True when a real worker is running; false when it fell back to the main thread. */
  readonly usingWorker: boolean;
  terminate(): void;
}
