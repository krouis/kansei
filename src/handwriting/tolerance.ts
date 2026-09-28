import type { ToleranceProfile } from './ports';

/**
 * Tolerance profiles.
 *
 * The governing principle is that tolerance describes the *input device and the
 * canvas*, never the learner. A finger on a 220 CSS-pixel square cannot place a
 * stroke as precisely as a stylus on a 520-pixel one, and holding both to the
 * same geometry would punish the phone user for owning a phone. Tolerance is
 * therefore derived from measurable facts — canvas edge length and the browser's
 * reported `pointerType` — and from nothing else.
 *
 * The numbers below are in *normalised units*: 1.0 is the longer edge of the
 * glyph's own bounding box after the aspect-preserving fit in `features.ts`. So
 * `shapeOkDistance = 0.10` means "on average, each point of your stroke may sit
 * a tenth of the character's size away from the reference median and still be
 * called fine".
 *
 * Rationale for the base (stylus, ~320px) figures:
 *  - shapeOkDistance 0.10 — a plausibly-drawn character deviates from the
 *    KanjiVG median by a few percent of its size; 10% leaves roughly 3x headroom
 *    over the deviation measured on our jittered/offset synthetic variants. The
 *    task is to accept recognisable characters, not to grade calligraphy.
 *  - shapeCloseDistance 0.22 — beyond ~0.22 the learner's stroke no longer
 *    overlaps the reference stroke anywhere along most of its length, which is
 *    the point where "different shape" stops being an aesthetic judgement.
 *  - directionDegrees 40 — a 一 written 30° off is still a 一. The ceiling is
 *    kept well under 90° so that a reversed stroke (180°) can never be absorbed
 *    by loosening: even the loosest profile rejects a reversal by a wide margin.
 *  - endpointDistance 0.18 — where a stroke begins matters pedagogically, but
 *    starting a fifth of the character's width off is a nudge, not a failure.
 *  - correctAtOrAbove 0.62 / uncertainBelow 0.45 — set from the measured
 *    confidence distributions of the synthetic set: correct variants cluster
 *    above 0.75 and wrong-character variants below 0.35, so the band between is
 *    genuinely the ambiguous region and is reported as such. See README.md for
 *    the measured numbers.
 */

/** Canvas size the base figures are calibrated for, in CSS pixels. */
const REFERENCE_CANVAS_PX = 320;

const BASE = {
  shapeOkDistance: 0.1,
  shapeCloseDistance: 0.22,
  directionDegrees: 40,
  endpointDistance: 0.18,
} as const;

/**
 * Per-device slack.
 *
 * - `pen`: 1.0. A stylus reports fine-grained positions and the learner can see
 *   the tip, so no extra slack is warranted.
 * - `touch`: 1.5. The contact patch is several millimetres wide and the finger
 *   hides the stroke being drawn.
 * - `mouse`: 1.3 on geometry but only 1.15 on direction. A mouse is positionally
 *   precise and angularly honest; what it is bad at is smooth curves, so the
 *   slack belongs in shape, not in direction.
 * - `unknown`: treated as touch, because guessing generously is the safe error.
 */
const DEVICE_SLACK: Record<ToleranceProfile['pointerType'], { geometry: number; direction: number }> = {
  pen: { geometry: 1.0, direction: 1.0 },
  touch: { geometry: 1.5, direction: 1.35 },
  mouse: { geometry: 1.3, direction: 1.15 },
  unknown: { geometry: 1.5, direction: 1.35 },
};

/**
 * Size factor.
 *
 * Achievable precision scales with the physical size of the drawing surface, so
 * a smaller canvas gets proportionally looser geometry — but only within limits.
 * The cap at 1.6 exists because past a point the problem is not tolerance but
 * that the canvas is too small to write in; the floor at 0.85 exists because a
 * huge canvas does not make a beginner's hand steadier.
 */
function sizeFactor(canvasPx: number): number {
  const px = Number.isFinite(canvasPx) && canvasPx > 0 ? canvasPx : REFERENCE_CANVAS_PX;
  return Math.min(1.6, Math.max(0.85, REFERENCE_CANVAS_PX / px));
}

export function toleranceFor(canvasPx: number, pointerType: ToleranceProfile['pointerType']): ToleranceProfile {
  const slack = DEVICE_SLACK[pointerType];
  const size = sizeFactor(canvasPx);
  const geo = slack.geometry * size;
  // Direction slack is damped relative to size: a small canvas makes positions
  // imprecise but does not rotate the learner's hand.
  const dir = slack.direction * (1 + (size - 1) * 0.5);

  return {
    id: `${pointerType}-${Math.round(canvasPx)}px`,
    canvasPx,
    pointerType,
    shapeOkDistance: round3(BASE.shapeOkDistance * geo),
    shapeCloseDistance: round3(BASE.shapeCloseDistance * geo),
    // Hard ceiling at 65°: above that the notion of "this stroke goes that way"
    // is no longer being tested, and a reversal must stay unambiguously outside.
    directionDegrees: Math.min(65, Math.round(BASE.directionDegrees * dir)),
    endpointDistance: Math.min(0.38, round3(BASE.endpointDistance * geo)),
    // Confidence bands are NOT loosened by device. Loosening them would change
    // what "you wrote this character" means depending on the hardware; the slack
    // for hardware belongs in the geometry that feeds the confidence instead.
    uncertainBelow: 0.45,
    correctAtOrAbove: 0.62,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Named profiles, for tests, About & Science copy, and as a fallback when the
 * canvas has not been measured yet.
 */
export const TOLERANCE_PRESETS = {
  /** Phone, drawn with a finger. The loosest profile Kansei uses. */
  phoneFinger: toleranceFor(220, 'touch'),
  /** Tablet or desktop, drawn with a finger. */
  tabletFinger: toleranceFor(420, 'touch'),
  /** Tablet with a stylus. The tightest profile Kansei uses. */
  tabletStylus: toleranceFor(520, 'pen'),
  /** Desktop, drawn with a mouse or trackpad. */
  desktopMouse: toleranceFor(360, 'mouse'),
} as const;

/** Safe default before the canvas has been laid out and a pointer has been seen. */
export const DEFAULT_TOLERANCE: ToleranceProfile = toleranceFor(REFERENCE_CANVAS_PX, 'unknown');

/**
 * Chooses a profile from what actually happened: the canvas as laid out and the
 * pointer type the strokes were drawn with.
 *
 * `pointerTypes` is the set of types seen across the submitted strokes. When a
 * submission mixes devices — genuinely possible, e.g. a stylus stroke followed
 * by a palm-corrected finger stroke — the loosest applicable profile wins,
 * because the tightest one would penalise strokes it does not describe.
 */
export function toleranceForSubmission(canvasPx: number, pointerTypes: ReadonlyArray<ToleranceProfile['pointerType']>): ToleranceProfile {
  if (pointerTypes.length === 0) return toleranceFor(canvasPx, 'unknown');
  const order: Array<ToleranceProfile['pointerType']> = ['pen', 'mouse', 'touch', 'unknown'];
  let loosest: ToleranceProfile['pointerType'] = 'pen';
  for (const t of pointerTypes) {
    if (order.indexOf(t) > order.indexOf(loosest)) loosest = t;
  }
  return toleranceFor(canvasPx, loosest);
}
