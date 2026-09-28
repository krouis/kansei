import type { IDBPObjectStore, IDBPTransaction } from 'idb';
import {
  LEARNING_STAGE_LABELS,
  type AttemptRecord, type AuxiliaryCounters, type ConfusionRecord, type DailyRecord,
  type ItemId, type SessionId, type SessionState, type Skill, type SkillState, type XpAward,
} from '@/domain';
import { fail, guard, storageError } from './errors';
import {
  ALL_STORES, AUXILIARY_KEY, NO_READING, fromSkillRow, keyRanges, toSkillRow,
  type KanseiSchema, type SkillStateRow, type StoreName,
} from './schema';
import type {
  AttemptRepo, AuxiliaryRepo, ConfusionRepo, DailyRepo, SessionRepo, SkillRepo, Transaction, XpRepo,
} from './ports';

/**
 * Repository implementations, all bound to ONE IndexedDB transaction.
 *
 * Nothing here opens a transaction of its own. That is what makes recording an
 * answer atomic, and it is also the constraint that makes these objects
 * dangerous to hold on to: the moment the transaction commits they are dead.
 * `TxScope` below turns that from a silent data-integrity bug into a loud error.
 */

/**
 * idb's `IDBPTransaction` third parameter must be a concrete tuple type, not a
 * general `StoreName[]` — a plain array's numeric index signature widens to
 * `string` and no longer satisfies `ArrayLike<StoreNames<DBTypes>>`. `typeof
 * ALL_STORES` is the broadest concrete tuple available, which is exactly what
 * these repo classes need: they are generic over `Name extends StoreName` and
 * do not depend on which subset a given real transaction actually opened.
 */
type TxStores = typeof ALL_STORES;
type AnyTx = IDBPTransaction<KanseiSchema, TxStores, 'readonly' | 'readwrite'>;

/**
 * Writable store handle.
 *
 * idb types `add`/`put`/`delete` as `undefined` when the transaction mode is
 * `'readonly'`, so a mode chosen at runtime makes them `fn | undefined` and every
 * call site needs a non-null assertion. The cast below resolves that conditional
 * type once; the ACTUAL enforcement of read-only is `TxScope.writable()`, which
 * throws before any request is issued. IndexedDB itself is the third line of
 * defence — a write on a readonly transaction throws `ReadOnlyError`.
 */
type Writable<Name extends StoreName> = IDBPObjectStore<KanseiSchema, TxStores, Name, 'readwrite'>;

/**
 * Liveness and mode guard shared by every repo.
 *
 * An idb transaction commits as soon as the microtask queue drains with no
 * request outstanding. A caller who awaits ANYTHING other than these repo methods
 * inside `transact` therefore ends their transaction early, and the writes that
 * follow land nowhere. Without this guard the symptom is "the answer was recorded
 * but the XP was not", days later, with no error. With it, the misuse throws and
 * names itself.
 */
class TxScope {
  private settled = false;

  constructor(
    private readonly tx: AnyTx,
    private readonly mode: 'readonly' | 'readwrite',
  ) {
    // `done` settles a microtask after the transaction finishes, either way.
    const mark = () => {
      this.settled = true;
    };
    tx.done.then(mark, mark);
  }

  private assertLive(operation: string): void {
    if (this.settled) {
      fail(
        'unknown',
        `${operation} ran after its transaction had already finished. idb transactions commit as ` +
          'soon as the microtask queue drains, so the callback passed to transact() must not await ' +
          'anything except the repository methods it was given. Writes issued before the commit ' +
          'point were applied; this one was not.',
      );
    }
  }

  store<Name extends StoreName>(name: Name, operation: string): IDBPObjectStore<KanseiSchema, TxStores, Name, 'readonly' | 'readwrite'> {
    this.assertLive(operation);
    return this.tx.objectStore(name);
  }

