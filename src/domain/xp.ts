/**
 * XP rules.
 *
 * XP measures completed practice. It is deliberately NOT a measure of learning:
 * learning stages come from spaced, unaided performance and are tracked
 * separately. This separation is stated in About & Science, and the formula
 * below is labelled there as a product choice, not a validated design.
 */

export const XP_RULES = {
  /** 1 XP per completed question screen, right or wrong. */
  perScreen: 1,
  /** +10 XP once, for finishing all ten screens of a series. */
  seriesCompletionBonus: 10,
  /** 10 screens + bonus = 20 XP for a complete series. */
  perCompleteSeries: 20,
  /** Immediate corrected retries earn nothing. */
  perRetry: 0,
  /** Revealing an answer earns nothing extra; the screen XP is still granted. */
  perReveal: 0,
  /** Replaying audio earns nothing. */
  perAudioReplay: 0,
  /** A matching screen is one screen, so it earns one screen's XP. */
  perMatchingScreen: 1,
  /** No speed or accuracy bonuses in this version. */
  speedBonus: 0,
  accuracyBonus: 0,
} as const;

export const DEFAULT_DAILY_XP_GOAL = 20;

/** Why a given XP award happened. Used to make awards idempotent. */
export type XpReason = 'screen' | 'series-completion';

/**
 * An XP award. `dedupeKey` makes awards idempotent across reload, session
 * restore and repeated submissions: the same key can only ever be banked once.
 */
export interface XpAward {
  id: string;
  sessionId: string;
  seriesIndex: number;
  /** null for a series completion bonus. */
  screenIndex: number | null;
  reason: XpReason;
  amount: number;
  /** `${sessionId}:${seriesIndex}:${screenIndex ?? 'series'}:${reason}` */
  dedupeKey: string;
  at: string;
  localDate: string;
  timeZone: string;
  utcOffsetMinutes: number;
}

export function screenDedupeKey(sessionId: string, seriesIndex: number, screenIndex: number): string {
  return `${sessionId}:${seriesIndex}:${screenIndex}:screen`;
}

export function seriesDedupeKey(sessionId: string, seriesIndex: number): string {
  return `${sessionId}:${seriesIndex}:series:series-completion`;
}

/**
 * A daily record. The goal that applied on the day is stored with the day, so
 * changing the goal later never rewrites past achievements.
 */
export interface DailyRecord {
  /** Learner's local calendar date, YYYY-MM-DD. */
  localDate: string;
  xp: number;
  /** The goal in force on this date. */
  goalXp: number;
  goalMetAt: string | null;
  screensCompleted: number;
  seriesCompleted: number;
  activeMs: number;
  /** IANA zone the day was recorded in. */
  timeZone: string;
}
