import type { HandwritingAspect, HandwritingVerdict, StrokeReference } from '@/domain';
import type { AssessRequest, Assessor } from './ports';
import { solveAssignment, countInversions } from './assignment';
import {
  capturedToPolylines, normaliseGlyph, referenceToPolylines, strokePairMetrics,
  type NormalisedGlyph, type NormalisedStroke,
} from './features';

/**
 * The stroke-aware assessor.
 *
 * Assesses identity, stroke count, stroke order, stroke direction and shape as
 * FIVE INDEPENDENT aspects and never collapses them into one score — `confidence`
 * is a separate, weighted summary computed for the single purpose of choosing an
 * outcome band (correct / uncertain / incorrect), and the UI is expected to show
 * the five aspects, not just the summary.
 *
 * Method, in one pass:
 *  1. Normalise the learner's strokes and the reference's strokes into the same
 *     aspect-preserving unit box (features.ts).
 *  2. Solve the optimal assignment between them on a direction-invariant shape
 *     cost (assignment.ts) — this is what tells an ORDER error (two strokes
 *     drawn in swapped positions) apart from two independent SHAPE errors.
 *  3. Score stroke count from the size mismatch the assignment leaves
 *     unassigned; stroke order from how inverted the assigned permutation is;
 *     stroke direction from each matched pair's forward-vs-reversed fit and
 *     chord angle; shape from each matched pair's placed distance.
 *  4. Identity is decided by running the SAME fit computation against every
 *     supplied alternative reference and comparing: the target only counts as
 *     identified when it fits distinctly better than every alternative.
 *  5. Confidence combines the aspects into one number used ONLY to pick the
 *     outcome band, per the three-band contract on ToleranceProfile.
 */
export class KanjiVgAssessor implements Assessor {
  readonly id = 'kansei-stroke-assessor';
  readonly version = '1.0.0';

  async assess(request: AssessRequest): Promise<HandwritingVerdict> {
    return assess(request);
  }
}

/** Per-target fit: how well one set of learner strokes matches one reference. */
interface GlyphFit {
  assignment: ReturnType<typeof solveAssignment>;
  matched: Array<{ learnerIdx: number; refIdx: number; metrics: ReturnType<typeof strokePairMetrics> }>;
  countDiff: number;
  maxCount: number;
  orderInversionRatio: number;
  meanShapeDistance: number;
  reversedCount: number;
  directionOffenderCount: number;
  endpointOffenderCount: number;
  /** 0..1, higher is a better fit. Used to rank the target against alternatives. */
  fitScore: number;
}

