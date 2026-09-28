/**
 * Real, local, stroke-aware handwriting assessment. See ./README.md for the
 * method, the tolerance rationale, and the measured numbers against the
 * synthetic validation set.
 */
export { KanjiVgAssessor, assess } from './assess';
export { attachStrokeCapture, undoLastStroke } from './capture';
export type { StrokeCaptureController, StrokeCaptureOptions } from './capture';
export { createTraceCoach } from './coach';
export { createAssessorClient } from './client';
export {
  toleranceFor, toleranceForSubmission, TOLERANCE_PRESETS, DEFAULT_TOLERANCE,
} from './tolerance';
export { solveAssignment, countInversions } from './assignment';
export type { AssignmentResult } from './assignment';
export {
  RESAMPLE_POINTS, normaliseGlyph, capturedToPolylines, referenceToPolylines,
  referenceGuideStrokes, capturedGuideStroke, strokePairMetrics,
} from './features';
export type { NormalisedGlyph, NormalisedStroke, StrokePairMetrics, Vec, Box } from './features';
export type {
  Assessor, AssessorClient, AssessRequest, ToleranceProfile, TraceCoach,
} from './ports';
