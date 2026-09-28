import type { CapturedStroke } from '@/domain';
import type { AssessRequest, TraceCoach } from './ports';
import {
  capturedGuideStroke, referenceGuideStrokes, strokePairMetrics, type NormalisedStroke,
} from './features';

/**
 * Learning-mode, per-stroke coaching.
 *
 * Trace mode shows a guide and reacts after EACH stroke, immediately — this is
 * deliberately a much looser check than the recall-mode `Assessor`: the guide is
 * on screen, so the only things worth flagging are direction, start point,
 * completeness and whether the strokes are landing in the reference's order.
 * Overall identity is not judged here at all, since the learner is copying a
 * known target, not producing one from memory.
 */
export function createTraceCoach(reference: AssessRequest['reference'], tolerance: AssessRequest['tolerance']): TraceCoach {
  const guides = referenceGuideStrokes(reference);
  let expected = 0;

  return {
    get expectedStrokeIndex() {
      return expected;
    },
    evaluateStroke(stroke: CapturedStroke, expectedStrokeIndex: number) {
      const learner = capturedGuideStroke(stroke);
      const issues: Array<'wrong-direction' | 'wrong-start' | 'too-short' | 'out-of-order' | 'off-guide'> = [];

      if (stroke.points.length < 2 || learner.arcLength < 0.01) {
        issues.push('too-short');
        return { accepted: false, coaching: 'That stroke was too short to read — try tracing the full guide.', issues };
      }

      const target = guides[expectedStrokeIndex];
      if (!target) {
        return { accepted: true, coaching: 'All the strokes for this character are done.', issues: [] };
      }
      const metrics = strokePairMetrics(learner, target);

      // Out-of-order: does this stroke fit a LATER guide distinctly better than
      // the one it was actually asked for? Only later strokes are checked —
      // matching an earlier, already-drawn guide is just a repeat of a mistake
      // already coached, not a new ordering problem.
      let betterElsewhere: number | null = null;
      for (let i = expectedStrokeIndex + 1; i < guides.length; i += 1) {
        const alt = strokePairMetrics(learner, guides[i] as NormalisedStroke);
        if (alt.traceDistance < metrics.traceDistance - 0.05) {
          betterElsewhere = i;
          break;
        }
      }
      if (betterElsewhere !== null) {
        issues.push('out-of-order');
        return {
          accepted: false,
          coaching: `That looks like stroke ${betterElsewhere + 1}, not stroke ${expectedStrokeIndex + 1} — try the guide in order.`,
          issues,
        };
      }

      if (metrics.reversedFitsBetter) issues.push('wrong-direction');
      else if (metrics.directionDegrees !== null && Math.abs(metrics.directionDegrees) > tolerance.directionDegrees) {
        issues.push('wrong-direction');
      }
      if (metrics.startDistance > tolerance.endpointDistance) issues.push('wrong-start');
      if (metrics.traceDistance > tolerance.shapeCloseDistance) issues.push('off-guide');

      const accepted = issues.length === 0 || (issues.length === 1 && issues[0] === 'off-guide');
      if (accepted) expected += 1;

      const coaching = issues.includes('wrong-direction')
        ? 'Good shape, but try drawing this stroke in the other direction.'
        : issues.includes('wrong-start')
          ? 'Start this stroke a little closer to the guide’s starting point.'
          : issues.includes('off-guide')
            ? 'Close — try following the guide a bit more closely.'
            : 'Good stroke.';

      return { accepted, coaching, issues };
    },
  };
}