function computeFit(learner: NormalisedGlyph, reference: NormalisedGlyph, tol: AssessRequest['tolerance']): GlyphFit {
  const rows = learner.strokes.length;
  const cols = reference.strokes.length;
  const cost: number[][] = [];
  const metricsGrid: ReturnType<typeof strokePairMetrics>[][] = [];
  for (let i = 0; i < rows; i += 1) {
    const costRow: number[] = [];
    const metricsRow: ReturnType<typeof strokePairMetrics>[] = [];
    for (let j = 0; j < cols; j += 1) {
      const m = strokePairMetrics(learner.strokes[i] as NormalisedStroke, reference.strokes[j] as NormalisedStroke);
      // The assignment cost blends direction-invariant shape and turning
      // distance; direction itself is judged AFTER assignment, on the pair the
      // assignment settles on, so a reversed stroke is never punished twice by
      // also being assigned to the wrong partner to "explain away" the reversal.
      costRow.push(0.7 * m.traceDistance + 0.3 * m.turningDistance);
      metricsRow.push(m);
    }
    cost.push(costRow);
    metricsRow.length && metricsGrid.push(metricsRow);
  }
  const assignment = solveAssignment(cost, rows, cols);

  const matched: GlyphFit['matched'] = [];
  for (let i = 0; i < rows; i += 1) {
    const j = assignment.rowToCol[i];
    if (j !== undefined && j >= 0) matched.push({ learnerIdx: i, refIdx: j, metrics: metricsGrid[i]![j]! });
  }

  const maxCount = Math.max(rows, cols, 1);
  const countDiff = Math.abs(rows - cols);

  // Order: how inverted is the sequence of reference indices the assignment
  // produced, read in the learner's drawing order? A learner who draws strokes
  // in the reference's own order gets the identity permutation (0 inversions).
  const matchedColsInDrawOrder = matched
    .slice()
    .sort((a, b) => a.learnerIdx - b.learnerIdx)
    .map((m) => m.refIdx);
  // Re-rank onto a dense 0..k-1 permutation so inversion counting is meaningful
  // even when some reference strokes were left unmatched.
  const rank = new Map([...matchedColsInDrawOrder].sort((a, b) => a - b).map((v, i) => [v, i]));
  const dense = matchedColsInDrawOrder.map((v) => rank.get(v) as number);
  const { inversions, maxInversions } = countInversions(dense);
  const orderInversionRatio = maxInversions > 0 ? inversions / maxInversions : 0;

  let shapeSum = 0;
  let reversedCount = 0;
  let directionOffenderCount = 0;
  let endpointOffenderCount = 0;
  for (const { metrics } of matched) {
    shapeSum += metrics.traceDistance;
    if (metrics.reversedFitsBetter) reversedCount += 1;
    if (metrics.directionDegrees !== null && Math.abs(metrics.directionDegrees) > tol.directionDegrees) {
      directionOffenderCount += 1;
    }
    if (metrics.startDistance > tol.endpointDistance) endpointOffenderCount += 1;
  }
  const meanShapeDistance = matched.length > 0 ? shapeSum / matched.length : 1;

  // fitScore: 1 is a perfect match. Penalise count mismatch, mean shape
  // distance (relative to the 'close' threshold, past which a stroke no longer
  // meaningfully overlaps its reference), and inversion ratio. Direction is
  // deliberately NOT in fitScore — identity is about which character this is,
  // and a reversed-but-otherwise-right stroke is still recognisably the same
  // character, just written with a coaching-worthy direction error.
  const countPenalty = countDiff / maxCount;
  const shapePenalty = Math.min(1, meanShapeDistance / Math.max(tol.shapeCloseDistance, 1e-6));
  const fitScore = Math.max(0, 1 - (0.45 * countPenalty + 0.4 * shapePenalty + 0.15 * orderInversionRatio));

  return {
    assignment, matched, countDiff, maxCount, orderInversionRatio, meanShapeDistance,
    reversedCount, directionOffenderCount, endpointOffenderCount, fitScore,
  };
}

function aspectFromRatio(badRatio: number, okAt: number, closeAt: number): HandwritingAspect {
  const score = Math.max(0, 1 - badRatio);
  const status: HandwritingAspect['status'] = badRatio <= okAt ? 'ok' : badRatio <= closeAt ? 'close' : 'off';
  return { status, score, detail: null };
}

