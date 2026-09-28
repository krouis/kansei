/**
 * Branded identifier types.
 *
 * Every learnable thing in Kansei has a stable, human-readable id so that
 * content packs, progress records and backups remain diffable and debuggable.
 *
 * Id grammar (all lowercase ASCII, `:` separated):
 *   kana:hi:a              a hiragana character
 *   kana:ka:a              a katakana character
 *   kanji:日                a kanji character
 *   comp:氵                a recurring component / radical
 *   vocab:ねこ              a vocabulary entry (keyed by its Japanese spelling)
 *   reading:日:にち         a word-specific reading of a kanji
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ItemId = Brand<string, 'ItemId'>;
export type CharacterId = Brand<string, 'CharacterId'>;
export type VocabId = Brand<string, 'VocabId'>;
export type ComponentId = Brand<string, 'ComponentId'>;
export type ReadingId = Brand<string, 'ReadingId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type QuestionId = Brand<string, 'QuestionId'>;

/** Narrow a raw string to an ItemId. Ids are validated when content is loaded. */
export const asItemId = (s: string): ItemId => s as ItemId;
export const asCharacterId = (s: string): CharacterId => s as CharacterId;
export const asVocabId = (s: string): VocabId => s as VocabId;
export const asComponentId = (s: string): ComponentId => s as ComponentId;
export const asReadingId = (s: string): ReadingId => s as ReadingId;
export const asSessionId = (s: string): SessionId => s as SessionId;

export const ID_PATTERN = /^(kana:(hi|ka):[a-z0-9_-]+|kanji:.+|comp:.+|vocab:.+|reading:.+:.+)$/u;

export const isItemId = (s: string): boolean => ID_PATTERN.test(s);

/** The id namespace tells you which content table an item lives in. */
export type ItemKind = 'kana' | 'kanji' | 'component' | 'vocab' | 'reading';

export function itemKind(id: ItemId | string): ItemKind {
  const head = String(id).split(':', 1)[0];
  switch (head) {
    case 'kana':
      return 'kana';
    case 'kanji':
      return 'kanji';
    case 'comp':
      return 'component';
    case 'vocab':
      return 'vocab';
    case 'reading':
      return 'reading';
    default:
      throw new Error(`Unrecognised item id: ${String(id)}`);
  }
}
