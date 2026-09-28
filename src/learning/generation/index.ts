/**
 * HOW an item is asked about. See ./README.md for the spec table, the
 * ambiguity rules and the difficulty ladder.
 */
export { QUESTION_SPECS, QUESTION_SPEC_LIST, specFor } from './specs';
export { CompositeGenerator } from './composite';
export type { CompositeGeneratorOptions } from './composite';
export { validateQuestion } from './validate';
export { ladderFor, ladderRung, LADDER_RUNGS, MAX_RUNG, RUNG_EXPLANATIONS } from './ladder';
export type { LadderConfig, LadderRungName } from './ladder';
export { romajiScaffoldPolicy, resolveScaffold, scaffoldWouldLeakAnswer } from './scaffold';
export type { ScaffoldPolicy, ScaffoldVisibility, ResolvedScaffold } from './scaffold';
export { chooseFace, FACE_LABELS } from './fonts';
export type { FacePurpose } from './fonts';
export { indexPool, audioKey, parseReadingId, isKana, isKanji } from './pool';
export type { PoolIndex, ParsedReadingId } from './pool';
export { mulberry32, shuffle, pickOne, sample } from './rng';
export type { Rng } from './rng';
export {
  standaloneAmbiguity, inWordAmbiguity, soundAlikeStandalone, expandHomophoneSpellings,
  MAX_ACCEPTED_HOMOPHONE_VARIANTS,
} from './homophones';
export type { AudioAmbiguity, HomophoneExpansion } from './homophones';
export { pickCharacterDistractors, pickVocabDistractors } from './distractors';
export type {
  DistractorReason, CharacterDistractor, CharacterDistractorRequest, VocabDistractor, VocabDistractorRequest,
} from './distractors';
