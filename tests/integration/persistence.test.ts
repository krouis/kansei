import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { asItemId, asSessionId, screenDedupeKey } from '@/domain';
import type { AttemptRecord, SkillState, XpAward } from '@/domain';
import { openDatabase } from '@/persistence/db';
import type { Database } from '@/persistence/ports';
import { StorageError } from '@/persistence/ports';

/**
 * Exercises persistence against a REAL (in-memory) IndexedDB implementation,
 * not a mock of the idb API — the failure mode these tests guard against (an
 * await outside a transaction silently splitting a write) only manifests
 * against real IDB transaction-lifetime semantics.
 */

let dbName: string;
let db: Database;

beforeEach(async () => {
  dbName = `kansei-test-${Math.random().toString(36).slice(2)}`;
  db = await openDatabase({ name: dbName });
});

afterEach(() => {
  db.close();
});

function fakeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: `a_${Math.random().toString(36).slice(2)}`,
    sessionId: asSessionId('s1'),
    questionId: 'q1' as never,
    itemId: asItemId('kana:hi:a'),
    readingId: null,
    skill: 'recognition',
    questionType: 'romaji-to-kana-choice',
    direction: 'romaji-to-glyph',
    selectionReason: 'new-material',
    focusedPractice: false,
    attemptOrdinal: 0,
    outcome: 'correct',
    unaidedFirstAttempt: true,
    declined: false,
    hintsUsed: [],
    audioReplays: 0,
    elapsedMs: 1200,
    inputMethod: 'touch',
    imeUsed: false,
    answerGiven: 'あ',
    confusedWithItemId: null,
    at: '2026-01-01T00:00:00.000Z',
    localDate: '2026-01-01',
    timeZone: 'UTC',
    utcOffsetMinutes: 0,
    handwriting: null,
    ...overrides,
  };
}

function fakeSkillState(overrides: Partial<SkillState> = {}): SkillState {
  return {
    itemId: asItemId('kana:hi:a'),
    skill: 'recognition',
    readingId: null,
    stage: 'unseen',
    stability: 0,
    difficulty: 0,
    streak: 0,
    spacedSuccesses: 0,
    totalAttempts: 0,
    unaidedFirstAttemptCorrect: 0,
    aidedAttempts: 0,
    lapses: 0,
    firstSeenAt: null,
    lastReviewedAt: null,
    lastUnaidedSuccessAt: null,
    dueAt: null,
    lastIntervalDays: 0,
    medianMsByInput: {},
    scaffoldLevel: 2,
    strongestEvidencePassed: 'none',
    ...overrides,
  };
}

