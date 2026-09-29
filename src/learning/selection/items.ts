import {
  SKILLS,
  type CharacterEntry,
  type CurriculumTier,
  type ItemId,
  type KanjiComponent,
  type KanjiReading,
  type Lesson,
  type Script,
  type Settings,
  type Skill,
  type SkillApplicability,
  type VocabEntry,
} from '@/domain';
import type { ContentLibrary } from '@/content/ports';

/**
 * Item lookup and eligibility.
 *
 * The selector needs three things the content port does not answer directly:
 * a by-id lookup that spans all four content tables, which skills an item can
 * honestly be tested on, and whether the learner's settings allow the item at
 * all. All three are derived here rather than stored, so a content pack can
 * never ship an applicability table that disagrees with the assets actually on
 * disk.
 */

/** Anything the selector can put on a screen. */
export type ContentItem = CharacterEntry | KanjiComponent | VocabEntry;

/** The slice of `ContentLibrary` session composition depends on. */
export type SelectionLibrary = Pick<
  ContentLibrary,
  'kana' | 'kanji' | 'components' | 'vocab' | 'lessons' | 'readingsFor' | 'hasAudio' | 'hasStrokes'
>;

export interface ItemIndex {
  get(id: ItemId | string): ContentItem | undefined;
  /** Lessons in teaching order. */
  lessons(): Lesson[];
  vocabulary(): VocabEntry[];
  /** Skills this item can be tested on, given the assets that actually verified. */
  applicable(item: ContentItem): SkillApplicability;
  /** Taught readings of a kanji — only those demonstrated by at least one word. */
  teachableReadings(item: ContentItem): KanjiReading[];
  /** Scripts an item belongs to. A word belongs to every script its characters use. */
  scriptsOf(item: ContentItem): Script[];
  tierOf(item: ContentItem): CurriculumTier;
}

/**
 * Audio keys.
 *
 * The content port exposes `hasAudio(key)` without fixing the key spelling, and
 * a vocabulary entry carries its `AudioRef` inline. Rather than guess one
 * convention we ask for both spellings a pack could plausibly use and take the
 * inline ref as authoritative where it exists. A wrong guess here can only ever
 * make us skip a listening question, never invent one.
 */
function hasAudioFor(library: SelectionLibrary, item: ContentItem): boolean {
  if (item.kind === 'vocab') return item.audio !== null;
  if (item.kind === 'component') return false;
  return library.hasAudio(String(item.id)) || library.hasAudio(item.glyph);
}

function hasStrokesFor(library: SelectionLibrary, item: ContentItem, index: ItemIndex): boolean {
  if (item.kind === 'vocab') {
    // A word can only be written by hand if every character in it has stroke
    // data; a partially traceable word would be graded against nothing.
    if (item.requiresCharacters.length === 0) return false;
    return item.requiresCharacters.every((cid) => {
      const child = index.get(cid);
      return child !== undefined && child.kind !== 'vocab' && library.hasStrokes(child.glyph);
    });
  }
  return library.hasStrokes(item.glyph);
}

