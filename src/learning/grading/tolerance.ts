import type { ToleranceProfile } from '@/handwriting/ports';

/**
 * Handwriting tolerance defaults.
 *
 * Tolerance is a property of the input surface, never of the learner: a finger
 * on a phone-sized canvas cannot place a point as precisely as a stylus on a
 * tablet, so holding both to the same geometry would mark accurate finger
 * writing as wrong. The numbers below are normalised to the canvas (0..1), and
 * they are a product judgement, not a measured threshold — the assessor owns the
 * scoring, this only says how much slack it is given.
 *
 * `uncertainBelow` matters most: between it and `correctAtOrAbove` the assessor
 * reports 'uncertain', which the UI must present as "not sure", never as a
 * failure, because a wrong verdict on handwriting is worse than no verdict.
 */
const BASE = {
  shapeOkDistance: 0.055,
  shapeCloseDistance: 0.11,
  directionDegrees: 40,
  endpointDistance: 0.13,
  uncertainBelow: 0.45,
  correctAtOrAbove: 0.68,
} as const;

/** Extra slack for coarse pointers, as a multiplier on the distance tolerances. */
const POINTER_SLACK: Record<ToleranceProfile['pointerType'], number> = {
  pen: 1,
  mouse: 1.25,
  touch: 1.45,
  unknown: 1.45,
};

/**
 * A canvas smaller than this (CSS px) cannot express fine geometry, so the
 * distance tolerances are scaled up below it. Above it they stop tightening:
 * a bigger canvas does not make a learner's hand steadier.
 */
const REFERENCE_CANVAS_PX = 320;

export function toleranceFor(
  pointerType: ToleranceProfile['pointerType'],
  canvasPx: number,
): ToleranceProfile {
  const slack = POINTER_SLACK[pointerType] * Math.max(1, REFERENCE_CANVAS_PX / Math.max(80, canvasPx));
  return {
    id: `kansei-default/${pointerType}/${Math.round(canvasPx)}`,
    canvasPx,
    pointerType,
    shapeOkDistance: BASE.shapeOkDistance * slack,
    shapeCloseDistance: BASE.shapeCloseDistance * slack,
    directionDegrees: BASE.directionDegrees * Math.min(1.4, slack),
    endpointDistance: BASE.endpointDistance * slack,
    uncertainBelow: BASE.uncertainBelow,
    correctAtOrAbove: BASE.correctAtOrAbove,
  };
}

/**
 * Tolerance inferred from what the learner actually drew with, used only when
 * the caller did not supply a profile. The canvas size is unknowable here, so
 * the reference size is assumed and named in the profile id — a grader that
 * guessed silently would be hiding a real uncertainty.
 */
export function inferredTolerance(pointerType: ToleranceProfile['pointerType']): ToleranceProfile {
  const profile = toleranceFor(pointerType, REFERENCE_CANVAS_PX);
  return { ...profile, id: `${profile.id}/assumed-canvas` };
}
