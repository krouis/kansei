import { openDB, type IDBPDatabase } from 'idb';
import { guard, storageError } from './errors';
import { CURRENT_SCHEMA_VERSION, MigrationFailure, runMigrations, type MigrationRun, type UpgradeTransaction } from './migrations';
import { createRepos } from './repos';
import type { Database, Transaction } from './ports';
import type { KanseiSchema } from './schema';

/**
 * Opens the Kansei database and implements the `Database` port over it.
 *
 * This is the one place that calls `idb.openDB` and hands out transactions.
 * Everything downstream (repos.ts) only ever sees a transaction that is already
 * open. Schema work itself lives entirely in migrations.ts — a fresh install
 * and an upgrade both go through `runMigrations`, starting from oldVersion 0
 * for a fresh install, because every migration's `up` already guards on
 * `hasStore`/`indexNames.contains` and is therefore exactly as correct applied
 * to nothing as applied to a partial prior schema. Duplicating "create the
 * current shape" as a second code path would be a second place for the two to
 * drift apart.
 */

const DB_NAME = 'kansei';
const REPO_TX_STORES = ['attempts', 'skillStates', 'confusions', 'xpAwards', 'daily', 'sessions', 'auxiliary'] as const;

export interface OpenDatabaseOptions {
  /** Override for tests: a distinct name isolates each test's data. */
  name?: string;
  /** Fired when an older connection (another tab) is blocking this upgrade. */
  onBlocked?: (currentVersion: number, blockedVersion: number) => void;
  /** Fired on THIS connection when a newer open elsewhere is waiting on it. */
  onVersionChange?: () => void;
}

/**
 * Opens the raw idb connection, migrated to the current schema.
 *
 * Split out from `openDatabase` so that `backup.ts` — which genuinely needs a
 * transaction over `settings` and `packState` too, stores the `Database` port
 * deliberately does not expose (see `ports.ts`'s `Transaction`) — can share
 * exactly this connection instead of opening the database a second time.
 */
export async function openRawConnection(options: OpenDatabaseOptions = {}): Promise<IDBPDatabase<KanseiSchema>> {
  let pendingRun: MigrationRun | null = null;

  let idb: IDBPDatabase<KanseiSchema>;
  try {
    idb = await openDB<KanseiSchema>(options.name ?? DB_NAME, CURRENT_SCHEMA_VERSION, {
      upgrade(database, oldVersion, newVersion, tx) {
        try {
          pendingRun = runMigrations(oldVersion, newVersion ?? CURRENT_SCHEMA_VERSION, {
            db: database as unknown as import('./migrations').UpgradeDatabase,
            tx: tx as unknown as UpgradeTransaction,
            note: () => {},
          });
        } catch (cause) {
          // A synchronous `up` failure. Re-thrown so it propagates out of this
          // callback, which is what makes idb abort the versionchange
          // transaction — the schema stays exactly as the previous build left
          // it, per the migration policy's all-or-nothing guarantee.
          throw cause;
        }
      },
      blocked(currentVersion, blockedVersion) {
        options.onBlocked?.(currentVersion, blockedVersion ?? currentVersion);
      },
      blocking() {
        options.onVersionChange?.();
      },
    });
  } catch (cause) {
    if (cause instanceof MigrationFailure) {
      throw storageError(cause, `upgrading the database from v${cause.fromVersion}`);
    }
    throw storageError(cause, 'opening the database');
  }

  // Backfills are async and were started inside the versionchange transaction
  // (see migrations.ts's two-phase note); wait for them before declaring the
  // database open, so nothing reads data mid-backfill.
  if (pendingRun) {
    try {
      await (pendingRun as MigrationRun).settled;
    } catch (cause) {
      idb.close();
      throw storageError(cause, 'completing a database migration');
    }
  }

  return idb;
}

/** Opens the database and wraps it as the `Database` port. The normal entry point. */
export async function openDatabase(options: OpenDatabaseOptions = {}): Promise<Database> {
  const idb = await openRawConnection(options);
  return wrapDatabase(idb);
}

/** Wraps an already-open, already-migrated connection as the `Database` port. */
export function wrapDatabase(idb: IDBPDatabase<KanseiSchema>): Database {
  let closed = false;

  const database: Database = {
    get version() {
      return idb.version;
    },

    async transact<T>(scope: 'readonly' | 'readwrite', fn: (tx: Transaction) => Promise<T>): Promise<T> {
      if (closed) throw storageError(new Error('Database is closed.'), 'starting a transaction');
      return guard('running a transaction', async () => {
        const tx = idb.transaction([...REPO_TX_STORES], scope);
        const repos = createRepos(tx, scope);
        let result: T;
        try {
          // The callback must not await anything outside the repo methods it was
          // given — see TxScope's doc comment in repos.ts for why, and what
          // happens (a loud, specific error naming the operation) if it does.
          result = await fn(repos);
        } catch (cause) {
          // A thrown JS error does NOT abort an IndexedDB transaction on its
          // own — IndexedDB only aborts on an unhandled request error or an
          // explicit abort() call, so without this, a queued write from earlier
          // in the callback would still commit despite the failure that
          // followed it. Abort explicitly, wait for the (rejected) settlement
          // so it cannot become an unhandled rejection, then propagate the
          // ORIGINAL error rather than idb's generic AbortError.
          tx.abort();
          await tx.done.catch(() => {});
          throw cause;
        }
        await tx.done;
        return result;
      });
    },

    close() {
      if (closed) return;
      closed = true;
      idb.close();
    },

    async estimate() {
      if (!('storage' in navigator) || typeof navigator.storage?.estimate !== 'function') {
        return { usageBytes: null, quotaBytes: null };
      }
      try {
        const { usage, quota } = await navigator.storage.estimate();
        return { usageBytes: usage ?? null, quotaBytes: quota ?? null };
      } catch {
        return { usageBytes: null, quotaBytes: null };
      }
    },

    async requestPersistence() {
      if (!('storage' in navigator) || typeof navigator.storage?.persist !== 'function') {
        return { persisted: false, supported: false };
      }
      try {
        const persisted = await navigator.storage.persist();
        return { persisted, supported: true };
      } catch {
        return { persisted: false, supported: true };
      }
    },
  };

  return database;
}
