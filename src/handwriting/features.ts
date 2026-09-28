import type { CapturedStroke, StrokeReference } from '@/domain';

/**
 * Geometric feature extraction for stroke-aware assessment.
 *
 * Everything here is pure and unit-free: callers hand in polylines already
 * expressed in a 0..1 box (captured strokes are normalised at capture time;
 * reference strokes are divided by their viewBox) and get back features in a
 * common unit box. Keeping this layer free of tolerances and of the notion of
 * "correct" is what lets `assess.ts` be re-tuned without touching the maths.
 *
 * Array indexing uses `!` throughout. `noUncheckedIndexedAccess` is on, and the
 * alternative — an undefined check inside every inner loop of a DTW — costs
 * legibility and speed for indices the surrounding loop bounds already prove.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Points per stroke after arc-length resampling. */
export const RESAMPLE_POINTS = 32;

/** Bins in the tangent-direction histogram (30° each). Must be even. */
export const TURN_BINS = 12;

/**
 * Points the stroke is decimated to before tangent angles are measured.
 *
 * This is deliberately far coarser than RESAMPLE_POINTS. At 32 points a stroke's
 * segments are ~2% of the character's size, which is *smaller* than the hand
 * tremor of a finger on a phone — so tangent angles measured at that scale are
 * dominated by noise and the histogram of a perfectly good stroke comes out
 * nearly uniform. At 11 points the segments are ~6-10% of the character, which
 * is comfortably above tremor, and the histogram then describes the stroke's
 * actual sweep. Shape distance (DTW / point distance) is what carries the fine
 * detail; the histogram only has to carry "which way does this stroke curve".
 */
export const TURN_SAMPLES = 11;

/**
 * Below this extent (fraction of the 0..1 input box) a glyph has no usable
 * bounding box — a single dot, or a tap. Scaling it up to the unit box would
 * amplify noise into a confident-looking shape, so it is reported as degenerate
 * and the assessor turns that into `uncertain` rather than a verdict.
 */
export const MIN_GLYPH_EXTENT = 0.03;

/**
 * A stroke shorter than this (in normalised units, after the glyph is fitted to
 * the unit box) has no meaningful start→end direction: the chord is dominated
 * by where the pen happened to land. Direction is reported as unassessable for
 * these rather than guessed at.
 */
export const MIN_DIRECTIONAL_LENGTH = 0.05;

export interface NormalisedStroke {
  /** Arc-length resampled to RESAMPLE_POINTS, in the shared unit box. */
  points: Vec[];
  start: Vec;
  end: Vec;
  centroid: Vec;
  /** Unit vector start→end. Zero vector when the stroke is a point. */
  chord: Vec;
  /** Arc length in the shared unit box. */
  arcLength: number;
  /** Length-weighted tangent-direction histogram, sums to 1. */
  turning: number[];
  /** Raw point count before resampling — evidence for the uncertainty rules. */
  rawPointCount: number;
}

export interface NormalisedGlyph {
  strokes: NormalisedStroke[];
  /** True when the source had no usable bounding box (see MIN_GLYPH_EXTENT). */
  degenerate: boolean;
  /** width/height of the source bounding box, before aspect-preserving fit. */
  aspect: number;
  /** Scale applied by the aspect-preserving fit. */
  scale: number;
  rawPointCount: number;
}

