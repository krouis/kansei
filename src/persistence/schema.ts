import type { DBSchema, StoreNames } from 'idb';
import type {
  AttemptRecord, AuxiliaryCounters, ConfusionRecord, DailyRecord, PackInstallState,
  SessionState, Settings, SkillState,
} from '@/domain';

/**
 * The IndexedDB schema.
 *
 * Every store and index below exists because a named query in
 * `persistence/ports.ts` needs it. Nothing is indexed "just in case": each index
 * costs write time and space on a device that may be a cheap phone, so the
 * justification is recorded next to it.
 *
 * Two IndexedDB facts shape the whole design:
 *
 *  1. `null` is not a valid IndexedDB key and is not indexable. A record whose
 *     indexed field is null is simply ABSENT from that index — it is not sorted
 *     first, it is missing. That is exploited on purpose for `dueAt` (an unseen
 *     pair has no due date and must not appear in the due query) and worked
 *     around with a sentinel for `readingId`, which is part of a primary key and
 *     therefore cannot be missing.
 *  2. Compound keys sort element by element, and within one element the type
 *     order is number < date < string < binary < array. A short array sorts
 *     before any longer array sharing its prefix. Both facts are used by the
 *     prefix ranges in `keyRanges` below, which is how `forItem` queries work
 *     without a redundant index.
 */

/**
 * Sentinel for "this skill state is not about a specific reading".
 *
 * `SkillState.readingId` is `string | null` in the domain, and null cannot sit in
 * a key. The empty string is used instead because no real ReadingId is empty
 * (they are `reading:<glyph>:<reading>`), so the mapping is lossless and
 * reversible. The domain-facing value is ALWAYS reconverted to null on read, so
 * nothing outside this module ever sees the sentinel.
 */
export const NO_READING = '';

/** Stored shape of a skill state: the domain record plus its derived key part. */
export type SkillStateRow = SkillState & {
  /** `readingId ?? NO_READING`. Derived, never authored by callers. */
  readingKey: string;
};

export const toSkillRow = (state: SkillState): SkillStateRow => ({
  ...state,
  readingKey: state.readingId ?? NO_READING,
});

export const fromSkillRow = (row: SkillStateRow): SkillState => {
  const { readingKey: _ignored, ...state } = row;
  // readingId is the authority; readingKey is only ever its indexable shadow.
  return state;
};

/** Single-record stores keep an explicit primary key so the record is addressable. */
export const SETTINGS_KEY = 'settings';
export const AUXILIARY_KEY = 'counters';

export interface SettingsRow {
  id: typeof SETTINGS_KEY;
  value: Settings;
}

export interface AuxiliaryRow {
  id: typeof AUXILIARY_KEY;
  value: AuxiliaryCounters;
}

export interface KanseiSchema extends DBSchema {
  /**
   * The attempt log: append-only, never edited, the source of truth every
   * statistic is derived from.
   *
   * Key: auto-increment. Insertion order is preserved and is the only reliable
   * "newest first" ordering — two attempts can share an ISO `at` to the
   * millisecond, and a clock change can make `at` go backwards, so `at` is not
   * safe to sort on. The domain's own `id` is carried in a UNIQUE index instead,
   * which makes "the same attempt cannot be stored twice" a schema guarantee and
   * so makes a backup merge inherently idempotent.
   */
  attempts: {
    key: number;
    value: AttemptRecord;
    indexes: {
      /** Unique: dedupe on the domain id, for merges and for repeat submissions. */
      id: string;
      /** `forSession` — restoring and reviewing one session. */
      sessionId: string;
      /** `forItem` — the per-character history panel. */
      itemId: string;
      /** `betweenDates` — every statistics screen ranges over local dates. */
      localDate: string;
      /**
       * `[itemId, skill]` — the per-item, per-skill breakdown. Without it that
       * screen reads every attempt for an item and filters in JS, which grows
       * without bound as the learner practises.
       */
      itemId_skill: [string, string];
    };
  };

  /**
   * Memory state, one record per (item, skill, reading).
   *
   * Key: `[itemId, skill, readingKey]`. A compound primary key rather than a
   * synthetic string id, because the prefix `[itemId]` then answers `forItem`
   * directly and nothing can ever write two states for the same triple.
   */
  skillStates: {
    key: [string, string, string];
    value: SkillStateRow;
    indexes: {
      /**
       * `due(at)` — the scheduler's central query. Null `dueAt` (an unseen pair)
       * is absent from this index, which is exactly right: unseen material is
       * chosen by the selector, not by the due query.
       */
      dueAt: string;
      /** `countByStage` — the progress summary counts, answered without a scan. */
      stage: string;
      /**
       * `[skill, dueAt]` — `due(at, skill)` when a mode narrows the skills
       * (silent practice, keyboard-only). Added in schema v2; before it, a
       * per-skill due query scanned every due pair across all four skills.
       */
      skill_dueAt: [string, string];
    };
  };

