import {
  SERIES_LENGTH, XP_RULES, screenDedupeKey, seriesDedupeKey, stamp,
} from '@/domain';
import type { DailyRecord, SessionId, SessionState, XpAward, XpReason } from '@/domain';
import type { Transaction } from '@/persistence/ports';

/**
 * The XP ledger.
 *
 * XP is an append-only log of awards, not a counter. Every total the app shows
 * is a sum over that log, which is what makes the three reload paths safe:
 * reload, session restore and a double-tapped submit all replay the same
 * `dedupeKey`, and `XpRepo.award` rejects a key it has already banked.
 *
 * The rules are exactly those in domain/xp.ts, and every one of them is a product
 * choice rather than a finding: 1 XP per completed screen right or wrong, +10
 * once for a complete ten-screen series, nothing at all for retries, reveals or
 * audio replays, and no speed or accuracy bonus.
 *
 * All awards are written through a caller-supplied `Transaction`, so the XP, the
 * day record and the session snapshot commit together with the attempt they came
 * from. The ledger never opens a transaction of its own — that is what would let
 * a crash leave the ledger and the session disagreeing.
 */

export interface AwardInput {
  sessionId: SessionId;
  seriesIndex: number;
  now: Date;
  /** The learner's zone AT THIS MOMENT, so travel is recorded as it happened. */
  timeZone: string;
  /**
   * The daily goal from settings at this moment. Used only when the day has no
   * record yet: once a day is written its goal is frozen, so changing the goal
   * tomorrow can never rewrite what today asked for.
   */
  goalXp: number;
  /** Answering time to attribute to the day. */
  activeMs: number;
}

export interface AwardResult {
  /** XP actually banked by this call. 0 when the key was already present. */
  amount: number;
  /** False when this award had already been banked — the idempotent path. */
  fresh: boolean;
  /** The local date the XP landed on, per the learner's zone at the time. */
  localDate: string;
}

export class XpLedger {
  /**
   * Bank the 1 XP for a completed question screen.
   *
   * "Completed" means the learner has reviewed the feedback: XP is the reward for
   * finishing the screen, not for being right, and a screen whose feedback was
   * never seen is not finished. A matching screen with three pairs is one screen
   * and earns exactly this.
   */
  async awardScreen(tx: Transaction, input: AwardInput & { screenIndex: number }): Promise<AwardResult> {
    return this.bank(tx, input, 'screen', input.screenIndex, XP_RULES.perScreen, 1, 0);
  }

  /**
   * Bank the +10 for completing all ten screens of a series.
   *
   * Awarded once per (session, series). A series that was abandoned at screen
   * nine keeps its nine screen-XP and never gets this.
   */
  async awardSeriesCompletion(tx: Transaction, input: AwardInput): Promise<AwardResult> {
    return this.bank(tx, input, 'series-completion', null, XP_RULES.seriesCompletionBonus, 0, 1);
  }

  private async bank(
    tx: Transaction,
    input: AwardInput,
    reason: XpReason,
    screenIndex: number | null,
    amount: number,
    screens: number,
    series: number,
  ): Promise<AwardResult> {
    const s = stamp(input.now, input.timeZone);
    const dedupeKey = screenIndex === null
      ? seriesDedupeKey(input.sessionId, input.seriesIndex)
      : screenDedupeKey(input.sessionId, input.seriesIndex, screenIndex);

    const award: XpAward = {
      // The id IS the dedupe key. A store that keys only on `id` is then just as
      // idempotent as one that indexes `dedupeKey`, so a double award is
      // impossible by construction rather than by the repo remembering to check.
      id: dedupeKey,
      sessionId: input.sessionId,
      seriesIndex: input.seriesIndex,
      screenIndex,
      reason,
      amount,
      dedupeKey,
      at: s.at,
      localDate: s.localDate,
      timeZone: s.timeZone,
      utcOffsetMinutes: s.utcOffsetMinutes,
    };

    const fresh = await tx.xp.award(award);
    if (!fresh) return { amount: 0, fresh: false, localDate: s.localDate };

    await this.touchDay(tx, {
      localDate: s.localDate,
      timeZone: s.timeZone,
      at: s.at,
      xp: amount,
      goalXp: input.goalXp,
      screens,
      series,
      activeMs: input.activeMs,
    });

    return { amount, fresh: true, localDate: s.localDate };
  }

  /**
   * Fold an award into the learner's day.
   *
   * The day is keyed by the LOCAL calendar date at the moment of the award, so a
   * session that runs past local midnight splits across two days exactly where
   * the learner's clock says it should, and a learner who flies to another zone
   * mid-day has the rest of the day's XP recorded under the date their new clock
   * shows. Both are consequences of stamping each award as it happens rather than
   * assigning the whole session to its start date.
   */
  private async touchDay(
    tx: Transaction,
    input: {
      localDate: string; timeZone: string; at: string; xp: number; goalXp: number;
      screens: number; series: number; activeMs: number;
    },
  ): Promise<void> {
    const existing = await tx.daily.get(input.localDate);
    // The goal in force is frozen on first write for the day. A learner who
    // raises their goal at 9pm has not retroactively failed the morning.
    const goalXp = existing?.goalXp ?? input.goalXp;
    const xp = (existing?.xp ?? 0) + input.xp;
    const record: DailyRecord = {
      localDate: input.localDate,
      xp,
      goalXp,
      // Set once, at the moment the goal was first reached. Practice beyond the
      // goal keeps earning; nothing is ever clawed back for a later missed day.
      goalMetAt: existing?.goalMetAt ?? (xp >= goalXp ? input.at : null),
      screensCompleted: (existing?.screensCompleted ?? 0) + input.screens,
      seriesCompleted: (existing?.seriesCompleted ?? 0) + input.series,
      activeMs: (existing?.activeMs ?? 0) + input.activeMs,
      // The zone the day was first recorded in is kept: it is the answer to
      // "where was I when this day happened", and a later flight does not change it.
      timeZone: existing?.timeZone ?? input.timeZone,
    };
    await tx.daily.upsert(record);
  }
}

/**
 * XP banked by a session, computed from its own snapshot.
 *
 * The snapshot is the authority for what a resumed session should show, and it is
 * written in the same transaction as the ledger, so the two cannot disagree. This
 * is what "resume restores the XP already banked" means in practice: no query
 * over the ledger is needed to redraw the screen.
 */
export function bankedXp(state: SessionState): number {
  let total = 0;
  for (const series of state.series) {
    for (const screen of series.screens) total += screen.xpAwarded;
    if (series.completionBonusAwarded) total += XP_RULES.seriesCompletionBonus;
  }
  return total;
}

/** The most XP a session of this shape could bank: 20 per complete series. */
export function maxXpFor(seriesCount: number): number {
  return seriesCount * XP_RULES.perCompleteSeries;
}

/** Sanity check used by the engine: a series is exactly ten screens or it is a bug. */
export function assertSeriesLength(screens: number, seriesIndex: number): void {
  if (screens !== SERIES_LENGTH) {
    throw new Error(
      `Series ${seriesIndex} has ${screens} screens; a series is exactly ${SERIES_LENGTH}. ` +
        `A short series would silently change what a series-completion bonus means.`,
    );
  }
}