export function dist(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Drops consecutive duplicate points, which otherwise produce NaN tangents. */
function dedupe(poly: readonly Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function polylineLength(poly: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < poly.length; i++) total += dist(poly[i - 1]!, poly[i]!);
  return total;
}

/**
 * Arc-length resampling to exactly `n` points.
 *
 * This is the step that makes a slow stylus stroke and a fast mouse stroke
 * comparable: after it, index i means "i/(n-1) of the way along the stroke"
 * regardless of how many samples the device produced or how the speed varied.
 */
export function resample(poly: readonly Vec[], n: number): Vec[] {
  if (n < 2) throw new RangeError('resample needs n >= 2');
  const pts = dedupe(poly);
  const first = pts[0];
  if (first === undefined) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ x: first.x, y: first.y }));

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = cum[cum.length - 1]!;
  if (total <= 0) return Array.from({ length: n }, () => ({ x: first.x, y: first.y }));

  const out: Vec[] = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < pts.length - 1 && cum[seg]! < target) seg++;
    const c0 = cum[seg - 1]!;
    const c1 = cum[seg]!;
    const t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    const a = pts[seg - 1]!;
    const b = pts[seg]!;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Light 3-tap moving average, endpoints pinned.
 *
 * Applied to captured input only. Pointer devices emit sub-pixel tremor that
 * inflates tangent angles; a single smoothing pass removes it without moving
 * the stroke anywhere (the endpoints, which carry the direction and start-point
 * verdicts, are deliberately left untouched).
 */
export function smoothPolyline(poly: readonly Vec[], passes = 1): Vec[] {
  let cur: Vec[] = poly.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < passes; pass++) {
    if (cur.length < 3) return cur;
    const next: Vec[] = [cur[0]!];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1]!;
      const b = cur[i]!;
      const c = cur[i + 1]!;
      next.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

export function boundsOf(polys: ReadonlyArray<readonly Vec[]>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function centroidOf(poly: readonly Vec[]): Vec {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  const n = poly.length || 1;
  return { x: sx / n, y: sy / n };
}

/**
 * Length-weighted histogram of tangent directions over [0, 2π).
 *
 * Weighting by segment length rather than by sample count is what makes this
 * comparable between a 4-point mouse stroke and a 200-point stylus stroke. The
 * histogram is deliberately NOT rotation-invariant: a 一 rotated 90° is not a
 * 一, so rotation must show up as a difference.
 */
export function turningHistogram(poly: readonly Vec[], bins = TURN_BINS, samples = TURN_SAMPLES): number[] {
  const coarse = poly.length > samples ? resample(poly, samples) : poly;
  const hist = new Array<number>(bins).fill(0);
  let total = 0;
  for (let i = 1; i < coarse.length; i++) {
    const a = coarse[i - 1]!;
    const b = coarse[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 0) continue;
    let theta = Math.atan2(dy, dx);
    if (theta < 0) theta += Math.PI * 2;
    const bin = Math.min(bins - 1, Math.floor((theta / (Math.PI * 2)) * bins));
    hist[bin] = hist[bin]! + len;
    total += len;
  }
  if (total > 0) for (let i = 0; i < bins; i++) hist[i] = hist[i]! / total;
  return hist;
}

/**
 * The turning histogram a stroke would have if it were drawn backwards.
 *
 * Reversing a polyline negates every tangent vector, i.e. adds π to every angle,
 * which for an even bin count is exactly a rotation by half the bins. Deriving it
 * this way instead of reversing and re-binning is not just cheaper — it is exact,
 * whereas re-binning a reversed resample can land a borderline angle in a
 * different bin and make a stroke look very slightly non-symmetric.
 */
export function reversedHistogram(hist: readonly number[]): number[] {
  const bins = hist.length;
  const half = bins >> 1;
  const out = new Array<number>(bins).fill(0);
  for (let i = 0; i < bins; i++) out[(i + half) % bins] = hist[i] ?? 0;
  return out;
}

/** Total-variation distance between two normalised histograms, in 0..1. */
export function histogramDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / 2;
}

