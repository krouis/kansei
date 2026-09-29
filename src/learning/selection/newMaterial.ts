import { asItemId, type ItemId, type Lesson, type Settings, type Skill } from '@/domain';
import { candidateSkills, pairKey, passesNewMaterialGate, type ContentItem, type ItemIndex } from './items';
import type { SelectionTuning } from './tuning';

/**
 * Choosing what to introduce next.
 *
 * Two rules do the work here.
 *
 * COHERENT GROUPS. New material is drawn from one lesson at a time, in lesson
 * order, so the learner meets a set that belongs together (the あ row, then the
 * か row) rather than ten unrelated characters. Because the group always comes
 * from the lowest-order lesson with anything left in it, this holds across
 * series too: a learner given two new items per series still works through one
 * lesson at a time.
 *
 * NO SPILLING. When the current lesson has fewer items left than the minimum
 * group size, the group is simply smaller. Topping it up from the following
 * lesson was rejected: that lesson's prerequisite — this one — is not finished
 * yet, and quietly ignoring a prerequisite to hit a group size would be the
 * selector lying about the curriculum order.
 */

/**
 * Order in which a brand-new item's skills are introduced.
 *
 * Recognition first because it is the weakest evidence and therefore the fairest
 * first meeting; production and writing follow. Listening comes last because it
 * depends on a recording existing at all.
 */
export const NEW_ITEM_SKILL_ORDER: readonly Skill[] = Object.freeze([
  'recognition',
  'readingRecall',
  'handwriting',
  'listening',
]);

export interface NewMaterialPick {
  /** The coherent group to introduce, in lesson order. At most `newGroupMax` items. */
  group: ContentItem[];
  /** Lesson the group came from, or null when there is nothing to introduce. */
  lessonId: string | null;
  /**
   * EXTENDING rather than introducing: items the learner has already met that
   * have an applicable skill never yet attempted, e.g. a character they can
   * recognise but have never written.
   */
  extensions: Array<{ item: ContentItem; skill: Skill }>;
  /** True when every lesson the learner's settings allow is fully started. */
  curriculumExhausted: boolean;
  /** Lessons skipped because a prerequisite is not underway yet, for diagnostics. */
  blockedByPrerequisites: string[];
}

/**
 * A prerequisite lesson counts as underway once every item it introduces that
 * the learner's settings allow has been met at least once.
 *
 * This is the weakest condition that guarantees the earlier material was
 * actually presented, and it cannot deadlock: being "met" needs one screen, not
 * mastery. Items the settings exclude are ignored, otherwise a learner who
 * leaves historical forms off could never pass a lesson containing one.
 */
function lessonUnderway(
  lesson: Lesson,
  index: ItemIndex,
  settings: Settings,
  started: ReadonlySet<string>,
): boolean {
  const selectable = lesson.introduces.filter((id) => {
    const item = index.get(id);
    return item !== undefined && passesNewMaterialGate(item, index, settings) && candidateSkills(item, index, new Set(['recognition','readingRecall','handwriting','listening'] as Skill[])).length > 0;
  });
  if (selectable.length === 0) return true;
  return selectable.every((id) => started.has(String(id)));
}

