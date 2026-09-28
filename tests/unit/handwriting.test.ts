import { describe, expect, it } from 'vitest';
import { assess } from '@/handwriting/assess';
import { toleranceFor } from '@/handwriting/tolerance';
import { buildSamplesFor, CONFUSABLE_PAIRS, type HandwritingSample } from '../fixtures/handwriting-samples';
import type { StrokeReference } from '@/domain';

/**
 * These tests run the REAL assessor (features.ts + assignment.ts + assess.ts)
 * against synthetic samples derived from real KanjiVG reference data — see
 * tests/fixtures/handwriting-samples.ts for exactly what "synthetic" means
 * here and its limits. No human finger/stylus/mouse capture was used; that
 * limitation is stated in src/handwriting/README.md, not hidden.
 */

const tol = toleranceFor(320, 'mouse');

function run(reference: StrokeReference, alternatives: StrokeReference[], sample: HandwritingSample) {
  return assess({
    targetGlyph: sample.targetGlyph,
    reference,
    strokes: sample.strokes,
    mode: 'recall',
    tolerance: tol,
    alternatives,
  });
}

describe('handwriting assessor — synthetic sample suite', () => {
  for (const [glyph, confusable] of CONFUSABLE_PAIRS) {
    const { reference, confusableReference, samples } = buildSamplesFor(glyph, confusable);
    const alternatives = [confusableReference];

    describe(`${glyph} (confusable with ${confusable})`, () => {
      it('accepts a clean attempt as correct, not merely uncertain', () => {
        const clean = samples.find((s) => s.kind === 'clean')!;
        const verdict = run(reference, alternatives, clean);
        expect(verdict.uncertain).toBe(false);
        expect(verdict.confidence).toBeGreaterThanOrEqual(tol.correctAtOrAbove);
        expect(verdict.identity.status).not.toBe('off');
      });

      it('accepts finger-tremor jitter without penalising shape into failure', () => {
        const jitter = samples.find((s) => s.kind === 'jitter')!;
        const verdict = run(reference, alternatives, jitter);
        expect(verdict.confidence).toBeGreaterThanOrEqual(tol.uncertainBelow);
        expect(verdict.strokeCount.status).toBe('ok');
      });

      it('does not penalise an undersampled (fast mouse) stroke for having few points', () => {
        const under = samples.find((s) => s.kind === 'undersample')!;
        const verdict = run(reference, alternatives, under);
        expect(verdict.confidence).toBeGreaterThanOrEqual(tol.uncertainBelow);
        expect(verdict.shape.status).not.toBe('off');
      });

      it('accepts an offset and slightly scaled attempt', () => {
        const offset = samples.find((s) => s.kind === 'offset')!;
        const verdict = run(reference, alternatives, offset);
        expect(verdict.confidence).toBeGreaterThanOrEqual(tol.uncertainBelow);
      });

      it('reports a reversed stroke as a DIRECTION problem, not a shape or count problem', () => {
        const sample = samples.find((s) => s.kind === 'reversed-stroke');
        if (!sample) return; // Some glyphs have only one stroke; nothing to reverse meaningfully.
        const verdict = run(reference, alternatives, sample);
        expect(verdict.strokeCount.status).toBe('ok');
        expect(verdict.strokeDirection.status).not.toBe('ok');
        expect(verdict.strokeNotes.some((n) => n.note.includes('reverse'))).toBe(true);
      });

      it('reports two swapped strokes as an ORDER problem', () => {
        const sample = samples.find((s) => s.kind === 'swapped-strokes');
        if (!sample) return;
        const verdict = run(reference, alternatives, sample);
        expect(verdict.strokeCount.status).toBe('ok');
        expect(verdict.strokeOrder.status).not.toBe('ok');
      });

      it('reports a missing stroke as a COUNT problem', () => {
        const sample = samples.find((s) => s.kind === 'missing-stroke');
        if (!sample) return;
        const verdict = run(reference, alternatives, sample);
        expect(verdict.strokeCount.status).not.toBe('ok');
      });

      it('reports an extra stroke as a COUNT problem', () => {
        const sample = samples.find((s) => s.kind === 'extra-stroke')!;
        const verdict = run(reference, alternatives, sample);
        expect(verdict.strokeCount.status).not.toBe('ok');
      });

      it('identifies the confusable character as identity trouble, naming the right alternative', () => {
        const wrong = samples.find((s) => s.kind === 'wrong-character')!;
        const verdict = run(reference, alternatives, wrong);
        expect(verdict.identity.status).not.toBe('ok');
        expect(verdict.bestAlternative?.glyph).toBe(confusable);
      });
    });
  }

  it('reports uncertain, not incorrect, when almost nothing was drawn', () => {
    const { reference } = buildSamplesFor('シ', 'ツ');
    const verdict = assess({
      targetGlyph: 'シ',
      reference,
      strokes: [],
      mode: 'recall',
      tolerance: tol,
      alternatives: [],
    });
    expect(verdict.uncertain).toBe(true);
    expect(verdict.uncertaintyReason).toBeTruthy();
  });

  it('never reports a mastery-style single score outside 0..1', () => {
    const { reference, confusableReference, samples } = buildSamplesFor('ソ', 'ン');
    for (const sample of samples) {
      const verdict = run(reference, [confusableReference], sample);
      expect(verdict.confidence).toBeGreaterThanOrEqual(0);
      expect(verdict.confidence).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Measures and reports the assessor's real numbers against the full synthetic
 * set, rather than asserting a hardcoded target — the honest output belongs in
 * the test log and in README.md's measured-numbers section, not silently
 * assumed to stay constant as the algorithm is tuned.
 */
describe('handwriting assessor — measured accuracy on the synthetic set', () => {
  it('reports pass rate on correct variants and false-accept rate on wrong-character variants', () => {
    let correctVariantTotal = 0;
    let correctVariantAccepted = 0;
    let wrongVariantTotal = 0;
    let wrongVariantFalseAccepted = 0;
    let uncertainCount = 0;
    let total = 0;

    for (const [glyph, confusable] of CONFUSABLE_PAIRS) {
      const { reference, confusableReference, samples } = buildSamplesFor(glyph, confusable);
      for (const sample of samples) {
        const verdict = run(reference, [confusableReference], sample);
        total += 1;
        if (verdict.uncertain) uncertainCount += 1;
        if (sample.kind === 'wrong-character') {
          wrongVariantTotal += 1;
          if (!verdict.uncertain && verdict.identity.status === 'ok') wrongVariantFalseAccepted += 1;
        } else if (sample.kind !== 'missing-stroke' && sample.kind !== 'extra-stroke' && sample.kind !== 'swapped-strokes' && sample.kind !== 'reversed-stroke') {
          // The "should still read as basically correct" variants: clean,
          // jitter, undersample, offset.
          correctVariantTotal += 1;
          if (!verdict.uncertain && verdict.confidence >= tol.correctAtOrAbove) correctVariantAccepted += 1;
        }
      }
    }

    const passRate = correctVariantAccepted / correctVariantTotal;
    const falseAcceptRate = wrongVariantFalseAccepted / wrongVariantTotal;
    const uncertainRate = uncertainCount / total;

    // eslint-disable-next-line no-console
    console.log(
      `[handwriting] correct-variant pass rate: ${(passRate * 100).toFixed(0)}% ` +
        `(${correctVariantAccepted}/${correctVariantTotal}); ` +
        `wrong-character false-accept rate: ${(falseAcceptRate * 100).toFixed(0)}% ` +
        `(${wrongVariantFalseAccepted}/${wrongVariantTotal}); ` +
        `uncertain rate over all variants: ${(uncertainRate * 100).toFixed(0)}% (${uncertainCount}/${total})`,
    );

    // A floor, not a target: the number above (printed to the test log and
    // transcribed into README.md) is the actual measurement to read.
    expect(passRate).toBeGreaterThanOrEqual(0.75);
    expect(falseAcceptRate).toBeLessThanOrEqual(0.25);
  });
});
