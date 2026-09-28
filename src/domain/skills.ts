/**
 * Skills are tracked independently for every item.
 *
 * The product rule this encodes: strong performance on one skill is NOT
 * evidence for another. Four-option recognition being easy does not make
 * unaided handwriting easy, so each skill carries its own memory state,
 * its own learning stage and its own review schedule.
 */

export const SKILLS = ['recognition', 'readingRecall', 'listening', 'handwriting'] as const;
export type Skill = (typeof SKILLS)[number];

/**
 * Japanese input-method (IME) practice is deliberately NOT a member of `Skill`.
 *
 * Typing Japanese exercises keyboard/IME procedure, which is a different ability
 * from recalling a reading. It is tracked in its own counter set so it can never
 * inflate `readingRecall`, and it is never displayed as character mastery.
 */
export type AuxiliarySkill = 'imeInput';

export const SKILL_LABELS: Record<Skill, string> = {
  recognition: 'Recognition',
  readingRecall: 'Reading recall',
  listening: 'Listening',
  handwriting: 'Handwriting',
};

export const SKILL_DESCRIPTIONS: Record<Skill, string> = {
  recognition:
    'Picking the right character when you can see it alongside other options, or matching it to a sound.',
  readingRecall: 'Producing the reading of a character or word from memory, with no options shown.',
  listening: 'Identifying a character or word from audio alone.',
  handwriting: 'Writing the character by hand, in the right stroke order, without a model to copy.',
};

/**
 * Which skills a given item can meaningfully be tested on.
 * A component, for example, has no reading to recall.
 */
export interface SkillApplicability {
  recognition: boolean;
  readingRecall: boolean;
  listening: boolean;
  handwriting: boolean;
}

/** Evidence strength of a question format for the skill it targets. */
export type EvidenceStrength = 'weak' | 'moderate' | 'strong';
