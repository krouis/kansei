import type { CharacterEntry, KanaCharacter, KanjiCharacter, VocabEntry } from '@/domain';
import { isKana, isKanji } from './pool';
import { shuffle } from './rng';
import type { Rng } from './rng';

/**
 * Distractor selection.
 *
 * A distractor is only useful if a learner who does not know the answer might
 * plausibly pick it, and only *safe* if a learner who does know the answer could
 * never defend it. Those two requirements pull in opposite directions, which is
 * why every candidate carries the reason it was chosen: a wrong answer recorded
 * as "confused ツ with シ" is a fact worth scheduling a repair for, while a wrong
 * answer recorded against a random character is noise.
 *
 * Relatedness is itself rung 2 of the difficulty ladder, so the tier order is
 * reversed for early material: a brand-new character is presented against
 * unrelated options, and confusables are held back until the character itself is
 * known.
 */
export type DistractorReason =
  | 'confusable'
  | 'same-row'
  | 'same-column'
  | 'same-component'
  | 'same-reading'
  | 'same-lesson'
  | 'shares-character'
  | 'random-in-pool'
  | 'other-reading-of-same-kanji';

export interface CharacterDistractor {
  entry: CharacterEntry;
  reason: DistractorReason;
}

export interface CharacterDistractorRequest {
  target: CharacterEntry;
  candidates: readonly CharacterEntry[];
  count: number;
  /** True once the ladder allows close neighbours (rung >= 2). */
  related: boolean;
  /**
   * Candidates that must never be offered, whatever their relatedness — this is
   * where rule (d) is enforced at the source: a character that is also a correct
   * answer to the prompt as posed is not a distractor, it is a second answer.
   */
  forbid: (entry: CharacterEntry) => boolean;
  random: Rng;
}

function kanaTiers(target: KanaCharacter, pool: readonly CharacterEntry[]): Array<[DistractorReason, CharacterEntry[]]> {
  const confusables = new Set(target.confusableWith.map(String));
  const pos = target.position;
  const kana = pool.filter(isKana);
  return [
    ['confusable', kana.filter((k) => confusables.has(String(k.id)))],
    ['same-row', pos ? kana.filter((k) => k.position?.row === pos.row) : []],
    ['same-column', pos ? kana.filter((k) => k.position?.column === pos.column) : []],
    ['same-lesson', kana.filter((k) => k.lessonId === target.lessonId)],
    ['random-in-pool', kana.filter((k) => k.script === target.script)],
  ];
}

function kanjiTiers(
  target: KanjiCharacter,
  pool: readonly CharacterEntry[],
): Array<[DistractorReason, CharacterEntry[]]> {
  const confusables = new Set(target.confusableWith.map(String));
  const components = new Set(target.components.map(String));
  const readings = new Set(target.readings.map(String));
  const kanji = pool.filter(isKanji);
  return [
    ['confusable', kanji.filter((k) => confusables.has(String(k.id)))],
    ['same-component', kanji.filter((k) => k.components.some((c) => components.has(String(c))))],
    ['same-reading', kanji.filter((k) => k.readings.some((r) => readings.has(String(r))))],
    ['same-lesson', kanji.filter((k) => k.lessonId === target.lessonId)],
    ['random-in-pool', kanji],
  ];
}

/**
 * Pick `count` distractors, or return null.
 *
 * Returning null rather than padding with whatever is left is the point: a
 * three-option question presented as a four-option question, or a question with
 * a repeated option, is a degraded question, and the caller is expected to try a
 * different format instead.
 */
export function pickCharacterDistractors(req: CharacterDistractorRequest): CharacterDistractor[] | null {
  const targetId = String(req.target.id);
  const usable = req.candidates.filter((c) => String(c.id) !== targetId && c.glyph !== req.target.glyph && !req.forbid(c));

  const tiers = isKana(req.target)
    ? kanaTiers(req.target, usable)
    : isKanji(req.target)
      ? kanjiTiers(req.target, usable)
      : [];

  // Rung < 2: unrelated first, and confusables suppressed entirely. A learner
  // meeting ツ for the first time should not meet it next to シ.
  const ordered = req.related
    ? tiers
    : tiers.filter(([reason]) => reason !== 'confusable').reverse();

  const chosen: CharacterDistractor[] = [];
  const used = new Set<string>([targetId]);
  const usedGlyphs = new Set<string>([req.target.glyph]);

  for (const [reason, group] of ordered) {
    if (chosen.length >= req.count) break;
    for (const entry of shuffle(group, req.random)) {
      if (chosen.length >= req.count) break;
      const id = String(entry.id);
      if (used.has(id) || usedGlyphs.has(entry.glyph)) continue;
      used.add(id);
      usedGlyphs.add(entry.glyph);
      chosen.push({ entry, reason });
    }
  }

  return chosen.length === req.count ? chosen : null;
}

export interface VocabDistractorRequest {
  target: VocabEntry;
  candidates: readonly VocabEntry[];
  count: number;
  related: boolean;
  forbid: (entry: VocabEntry) => boolean;
  random: Rng;
}

export interface VocabDistractor {
  entry: VocabEntry;
  reason: DistractorReason;
}

/** The same contract for whole words: related first once the ladder allows it. */
export function pickVocabDistractors(req: VocabDistractorRequest): VocabDistractor[] | null {
  const targetId = String(req.target.id);
  const usable = req.candidates.filter((v) => String(v.id) !== targetId && !req.forbid(v));
  const targetChars = new Set(Array.from(req.target.spelling));

  const tiers: Array<[DistractorReason, VocabEntry[]]> = [
    ['shares-character', usable.filter((v) => Array.from(v.spelling).some((c) => targetChars.has(c)))],
    ['same-lesson', usable.filter((v) => v.lessonId === req.target.lessonId)],
    ['random-in-pool', usable],
  ];
  const ordered = req.related ? tiers : tiers.slice().reverse();

  const chosen: VocabDistractor[] = [];
  const used = new Set<string>([targetId]);
  const usedDisplays = new Set<string>([req.target.spelling]);
  for (const [reason, group] of ordered) {
    if (chosen.length >= req.count) break;
    for (const entry of shuffle(group, req.random)) {
      if (chosen.length >= req.count) break;
      const id = String(entry.id);
      // Two words with the same reading would both be valid answers to audio.
      if (used.has(id) || usedDisplays.has(entry.spelling) || entry.reading === req.target.reading) continue;
      used.add(id);
      usedDisplays.add(entry.spelling);
      chosen.push({ entry, reason });
    }
  }
  return chosen.length === req.count ? chosen : null;
}
