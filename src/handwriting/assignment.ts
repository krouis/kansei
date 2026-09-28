/**
 * Rectangular linear assignment.
 *
 * Why this and not greedy nearest-match: a learner who writes strokes 2 and 3 in
 * the wrong order produces two strokes that each sit closest to the *other's*
 * reference. A greedy pass takes the globally cheapest pair first and then has
 * to make a bad choice for whatever is left, so the same input is sometimes read
 * as "two badly-shaped strokes" and sometimes as "a swap", depending only on
 * which pair happened to be cheapest. Solving the assignment optimally makes the
 * correspondence a property of the drawing rather than of the iteration order,
 * which is the whole basis for telling an ORDER error apart from a SHAPE error.
 *
 * Implementation: the Jonker–Volgenant shortest-augmenting-path method, O(n^3),
 * exact. `n` here is a stroke count — at most ~30 for the hardest kanji Kansei
 * teaches — so an exact cubic solver costs microseconds and no approximation is
 * warranted.
 */

export interface AssignmentResult {
  /** Row → column, or -1 when the row is left unassigned (rows > cols). */
  rowToCol: number[];
  /** Column → row, or -1 when the column is left unassigned (cols > rows). */
  colToRow: number[];
  /** Sum of the assigned costs. */
  total: number;
}

/**
 * Solves min-cost assignment for a `rows` x `cols` cost matrix.
 *
 * Rectangular input is handled by assigning every element of the shorter side;
 * the surplus rows or columns come back as -1 so the caller can treat them as
 * extra or missing strokes rather than forcing a bogus pairing.
 */
export function solveAssignment(cost: ReadonlyArray<ReadonlyArray<number>>, rows: number, cols: number): AssignmentResult {
  if (rows === 0 || cols === 0) {
    return { rowToCol: new Array<number>(rows).fill(-1), colToRow: new Array<number>(cols).fill(-1), total: 0 };
  }

  // The solver below requires n <= m. Transposing rather than padding with a
  // large dummy cost keeps the result exact: padding can only be made safe by
  // choosing a dummy value larger than any real assignment, and a badly chosen
  // one silently changes the optimum.
  const transposed = rows > cols;
  const n = transposed ? cols : rows;
  const m = transposed ? rows : cols;
  const at = transposed ? (i: number, j: number) => cost[j]![i]! : (i: number, j: number) => cost[i]![j]!;

  const INF = Infinity;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1).fill(0); // p[j] = 1-based row matched to column j
  const way = new Int32Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF);
    const used = new Uint8Array(m + 1);
    let stalled = false;
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = at(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      if (j1 < 0) {
        // Unreachable while n <= m and every cost is finite. Leaving the row
        // unassigned is the only degradation that cannot corrupt the matching.
        stalled = true;
        break;
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    if (stalled) continue;

    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const shortToLong = new Array<number>(n).fill(-1);
  const longToShort = new Array<number>(m).fill(-1);
  let total = 0;
  for (let j = 1; j <= m; j++) {
    const i = p[j]!;
    if (i === 0) continue;
    shortToLong[i - 1] = j - 1;
    longToShort[j - 1] = i - 1;
    total += at(i - 1, j - 1);
  }

  return transposed
    ? { rowToCol: longToShort, colToRow: shortToLong, total }
    : { rowToCol: shortToLong, colToRow: longToShort, total };
}

/**
 * Inversions in a partial permutation — the order-error measure.
 *
 * Only matched entries count. A learner who omitted a stroke should not be told
 * their order was wrong as well; the remaining strokes are still in order if the
 * reference indices they map to are increasing.
 */
export function countInversions(rowToCol: readonly number[]): { inversions: number; maxInversions: number } {
  const seq = rowToCol.filter((c) => c >= 0);
  let inversions = 0;
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) if (seq[i]! > seq[j]!) inversions++;
  }
  const k = seq.length;
  return { inversions, maxInversions: (k * (k - 1)) / 2 };
}
