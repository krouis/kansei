import type { QuestionType } from './questions';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface ReminderPreferences {
  enabled: boolean;
  /** Local times, HH:MM, on the selected weekdays. */
  times: string[];
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** A reminder roughly 24h after the last completed series. */
  afterLastSeries: boolean;
  quietHours: { start: string; end: string } | null;
  snoozeMinutes: number;
  pausedUntil: string | null;
  /** Stop reminding once today's XP goal is met, where the platform allows it. */
  skipWhenGoalMet: boolean;
  /** Whether the learner granted the Notification permission. */
  notificationPermission: 'default' | 'granted' | 'denied';
}

export interface Settings {
  version: number;
  theme: ThemePreference;
  /** Type scale multiplier for Japanese text, 1 = default. */
  japaneseTextScale: number;
  reducedMotion: 'system' | 'always' | 'never';
  dailyGoalXp: number;
  /** Question formats the learner has enabled. */
  enabledQuestionTypes: QuestionType[];
  /** Exclude listening questions without changing listening progress. */
  silentPractice: boolean;
  /** Substitute handwriting with reading recall or stroke-order reconstruction. */
  keyboardOnlyMode: boolean;
  /** Series per linked round: 1, 2 or 3. */
  seriesPerSession: 1 | 2 | 3;
  selectionPolicy: { dueReview: number; weakSkillOrConfusion: number; newOrExtending: number };
  /** Rōmaji scaffolding: how quickly support is withdrawn. */
  scaffoldWithdrawal: 'slow' | 'standard' | 'fast';
  showStreak: boolean;
  /** Short procedural chimes on a graded answer and on finishing a session. */
  playChimes: boolean;
  reminders: ReminderPreferences;
  /** Set once onboarding has been completed. */
  onboardingCompletedAt: string | null;
  /** Locale for UI copy. Only 'en' ships in this version. */
  locale: 'en';
  /** Learner-chosen practice scripts, used to bound new-material selection. */
  activeScripts: Array<'hiragana' | 'katakana' | 'kanji'>;
  /** Include the extended curriculum tier in new-material selection. */
  includeExtended: boolean;
  /** Include historical forms. Off by default and never on the beginner path. */
  includeHistorical: boolean;
}
