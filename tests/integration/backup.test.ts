import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { asItemId, screenDedupeKey } from '@/domain';
import type { Settings } from '@/domain';
import { openRawConnection, wrapDatabase } from '@/persistence/db';
import { createBackupService } from '@/persistence/backup';
import type { BackupFile, Database } from '@/persistence/ports';
import type { IDBPDatabase } from 'idb';
import type { KanseiSchema } from '@/persistence/schema';

const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'system',
  japaneseTextScale: 1,
  reducedMotion: 'system',
  dailyGoalXp: 20,
  enabledQuestionTypes: [],
  silentPractice: false,
  keyboardOnlyMode: false,
  seriesPerSession: 1,
  selectionPolicy: { dueReview: 6, weakSkillOrConfusion: 2, newOrExtending: 2 },
  scaffoldWithdrawal: 'standard',
  showStreak: true,
  playChimes: true,
  reminders: {
    enabled: false, times: [], weekdays: [], afterLastSeries: false, quietHours: null,
    snoozeMinutes: 15, pausedUntil: null, skipWhenGoalMet: true, notificationPermission: 'default',
  },
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
  locale: 'en',
  activeScripts: ['hiragana'],
  includeExtended: false,
  includeHistorical: false,
};

let raw: IDBPDatabase<KanseiSchema>;
let db: Database;

beforeEach(async () => {
  raw = await openRawConnection({ name: `kansei-backup-test-${Math.random().toString(36).slice(2)}` });
  db = wrapDatabase(raw);
  // Settings must exist for export() to succeed.
  const tx = raw.transaction(['settings'], 'readwrite');
  await tx.objectStore('settings').put({ id: 'settings', value: DEFAULT_SETTINGS });
  await tx.done;
});

afterEach(() => {
  db.close();
});

describe('backup: export/import round trip', () => {
  it('produces a file that imports back to an identical state', async () => {
    await db.transact('readwrite', async (tx) => {
      await tx.xp.award({
        id: 'x1', sessionId: 's1', seriesIndex: 0, screenIndex: 0, reason: 'screen', amount: 1,
        dedupeKey: screenDedupeKey('s1', 0, 0), at: '2026-01-01T00:00:00.000Z', localDate: '2026-01-01',
        timeZone: 'UTC', utcOffsetMinutes: 0,
      });
      await tx.skills.put({
        itemId: asItemId('kana:hi:a'), skill: 'recognition', readingId: null, stage: 'learning',
        stability: 1, difficulty: 5, streak: 1, spacedSuccesses: 0, totalAttempts: 1,
        unaidedFirstAttemptCorrect: 1, aidedAttempts: 0, lapses: 0, firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastReviewedAt: '2026-01-01T00:00:00.000Z', lastUnaidedSuccessAt: '2026-01-01T00:00:00.000Z',
        dueAt: '2026-01-02T00:00:00.000Z', lastIntervalDays: 1, medianMsByInput: {}, scaffoldLevel: 2,
        strongestEvidencePassed: 'weak',
      });
    });

    const service = createBackupService(raw);
    const file = await service.export();
    expect(file.format).toBe('kansei-backup');
    expect(file.counts.xp).toBe(1);
    expect(file.counts.skills).toBe(1);

    // Import into a FRESH database and confirm the state matches.
    const rawB = await openRawConnection({ name: `kansei-backup-test-target-${Math.random().toString(36).slice(2)}` });
    const dbB = wrapDatabase(rawB);
    const serviceB = createBackupService(rawB);
    const plan = await serviceB.plan(file, 'replace');
    expect(plan.valid).toBe(true);
    await serviceB.apply(file, plan);

    const total = await dbB.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(1);
    const skill = await dbB.transact('readonly', (tx) => tx.skills.get(asItemId('kana:hi:a'), 'recognition'));
    expect(skill?.stage).toBe('learning');
    dbB.close();
  });
});

