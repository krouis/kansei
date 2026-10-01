import { itemKind, type CharacterEntry, type Question, type VocabEntry } from '@/domain';
import type { GenerationContext, SelectedTarget } from '@/learning/ports';
import { pickCharacterDistractors, pickVocabDistractors } from '../distractors';
import { audioKey, indexPool, isKana } from '../pool';
import { soundAlikeStandalone } from '../homophones';
import { ladderFor } from '../ladder';
import { chooseFace } from '../fonts';
import { randomOrder, baseEnvelope, buildChoiceOptions, emptyPrompt, reject } from '../support';

/**
 * Type 1 — Audio → select the correct character among four options.
 *
 * Listening. The prompt is audio only; the four glyphs on screen are what makes
 * the choice fair. Ambiguity is handled at the DISTRACTOR level rather than by
 * accepting several options: a homophone of the target (じ for ぢ, を for お) is
 * excluded from the distractor pool entirely, so whichever single option is
 * shown is unambiguously the one the recording named. That is weaker than
 * requiring the learner to spell what they heard (type 6), which is exactly why
 * this format is 'weak' evidence.
 *
 * Kana/kanji and vocabulary are handled as two separate branches rather than
 * one generic path: `pickCharacterDistractors` and `pickVocabDistractors` take
 * and return different shapes, and unifying them behind one generic call site
 * bought nothing but a harder-to-read type error.
 */
export function generateAudioToCharacterChoice(
  target: SelectedTarget,
  ctx: GenerationContext,
): { question: Question | null; rejected: string | null } {
  const kind = itemKind(target.itemId);
  if (kind !== 'kana' && kind !== 'kanji' && kind !== 'vocab') {
    return reject(`audio-to-character-choice does not apply to a ${kind} target.`);
  }
  const key = audioKey(target.itemId);
  if (!ctx.hasAudio(key)) return reject('No verified recording for this item; listening questions require real audio.');
  const audio = ctx.audio?.(key);
  if (!audio) return reject('hasAudio reported true but no AudioRef was supplied.');

  const index = indexPool(ctx.pool);
  const ladder = ladderFor(target.state, ctx.settings);
  const base = baseEnvelope('audio-to-character-choice', target, ctx.random);

  if (kind === 'vocab') {
    const entry = index.vocabById(String(target.itemId));
    if (!entry) return reject('Target word not found in the generation pool.');
    const distractors = pickVocabDistractors({
      target: entry,
      candidates: index.vocab(),
      count: 3,
      related: ladder.relatedDistractors,
      forbid: (v: VocabEntry) => soundAlikeStandalone(entry.spelling, v.spelling),
      random: ctx.random,
    });
    if (!distractors) return reject('Could not assemble three safe word distractors.');
    const options = buildChoiceOptions(entry.spelling, entry.id, distractors, randomOrder(4, ctx.random));
    const question: Question = {
      ...base,
      prompt: { ...emptyPrompt('Listen, then choose what you heard.'), audio },
      options,
      pairs: null,
      acceptedAnswers: [entry.spelling],
      canonicalAnswer: entry.spelling,
      alsoAcceptableNote: null,
      distinction: null,
      requiredAudio: [key],
    };
    return { question, rejected: null };
  }

  const entry = index.characterById(String(target.itemId)) as CharacterEntry | undefined;
  if (!entry) return reject('Target character not found in the generation pool.');
  const candidates = isKana(entry) ? index.kana(entry.script) : index.kanji();
  const distractors = pickCharacterDistractors({
    target: entry,
    candidates,
    count: 3,
    related: ladder.relatedDistractors,
    forbid: (c) => soundAlikeStandalone(entry.glyph, c.glyph),
    random: ctx.random,
    settings: ctx.settings,
  });
  if (!distractors) return reject('Could not assemble three safe character distractors.');
  const options = buildChoiceOptions(entry.glyph, entry.id, distractors, randomOrder(4, ctx.random));
  const face = chooseFace(entry, 'read', ladder, ctx.random);

  const question: Question = {
    ...base,
    prompt: { ...emptyPrompt('Listen, then choose what you heard.'), audio, face },
    options,
    pairs: null,
    acceptedAnswers: [entry.glyph],
    canonicalAnswer: entry.glyph,
    alsoAcceptableNote: null,
    distinction: null,
    requiredAudio: [key],
  };
  return { question, rejected: null };
}
