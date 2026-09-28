import type {
  CharacterEntry, ItemId, KanaCharacter, KanjiCharacter, KanjiReading, ReadingId, VocabEntry,
} from '@/domain';
import { itemKind } from '@/domain';
import type { GenerationContext } from '@/learning/ports';

/**
 * An index over the generation pool.
 *
 * Generators ask questions like "which kanji share this component" hundreds of
 * times while assembling one screen. Building the maps once per screen keeps
 * that linear instead of quadratic, and — more importantly — puts every lookup
 * behind one interface so the ambiguity checks and the distractor picker cannot
 * disagree about what the pool contains.
 */

/**
 * Audio key convention: **the item's own id**.
 *
 * `ContentLibrary.audio(key)` takes an opaque string, so the convention has to be
 * stated somewhere. Ids are chosen because they are the app's only stable keys —
 * a glyph is not unique across scripts once extended katakana arrive, and a
 * romanisation is not unique at all. Everything that stores or verifies audio
 * must use this function so the convention is changed in one place.
 */
export function audioKey(itemId: ItemId | string): string {
  return String(itemId);
}

export interface ParsedReadingId {
  id: ReadingId;
  kanji: string;
  reading: string;
}

/**
 * Split `reading:日:にち` into its parts.
 *
 * The grammar is documented and validated at content-load time (domain/ids.ts),
 * so parsing it is not a guess. This exists because `GenerationContext.pool`
 * does not always carry the KanjiReading objects, and the reading's kana — the
 * one thing a reading question cannot do without — is recoverable from the id.
 */
export function parseReadingId(id: string): ParsedReadingId | null {
  const parts = String(id).split(':');
  if (parts.length !== 3 || parts[0] !== 'reading') return null;
  const kanji = parts[1];
  const reading = parts[2];
  if (!kanji || !reading) return null;
  return { id: id as ReadingId, kanji, reading };
}

export interface PoolIndex {
  characterById(id: string): CharacterEntry | undefined;
  characterByGlyph(glyph: string): CharacterEntry | undefined;
  vocabById(id: string): VocabEntry | undefined;
  kana(script?: 'hiragana' | 'katakana'): KanaCharacter[];
  kanji(): KanjiCharacter[];
  vocab(): VocabEntry[];
  /** The KanjiReading object, when the caller supplied one. */
  reading(id: string): KanjiReading | undefined;
  /** The reading's kana — from the object if present, else from the id grammar. */
  readingKana(id: string): string | null;
  /** Taught words that demonstrate a reading, ordered so the shortest comes first. */
  wordsDemonstrating(readingId: string): VocabEntry[];
  /** Reading ids of a kanji glyph, in the order content declares them. */
  readingIdsOf(glyph: string): string[];
  /** Words a character appears in. */
  wordsContaining(glyph: string): VocabEntry[];
}

export function isKana(entry: CharacterEntry): entry is KanaCharacter {
  return entry.kind === 'kana';
}

export function isKanji(entry: CharacterEntry): entry is KanjiCharacter {
  return entry.kind === 'kanji';
}

export function indexPool(pool: GenerationContext['pool']): PoolIndex {
  const byId = new Map<string, CharacterEntry>();
  const byGlyph = new Map<string, CharacterEntry>();
  for (const c of pool.characters) {
    byId.set(String(c.id), c);
    // First writer wins: if two entries share a glyph (a character taught in two
    // tiers) the earlier-declared one is canonical, rather than silently the last.
    if (!byGlyph.has(c.glyph)) byGlyph.set(c.glyph, c);
  }
  const vocabById = new Map<string, VocabEntry>();
  for (const v of pool.vocab) vocabById.set(String(v.id), v);

  const readingById = new Map<string, KanjiReading>();
  for (const r of pool.readings ?? []) readingById.set(String(r.id), r);

  const kanaAll = pool.characters.filter(isKana);
  const kanjiAll = pool.characters.filter(isKanji);

  const demonstrating = new Map<string, VocabEntry[]>();
  for (const v of pool.vocab) {
    for (const rid of v.demonstratesReadings) {
      const key = String(rid);
      const list = demonstrating.get(key);
      if (list) list.push(v);
      else demonstrating.set(key, [v]);
    }
  }
  for (const list of demonstrating.values()) {
    list.sort((a, b) => a.reading.length - b.reading.length || a.teachingOrder - b.teachingOrder);
  }

  return {
    characterById: (id) => byId.get(String(id)),
    characterByGlyph: (glyph) => byGlyph.get(glyph),
    vocabById: (id) => vocabById.get(String(id)),
    kana: (script) => (script ? kanaAll.filter((k) => k.script === script) : kanaAll),
    kanji: () => kanjiAll,
    vocab: () => pool.vocab,
    reading: (id) => readingById.get(String(id)),
    readingKana: (id) => {
      const obj = readingById.get(String(id));
      if (obj) return obj.reading;
      return parseReadingId(id)?.reading ?? null;
    },
    wordsDemonstrating: (readingId) => demonstrating.get(String(readingId)) ?? [],
    readingIdsOf: (glyph) => {
      const k = byGlyph.get(glyph);
      if (k && isKanji(k)) return k.readings.map(String);
      // Fall back to whatever readings were supplied for the glyph.
      return (pool.readings ?? []).filter((r) => r.kanji === glyph).map((r) => String(r.id));
    },
    wordsContaining: (glyph) => pool.vocab.filter((v) => v.spelling.includes(glyph)),
  };
}

/** The item kind of a target id, without throwing on an unrecognised id. */
export function safeItemKind(id: ItemId | string): ReturnType<typeof itemKind> | null {
  try {
    return itemKind(id);
  } catch {
    return null;
  }
}
