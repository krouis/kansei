import type { ItemId, QuestionId, SessionId } from './ids';
import type { HintKind, InputMethod, PromptDirection, QuestionType, SelectionReason } from './questions';
import type { EvidenceStrength, Skill } from './skills';

/**
 * Learning stage for one (item, skill) pair.
 *
 * Criteria are explicit, spaced-performance based, and documented in
 * About & Science. Kansei never shows a mastery percentage: a stage is a
 * statement about observed behaviour, not a measurement of memory strength.
 */
export type LearningStage = 'unseen' | 'learning' | 'consolidating' | 'retained';

export const LEARNING_STAGE_LABELS: Record<LearningStage, string> = {
  unseen: 'Not started',
  learning: 'Learning',
  consolidating: 'Consolidating',
  retained: 'Retained',
};

/**
 * Non-colour indicator for each stage. Learning status is never conveyed by
 * colour alone; every tile carries this glyph and an accessible label too.
 */
export const LEARNING_STAGE_MARK: Record<LearningStage, string> = {
  unseen: '○',
  learning: '◔',
  consolidating: '◑',
  retained: '●',
};

/** Memory state for one (item, skill) pair. */
export interface SkillState {
  itemId: ItemId;
  skill: Skill;
  /** For kanji readings, the specific reading; null for whole-character skills. */
  readingId: string | null;
  stage: LearningStage;
  /**
   * Scheduler state. `stability` is the modelled retention interval in days and
   * `difficulty` the modelled item difficulty; both are estimates from a local
   * FSRS-style model, not measurements. See src/learning/scheduler/README.md.
   */
  stability: number;
  difficulty: number;
  /** Consecutive unaided first-attempt successes at or above the required evidence. */
  streak: number;
  /** Count of unaided first-attempt successes separated by at least one day. */
  spacedSuccesses: number;
  /** Lifetime counters. */
  totalAttempts: number;
  unaidedFirstAttemptCorrect: number;
  /** Attempts that used a hint or a reveal. */
  aidedAttempts: number;
  lapses: number;
  /** ISO instants. */
  firstSeenAt: string | null;
  lastReviewedAt: string | null;
  /** Last time the learner was right with no help at all. */
  lastUnaidedSuccessAt: string | null;
  dueAt: string | null;
  /** The interval, in days, that produced `dueAt`. */
  lastIntervalDays: number;
  /** Median response time in ms, kept per input method so pen ≠ slow memory. */
  medianMsByInput: Partial<Record<InputMethod, number>>;
  /** Scaffolding still being shown for this pair, 0 = none. */
  scaffoldLevel: number;
  /** Evidence strength of the best format this pair has passed. */
  strongestEvidencePassed: 'none' | 'weak' | 'moderate' | 'strong';
}

/** One recorded attempt. Append-only; never edited after the fact. */
export interface AttemptRecord {
  /** Monotonic local id. */
  id: string;
  sessionId: SessionId;
  questionId: QuestionId;
  itemId: ItemId;
  readingId: string | null;
  skill: Skill;
  questionType: QuestionType;
  direction: PromptDirection;
  /**
   * Evidence strength of the format that was asked, copied from the Question.
   *
   * It is recorded on the attempt rather than re-derived from `questionType`
   * later, because the scheduler must weight the evidence exactly as it was at
   * the time: a format's evidence rating can be revised in a later content
   * pack, and history must not silently change underneath old attempts.
   *
   * Optional only while the session engine is being wired up. A scheduler that
   * receives an attempt without it treats the attempt as WEAK evidence — the
   * conservative choice, which cannot inflate a pair's stage or interval.
   */
  evidence?: EvidenceStrength;
  selectionReason: SelectionReason;
  focusedPractice: boolean;
  /**
   * `attemptOrdinal` 0 is the first, graded attempt. Corrected retries are
   * recorded with ordinal >= 1 and NEVER overwrite the first result.
   */
  attemptOrdinal: number;
  outcome: 'correct' | 'incorrect' | 'uncertain';
  unaidedFirstAttempt: boolean;
  declined: boolean;
  hintsUsed: HintKind[];
  audioReplays: number;
  elapsedMs: number;
  inputMethod: InputMethod;
  imeUsed: boolean;
  /** What the learner answered, for confusion analysis. */
  answerGiven: string | null;
  confusedWithItemId: ItemId | null;
  /** UTC instant. */
  at: string;
  /** Learner's local calendar date (YYYY-MM-DD) at the time of the attempt. */
  localDate: string;
  /** IANA zone and UTC offset in minutes at the time, so history stays stable. */
  timeZone: string;
  utcOffsetMinutes: number;
  /** Handwriting detail, when applicable. */
  handwriting: {
    confidence: number;
    uncertain: boolean;
    strokeCountOk: boolean;
    strokeOrderOk: boolean;
    shapeScore: number | null;
    pointerType: string;
    strokeCountGiven: number;
    strokeCountExpected: number;
  } | null;
}

/** A recurring confusion between two items, derived from attempts. */
export interface ConfusionRecord {
  itemId: ItemId;
  confusedWithItemId: ItemId;
  skill: Skill;
  count: number;
  lastAt: string;
  /** True once the pair has been targeted by a repair question. */
  repairScheduled: boolean;
  resolvedAt: string | null;
}

/** IME/typing practice, tracked apart from reading recall. */
export interface AuxiliaryCounters {
  imeQuestions: number;
  imeCorrect: number;
  /** Times the learner typed rōmaji that was visible on screen — never credited. */
  copiedVisibleRomaji: number;
  lastAt: string | null;
}
