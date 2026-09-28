import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CapturedStroke, StrokeReference } from '@/domain';

/**
 * Synthetic handwriting samples for the assessor's own test suite.
 *
 * These are SYNTHETIC, derived by transforming the real KanjiVG reference
 * polylines that ship in `public/content/strokes/`. They are not real finger,
 * stylus or mouse captures from a human — the assessor has not been validated
 * against actual human input of any kind, and `src/handwriting/README.md`
 * states this plainly. What these fixtures DO exercise honestly is the
 * assessor's geometry and its handling of the specific error shapes the
 * product brief calls out: tremor, undersampling, a reversed stroke, two
 * swapped strokes, a missing stroke, an extra stroke, and a different but
 * visually similar character.
 */

const strokesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'content', 'strokes');

function loadReference(glyph: string): StrokeReference {
  const index = JSON.parse(readFileSync(join(strokesDir, 'index.json'), 'utf8')) as {
    characters: Record<string, { file: string }>;
  };
  const entry = index.characters[glyph];
  if (!entry) throw new Error(`No stroke reference indexed for ${glyph}. Run scripts/content/build-strokes.mjs first.`);
  return JSON.parse(readFileSync(join(strokesDir, entry.file), 'utf8')) as StrokeReference;
}

/** A tiny deterministic PRNG so "jittered" fixtures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Design-space points (0..viewBox) → normalised 0..1, matching CapturedStroke's space. */
function toCaptured(
  reference: StrokeReference,
  strokeIndices: number[],
  transform: (points: Array<[number, number]>, strokeIdx: number) => Array<[number, number]>,
): CapturedStroke[] {
  const w = reference.viewBox.width;
  const h = reference.viewBox.height;
  let t = 0;
  return strokeIndices.map((si) => {
    const stroke = reference.strokes[si];
    if (!stroke) throw new Error(`Reference ${reference.glyph} has no stroke ${si}.`);
    const pts = transform(stroke.points, si);
    return {
      points: pts.map(([x, y]) => {
        t += 8;
        return { x: x / w, y: y / h, t, pressure: null };
      }),
      pointerType: 'mouse' as const,
      startedAt: t,
      endedAt: t + pts.length * 8,
    };
  });
}

export interface HandwritingSample {
  name: string;
  targetGlyph: string;
  strokes: CapturedStroke[];
  /** What kind of variant this is, for grouping assertions. */
  kind:
    | 'clean' | 'jitter' | 'undersample' | 'offset' | 'reversed-stroke' | 'swapped-strokes'
    | 'missing-stroke' | 'extra-stroke' | 'wrong-character';
}

/** Build the full sample set for one glyph, given its own reference and one confusable's. */
export function buildSamplesFor(glyph: string, confusable: string): { reference: StrokeReference; confusableReference: StrokeReference; samples: HandwritingSample[] } {
  const reference = loadReference(glyph);
  const confusableReference = loadReference(confusable);
  const n = reference.strokes.length;
  const rng = mulberry32(hashSeed(glyph));
  const identity = Array.from({ length: n }, (_, i) => i);

  const samples: HandwritingSample[] = [];

  samples.push({ name: `${glyph}: clean`, targetGlyph: glyph, kind: 'clean', strokes: toCaptured(reference, identity, (p) => p) });

  // Tremor: every point nudged by a few percent of the design box, modelling a
  // finger's imprecise contact point.
  samples.push({
    name: `${glyph}: finger tremor`,
    targetGlyph: glyph,
    kind: 'jitter',
    strokes: toCaptured(reference, identity, (p) =>
      p.map(([x, y]) => [x + (rng() - 0.5) * reference.viewBox.width * 0.04, y + (rng() - 0.5) * reference.viewBox.height * 0.04]),
    ),
  });

  // Undersampled: keep roughly every 4th point, modelling a fast mouse stroke
  // with a low-polling-rate pointermove stream.
  samples.push({
    name: `${glyph}: undersampled (fast mouse)`,
    targetGlyph: glyph,
    kind: 'undersample',
    strokes: toCaptured(reference, identity, (p) => p.filter((_, i) => i % 4 === 0 || i === p.length - 1)),
  });

  // Uniformly offset and slightly scaled — a learner drawing off-centre on the
  // canvas, or a smaller/larger character than the reference's design size.
  samples.push({
    name: `${glyph}: offset + scaled`,
    targetGlyph: glyph,
    kind: 'offset',
    strokes: toCaptured(reference, identity, (p) =>
      p.map(([x, y]) => [x * 0.92 + reference.viewBox.width * 0.06, y * 0.92 + reference.viewBox.height * 0.04]),
    ),
  });

  if (n >= 1) {
    // One stroke drawn back-to-front.
    samples.push({
      name: `${glyph}: one stroke reversed`,
      targetGlyph: glyph,
      kind: 'reversed-stroke',
      strokes: toCaptured(reference, identity, (p, si) => (si === 0 ? p.slice().reverse() : p)),
    });
  }

  if (n >= 2) {
    // Strokes 0 and 1 drawn in swapped order.
    const swapped = identity.slice();
    [swapped[0], swapped[1]] = [swapped[1] as number, swapped[0] as number];
    samples.push({
      name: `${glyph}: two strokes swapped`,
      targetGlyph: glyph,
      kind: 'swapped-strokes',
      strokes: toCaptured(reference, swapped, (p) => p),
    });

    // Missing the last stroke entirely.
    samples.push({
      name: `${glyph}: missing last stroke`,
      targetGlyph: glyph,
      kind: 'missing-stroke',
      strokes: toCaptured(reference, identity.slice(0, -1), (p) => p),
    });
  }

  // An extra stroke: every real stroke, plus one unnecessary extra mark (a
  // short offset copy of the first stroke) tacked on at the end.
  samples.push({
    name: `${glyph}: one extra stroke`,
    targetGlyph: glyph,
    kind: 'extra-stroke',
    strokes: [
      ...toCaptured(reference, identity, (p) => p),
      ...toCaptured(reference, [0], (p) => p.map(([x, y]) => [x + reference.viewBox.width * 0.2, y])),
    ],
  });

  // The confusable character itself, presented as if it were an attempt at `glyph`.
  samples.push({
    name: `${confusable} drawn (mistaken for ${glyph})`,
    targetGlyph: glyph,
    kind: 'wrong-character',
    strokes: toCaptured(confusableReference, confusableReference.strokes.map((_, i) => i), (p) => p),
  });

  return { reference, confusableReference, samples };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The confusable pairs used across the handwriting test suite. */
export const CONFUSABLE_PAIRS: ReadonlyArray<[string, string]> = [
  ['シ', 'ツ'],
  ['ソ', 'ン'],
];
