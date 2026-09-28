import {
  asItemId, asQuestionId, itemKind,
  type CharacterEntry, type ChoiceOption, type HintKind, type ItemId, type Question, type QuestionId,
  type QuestionPrompt, type QuestionType, type VocabEntry,
} from '@/domain';
import type { SelectedTarget } from '@/learning/ports';
import { specFor } from './specs';
import type { Rng } from './rng';

/**
 * Shared plumbing every generator uses to assemble a `Question` from a
 * `SelectedTarget` and a `QuestionSpec`, so the ten format modules only write
 * the part that is actually specific to them: the prompt, the options or pairs,
 * and the accepted answers.
 */

/**
 * A question id, minted from the injected RNG rather than `crypto.randomUUID`.
 *
 * Every random decision in generation goes through the seeded generator so a
 * session is replayable byte-for-byte (see rng.ts); an id is a random decision
 * like any other, and using a non-seeded source here would make two runs of the
 * same seed disagree on ids while agreeing on everything else, which is exactly
 * the kind of flaky-looking mismatch a replay is meant to rule out.
 */
export function mintQuestionId(random: Rng): QuestionId {
  const part = () => Math.floor(random() * 0xffffffff).toString(36);
  return asQuestionId(`q_${part()}${part()}`);
}

/** The glyph or spelling a content entry displays as. Works across the pool's item kinds. */
export function displayOf(entry: CharacterEntry | VocabEntry): string {
  return entry.kind === 'vocab' ? entry.spelling : entry.glyph;
}

/** Base fields common to every question, filled from the spec and the target. */
export function baseEnvelope(
  type: QuestionType,
  target: SelectedTarget,
  random: Rng,
): Pick<
  Question,
  | 'id' | 'type' | 'targetItemId' | 'targetReadingId' | 'skill' | 'direction' | 'response'
  | 'inputScript' | 'evidence' | 'allowedHints' | 'selectionReason' | 'focusedPractice'
  | 'requiredAudio' | 'requiredStrokeData'
> {
  const spec = specFor(type);
  return {
    id: mintQuestionId(random),
    type,
    targetItemId: target.itemId,
    targetReadingId: target.readingId,
    skill: spec.assesses,
    direction: spec.direction,
    response: spec.response,
    inputScript: spec.inputScript,
    evidence: spec.evidence,
    allowedHints: [...spec.allowedHints],
    selectionReason: target.reason,
    focusedPractice: target.reason === 'focused',
    requiredAudio: [],
    requiredStrokeData: [],
  };
}

export function emptyPrompt(instruction: string): QuestionPrompt {
  return { text: null, textIsJapanese: false, audio: null, instruction, context: null, scaffold: null };
}

/**
 * Build a shuffled option list from a correct entry and its distractors, keyed
 * A-D. Every content id carries its own brand (CharacterId, VocabId, …), which
 * is deliberately distinct from the general ItemId that ChoiceOption stores —
 * `asItemId` is the documented, explicit widening for exactly this crossing.
 */
export function buildChoiceOptions<T extends { entry: CharacterEntry | VocabEntry; reason: string }>(
  correctDisplay: string,
  correctItemId: ItemId | string | null,
  distractors: T[],
  order: readonly number[],
): ChoiceOption[] {
  const pool: ChoiceOption[] = [
    {
      key: '_correct',
      display: correctDisplay,
      itemId: correctItemId === null ? null : asItemId(String(correctItemId)),
      correct: true,
      distractorReason: null,
    },
    ...distractors.map((d, i) => ({
      key: `_d${i}`,
      display: displayOf(d.entry),
      itemId: asItemId(String(d.entry.id)),
      correct: false,
      distractorReason: d.reason,
    })),
  ];
  const positioned = order.map((sourceIndex, slot) => ({ ...pool[sourceIndex]!, key: 'ABCD'[slot]! }));
  return positioned;
}

/** A uniformly random permutation of 0..n-1, via the seeded RNG (see rng.ts's shuffle). */
export function randomOrder(n: number, random: Rng): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = idx[i] as number;
    const b = idx[j] as number;
    idx[i] = b;
    idx[j] = a;
  }
  return idx;
}

export function withHints(base: HintKind[], extra: HintKind[]): HintKind[] {
  const set = new Set(base);
  for (const h of extra) set.add(h);
  return [...set];
}

/** True when the target's item id names a kind this generator can handle. */
export function isCharacterTarget(id: string): boolean {
  const kind = itemKind(id);
  return kind === 'kana' || kind === 'kanji';
}

export interface Rejection {
  question: null;
  rejected: string;
}

export const reject = (reason: string): Rejection => ({ question: null, rejected: reason });
