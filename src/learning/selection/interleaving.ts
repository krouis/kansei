import type { ItemId, LearningStage, Script, Skill } from '@/domain';
import type { ContentItem, ItemIndex } from './items';
import type { SelectionTuning } from './tuning';

/**
 * Interleaving, and the guard that limits it.
 *
 * Kansei interleaves across SKILLS and across LESSONS: consecutive screens
 * prefer a different skill and a different script, so a series is not ten
 * recognition questions about hiragana in a row.
 *
 * It does NOT pack a series with a pile of mutually confusable characters while
 * the learner is still learning them, and it keeps new vocabulary in a block.
 * Both restrictions come from the same source:
 *
 *   Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of
 *   interleaved learning and its moderators. Psychological Bulletin, 145(11),
 *   1029-1052. https://doi.org/10.1037/bul0000209   (id `brunmair2019` in
 *   src/features/about/references.data.ts)
 *
 * The meta-analysis found interleaving's benefit depends on what is being
 * learned: strong for visual categories, and REVERSED for word learning, where
 * blocking beat interleaving. Kansei reads two rules out of that, and both are
 * our inference rather than a result the paper reports about Japanese:
 *
 *  1. Interleaving is most defensible where telling similar things apart IS the
 *     skill — a confusable PAIR presented together. Beyond a pair, while the
 *     learner has no stable representation of any of them yet, mixing four
 *     lookalikes is not discrimination practice, it is noise. Hence
 *     `maxConfusablesWhileLearning`. Once a pair is consolidating or retained,
 *     the limit rises: at that point contrast is exactly what is wanted.
 *  2. New VOCABULARY is introduced as a contiguous block, because the word
 *     result went the other way.
 *
 * A simpler rule — "never put confusables in the same series" — was rejected
 * because it would make confusion repair impossible, and discrimination between
 * シ and ツ is a thing the app must actually teach.
 */

export interface InterleaveSubject {
  itemId: ItemId;
  skill: Skill;
  /** Stage of the pair being practised, used to decide how fragile it is. */
  stage: LearningStage;
  /** True for confusion repair and focused practice, which are exempt from the guard. */
  exemptFromConfusableGuard: boolean;
  /** True for new vocabulary, which is kept in a block rather than scattered. */
  blockWithNewVocab: boolean;
}

function confusablesOf(item: ContentItem): ReadonlySet<string> {
  if (item.kind === 'kana' || item.kind === 'kanji') {
    return new Set(item.confusableWith.map(String));
  }
  return new Set<string>();
}

/** True when two items are listed as confusable in either direction. */
export function areConfusable(a: ContentItem, b: ContentItem): boolean {
  if (String(a.id) === String(b.id)) return false;
  return confusablesOf(a).has(String(b.id)) || confusablesOf(b).has(String(a.id));
}

const FRAGILE_STAGES: ReadonlySet<LearningStage> = new Set<LearningStage>(['unseen', 'learning']);

/**
 * Decide whether one more member of a confusable cluster may join the series.
 *
 * `chosen` is what has already been accepted. The cluster is approximated by
 * direct adjacency in `confusableWith`, which is what the content packs record;
 * a transitive closure was rejected because it would sweep in characters the
 * learner has no reason to mix up (ね/れ/わ and ぬ/め share neighbours without
 * all five being mutually confusable).
 */
export function confusableGuardAllows(
  candidate: { item: ContentItem; subject: InterleaveSubject },
  chosen: readonly { item: ContentItem; subject: InterleaveSubject }[],
  tuning: SelectionTuning,
): boolean {
  if (candidate.subject.exemptFromConfusableGuard) return true;
  const neighbours = chosen.filter((c) => areConfusable(c.item, candidate.item));
  if (neighbours.length === 0) return true;
  const anyFragile =
    FRAGILE_STAGES.has(candidate.subject.stage) ||
    neighbours.some((n) => FRAGILE_STAGES.has(n.subject.stage));
  const limit = anyFragile ? tuning.maxConfusablesWhileLearning : tuning.maxConfusablesWhenConsolidated;
  // +1 for the candidate itself: `limit` counts members of the cluster in the series.
  return neighbours.length + 1 <= limit;
}

interface Orderable<T> {
  value: T;
  item: ContentItem;
  subject: InterleaveSubject;
}

/**
 * Order the chosen targets for presentation.
 *
 * Greedy and fully deterministic — no randomness, so a failing series can be
 * replayed in a test exactly as the learner saw it. At each step it prefers a
 * target that (a) is not confusable with the previous one while either is
 * fragile, (b) uses a different skill from the previous one, and (c) uses a
 * different script. New vocabulary is emitted as one block wherever the block
 * starts, per Brunmair & Richter's word-learning result.
 */
export function interleave<T>(
  targets: readonly T[],
  describe: (t: T) => { item: ContentItem; subject: InterleaveSubject },
  index: ItemIndex,
): T[] {
  const pool: Array<Orderable<T>> = targets.map((value) => {
    const d = describe(value);
    return { value, item: d.item, subject: d.subject };
  });

  const scriptOf = (o: Orderable<T>): Script | null => index.scriptsOf(o.item)[0] ?? null;

  const out: Array<Orderable<T>> = [];
  let previous: Orderable<T> | null = null;
  // While a vocabulary block is open, keep taking from it so the words stay
  // contiguous instead of being shuffled through the series.
  let blockOpen = false;

  while (pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i];
      if (candidate === undefined) continue;
      let score = 0;
      if (blockOpen) {
        // Keeping the block together outranks every diversity preference.
        score += candidate.subject.blockWithNewVocab ? 1000 : -1000;
      } else if (candidate.subject.blockWithNewVocab) {
        // Do not open the block on screen 0 if anything else can go there: the
        // first screen of a series should be something already known.
        score += out.length === 0 ? -50 : 0;
      }
      if (previous !== null) {
        const fragile =
          FRAGILE_STAGES.has(candidate.subject.stage) || FRAGILE_STAGES.has(previous.subject.stage);
        if (fragile && areConfusable(previous.item, candidate.item)) score -= 100;
        if (candidate.subject.skill !== previous.subject.skill) score += 10;
        if (scriptOf(candidate) !== scriptOf(previous)) score += 4;
        if (String(candidate.item.id) !== String(previous.item.id)) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    const taken = pool.splice(bestIndex, 1)[0];
    if (taken === undefined) break;
    out.push(taken);
    blockOpen = taken.subject.blockWithNewVocab;
    previous = taken;
  }

  return out.map((o) => o.value);
}