export function pickNewMaterial(args: {
  index: ItemIndex;
  settings: Settings;
  allowedSkills: ReadonlySet<Skill>;
  /** Item ids the learner has met (any skill at a stage other than `unseen`). */
  startedItems: ReadonlySet<string>;
  /** `pairKey` values that already have a state, used to find untouched skills. */
  attemptedPairs: ReadonlySet<string>;
  excludedItems: ReadonlySet<string>;
  tuning: SelectionTuning;
}): NewMaterialPick {
  const { index, settings, allowedSkills, startedItems, attemptedPairs, excludedItems, tuning } = args;
  const lessons = index.lessons();
  const blockedByPrerequisites: string[] = [];
  let group: ContentItem[] = [];
  let lessonId: string | null = null;
  let anyUnstartedAnywhere = false;

  for (const lesson of lessons) {
    const fresh = lesson.introduces
      .map((id) => index.get(id))
      .filter((item): item is ContentItem => item !== undefined)
      .filter((item) => passesNewMaterialGate(item, index, settings))
      .filter((item) => !startedItems.has(String(item.id)) && !excludedItems.has(String(item.id)))
      // An item with no testable skill in this session's allowed set cannot be
      // introduced now — in silent mode that is any item whose only asset is audio.
      .filter((item) => candidateSkills(item, index, allowedSkills).length > 0);
    if (fresh.length === 0) continue;
    anyUnstartedAnywhere = true;
    const prerequisitesMet = lesson.prerequisites.every((pid) => {
      const prerequisite = lessons.find((l) => l.id === pid);
      // An unknown prerequisite id is treated as unmet: guessing that a missing
      // lesson is satisfied would let the selector jump ahead in the curriculum.
      if (prerequisite === undefined) return false;
      return lessonUnderway(prerequisite, index, settings, startedItems);
    });
    if (!prerequisitesMet) {
      blockedByPrerequisites.push(lesson.id);
      continue;
    }
    // Introduce a couple of useful shapes alongside actual kanji, rather than
    // letting a radical-heavy lesson become an isolated component-only series.
    const components = fresh.filter(item => item.kind === 'component');
    const characters = fresh.filter(item => item.kind !== 'component');
    const shapes = components.slice(0, characters.length ? 2 : tuning.newGroupMax);
    group = [...shapes, ...characters.slice(0, tuning.newGroupMax - shapes.length)];
    lessonId = lesson.id;
    break;
  }

  // Vocabulary is not listed in character lessons' introduces arrays. Gate it
  // explicitly on actual introductions, not a maximum teaching-order estimate.
  const words = index.vocabulary()
    .filter(word => passesNewMaterialGate(word, index, settings))
    .filter(word => !startedItems.has(String(word.id)) && !excludedItems.has(String(word.id)))
    .filter(word => word.requiresCharacters.every(id => startedItems.has(String(id))))
    .filter(word => candidateSkills(word, index, allowedSkills).length > 0)
    .sort((a,b) => a.teachingOrder-b.teachingOrder || String(a.id).localeCompare(String(b.id)));
  if (words.length) {
    anyUnstartedAnywhere = true;
    const ready = words.slice(0, group.length ? 2 : tuning.newGroupMax);
    group = [...ready, ...group.slice(0, tuning.newGroupMax-ready.length)];
    lessonId ??= ready[0]?.lessonId ?? null;
  }

  // Extensions: a skill on a known item that has never been attempted.
  const extensions: Array<{ item: ContentItem; skill: Skill }> = [];
  const startedIds = [...startedItems];
  const knownItems = startedIds
    .map((id) => index.get(id))
    .filter((item): item is ContentItem => item !== undefined)
    .filter((item) => !excludedItems.has(String(item.id)))
    .filter((item) => passesNewMaterialGate(item, index, settings))
    .sort((a, b) => a.teachingOrder - b.teachingOrder || String(a.id).localeCompare(String(b.id)));
  for (const item of knownItems) {
    for (const skill of NEW_ITEM_SKILL_ORDER) {
      if (!allowedSkills.has(skill)) continue;
      if (!index.applicable(item)[skill]) continue;
      // Reading skills are keyed by reading, so an untouched reading is also an
      // extension; the selector expands those when it builds the targets.
      if (item.kind === 'kanji' && skill === 'readingRecall') {
        if (index.teachableReadings(item).every(r => attemptedPairs.has(pairKey(item.id, skill, String(r.id))))) continue;
      } else if (attemptedPairs.has(pairKey(item.id, skill, null))) continue;
      extensions.push({ item, skill });
    }
  }

  return {
    group,
    lessonId,
    extensions,
    curriculumExhausted: !anyUnstartedAnywhere,
    blockedByPrerequisites,
  };
}

/** Ids of the items in a pick, for the deviation note and for tests. */
export function groupItemIds(pick: NewMaterialPick): ItemId[] {
  return pick.group.map((i) => asItemId(String(i.id)));
}