describe('backup: validation rejects bad input cleanly', () => {
  it('rejects a non-Kansei file with a clear message', async () => {
    const service = createBackupService(raw);
    const plan = await service.plan({ hello: 'world' }, 'merge');
    expect(plan.valid).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/not a Kansei backup/i);
  });

  it('rejects a tampered checksum', async () => {
    const service = createBackupService(raw);
    const file = await service.export();
    const tampered: BackupFile = { ...file, checksum: '0'.repeat(64) };
    const plan = await service.plan(tampered, 'merge');
    expect(plan.valid).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/integrity check/i);
  });

  it('rejects a newer formatVersion with a clear message, not a crash', async () => {
    const service = createBackupService(raw);
    const file = await service.export();
    const fromFuture: BackupFile = { ...file, formatVersion: 999 };
    const plan = await service.plan(fromFuture, 'merge');
    expect(plan.valid).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/newer version/i);
  });

  it('never throws on a hostile payload', async () => {
    const service = createBackupService(raw);
    const hostile = { format: 'kansei-backup', __proto__: { polluted: true }, data: null };
    await expect(service.plan(hostile, 'merge')).resolves.toMatchObject({ valid: false });
  });
});

describe('backup: merge never double-counts XP', () => {
  it('re-applying the same backup in merge mode leaves the XP total unchanged', async () => {
    await db.transact('readwrite', (tx) =>
      tx.xp.award({
        id: 'x1', sessionId: 's1', seriesIndex: 0, screenIndex: 0, reason: 'screen', amount: 1,
        dedupeKey: screenDedupeKey('s1', 0, 0), at: '2026-01-01T00:00:00.000Z', localDate: '2026-01-01',
        timeZone: 'UTC', utcOffsetMinutes: 0,
      }),
    );
    const service = createBackupService(raw);
    const file = await service.export();

    const plan1 = await service.plan(file, 'merge');
    await service.apply(file, plan1);
    const plan2 = await service.plan(file, 'merge');
    await service.apply(file, plan2);

    const total = await db.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(1);
  });
});

describe('backup: replace fully replaces', () => {
  it('a replace import removes data not present in the backup', async () => {
    await db.transact('readwrite', (tx) =>
      tx.attempts.append({
        id: 'will-be-replaced', sessionId: 's1' as never, questionId: 'q1' as never, itemId: asItemId('kana:hi:a'),
        readingId: null, skill: 'recognition', questionType: 'romaji-to-kana-choice', direction: 'romaji-to-glyph',
        selectionReason: 'new-material', focusedPractice: false, attemptOrdinal: 0, outcome: 'correct',
        unaidedFirstAttempt: true, declined: false, hintsUsed: [], audioReplays: 0, elapsedMs: 1000,
        inputMethod: 'touch', imeUsed: false, answerGiven: 'あ', confusedWithItemId: null,
        at: '2026-01-01T00:00:00.000Z', localDate: '2026-01-01', timeZone: 'UTC', utcOffsetMinutes: 0, handwriting: null,
      }),
    );
    const service = createBackupService(raw); // exports the CURRENT (empty-of-that-attempt at export time) state
    const emptyFile = await service.export();
    // The export happened AFTER the attempt was written, so it actually contains
    // it; to test replace-removes-extra-data, apply an export taken BEFORE it
    // existed by reusing a fresh empty database's export instead.
    const blankRaw = await openRawConnection({ name: `kansei-backup-blank-${Math.random().toString(36).slice(2)}` });
    await blankRaw.transaction(['settings'], 'readwrite').objectStore('settings').put({ id: 'settings', value: DEFAULT_SETTINGS });
    const blankService = createBackupService(blankRaw);
    const blankFile = await blankService.export();
    expect(blankFile.counts.attempts).toBe(0);
    void emptyFile;

    const plan = await service.plan(blankFile, 'replace');
    expect(plan.valid).toBe(true);
    const attemptsEffect = plan.effects.find((e) => e.store === 'attempts');
    expect(attemptsEffect?.removing).toBe(1);
    await service.apply(blankFile, plan);

    const count = await db.transact('readonly', (tx) => tx.attempts.count());
    expect(count).toBe(0);
    blankRaw.close();
  });
});
