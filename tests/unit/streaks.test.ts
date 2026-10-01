import { describe, expect, it } from 'vitest';
import { addDays, currentStreak, dailyStreak } from '@/app/App';
import type { DailyRecord, SessionState } from '@/domain';

function outcomes(...results: ('correct' | 'incorrect' | null)[]): SessionState {
  return {
    series: [{
      screens: results.map(outcome => ({ result: outcome ? { grade: { outcome } } : null })),
    }],
  } as unknown as SessionState;
}

describe('currentStreak', () => {
  it('is zero with no session', () => expect(currentStreak(undefined)).toBe(0));
  it('is zero when nothing has been answered yet', () => expect(currentStreak(outcomes(null, null))).toBe(0));
  it('counts consecutive correct answers ending at the latest one', () => {
    expect(currentStreak(outcomes('correct', 'correct', 'correct'))).toBe(3);
  });
  it('resets at the most recent incorrect answer, ignoring earlier correct ones', () => {
    expect(currentStreak(outcomes('correct', 'correct', 'incorrect', 'correct'))).toBe(1);
  });
  it('is zero right after a miss', () => expect(currentStreak(outcomes('correct', 'incorrect'))).toBe(0));
});

describe('addDays', () => {
  it('adds across a month boundary', () => expect(addDays('2026-01-31', 1)).toBe('2026-02-01'));
  it('subtracts across a year boundary', () => expect(addDays('2026-01-01', -1)).toBe('2025-12-31'));
  it('handles a leap day', () => expect(addDays('2024-02-28', 1)).toBe('2024-02-29'));
});

function daily(localDate: string, xp: number): DailyRecord {
  return { localDate, xp, goalXp: 20, goalMetAt: null, screensCompleted: 0, seriesCompleted: 0, activeMs: 0, timeZone: 'UTC' };
}

describe('dailyStreak', () => {
  it('is zero with no history', () => expect(dailyStreak([], '2026-03-10')).toBe(0));
  it('counts today plus unbroken prior days', () => {
    const days = [daily('2026-03-08', 20), daily('2026-03-09', 5), daily('2026-03-10', 1)];
    expect(dailyStreak(days, '2026-03-10')).toBe(3);
  });
  it('still counts yesterday when today has no practice yet, rather than reading as broken', () => {
    const days = [daily('2026-03-08', 20), daily('2026-03-09', 5)];
    expect(dailyStreak(days, '2026-03-10')).toBe(2);
  });
  it('stops at the first gap', () => {
    const days = [daily('2026-03-05', 20), daily('2026-03-09', 5), daily('2026-03-10', 1)];
    expect(dailyStreak(days, '2026-03-10')).toBe(2);
  });
  it('does not count a day with zero XP as practiced', () => {
    expect(dailyStreak([daily('2026-03-10', 0)], '2026-03-10')).toBe(0);
  });
});
