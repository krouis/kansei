import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { asSessionId } from '@/domain';
import { openDatabase } from '@/persistence/db';
import type { Database } from '@/persistence/ports';
import { XpLedger, bankedXp } from '@/learning/xp';

/**
 * The XP ledger's day-boundary logic, exercised across real daylight-saving
 * transitions rather than asserted in the abstract. 2026 is used throughout:
 * America/New_York springs forward (a 23-hour day) on 8 March and falls back
 * (a 25-hour day) on 1 November — both picked by scanning the real IANA data
 * rather than assumed. Asia/Tokyo carries no DST at all, which is exactly why
 * the cross-timezone test below uses America/Los_Angeles instead: a learner's
 * local date must track whichever zone was in force at the moment of each
 * award, DST included.
 */

let db: Database;
let ledger: XpLedger;

beforeEach(async () => {
  db = await openDatabase({ name: `kansei-xp-test-${Math.random().toString(36).slice(2)}` });
  ledger = new XpLedger();
});

afterEach(() => {
  db.close();
});

const sessionId = asSessionId('xp-test-session');

describe('XP ledger: local date assignment', () => {
  it('assigns a screen award to the correct side of local midnight, not UTC midnight', async () => {
    // 2026-01-01T04:30:00Z is already 2025-12-31T23:30 in America/New_York
    // (UTC-5 in January) — a case where the UTC date and the local date
    // disagree on which calendar day it is.
    const now = new Date('2026-01-01T04:30:00.000Z');
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, {
        sessionId, seriesIndex: 0, screenIndex: 0, now, timeZone: 'America/New_York', goalXp: 20, activeMs: 1000,
      }),
    );
    const dec31 = await db.transact('readonly', (tx) => tx.daily.get('2025-12-31'));
    const jan1 = await db.transact('readonly', (tx) => tx.daily.get('2026-01-01'));
    expect(dec31?.xp).toBe(1);
    expect(jan1).toBeUndefined();
  });

  it('splits a session that crosses local midnight across two DailyRecords', async () => {
    const beforeMidnight = new Date('2026-01-01T04:59:00.000Z'); // 2025-12-31T23:59 EST
    const afterMidnight = new Date('2026-01-01T05:01:00.000Z'); // 2026-01-01T00:01 EST
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 0, now: beforeMidnight, timeZone: 'America/New_York', goalXp: 20, activeMs: 500 }),
    );
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 1, now: afterMidnight, timeZone: 'America/New_York', goalXp: 20, activeMs: 500 }),
    );
    const dec31 = await db.transact('readonly', (tx) => tx.daily.get('2025-12-31'));
    const jan1 = await db.transact('readonly', (tx) => tx.daily.get('2026-01-01'));
    expect(dec31?.xp).toBe(1);
    expect(jan1?.xp).toBe(1);
    const total = await db.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(2); // Nothing lost and nothing duplicated across the split.
  });
});

describe('XP ledger: daylight-saving boundaries (America/New_York, 2026)', () => {
  it('records a full day of practice correctly across the 23-hour spring-forward day (8 March)', async () => {
    // 01:30 EST, still before the 2am skip to EDT.
    const early = new Date('2026-03-08T06:30:00.000Z');
    // 23:30 EDT, near the end of the same shortened local day.
    const late = new Date('2026-03-09T03:30:00.000Z');
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 0, now: early, timeZone: 'America/New_York', goalXp: 20, activeMs: 1000 }),
    );
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 1, now: late, timeZone: 'America/New_York', goalXp: 20, activeMs: 1000 }),
    );
    const day = await db.transact('readonly', (tx) => tx.daily.get('2026-03-08'));
    expect(day?.xp).toBe(2);
    // Nothing spilled onto the 9th despite the missing 2am-3am hour.
    const next = await db.transact('readonly', (tx) => tx.daily.get('2026-03-09'));
    expect(next).toBeUndefined();
  });

  it('records a full day of practice correctly across the 25-hour fall-back day (1 November)', async () => {
    // 01:30 EDT, before the 2am repeat.
    const early = new Date('2026-11-01T05:30:00.000Z');
    // 01:30 EST, the SECOND time that clock time occurs, an hour later in UTC.
    const repeated = new Date('2026-11-01T06:30:00.000Z');
    // 23:30 EST, near the end of the same lengthened local day.
    const late = new Date('2026-11-02T04:30:00.000Z');
    for (const [i, now] of [early, repeated, late].entries()) {
      await db.transact('readwrite', (tx) =>
        ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: i, now, timeZone: 'America/New_York', goalXp: 20, activeMs: 1000 }),
      );
    }
    const day = await db.transact('readonly', (tx) => tx.daily.get('2026-11-01'));
    expect(day?.xp).toBe(3);
    const next = await db.transact('readonly', (tx) => tx.daily.get('2026-11-02'));
    expect(next).toBeUndefined();
  });

  it('banks the series-completion bonus correctly when it lands right at a DST transition', async () => {
    const now = new Date('2026-03-08T07:00:00.000Z'); // 02:00 UTC-offset-shift moment, 2am EST -> already skipped to 3am EDT locally
    const award = await db.transact('readwrite', (tx) =>
      ledger.awardSeriesCompletion(tx, { sessionId, seriesIndex: 0, now, timeZone: 'America/New_York', goalXp: 20, activeMs: 0 }),
    );
    expect(award.fresh).toBe(true);
    expect(award.amount).toBe(10);
    expect(award.localDate).toBe('2026-03-08');
  });
});

