import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { ConfusionRecord } from '@/domain';

/**
 * Schema migrations.
 *
 * idb hands you a single `upgrade(db, oldVersion, newVersion, tx)` callback and it
 * is tempting to write one `if (oldVersion < 2) …` ladder inside it. This module
 * deliberately does not: that ladder cannot be unit tested, its order is
 * implicit, and it gives no vocabulary for reporting WHICH step failed. Each
 * schema change is instead a named, ordered `Migration`; the runner applies
 * exactly the pending ones, in order, and a failure names the step.
 *
 * Policy, binding on every migration ever added here:
 *
 *  - ADDITIVE ONLY. A migration may create stores, create indexes and fill in
 *    missing fields. It may never delete a store, delete a field or narrow a
 *    value. For a learner whose only copy of their progress is this device, data
 *    lost in an upgrade is lost permanently.
 *  - IDEMPOTENT. Every step checks whether its store or index already exists, so
 *    a half-applied upgrade (a tab killed mid-versionchange) re-runs safely.
 *  - ALL-OR-NOTHING. Migrations run inside IndexedDB's single versionchange
 *    transaction. If a step fails, that transaction is aborted: the stored
 *    version does NOT advance, nothing is applied, and the database is left
 *    exactly as the previous build wrote it — still fully usable by that build.
 *  - INDEX BACKFILL IS FREE. `createIndex` inside a versionchange transaction is
 *    populated from existing records by the engine, so adding an index never
 *    needs a manual pass over the data.
 *
 * SPLIT INTO TWO PHASES, and this is the non-obvious part.
 *
 * A versionchange transaction is deactivated the moment the `upgradeneeded`
 * handler returns and commits as soon as no request is outstanding. An
 * `async`/`await` migration therefore looks correct and is not: the first `await`
 * that is not already inside an in-flight IndexedDB request hands control back,
 * the transaction commits with the version already bumped, and the next statement
 * throws `TransactionInactiveError` — leaving a database stamped v2 with a v1
 * shape. So:
 *
 *   `up`        is SYNCHRONOUS and does all schema work. Runs in order.
 *   `backfill`  is async and may rewrite data. The runner starts every pending
 *               backfill in the SAME synchronous turn as `up`, which is only safe
 *               because each `backfill` issues its first IndexedDB request before
 *               its first `await` — that request keeps the transaction alive, and
 *               every later `await` resumes during a request's event dispatch,
 *               when the transaction is active again.
 *
 * Consequence, and it is a real constraint on future migrations: backfills run
 * concurrently, so they must be INDEPENDENT of one another. Order the schema, not
 * the data. A backfill that must observe another's output belongs in a later
 * schema version.
 */

/**
 * Migrations run against historical record shapes the CURRENT schema type does
 * not describe — that is what a migration is for. The context is therefore
 * deliberately untyped (`unknown` schema): `tx.objectStore(name)` yields loose
 * values, and each migration states in code what shape it expects to find.
 */
export type UpgradeDatabase = IDBPDatabase<unknown>;
export type UpgradeTransaction = IDBPTransaction<unknown, ArrayLike<string>, 'versionchange'>;

export interface MigrationContext {
  readonly db: UpgradeDatabase;
  readonly tx: UpgradeTransaction;
  /** Records what actually happened, for failure reports and for tests. */
  note(message: string): void;
}

export interface Migration {
  /** The schema version the database is AT once this migration has completed. */
  readonly version: number;
  /** Stable identifier. Appears in backup import plans and failure messages. */
  readonly name: string;
  /** Why this migration exists. Mirrored in docs/DATA-MODEL.md. */
  readonly description: string;
  /** Synchronous schema work: stores and indexes only. */
  up(ctx: MigrationContext): void;
  /**
   * Optional data rewrite. MUST issue its first IndexedDB request before its
   * first `await`, and MUST NOT depend on another migration's backfill.
   */
  backfill?(ctx: MigrationContext): Promise<void>;
}