export function buildItemIndex(library: SelectionLibrary): ItemIndex {
  const byId = new Map<string, ContentItem>();
  for (const item of [
    ...library.kana('hiragana'),
    ...library.kana('katakana'),
    ...library.kanji(),
    ...library.components(),
    ...library.vocab(),
  ]) {
    byId.set(String(item.id), item);
  }

  const lessons = [...library.lessons()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const readingCache = new Map<string, KanjiReading[]>();
  const applicabilityCache = new Map<string, SkillApplicability>();

  const index: ItemIndex = {
    get: (id) => byId.get(String(id)),
    lessons: () => lessons,
    vocabulary: () => library.vocab(),
    teachableReadings(item) {
      if (item.kind !== 'kanji') return [];
      const cached = readingCache.get(String(item.id));
      if (cached) return cached;
      // A reading with no example word is not taught: Kansei only ever tests a
      // reading through a word that actually uses it.
      const readings = library.readingsFor(item.glyph).filter((r) => r.exampleVocab.length > 0);
      readingCache.set(String(item.id), readings);
      return readings;
    },
    applicable(item) {
      const cached = applicabilityCache.get(String(item.id));
      if (cached) return cached;
      const audio = hasAudioFor(library, item);
      const strokes = hasStrokesFor(library, item, index);
      let result: SkillApplicability;
      switch (item.kind) {
        case 'kana':
          result = { recognition: true, readingRecall: true, listening: audio, handwriting: strokes };
          break;
        case 'kanji':
          // A bare kanji has no single reading to recall unless at least one of
          // its readings is taught through a word.
          result = {
            recognition: true,
            readingRecall: index.teachableReadings(item).length > 0,
            listening: audio,
            handwriting: strokes && index.teachableReadings(item).length > 0,
          };
          break;
        case 'component':
          // Components carry glosses, not readings, and several carry no
          // reliable meaning at all — so there is nothing to recall or hear.
          result = { recognition: library.kanji().some(k => k.components.includes(item.id) && item.appearsIn.includes(k.id)), readingRecall: false, listening: false, handwriting: false };
          break;
        case 'vocab':
          // The drawing assessor accepts one character, not a whole word.
          result = { recognition: true, readingRecall: true, listening: audio, handwriting: false };
          break;
      }
      applicabilityCache.set(String(item.id), result);
      return result;
    },
    scriptsOf(item) {
      switch (item.kind) {
        case 'kana':
          return [item.script];
        case 'kanji':
          return ['kanji'];
        case 'component':
          // Components are only ever studied as part of kanji.
          return ['kanji'];
        case 'vocab': {
          const scripts = new Set<Script>();
          for (const cid of item.requiresCharacters) {
            const child = index.get(cid);
            if (child && child.kind !== 'vocab' && child.kind !== 'component') scripts.add(child.script);
            if (child && child.kind === 'component') scripts.add('kanji');
          }
          return [...scripts];
        }
      }
    },
    tierOf(item) {
      // KanjiComponent has no tier: a component is only reachable through the
      // kanji that contains it, so it inherits the beginner path by default.
      return item.kind === 'component' ? 'modern-core' : item.tier;
    },
  };

  return index;
}

/**
 * Gate applied to EVERY candidate, review included.
 *
 * Historical forms are the only tier excluded unconditionally. Turning the
 * setting off hides them from practice; it never deletes progress already
 * recorded against them.
 */
export function passesGlobalGate(item: ContentItem, index: ItemIndex, settings: Settings): boolean {
  return index.tierOf(item) !== 'historical' || settings.includeHistorical;
}

/**
 * Gate applied to NEW material only.
 *
 * `activeScripts` and `includeExtended` are documented in the domain as bounds
 * on new-material selection, so an item already in the learner's collection
 * stays reviewable after they narrow their active scripts.
 */
export function passesNewMaterialGate(item: ContentItem, index: ItemIndex, settings: Settings): boolean {
  if (!passesGlobalGate(item, index, settings)) return false;
  const tier = index.tierOf(item);
  if (tier === 'extended' && !settings.includeExtended) return false;
  const scripts = index.scriptsOf(item);
  if (scripts.length === 0) return false;
  return scripts.every((s) => settings.activeScripts.includes(s));
}

/** Skills an item can be tested on, intersected with what this session allows. */
export function candidateSkills(
  item: ContentItem,
  index: ItemIndex,
  allowed: ReadonlySet<Skill>,
): Skill[] {
  const applicability = index.applicable(item);
  return SKILLS.filter((s) => applicability[s] && allowed.has(s));
}

export function pairKey(itemId: ItemId | string, skill: Skill, readingId: string | null): string {
  return `${String(itemId)}|${skill}|${readingId ?? ''}`;
}