  /**
   * Confusion pairs, derived from attempts but stored because the derivation is
   * a full scan of the attempt log and the selector needs it every series.
   *
   * Key: `[itemId, confusedWithItemId, skill]`. Directional on purpose: reading
   * シ as ツ is a different error from the reverse and deserves its own count.
   */
  confusions: {
    key: [string, string, string];
    value: ConfusionRecord;
    indexes: {
      /** `top(limit)` — iterated in reverse for "most confused first". */
      count: number;
      /**
       * `resolvedAt` — auditing which pairs were repaired and when. Unresolved
       * records have a null `resolvedAt` and are therefore NOT in this index, so
       * it can only ever be used to enumerate resolved pairs. `top()` needs the
       * opposite and so filters unresolved records while walking `count`.
       * Added in schema v2.
       */
      resolvedAt: string;
    };
  };

  /**
   * The XP ledger.
   *
   * Key: `dedupeKey`. This is the whole point of the store's design — making the
   * dedupe key the PRIMARY key moves "XP is never awarded twice for the same
   * screen" out of application logic and into the storage engine, where a reload,
   * a session restore, a double tap and a backup merge all hit the same
   * `ConstraintError` and become a no-op.
   */
  xpAwards: {
    key: string;
    value: import('@/domain').XpAward;
    indexes: {
      /** `totalForDate` / `betweenDates` — daily goal and the XP history chart. */
      localDate: string;
    };
  };

  /** One record per local calendar date. Key: the date itself; no index needed. */
  daily: {
    key: string;
    value: DailyRecord;
  };

  /** Session snapshots, saved after every graded screen so a reload resumes. */
  sessions: {
    key: string;
    value: SessionState;
    indexes: {
      /** `active()` — find the interrupted session to offer a resume. */
      status: string;
      /** `recent(limit)` — the session history list, walked in reverse. */
      startedAt: string;
    };
  };

  /** Single record. Kept in IndexedDB, not localStorage, so it joins backups. */
  settings: {
    key: string;
    value: SettingsRow;
  };

  /** Single record: IME/typing counters, deliberately outside skill progress. */
  auxiliary: {
    key: string;
    value: AuxiliaryRow;
  };

  /**
   * Per-pack install state. Device-local: it describes which files verified on
   * THIS device, so it is intentionally excluded from backups and from import.
   */
  packState: {
    key: string;
    value: PackInstallState;
  };
}

/**
 * Deliberately `StoreNames<KanseiSchema>` (idb's own helper) rather than
 * `keyof KanseiSchema & string`. The two resolve to the same literal union, but
 * idb's generic store/transaction types are bound by `StoreNames<DBTypes>`
 * internally, and TypeScript does not treat two independently-computed type
 * expressions as interchangeable inside a *generic* constraint check — only a
 * concrete instantiation gets structurally compared. Aliasing the identical
 * helper here is what lets `Name extends StoreName` satisfy idb's own generic
 * bounds in `repos.ts` without a cast at every call site.
 */
export type StoreName = StoreNames<KanseiSchema>;

/**
 * Stores reachable through `Database.transact`. Every one of them is in scope on
 * every transaction so that recording an answer — attempt, skill state,
 * confusion, XP, session snapshot, daily total, auxiliary counters — is one
 * atomic unit. Naming a narrower scope per call would be marginally faster and
 * would make partial writes possible, which is the wrong trade for a progress log.
 */
export const REPO_STORES = [
  'attempts', 'skillStates', 'confusions', 'xpAwards', 'daily', 'sessions', 'auxiliary',
] as const satisfies readonly StoreName[];

/** Stores a backup writes. `packState` is absent by design: see its comment above. */
export const BACKUP_STORES = [
  'attempts', 'skillStates', 'confusions', 'xpAwards', 'daily', 'sessions', 'auxiliary', 'settings',
] as const satisfies readonly StoreName[];

export const ALL_STORES = [...BACKUP_STORES, 'packState'] as const satisfies readonly StoreName[];

/**
 * Prefix ranges over compound primary keys.
 *
 * `[itemId]` is shorter than any `[itemId, skill, readingKey]` and so sorts
 * before all of them; `[itemId, []]` is greater than all of them because an
 * empty array outranks any string in IndexedDB key order. The pair therefore
 * bounds exactly the records for one item. This is why no separate `itemId`
 * index exists on `skillStates` or `confusions`.
 */
export const keyRanges = {
  itemPrefix(itemId: string): IDBKeyRange {
    return IDBKeyRange.bound([itemId], [itemId, []]);
  },
  /** Inclusive date range. Safe because every stored date is exactly YYYY-MM-DD. */
  dates(from: string, to: string): IDBKeyRange {
    return IDBKeyRange.bound(from, to);
  },
  /** Due at or before `at`, for one skill. '' is below every ISO instant. */
  dueForSkill(skill: string, at: string): IDBKeyRange {
    return IDBKeyRange.bound([skill, ''], [skill, at]);
  },
};
