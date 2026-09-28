import type { Skill } from './skills';
import type { ItemId, SessionId } from './ids';
import type { AnswerSubmission, Grade, Question } from './questions';

/** Standard series length. A product choice, stated as such in About & Science. */
export const SERIES_LENGTH = 10;

/** Default selection mix per series. Configurable; not a scientific constant. */
export const DEFAULT_SELECTION_POLICY = {
  dueReview: 6,
  weakSkillOrConfusion: 2,
  newOrExtending: 2,
} as const;

export type SessionKind = 'standard' | 'linked' | 'focused' | 'placement';

export type SessionStatus = 'active' | 'completed' | 'abandoned';

/** One of the 10 screens in a series. */
export interface SeriesScreen {
  /** 0-based index within the series, 0..9. */
  index: number;
  question: Question;
  /** Set once the screen has been graded. */
  result: ScreenResult | null;
  /** Corrected retries attached to this screen, in order. */
  retries: ScreenResult[];
  /** True once the learner has seen and dismissed the feedback. */
  feedbackAcknowledged: boolean;
  /** XP already banked for this screen. Guards against double awards. */
  xpAwarded: number;
}

export interface ScreenResult {
  submission: AnswerSubmission;
  grade: Grade;
  at: string;
}

/**
 * A live session. Persisted after every graded screen so that closing the app,
 * reloading, or rotating the device resumes exactly where the learner was.
 */
export interface SessionState {
  id: SessionId;
  kind: SessionKind;
  status: SessionStatus;
  /** Series in this session: 1 for standard, 2–3 for linked rounds. */
  series: SeriesState[];
  /** Requested round length; absent on legacy snapshots, which resume as one series. */
  seriesCount?: 1 | 2 | 3;
  /** Index of the series currently being answered. */
  activeSeriesIndex: number;
  startedAt: string;
  endedAt: string | null;
  localDate: string;
  timeZone: string;
  utcOffsetMinutes: number;
  /** Focused practice target, when kind === 'focused'. */
  focusItemId: ItemId | null;
  /** Modes the learner enabled for this session. */
  enabledQuestionTypes: string[];
  /** True when listening questions are excluded (silent practice). */
  silentMode: boolean;
  /** True when handwriting is substituted (keyboard-only mode). */
  keyboardOnlyMode: boolean;
  /** Total ms actually spent answering, excluding idle time. */
  activeMs: number;
  /** Schema version for safe restore across app updates. */
  version: number;
}

export interface SeriesState {
  /** 0-based index within the session. */
  index: number;
  screens: SeriesScreen[];
  /** Index of the screen being shown, 0..9. */
  cursor: number;
  /** Items queued for a delayed revisit later in this or a following series. */
  revisitQueue: Array<{ itemId: ItemId; skill?: Skill; readingId?: string | null; afterScreenIndex: number; reason: string }>;
  completedAt: string | null;
  /** True once the +10 completion bonus has been banked. Idempotency guard. */
  completionBonusAwarded: boolean;
}