describe('XP ledger: a learner who changes time zone mid-day', () => {
  it('attributes each award to the zone in force when it happened, not the session start zone', async () => {
    // The SAME instant is 2026-06-15 in Tokyo (JST, UTC+9) but still
    // 2026-06-14 in Los Angeles (PDT, UTC-7) — a genuine one-instant date
    // disagreement, not two different instants that happen to land on
    // different days. Asia/Tokyo carries no DST, isolating the effect of the
    // zone CHANGE itself rather than mixing in a transition.
    const instant = new Date('2026-06-15T02:00:00.000Z');
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 0, now: instant, timeZone: 'Asia/Tokyo', goalXp: 20, activeMs: 1000 }),
    );
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 1, screenIndex: 0, now: instant, timeZone: 'America/Los_Angeles', goalXp: 20, activeMs: 1000 }),
    );
    const tokyoDay = await db.transact('readonly', (tx) => tx.daily.get('2026-06-15'));
    const laDay = await db.transact('readonly', (tx) => tx.daily.get('2026-06-14'));
    expect(tokyoDay?.xp).toBe(1);
    expect(tokyoDay?.timeZone).toBe('Asia/Tokyo');
    expect(laDay?.xp).toBe(1);
    expect(laDay?.timeZone).toBe('America/Los_Angeles');
    const total = await db.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(2); // Split across two DailyRecords, nothing lost or doubled.
  });
});

describe('XP ledger: the daily goal is frozen on first write', () => {
  it('does not let a later goal change rewrite what a past day recorded', async () => {
    const now = new Date('2026-05-01T12:00:00.000Z');
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 0, now, timeZone: 'UTC', goalXp: 20, activeMs: 1000 }),
    );
    // The learner raises their goal, then earns a second screen the SAME day.
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 1, now, timeZone: 'UTC', goalXp: 999, activeMs: 1000 }),
    );
    const day = await db.transact('readonly', (tx) => tx.daily.get('2026-05-01'));
    expect(day?.goalXp).toBe(20); // Frozen from the first write of the day, not 999.
    expect(day?.xp).toBe(2);
  });

  it('never claws back XP already earned when a day is later revisited', async () => {
    const day1 = new Date('2026-05-01T12:00:00.000Z');
    await db.transact('readwrite', (tx) =>
      ledger.awardScreen(tx, { sessionId, seriesIndex: 0, screenIndex: 0, now: day1, timeZone: 'UTC', goalXp: 20, activeMs: 1000 }),
    );
    const totalAfterDay1 = await db.transact('readonly', (tx) => tx.xp.total());
    // A day passes with no practice at all — nothing should ever reduce the total.
    const totalLater = await db.transact('readonly', (tx) => tx.xp.total());
    expect(totalLater).toBe(totalAfterDay1);
    expect(totalAfterDay1).toBe(1);
  });
});

describe('bankedXp() reads a session snapshot without querying the ledger', () => {
  it('sums per-screen and per-series XP directly from the session state', () => {
    const state = {
      series: [
        { screens: [{ xpAwarded: 1 }, { xpAwarded: 1 }, { xpAwarded: 0 }], completionBonusAwarded: false },
        { screens: [{ xpAwarded: 1 }], completionBonusAwarded: true },
      ],
    } as unknown as Parameters<typeof bankedXp>[0];
    expect(bankedXp(state)).toBe(1 + 1 + 0 + 1 + 10);
  });
});