  writable<Name extends StoreName>(name: Name, operation: string): Writable<Name> {
    this.assertLive(operation);
    if (this.mode !== 'readwrite') {
      fail('unknown', `${operation} is a write, but its transaction was opened as read-only.`);
    }
    return this.tx.objectStore(name) as unknown as Writable<Name>;
  }
}

/** Collect a cursor walk, honouring a limit and a predicate, newest-first when asked. */
async function collect<T>(
  open: () => Promise<{ value: T; continue: () => Promise<unknown> } | null>,
  limit: number | undefined,
  keep: (value: T) => boolean,
): Promise<T[]> {
  const out: T[] = [];
  let cursor = (await open()) as { value: T; continue: () => Promise<typeof cursor> } | null;
  while (cursor && (limit === undefined || out.length < limit)) {
    if (keep(cursor.value)) out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

class Attempts implements AttemptRepo {
  constructor(private readonly scope: TxScope) {}

  async append(record: AttemptRecord): Promise<void> {
    if (!record.id) fail('unknown', 'An attempt cannot be appended without an id.');
    await guard('appending an attempt', async () => {
      // `add`, not `put`: the store is append-only and the unique `id` index must
      // reject a second copy of the same attempt rather than overwrite history.
      await this.scope.writable('attempts', 'appending an attempt').add(record);
    });
  }

  async forItem(itemId: ItemId, limit?: number): Promise<AttemptRecord[]> {
    return guard('reading an item history', async () => {
      const index = this.scope.store('attempts', 'reading an item history').index('itemId');
      // 'prev' walks [itemId, primaryKey] descending, and the primary key is the
      // auto-increment counter, so this really is newest-inserted-first.
      return collect<AttemptRecord>(
        () => index.openCursor(IDBKeyRange.only(itemId), 'prev') as never,
        limit,
        () => true,
      );
    });
  }

  async forSession(sessionId: SessionId): Promise<AttemptRecord[]> {
    return guard('reading a session history', () =>
      this.scope.store('attempts', 'reading a session history').index('sessionId').getAll(sessionId),
    );
  }

  async betweenDates(fromLocalDate: string, toLocalDate: string): Promise<AttemptRecord[]> {
    if (fromLocalDate > toLocalDate) return [];
    return guard('reading attempts by date', () =>
      this.scope
        .store('attempts', 'reading attempts by date')
        .index('localDate')
        .getAll(keyRanges.dates(fromLocalDate, toLocalDate)),
    );
  }

  /** Attempts for one item and skill. Uses the v2 compound index. */
  async forItemAndSkill(itemId: ItemId, skill: Skill): Promise<AttemptRecord[]> {
    return guard('reading attempts for an item and skill', () =>
      this.scope
        .store('attempts', 'reading attempts for an item and skill')
        .index('itemId_skill')
        .getAll(IDBKeyRange.only([itemId, skill])),
    );
  }

  async count(): Promise<number> {
    return guard('counting attempts', () => this.scope.store('attempts', 'counting attempts').count());
  }

  /** True when this exact attempt id is already stored. Used by backup merge. */
  async hasId(id: string): Promise<boolean> {
    return guard('checking for an attempt', async () => {
      const key = await this.scope.store('attempts', 'checking for an attempt').index('id').getKey(id);
      return key !== undefined;
    });
  }
}

class Skills implements SkillRepo {
  constructor(private readonly scope: TxScope) {}

  async get(itemId: ItemId, skill: Skill, readingId?: string | null): Promise<SkillState | undefined> {
    return guard('reading a skill state', async () => {
      const row = await this.scope
        .store('skillStates', 'reading a skill state')
        .get([itemId, skill, readingId ?? NO_READING]);
      return row ? fromSkillRow(row) : undefined;
    });
  }

  async put(state: SkillState): Promise<void> {
    await guard('saving a skill state', async () => {
      await this.scope.writable('skillStates', 'saving a skill state').put(toSkillRow(state));
    });
  }

  async forItem(itemId: ItemId): Promise<SkillState[]> {
    return guard('reading an item’s skill states', async () => {
      const rows = await this.scope
        .store('skillStates', 'reading an item’s skill states')
        .getAll(keyRanges.itemPrefix(itemId));
      return rows.map(fromSkillRow);
    });
  }

  async due(at: string, skill?: Skill, limit?: number): Promise<SkillState[]> {
    return guard('reading due items', async () => {
      const store = this.scope.store('skillStates', 'reading due items');
      // Both branches are ordered by dueAt ascending, so the most overdue pair
      // comes first and a `limit` takes the most urgent work rather than an
      // arbitrary slice. Pairs with a null dueAt are absent from both indexes.
      const rows = skill
        ? await collect<SkillStateRow>(
            () => store.index('skill_dueAt').openCursor(keyRanges.dueForSkill(skill, at)) as never,
            limit,
            () => true,
          )
        : await collect<SkillStateRow>(
            () => store.index('dueAt').openCursor(IDBKeyRange.upperBound(at)) as never,
            limit,
            () => true,
          );
      return rows.map(fromSkillRow);
    });
  }

  async all(): Promise<SkillState[]> {
    return guard('reading all skill states', async () => {
      const rows = await this.scope.store('skillStates', 'reading all skill states').getAll();
      return rows.map(fromSkillRow);
    });
  }

  async countByStage(): Promise<Record<string, number>> {
    return guard('counting stages', async () => {
      const index = this.scope.store('skillStates', 'counting stages').index('stage');
      const out: Record<string, number> = {};
      // One counted range per known stage beats a full scan, and the stage list is
      // closed (it comes from the domain), so nothing can be missed.
      for (const stage of Object.keys(LEARNING_STAGE_LABELS)) {
        out[stage] = await index.count(stage);
      }
      return out;
    });
  }
}

class Confusions implements ConfusionRepo {
  constructor(private readonly scope: TxScope) {}

  async record(itemId: ItemId, confusedWith: ItemId, skill: Skill, at: string): Promise<void> {
    await guard('recording a confusion', async () => {
      const store = this.scope.writable('confusions', 'recording a confusion');
      const existing = await store.get([itemId, confusedWith, skill]);
      if (!existing) {
        await store.put({
          itemId, confusedWithItemId: confusedWith, skill,
          count: 1, lastAt: at, repairScheduled: false, resolvedAt: null,
        });
        return;
      }
      // A pair that confuses the learner again is no longer resolved, and its
      // repair has to be re-scheduled: keeping `resolvedAt` set here would hide
      // a live confusion from `top()` forever.
      await store.put({
        ...existing,
        count: existing.count + 1,
        lastAt: at,
        repairScheduled: false,
        resolvedAt: null,
      });
    });
  }

  async top(limit: number): Promise<ConfusionRecord[]> {
    return guard('reading top confusions', async () => {
      const index = this.scope.store('confusions', 'reading top confusions').index('count');
      // Walked in reverse for highest count first. Unresolved records cannot be
      // found through the `resolvedAt` index (IndexedDB does not index null), so
      // the filter happens here.
      return collect<ConfusionRecord>(
        () => index.openCursor(null, 'prev') as never,
        limit,
        (record) => record.resolvedAt === null,
      );
    });
  }

  async forItem(itemId: ItemId): Promise<ConfusionRecord[]> {
    return guard('reading confusions for an item', () =>
      this.scope
        .store('confusions', 'reading confusions for an item')
        .getAll(keyRanges.itemPrefix(itemId)),
    );
  }

  async markRepairScheduled(itemId: ItemId, confusedWith: ItemId, skill: Skill): Promise<void> {
    await this.patch(itemId, confusedWith, skill, 'marking a confusion repair', (record) => ({
      ...record,
      repairScheduled: true,
    }));
  }

  async resolve(itemId: ItemId, confusedWith: ItemId, skill: Skill, at: string): Promise<void> {
    await this.patch(itemId, confusedWith, skill, 'resolving a confusion', (record) => ({
      ...record,
      resolvedAt: at,
    }));
  }

  private async patch(
    itemId: ItemId,
    confusedWith: ItemId,
    skill: Skill,
    context: string,
    change: (record: ConfusionRecord) => ConfusionRecord,
  ): Promise<void> {
    await guard(context, async () => {
      const store = this.scope.writable('confusions', context);
      const existing = await store.get([itemId, confusedWith, skill]);
      if (!existing) {
        // Silently creating a record here would invent a confusion that was never
        // observed, so this is an error the caller has to see.
        fail('unknown', `No confusion record for ${itemId} → ${confusedWith} (${skill}).`);
      }
      await store.put(change(existing));
    });
  }
}

class Xp implements XpRepo {
  constructor(private readonly scope: TxScope) {}

  async award(award: XpAward): Promise<boolean> {
    if (!award.dedupeKey) fail('unknown', 'An XP award cannot be banked without a dedupeKey.');
    const store = this.scope.writable('xpAwards', 'banking XP');
    try {
      // `add` on a store keyed by dedupeKey: the engine rejects the duplicate, so
      // idempotence does not depend on a read-then-write race inside the app.
      await store.add(award);
      return true;
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'ConstraintError') {
        return false;
      }
      throw storageError(cause, 'banking XP');
    }
  }

  async hasAward(dedupeKey: string): Promise<boolean> {
    return guard('checking an XP award', async () => {
      const count = await this.scope.store('xpAwards', 'checking an XP award').count(dedupeKey);
      return count > 0;
    });
  }

  async totalForDate(localDate: string): Promise<number> {
    const awards = await this.betweenDates(localDate, localDate);
    return awards.reduce((sum, a) => sum + a.amount, 0);
  }

  async betweenDates(fromLocalDate: string, toLocalDate: string): Promise<XpAward[]> {
    if (fromLocalDate > toLocalDate) return [];
    return guard('reading XP by date', () =>
      this.scope
        .store('xpAwards', 'reading XP by date')
        .index('localDate')
        .getAll(keyRanges.dates(fromLocalDate, toLocalDate)),
    );
  }

  async total(): Promise<number> {
    return guard('totalling XP', async () => {
      // Streamed rather than materialised: the ledger grows by one record per
      // question screen and outlives every other store.
      let sum = 0;
      let cursor = await this.scope.store('xpAwards', 'totalling XP').openCursor();
      while (cursor) {
        sum += cursor.value.amount;
        cursor = await cursor.continue();
      }
      return sum;
    });
  }

  async all(): Promise<XpAward[]> {
    return guard('reading the XP ledger', () =>
      this.scope.store('xpAwards', 'reading the XP ledger').getAll(),
    );
  }
}

class Sessions implements SessionRepo {
  constructor(private readonly scope: TxScope) {}

  async save(state: SessionState): Promise<void> {
    await guard('saving a session', async () => {
      await this.scope.writable('sessions', 'saving a session').put(state);
    });
  }

  async get(id: SessionId): Promise<SessionState | undefined> {
    return guard('reading a session', () => this.scope.store('sessions', 'reading a session').get(id));
  }

  async active(): Promise<SessionState | undefined> {
    return guard('looking for a session to resume', async () => {
      const open = await this.scope
        .store('sessions', 'looking for a session to resume')
        .index('status')
        .getAll('active');
      // More than one active session is possible — a backup merge can bring one
      // in from another device — so the newest is offered and the rest are left
      // alone rather than being rewritten.
      return open.reduce<SessionState | undefined>(
        (newest, s) => (!newest || s.startedAt > newest.startedAt ? s : newest),
        undefined,
      );
    });
  }

  async recent(limit: number): Promise<SessionState[]> {
    return guard('reading recent sessions', async () => {
      const index = this.scope.store('sessions', 'reading recent sessions').index('startedAt');
      return collect<SessionState>(() => index.openCursor(null, 'prev') as never, limit, () => true);
    });
  }

  async markAbandoned(id: SessionId, at: string): Promise<void> {
    await guard('abandoning a session', async () => {
      const store = this.scope.writable('sessions', 'abandoning a session');
      const existing = await store.get(id);
      if (!existing) fail('unknown', `No session ${id} to abandon.`);
      // A terminal session is not reopened or re-ended: whichever end came first
      // is the one that happened.
      if (existing.status !== 'active') return;
      await store.put({ ...existing, status: 'abandoned', endedAt: existing.endedAt ?? at });
    });
  }

  async all(): Promise<SessionState[]> {
    return guard('reading all sessions', () => this.scope.store('sessions', 'reading all sessions').getAll());
  }
}

class Daily implements DailyRepo {
  constructor(private readonly scope: TxScope) {}

  async upsert(record: DailyRecord): Promise<void> {
    await guard('saving a daily record', async () => {
      await this.scope.writable('daily', 'saving a daily record').put(record);
    });
  }

  async get(localDate: string): Promise<DailyRecord | undefined> {
    return guard('reading a daily record', () =>
      this.scope.store('daily', 'reading a daily record').get(localDate),
    );
  }

  async betweenDates(fromLocalDate: string, toLocalDate: string): Promise<DailyRecord[]> {
    if (fromLocalDate > toLocalDate) return [];
    return guard('reading daily records', () =>
      this.scope.store('daily', 'reading daily records').getAll(keyRanges.dates(fromLocalDate, toLocalDate)),
    );
  }

  async all(): Promise<DailyRecord[]> {
    return guard('reading all daily records', () =>
      this.scope.store('daily', 'reading all daily records').getAll(),
    );
  }
}

/** Zeroed counters. Returned when nothing has been recorded, so callers never see undefined. */
export const EMPTY_AUXILIARY: AuxiliaryCounters = {
  imeQuestions: 0,
  imeCorrect: 0,
  copiedVisibleRomaji: 0,
  lastAt: null,
};

class Auxiliary implements AuxiliaryRepo {
  constructor(private readonly scope: TxScope) {}

  async get(): Promise<AuxiliaryCounters> {
    return guard('reading auxiliary counters', async () => {
      const row = await this.scope.store('auxiliary', 'reading auxiliary counters').get(AUXILIARY_KEY);
      return row ? row.value : { ...EMPTY_AUXILIARY };
    });
  }

  async put(counters: AuxiliaryCounters): Promise<void> {
    await guard('saving auxiliary counters', async () => {
      await this.scope
        .writable('auxiliary', 'saving auxiliary counters')
        .put({ id: AUXILIARY_KEY, value: counters });
    });
  }
}

/**
 * Extra repo methods the ports do not declare but the backup service needs.
 * Exposed as a widened view rather than by changing the shared `Transaction`
 * type, so nothing outside this package sees a different contract.
 */
export interface FullTransaction extends Transaction {
  attempts: AttemptRepo & { hasId(id: string): Promise<boolean>; forItemAndSkill(itemId: ItemId, skill: Skill): Promise<AttemptRecord[]> };
  xp: XpRepo & { all(): Promise<XpAward[]> };
  sessions: SessionRepo & { all(): Promise<SessionState[]> };
}

export function createRepos(tx: AnyTx, mode: 'readonly' | 'readwrite'): FullTransaction {
  const scope = new TxScope(tx, mode);
  return {
    attempts: new Attempts(scope),
    skills: new Skills(scope),
    confusions: new Confusions(scope),
    xp: new Xp(scope),
    sessions: new Sessions(scope),
    daily: new Daily(scope),
    auxiliary: new Auxiliary(scope),
  };
}