/** Mean index-aligned point distance. Both inputs must have equal length. */
export function meanPointDistance(a: readonly Vec[], b: readonly Vec[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += dist(a[i]!, b[i]!);
  return sum / n;
}

/**
 * Band-limited DTW distance, normalised by path length.
 *
 * Arc-length resampling already removes speed differences between devices, but
 * it does not remove *local* ones: a learner who hesitates at a corner shifts
 * every later sample. DTW absorbs that. The Sakoe-Chiba band caps how far the
 * alignment may wander (default a quarter of the sequence), which is what stops
 * DTW from warping a genuinely wrong shape onto the reference.
 */
export function dtwDistance(a: readonly Vec[], b: readonly Vec[], band = Math.ceil(RESAMPLE_POINTS / 4)): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;
  const w = Math.max(band, Math.abs(n - m));
  let prev = new Float64Array(m + 1).fill(Infinity);
  let cur = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const lo = Math.max(1, i - w);
    const hi = Math.min(m, i + w);
    for (let j = lo; j <= hi; j++) {
      const cost = dist(a[i - 1]!, b[j - 1]!);
      const best = Math.min(prev[j]!, cur[j - 1]!, prev[j - 1]!);
      cur[j] = cost + best;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    // Column 0 is only reachable before any row has been consumed.
    prev[0] = Infinity;
  }
  const raw = prev[m]!;
  if (!Number.isFinite(raw)) return Infinity;
  // Normalising by the warping-path length bound keeps the result comparable to
  // meanPointDistance, so a single distance tolerance covers both.
  return raw / Math.max(n, m);
}

function unitVector(from: Vec, to: Vec): Vec {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 1e-9) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Angle between two chords in degrees, or null when either is degenerate. */
export function chordAngleDegrees(a: Vec, b: Vec): number | null {
  if ((a.x === 0 && a.y === 0) || (b.x === 0 && b.y === 0)) return null;
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

export function reversePoly(poly: readonly Vec[]): Vec[] {
  return poly.slice().reverse().map((p) => ({ x: p.x, y: p.y }));
}

export function translatePoly(poly: readonly Vec[], dx: number, dy: number): Vec[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Builds the feature record for one already-positioned polyline.
 *
 * `fitted` must already be in whatever shared space the caller is comparing in —
 * the unit box for recall assessment, guide space for trace coaching. This
 * function deliberately does no scaling of its own so the two spaces cannot
 * drift apart.
 */
function buildStroke(fitted: readonly Vec[], rawPointCount: number): NormalisedStroke {
  const points = resample(fitted, RESAMPLE_POINTS);
  const start = points[0] ?? { x: 0, y: 0 };
  const end = points[points.length - 1] ?? { x: 0, y: 0 };
  return {
    points,
    start,
    end,
    centroid: centroidOf(points),
    chord: unitVector(start, end),
    arcLength: polylineLength(fitted),
    turning: turningHistogram(points),
    rawPointCount,
  };
}

/**
 * Fits a set of polylines into the unit box, preserving aspect ratio.
 *
 * Aspect ratio is preserved rather than stretched because stretching would turn
 * every single horizontal stroke into the same shape: 一 stretched to fill a
 * square is indistinguishable from an S-curve of the same span, and a learner's
 * slightly-slanted 一 would be stretched into something quite unlike the
 * reference. Instead the longer axis is scaled to 1 and the result is centred,
 * so a wide flat character stays wide and flat in both the learner's rendering
 * and the reference's.
 */
export function normaliseGlyph(polys: ReadonlyArray<readonly Vec[]>, rawPointCounts?: readonly number[]): NormalisedGlyph {
  const box = boundsOf(polys);
  const extent = Math.max(box.width, box.height);
  const degenerate = extent < MIN_GLYPH_EXTENT;
  const scale = extent > 0 ? 1 / extent : 1;
  const offsetX = (1 - box.width * scale) / 2 - box.minX * scale;
  const offsetY = (1 - box.height * scale) / 2 - box.minY * scale;

  const strokes: NormalisedStroke[] = [];
  let rawTotal = 0;
  for (let i = 0; i < polys.length; i++) {
    const src = polys[i]!;
    rawTotal += rawPointCounts?.[i] ?? src.length;
    const fitted = src.map((p) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }));
    strokes.push(buildStroke(fitted, rawPointCounts?.[i] ?? src.length));
  }

  return {
    strokes,
    degenerate,
    aspect: box.height > 0 ? box.width / box.height : Infinity,
    scale,
    rawPointCount: rawTotal,
  };
}

/** Captured strokes → 0..1 polylines, lightly smoothed for assessment. */
export function capturedToPolylines(strokes: readonly CapturedStroke[], smoothPasses = 1): Vec[][] {
  return strokes.map((s) => smoothPolyline(s.points.map((p) => ({ x: p.x, y: p.y })), smoothPasses));
}