export function assess(request: AssessRequest): HandwritingVerdict {
  const { strokes, reference, alternatives, tolerance: tol } = request;

  if (strokes.length === 0) {
    return uncertainVerdict('No strokes were captured.');
  }
  const totalPoints = strokes.reduce((sum, s) => sum + s.points.length, 0);
  if (totalPoints < strokes.length * 2) {
    return uncertainVerdict('Too few points were captured to assess this attempt — try drawing a little slower.');
  }

  const learnerGlyph = normaliseGlyph(capturedToPolylines(strokes));
  if (learnerGlyph.degenerate) {
    return uncertainVerdict('The drawing was too small or flat to compare against a reference.');
  }
  const referenceGlyph = normaliseGlyph(referenceToPolylines(reference));

  const targetFit = computeFit(learnerGlyph, referenceGlyph, tol);
  const altFits = alternatives.map((alt) => ({
    ref: alt,
    fit: computeFit(learnerGlyph, normaliseGlyph(referenceToPolylines(alt)), tol),
  }));

  const bestAlt = altFits.reduce<{ ref: StrokeReference; fit: GlyphFit } | null>(
    (best, cur) => (best === null || cur.fit.fitScore > best.fit.fitScore ? cur : best),
    null,
  );

  // Identity margin: an alternative has to fit MEASURABLY better to change the
  // verdict, so noise between two very close fits does not flip the identity
  // call back and forth between otherwise-identical attempts.
  const IDENTITY_MARGIN = 0.08;
  let identity: HandwritingAspect;
  let bestAlternative: HandwritingVerdict['bestAlternative'] = null;
  if (bestAlt && bestAlt.fit.fitScore > targetFit.fitScore + IDENTITY_MARGIN) {
    identity = { status: 'off', score: targetFit.fitScore, detail: `Closer to ${bestAlt.ref.glyph}.` };
    bestAlternative = { glyph: bestAlt.ref.glyph, confidence: bestAlt.fit.fitScore };
  } else if (bestAlt && bestAlt.fit.fitScore > targetFit.fitScore - IDENTITY_MARGIN) {
    identity = { status: 'close', score: targetFit.fitScore, detail: `Also close to ${bestAlt.ref.glyph}.` };
    bestAlternative = { glyph: bestAlt.ref.glyph, confidence: bestAlt.fit.fitScore };
  } else {
    identity = { status: targetFit.fitScore >= 0.75 ? 'ok' : 'close', score: targetFit.fitScore, detail: null };
  }

  const strokeCount: HandwritingAspect = aspectFromRatio(targetFit.countDiff / targetFit.maxCount, 0, 1 / targetFit.maxCount);
  const strokeOrder = aspectFromRatio(targetFit.orderInversionRatio, 0, 0.34);
  const matchedCount = Math.max(1, targetFit.matched.length);
  const strokeDirection = aspectFromRatio(targetFit.directionOffenderCount / matchedCount, 0, 0.2);
  const shapeStatus: HandwritingAspect['status'] =
    targetFit.meanShapeDistance <= tol.shapeOkDistance
      ? 'ok'
      : targetFit.meanShapeDistance <= tol.shapeCloseDistance
        ? 'close'
        : 'off';
  const shape: HandwritingAspect = {
    status: shapeStatus,
    score: Math.max(0, 1 - targetFit.meanShapeDistance / Math.max(tol.shapeCloseDistance * 2, 1e-6)),
    detail: null,
  };

  // Per-stroke coaching notes, indexed by the LEARNER's stroke number (0-based)
  // so the UI can point at the specific stroke that needs attention.
  const strokeNotes: HandwritingVerdict['strokeNotes'] = [];
  for (const { learnerIdx, metrics } of targetFit.matched) {
    if (metrics.reversedFitsBetter) {
      strokeNotes.push({ strokeIndex: learnerIdx, note: 'This stroke looks drawn in the reverse direction.', severity: 'warn' });
    } else if (metrics.directionDegrees !== null && Math.abs(metrics.directionDegrees) > tol.directionDegrees) {
      strokeNotes.push({ strokeIndex: learnerIdx, note: 'This stroke’s direction is off from the reference.', severity: 'warn' });
    } else if (metrics.startDistance > tol.endpointDistance) {
      strokeNotes.push({ strokeIndex: learnerIdx, note: 'This stroke starts noticeably away from the reference.', severity: 'info' });
    }
  }
  for (let i = 0; i < learnerGlyph.strokes.length; i += 1) {
    if (targetFit.assignment.rowToCol[i] === -1) {
      strokeNotes.push({ strokeIndex: i, note: 'This stroke does not correspond to any expected stroke.', severity: 'warn' });
    }
  }

  const confidence = Math.max(
    0,
    Math.min(
      1,
      0.4 * (identity.score ?? 0) +
        0.25 * (shape.score ?? 0) +
        0.15 * (strokeOrder.score ?? 0) +
        0.1 * (strokeDirection.score ?? 0) +
        0.1 * (strokeCount.score ?? 0),
    ),
  );

  const uncertain = confidence >= tol.uncertainBelow && confidence < tol.correctAtOrAbove;
  const uncertaintyReason = uncertain
    ? bestAlternative
      ? `This is genuinely hard to call between this character and ${bestAlternative.glyph} — try again, or compare against the reference.`
      : 'This attempt is in between recognisable and not — try again, or compare against the reference.'
    : null;

  return {
    confidence,
    identity,
    strokeCount,
    strokeOrder,
    strokeDirection,
    shape,
    strokeNotes,
    uncertain,
    uncertaintyReason,
    bestAlternative,
  };
}

function uncertainVerdict(reason: string): HandwritingVerdict {
  const unknown: HandwritingAspect = { status: 'unknown', score: null, detail: null };
  return {
    confidence: 0,
    identity: unknown,
    strokeCount: unknown,
    strokeOrder: unknown,
    strokeDirection: unknown,
    shape: unknown,
    strokeNotes: [],
    uncertain: true,
    uncertaintyReason: reason,
    bestAlternative: null,
  };
}