export class MigrationFailure extends Error {
  constructor(
    readonly migrationName: string,
    readonly fromVersion: number,
    readonly toVersion: number,
    readonly reason: unknown,
  ) {
    super(
      `Migration '${migrationName}' (to schema v${toVersion}) failed while upgrading from ` +
        `v${fromVersion}: ${reason instanceof Error ? reason.message : String(reason)}. ` +
        'The upgrade was rolled back — no data was changed and the database is still at ' +
        `v${fromVersion}.`,
    );
    this.name = 'MigrationFailure';
  }
}

const hasStore = (db: UpgradeDatabase, name: string): boolean => db.objectStoreNames.contains(name);

/**
 * v1 — the initial schema.
 *
 * Kept verbatim as the first shipped version rather than folded into the current
 * schema, because the v1→v2 path has to be exercisable in a test against a
 * database that really was created this way.
 */
const v1: Migration = {
  version: 1,
  name: 'v1-initial-schema',
  description:
    'Creates the attempt log, skill states, confusions, XP ledger, daily records, sessions, settings, auxiliary counters and pack state.',
  up({ db }) {
    if (!hasStore(db, 'attempts')) {
      // Auto-increment: insertion order is the only trustworthy "newest first"
      // ordering, because `at` can tie to the millisecond and moves backwards
      // when the device clock is corrected.
      const attempts = db.createObjectStore('attempts', { autoIncrement: true });
      // Unique: the domain id is what makes storing the same attempt twice
      // impossible, which is in turn what makes a backup merge safe.
      attempts.createIndex('id', 'id', { unique: true });
      attempts.createIndex('sessionId', 'sessionId');
      attempts.createIndex('itemId', 'itemId');
      attempts.createIndex('localDate', 'localDate');
    }

    if (!hasStore(db, 'skillStates')) {
      const skills = db.createObjectStore('skillStates', { keyPath: ['itemId', 'skill', 'readingKey'] });
      skills.createIndex('dueAt', 'dueAt');
      skills.createIndex('stage', 'stage');
    }

    if (!hasStore(db, 'confusions')) {
      const confusions = db.createObjectStore('confusions', {
        keyPath: ['itemId', 'confusedWithItemId', 'skill'],
      });
      confusions.createIndex('count', 'count');
    }

    if (!hasStore(db, 'xpAwards')) {
      // dedupeKey AS the primary key: idempotence becomes a storage guarantee.
      const xp = db.createObjectStore('xpAwards', { keyPath: 'dedupeKey' });
      xp.createIndex('localDate', 'localDate');
    }

    if (!hasStore(db, 'daily')) db.createObjectStore('daily', { keyPath: 'localDate' });

    if (!hasStore(db, 'sessions')) {
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('status', 'status');
      sessions.createIndex('startedAt', 'startedAt');
    }

    if (!hasStore(db, 'settings')) db.createObjectStore('settings', { keyPath: 'id' });
    if (!hasStore(db, 'auxiliary')) db.createObjectStore('auxiliary', { keyPath: 'id' });
    if (!hasStore(db, 'packState')) db.createObjectStore('packState', { keyPath: 'packId' });
  },
};

/**
 * v2 — indexes the statistics and selection screens need, plus a backfill.
 *
 * Three queries were reading far more records than they returned:
 *   - the per-item, per-skill history read every attempt for an item;
 *   - `due(at, skill)` (silent practice, keyboard-only mode) read every due pair
 *     across all four skills and filtered in JS;
 *   - listing repaired confusions read the whole confusion table.
 *
 * The backfill exists because v1 wrote confusion records before `repairScheduled`
 * and `resolvedAt` were part of `ConfusionRecord`. On such a record
 * `resolvedAt === null` evaluates `undefined === null`, which is false — so an
 * unrepaired pair would have looked repaired and been hidden from `top()`
 * forever. The fields are filled in rather than the records rebuilt, so counts
 * and timestamps survive untouched.
 */