/** Reference strokes → 0..1 polylines, by dividing out the design viewBox. */
export function referenceToPolylines(reference: StrokeReference): Vec[][] {
  const w = reference.viewBox.width || 1;
  const h = reference.viewBox.height || 1;
  return reference.strokes.map((s) => s.points.map(([x, y]) => ({ x: x / w, y: y / h })));
}

/**
 * Reference in *guide space*: the unit square of the canvas, not the glyph's
 * own bounding box.
 *
 * Trace mode needs this. When the learner is tracing an on-screen guide, the
 * guide is drawn from the same viewBox, so canvas coordinates and reference
 * coordinates are directly comparable — and they must be, because "your stroke
 * started too far left" is a claim about the guide, not about the learner's own
 * bounding box (which does not exist yet after one stroke).
 */
export function referenceGuideStrokes(reference: StrokeReference): NormalisedStroke[] {
  return referenceToPolylines(reference).map((fitted) => buildStroke(fitted, fitted.length));
}

/** A single captured stroke in guide space, for per-stroke trace coaching. */
export function capturedGuideStroke(stroke: CapturedStroke, smoothPasses = 1): NormalisedStroke {
  const fitted = smoothPolyline(stroke.points.map((p) => ({ x: p.x, y: p.y })), smoothPasses);
  return buildStroke(fitted, stroke.points.length);
}

export interface StrokePairMetrics {
  /** Direction-invariant placed distance: the stroke's trace vs the reference's. */
  traceDistance: number;
  /** Placed distance with the learner's stroke taken in the drawn order. */
  forwardDistance: number;
  /** Placed distance with the learner's stroke reversed. */
  reverseDistance: number;
  /** True when the reversed reading fits distinctly better. */
  reversedFitsBetter: boolean;
  /** Direction-invariant turning-histogram distance, 0..1. */
  turningDistance: number;
  /** Distance between stroke centroids. */
  centroidDistance: number;
  /** Distance between stroke starts, in the drawn order. */
  startDistance: number;
  /** learner arc length / reference arc length. */
  lengthRatio: number;
  /** Angle between the drawn chord and the reference chord, null if unassessable. */
  directionDegrees: number | null;
}

/**
 * Compares one learner stroke against one reference stroke.
 *
 * Shape is measured direction-invariantly, on purpose. A learner who draws the
 * right line the wrong way round has made exactly one mistake, and the verdict
 * must say so once (as a direction error) instead of reporting the same event
 * twice as a shape error as well.
 */
export function strokePairMetrics(learner: NormalisedStroke, reference: NormalisedStroke): StrokePairMetrics {
  const fwd = 0.5 * meanPointDistance(learner.points, reference.points) + 0.5 * dtwDistance(learner.points, reference.points);
  const rev = (() => {
    const r = reversePoly(learner.points);
    return 0.5 * meanPointDistance(r, reference.points) + 0.5 * dtwDistance(r, reference.points);
  })();
  const turnFwd = histogramDistance(learner.turning, reference.turning);
  const turnRev = histogramDistance(reversedHistogram(learner.turning), reference.turning);
  const refLen = reference.arcLength;
  return {
    traceDistance: Math.min(fwd, rev),
    forwardDistance: fwd,
    reverseDistance: rev,
    // A margin is required so sampling noise on a symmetric stroke (a short
    // straight tick reads almost the same either way) is not announced as a
    // reversal.
    reversedFitsBetter: rev < fwd - 0.01,
    turningDistance: Math.min(turnFwd, turnRev),
    centroidDistance: dist(learner.centroid, reference.centroid),
    startDistance: dist(learner.start, reference.start),
    lengthRatio: refLen > 1e-9 ? learner.arcLength / refLen : 1,
    directionDegrees:
      reference.arcLength < MIN_DIRECTIONAL_LENGTH || learner.arcLength < MIN_DIRECTIONAL_LENGTH
        ? null
        : chordAngleDegrees(learner.chord, reference.chord),
  };
}
