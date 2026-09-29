import type { CharacterEntry, KanjiReading, VocabEntry } from '@/domain';
import type { ContentLibrary } from '@/content/ports';
import type { GenerationContext } from '@/learning/ports';

/**
 * Builds the `GenerationContext.pool` the generators need from the content
 * library's own, more specific query methods.
 *
 * Rebuilt once per series (see `engine.ts`) rather than per question: the
 * library's own lookups are already O(1) maps, so the only cost here is
 * assembling three flat arrays, and doing that once per series avoids
 * reassembling the same arrays ten times over.
 */
export function buildGenerationPool(library: ContentLibrary): GenerationContext['pool'] {
  const characters: CharacterEntry[] = [
    ...library.kana('hiragana'),
    ...library.kana('katakana'),
    ...library.kanji(),
  ];
  const vocab: VocabEntry[] = library.vocab();
  const readings: KanjiReading[] = library.kanji().flatMap((k) => library.readingsFor(k.glyph));
  return { characters, vocab, readings, components: library.components() };
}

/** `GenerationContext.audio`, backed by the library's own audio lookup. */
export function audioLookup(library: ContentLibrary): NonNullable<GenerationContext['audio']> {
  return (key: string) => library.audio(key);
}