const v2: Migration = {
  version: 2,
  name: 'v2-statistics-indexes-and-confusion-backfill',
  description:
    'Adds attempts[itemId,skill], skillStates[skill,dueAt] and confusions.resolvedAt; backfills repairScheduled/resolvedAt on confusion records written by v1.',
  up({ tx, note }) {
    const attempts = tx.objectStore('attempts');
    if (!attempts.indexNames.contains('itemId_skill')) {
      attempts.createIndex('itemId_skill', ['itemId', 'skill']);
      note('created attempts.itemId_skill');
    }

    const skills = tx.objectStore('skillStates');
    if (!skills.indexNames.contains('skill_dueAt')) {
      skills.createIndex('skill_dueAt', ['skill', 'dueAt']);
      note('created skillStates.skill_dueAt');
    }

    const confusions = tx.objectStore('confusions');
    if (!confusions.indexNames.contains('resolvedAt')) {
      confusions.createIndex('resolvedAt', 'resolvedAt');
      note('created confusions.resolvedAt');
    }
  },
  async backfill({ tx, note }) {
    // First request issued before the first await — see the phase note above.
    let cursor = await tx.objectStore('confusions').openCursor();
    let patched = 0;
    while (cursor) {
      const row = cursor.value as Partial<ConfusionRecord>;
      const needsRepairFlag = typeof row.repairScheduled !== 'boolean';
      const needsResolved = row.resolvedAt === undefined;
      // Only genuinely incomplete records are rewritten, which is what makes
      // re-running this backfill a no-op.
      if (needsRepairFlag || needsResolved) {
        await cursor.update({
          ...row,
          repairScheduled: needsRepairFlag ? false : row.repairScheduled,
          resolvedAt: needsResolved ? null : row.resolvedAt,
        });
        patched += 1;
      }
      cursor = await cursor.continue();
    }
    if (patched > 0) note(`backfilled ${patched} confusion record(s)`);
  },
};

/** Ordered and contiguous from 1. Append new migrations; never edit a shipped one. */
export const MIGRATIONS: readonly Migration[] = [v1, v2];

/**
 * Authoring guard. A gap or a repeat in the version sequence would silently skip
 * a step on some upgrade paths, so it fails at import time rather than in the wild.
 */
MIGRATIONS.forEach((migration, index) => {
  if (migration.version !== index + 1) {
    throw new Error(
      `Migration list is not contiguous from 1: '${migration.name}' claims v${migration.version} at position ${index}.`,
    );
  }
});

export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.length;

/** The steps needed to move a database from `fromVersion` to `toVersion`, in order. */
export function pendingMigrations(
  fromVersion: number,
  toVersion: number = CURRENT_SCHEMA_VERSION,
): Migration[] {
  return MIGRATIONS.filter((m) => m.version > fromVersion && m.version <= toVersion);
}

export function migrationNames(fromVersion: number, toVersion?: number): string[] {
  return pendingMigrations(fromVersion, toVersion).map((m) => m.name);
}

export interface MigrationRun {
  /** Names applied, in order. */
  applied: string[];
  /** Everything the migrations reported, for logs and tests. */
  notes: string[];
  /** Resolves when the backfills have finished; rejects with a `MigrationFailure`. */
  settled: Promise<void>;
}

/**
 * Apply the pending migrations. MUST be called synchronously from inside idb's
 * `upgrade` callback — see the two-phase note at the top of this file.
 *
 * A synchronous failure is thrown to the caller, which lets it propagate out of
 * the upgrade handler so the engine aborts the versionchange transaction. An
 * asynchronous (backfill) failure arrives through `settled`, and the caller must
 * abort the transaction itself.
 */
export function runMigrations(
  oldVersion: number,
  newVersion: number,
  ctx: MigrationContext,
): MigrationRun {
  const notes: string[] = [];
  const recording: MigrationContext = { db: ctx.db, tx: ctx.tx, note: (m) => notes.push(m) };
  const pending = pendingMigrations(oldVersion, newVersion);
  const applied: string[] = [];

  for (const migration of pending) {
    try {
      migration.up(recording);
    } catch (reason) {
      throw new MigrationFailure(migration.name, oldVersion, migration.version, reason);
    }
    applied.push(migration.name);
    notes.push(`applied ${migration.name}`);
  }

  // Started here, in the same synchronous turn, so the transaction cannot commit
  // between the schema phase and the first backfill request.
  const backfills = pending
    .filter((m) => m.backfill)
    .map((migration) =>
      migration.backfill!(recording).catch((reason: unknown) => {
        throw new MigrationFailure(migration.name, oldVersion, migration.version, reason);
      }),
    );

  return { applied, notes, settled: Promise.all(backfills).then(() => undefined) };
}