describe('persistence: round trips', () => {
  it('round-trips an attempt through append and forItem', async () => {
    const record = fakeAttempt();
    await db.transact('readwrite', (tx) => tx.attempts.append(record));
    const found = await db.transact('readonly', (tx) => tx.attempts.forItem(record.itemId));
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(record);
  });

  it('round-trips a skill state through put and get', async () => {
    const state = fakeSkillState({ stage: 'learning', streak: 2 });
    await db.transact('readwrite', (tx) => tx.skills.put(state));
    const found = await db.transact('readonly', (tx) => tx.skills.get(state.itemId, state.skill, state.readingId));
    expect(found).toEqual(state);
  });

  it('answers the due-index query without a null readingId polluting it', async () => {
    await db.transact('readwrite', async (tx) => {
      await tx.skills.put(fakeSkillState({ dueAt: '2026-01-01T00:00:00.000Z', stage: 'learning' }));
      await tx.skills.put(
        fakeSkillState({ itemId: asItemId('kana:hi:i'), dueAt: null, stage: 'unseen' }),
      );
    });
    const due = await db.transact('readonly', (tx) => tx.skills.due('2026-06-01T00:00:00.000Z'));
    expect(due).toHaveLength(1);
    expect(due[0]?.dueAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('persistence: XP idempotence is a schema guarantee', () => {
  it('rejects a duplicate dedupeKey instead of double-banking XP', async () => {
    const award: XpAward = {
      id: 'x1',
      sessionId: 's1',
      seriesIndex: 0,
      screenIndex: 0,
      reason: 'screen',
      amount: 1,
      dedupeKey: screenDedupeKey('s1', 0, 0),
      at: '2026-01-01T00:00:00.000Z',
      localDate: '2026-01-01',
      timeZone: 'UTC',
      utcOffsetMinutes: 0,
    };
    const first = await db.transact('readwrite', (tx) => tx.xp.award(award));
    const second = await db.transact('readwrite', (tx) => tx.xp.award({ ...award, id: 'x2' }));
    expect(first).toBe(true);
    expect(second).toBe(false);
    const total = await db.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(1);
  });

  it('survives reload: a fresh connection still refuses the same dedupeKey', async () => {
    const key = screenDedupeKey('s2', 0, 3);
    await db.transact('readwrite', (tx) =>
      tx.xp.award({
        id: 'y1', sessionId: 's2', seriesIndex: 0, screenIndex: 3, reason: 'screen', amount: 1,
        dedupeKey: key, at: '2026-01-01T00:00:00.000Z', localDate: '2026-01-01', timeZone: 'UTC', utcOffsetMinutes: 0,
      }),
    );
    db.close();
    db = await openDatabase({ name: dbName });
    const again = await db.transact('readwrite', (tx) =>
      tx.xp.award({
        id: 'y2', sessionId: 's2', seriesIndex: 0, screenIndex: 3, reason: 'screen', amount: 1,
        dedupeKey: key, at: '2026-01-01T00:00:01.000Z', localDate: '2026-01-01', timeZone: 'UTC', utcOffsetMinutes: 0,
      }),
    );
    expect(again).toBe(false);
  });
});

describe('persistence: transactional atomicity', () => {
  it('applies every write in one transact call, or none of it', async () => {
    const attempt = fakeAttempt({ id: 'atomic-1' });
    await db.transact('readwrite', async (tx) => {
      await tx.attempts.append(attempt);
      await tx.skills.put(fakeSkillState({ stage: 'learning' }));
      await tx.daily.upsert({
        localDate: '2026-01-01', xp: 1, goalXp: 20, goalMetAt: null,
        screensCompleted: 1, seriesCompleted: 0, activeMs: 1000, timeZone: 'UTC',
      });
    });
    const [attempts, skill, daily] = await db.transact('readonly', (tx) =>
      Promise.all([tx.attempts.count(), tx.skills.get(asItemId('kana:hi:a'), 'recognition'), tx.daily.get('2026-01-01')]),
    );
    expect(attempts).toBe(1);
    expect(skill?.stage).toBe('learning');
    expect(daily?.xp).toBe(1);
  });

  it('rolls back every write when the callback throws partway through', async () => {
    await expect(
      db.transact('readwrite', async (tx) => {
        await tx.attempts.append(fakeAttempt({ id: 'rollback-1' }));
        throw new Error('simulated mid-transaction failure');
      }),
    ).rejects.toThrow();
    const count = await db.transact('readonly', (tx) => tx.attempts.count());
    expect(count).toBe(0);
  });

  it('throws loudly rather than silently splitting a write when misused across a real await', async () => {
    // Deliberately reproduces the documented misuse: awaiting something OTHER
    // than a repo method inside the callback, which lets the idb transaction
    // auto-commit before the second write is issued.
    await expect(
      db.transact('readwrite', async (tx) => {
        await tx.attempts.append(fakeAttempt({ id: 'misuse-1' }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await tx.attempts.append(fakeAttempt({ id: 'misuse-2' }));
      }),
    ).rejects.toThrow(/already committed/);
  });
});

describe('persistence: storage failures are surfaced, not swallowed', () => {
  it('reports a corrupt/unopenable database as a StorageError', async () => {
    // Poison the global IDBFactory so the next open() call fails outright —
    // this is the most portable way to force `indexedDB.open` to reject
    // without depending on a specific browser's quota-error plumbing.
    const original = globalThis.indexedDB;
    // @ts-expect-error -- deliberately breaking the factory for this one call
    globalThis.indexedDB = { open: () => { throw new Error('simulated engine failure'); } };
    try {
      await expect(openDatabase({ name: 'will-not-open' })).rejects.toBeInstanceOf(StorageError);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('reports a transaction started after close as unavailable, not a silent no-op', async () => {
    const fresh = await openDatabase({ name: `${dbName}-closing` });
    fresh.close();
    await expect(fresh.transact('readonly', (tx) => tx.attempts.count())).rejects.toBeInstanceOf(StorageError);
  });
});

describe('persistence: migration preserves existing data', () => {
  it('upgrading from v1 keeps existing attempts and confusion records intact', async () => {
    const v1Name = `kansei-test-v1-${Math.random().toString(36).slice(2)}`;
    // Open at schema version 1 directly against the real (fake) IDB factory,
    // bypassing openDatabase, to get a genuine v1-shaped database on disk.
    const idbFactory: IDBFactory = globalThis.indexedDB;
    await new Promise<void>((resolve, reject) => {
      const req = idbFactory.open(v1Name, 1);
      req.onupgradeneeded = () => {
        const raw = req.result;
        const attempts = raw.createObjectStore('attempts', { autoIncrement: true });
        attempts.createIndex('id', 'id', { unique: true });
        attempts.createIndex('sessionId', 'sessionId');
        attempts.createIndex('itemId', 'itemId');
        attempts.createIndex('localDate', 'localDate');
        const skills = raw.createObjectStore('skillStates', { keyPath: ['itemId', 'skill', 'readingKey'] });
        skills.createIndex('dueAt', 'dueAt');
        skills.createIndex('stage', 'stage');
        const confusions = raw.createObjectStore('confusions', { keyPath: ['itemId', 'confusedWithItemId', 'skill'] });
        confusions.createIndex('count', 'count');
        raw.createObjectStore('xpAwards', { keyPath: 'dedupeKey' }).createIndex('localDate', 'localDate');
        raw.createObjectStore('daily', { keyPath: 'localDate' });
        const sessions = raw.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('status', 'status');
        sessions.createIndex('startedAt', 'startedAt');
        raw.createObjectStore('settings', { keyPath: 'id' });
        raw.createObjectStore('auxiliary', { keyPath: 'id' });
        raw.createObjectStore('packState', { keyPath: 'packId' });
      };
      req.onsuccess = () => {
        const raw = req.result;
        const tx = raw.transaction(['attempts', 'confusions'], 'readwrite');
        tx.objectStore('attempts').add(fakeAttempt({ id: 'pre-migration-1' }));
        // A v1-shaped confusion record: no repairScheduled/resolvedAt fields at
        // all, which is exactly the shape v2's backfill exists to fix.
        tx.objectStore('confusions').add({
          itemId: 'kana:ka:shi', confusedWithItemId: 'kana:ka:tsu', skill: 'recognition', count: 3, lastAt: '2026-01-01T00:00:00.000Z',
        });
        tx.oncomplete = () => {
          raw.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const upgraded = await openDatabase({ name: v1Name });
    expect(upgraded.version).toBe(2);

    const attempts = await upgraded.transact('readonly', (tx) => tx.attempts.forItem(asItemId('kana:hi:a')));
    expect(attempts.some((a) => a.id === 'pre-migration-1')).toBe(true);

    const confusions = await upgraded.transact('readonly', (tx) => tx.confusions.top(10));
    const migrated = confusions.find((c) => c.itemId === ('kana:ka:shi' as never));
    expect(migrated).toBeDefined();
    // The backfill must fill these in without touching the original count.
    expect(migrated?.count).toBe(3);
    expect(migrated?.repairScheduled).toBe(false);
    expect(migrated?.resolvedAt).toBeNull();

    upgraded.close();
  });
});
