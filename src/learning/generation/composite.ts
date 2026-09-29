import { itemKind, type Question, type QuestionType } from '@/domain';
import type { GenerationContext, Generator, SelectedTarget } from '@/learning/ports';
import { ladderFor } from './ladder';
import { validateQuestion } from './validate';

import { generateAudioToCharacterChoice } from './types/audioToCharacterChoice';
import { generateRomajiToKanaChoice } from './types/romajiToKanaChoice';
import { generateCharacterToReadingChoice } from './types/characterToReadingChoice';
import { generateCharacterToReadingTyped } from './types/characterToReadingTyped';
import { generateMatchPairs } from './types/matchPairs';
import { generateAudioToTyped } from './types/audioToTyped';
import { generatePromptToHandwriting } from './types/promptToHandwriting';
import { generateConfusableDiscrimination } from './types/confusableDiscrimination';
import { generateWordReading } from './types/wordReading';
import { generateComponentInKanjiChoice, generateMeaningToKanjiChoice } from './types/visualKanjiChoice';
import { generateKanjiInWordContext } from './types/kanjiInWordContext';

type GenFn = (target: SelectedTarget, ctx: GenerationContext) => { question: Question | null; rejected: string | null };

const GENERATORS: Record<QuestionType, GenFn> = {
  'component-in-kanji-choice': generateComponentInKanjiChoice,
  'meaning-to-kanji-choice': generateMeaningToKanjiChoice,
  'audio-to-character-choice': generateAudioToCharacterChoice,
  'romaji-to-kana-choice': generateRomajiToKanaChoice,
  'character-to-reading-choice': generateCharacterToReadingChoice,
  'character-to-reading-typed': generateCharacterToReadingTyped,
  'match-pairs': generateMatchPairs,
  'audio-to-typed': generateAudioToTyped,
  'prompt-to-handwriting': generatePromptToHandwriting,
  'confusable-discrimination': generateConfusableDiscrimination,
  'word-reading': generateWordReading,
  'kanji-in-word-context': generateKanjiInWordContext,
};

/**
 * Which formats can even be TRIED for a given skill, in preference order.
 *
 * Order encodes the difficulty ladder's rung 2 (relatedDistractors) and the
 * scaffold schedule: `confusable-discrimination` — the hardest recognition
 * format — is only tried first once the ladder allows related distractors, and
 * `romaji-to-kana-choice` — the gentlest — is what a brand-new kana pair gets,
 * since ladderFor returns rung 0 with the rōmaji still shown for it.
 *
 * This table is deliberately independent of item kind: a format that cannot
 * apply to the target (e.g. match-pairs on a kanji) rejects itself, and the
 * composite generator moves on to the next candidate rather than special-
 * casing kinds here.
 */
function candidatesFor(skill: SelectedTarget['skill'], relatedDistractors: boolean): QuestionType[] {
  switch (skill) {
    case 'listening':
      return ['audio-to-typed', 'audio-to-character-choice'];
    case 'recognition':
      return relatedDistractors
        ? ['confusable-discrimination', 'match-pairs', 'character-to-reading-choice', 'romaji-to-kana-choice']
        : ['romaji-to-kana-choice', 'character-to-reading-choice', 'match-pairs', 'confusable-discrimination'];
    case 'readingRecall':
      return ['kanji-in-word-context', 'word-reading', 'character-to-reading-typed'];
    case 'handwriting':
      return ['prompt-to-handwriting'];
    default:
      return [];
  }
}

export interface CompositeGeneratorOptions {
  /** Only these types may ever be produced — the learner's enabled formats. */
  enabledTypes?: readonly QuestionType[];
}

/**
 * Implements the `Generator` port by trying, in order, every format that could
 * plausibly assess the target's skill, and returning the first one that both
 * generates and passes `validateQuestion`. Every rejection along the way is
 * kept so a caller that cannot fill a screen can report WHY rather than just
 * failing silently.
 */
export class CompositeGenerator implements Generator {
  constructor(private readonly options: CompositeGeneratorOptions = {}) {}

  async generate(
    target: SelectedTarget,
    ctx: GenerationContext,
  ): Promise<{ question: Question | null; rejected: string | null }> {
    const ladder = ladderFor(target.state, ctx.settings);
    let candidates = candidatesFor(target.skill, ladder.relatedDistractors);
    if (target.skill === 'recognition') candidates.push('component-in-kanji-choice', 'meaning-to-kanji-choice');
    const enabledTypes = this.options.enabledTypes ?? ctx.settings.enabledQuestionTypes;
    if (enabledTypes.length) {
      const enabled = new Set(enabledTypes);
      candidates = candidates.filter((t) => enabled.has(t));
    }
    if (candidates.length === 0) {
      return {
        question: null,
        rejected: `No enabled question format assesses '${target.skill}' for a ${safeKind(target)} target.`,
      };
    }

    const reasons: string[] = [];
    for (const type of candidates) {
      const fn = GENERATORS[type];
      const result = fn(target, ctx);
      if (!result.question) {
        reasons.push(`${type}: ${result.rejected ?? 'no reason given'}`);
        continue;
      }
      const verdict = validateQuestion(result.question);
      if (!verdict.ok) {
        reasons.push(`${type}: generated but failed validation — ${verdict.reason}`);
        continue;
      }
      return { question: result.question, rejected: null };
    }

    return { question: null, rejected: `Every candidate format was rejected: ${reasons.join(' | ')}` };
  }
}

function safeKind(target: SelectedTarget): string {
  try {
    return itemKind(target.itemId);
  } catch {
    return 'unknown';
  }
}
