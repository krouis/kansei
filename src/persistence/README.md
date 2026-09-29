# Persistence

IndexedDB via `idb`, behind the ports in `ports.ts`. See
[`docs/DATA-MODEL.md`](../../docs/DATA-MODEL.md) for the schema itself (every
store, every index, and why); this file is about the modules and the two
guarantees the rest of the app depends on.

## Modules

| File | Owns |
|---|---|
| `schema.ts` | The `KanseiSchema` type, store/index definitions, and `keyRanges` — the compound-key range helpers the repos use instead of extra indexes. |
| `db.ts` | `openRawConnection`/`wrapDatabase`/`openDatabase` — opens and migrates the connection, implements `Database.transact`. |
| `repos.ts` | `createRepos(tx, mode)` — one repo class per store, all bound to a single transaction via `TxScope` (see below). |
| `migrations.ts` | The versioned, ordered migration list and `runMigrations`. |
| `errors.ts` | `StorageError`/`StorageFailure`, and `guard`/`fail` helpers every repo method routes through. |
| `backup.ts` | `createBackupService` — export/plan/apply. |
| `settingsStore.ts` | `createSettingsStore` — settings live outside `transact`'s scope; see below. |
| `packStateStore.ts` | Per-pack install state — also outside `transact`'s scope, and deliberately excluded from backups (it describes what verified on *this* device). |

## Guarantee 1: recording an answer is one transaction

`Database.transact(scope, fn)` opens ONE IndexedDB transaction over
`attempts`, `skillStates`, `confusions`, `xpAwards`, `daily`, `sessions`, and
`auxiliary`, and hands `fn` a `Transaction` whose repos are all bound to it.
Grading a screen writes the attempt, the updated skill state, a confusion
record, the XP award, and the daily total in that one transaction — a crash
mid-write cannot leave the XP ledger disagreeing with the attempt log.

Two real bugs were found and fixed here by testing against an actual
IndexedDB implementation (`fake-indexeddb`) rather than trusting the code by
inspection — both are documented in `tests/integration/persistence.test.ts`
and in the commit history, because the failure mode is exactly the kind that
looks correct on review:

1. **An unhandled request error aborts the WHOLE transaction**, synchronously,
   during the native event's dispatch — before a JS `.catch()` on the
   wrapped promise ever runs. `Xp.award()` used to catch a duplicate-key
   `ConstraintError` from `add()`, but by the time the catch block ran, the
   transaction (and every other write already queued in it) was already
   gone. Fixed by checking `getKey()` before `add()`, inside the same
   transaction, so the constraint violation is never raised. `backup.ts`'s
   merge-import path had the identical bug for the identical reason and is
   fixed the identical way.
2. **A thrown JS error does not abort an IndexedDB transaction on its own.**
   IndexedDB only aborts on an explicit `tx.abort()` or an unhandled request
   error — a plain `throw` in application code is invisible to it, so a
   write issued earlier in a callback that later threw would still commit.
   `Database.transact` now calls `tx.abort()` explicitly when the callback
   throws, before propagating the original error.

`TxScope` (in `repos.ts`) turns a THIRD, still-possible misuse into a loud
error instead of silent data loss: an idb transaction auto-commits as soon as
the microtask queue drains with no request outstanding, so a callback that
`await`s anything other than a repo method (a `setTimeout`, an unrelated
fetch) ends the transaction early. Every repo call checks `TxScope`'s
liveness first and throws a specific, named error — "ran after its
transaction had already committed" — rather than silently writing nothing.

## Guarantee 2: migrations are additive, ordered, and never destroy data

`migrations.ts`'s policy, enforced by convention and tested against a real
v1→v2 upgrade with pre-existing data: a migration may create stores/indexes
and fill in missing fields, and may **never** delete a store, delete a
field, or narrow a value. Each migration is a named, ordered unit (`up`
synchronous schema work; an optional async `backfill`) rather than one
`if (oldVersion < N)` ladder, specifically so a single step can be tested and
a failure can name itself. `CURRENT_SCHEMA_VERSION` is derived from the
migration list's own length, so it cannot drift from what is actually
defined.

A **fresh install runs every migration from version 0** rather than a
separate "create current shape" code path — safe because every migration's
`up` already guards on `hasStore`/`indexNames.contains`, so it is exactly as
correct applied to nothing as applied to a partial prior schema, and there is
only one code path to keep correct.

## Settings and pack state live outside `transact`

Both are read far more often than the learning-record stores change (nearly
every render wants the theme or the daily goal) and are not part of the
atomic "recording an answer" write set. `settingsStore.ts` uses a
`BroadcastChannel` for cross-tab change notification, since IndexedDB itself
has no change-event API. `backup.ts`, which genuinely needs a transaction
spanning `settings` too, is given the raw `IDBPDatabase` directly via
`openRawConnection()` rather than going through the narrower `Database` port
— see `db.ts`'s doc comment on why that split exists.

## Backup (`backup.ts`)

`FORMAT_VERSION` (currently 1) is versioned independently of the database
SCHEMA version — a schema migration can happen with no backup-format change,
and the reverse is just as real. `export()` snapshots every backup-relevant
store with a SHA-256 checksum over a canonicalised (stable key order)
serialisation of the data block, so a later edit or truncation is caught by
`plan()` rather than silently imported. `plan()` never touches the database;
it computes real per-store effects (adding/updating/keeping/removing) against
whatever is currently stored — including a brand-new install with nothing in
it, the exact case a cross-device restore needs to work for, which is why the
"current state" read inside `plan()` tolerates a missing settings row that
`export()` itself would treat as a real error. `apply()`'s merge mode
resolves a skill-state conflict by keeping whichever side has the later
`lastReviewedAt`; XP awards union by `dedupeKey`, which is also what makes
re-importing the same backup a safe no-op rather than double-counted XP.

## Testing

`tests/integration/persistence.test.ts` (round-trips, the due-index query,
XP idempotence including across a simulated reload, both atomicity bugs
above, storage-failure surfacing, a real v1→v2 migration with pre-existing
data) and `tests/integration/backup.test.ts` (export/import round trip into
a fresh database, four distinct validation rejections including a hostile
`__proto__` payload, merge non-double-counting across a repeated import,
replace actually removing data) both run against `fake-indexeddb`, not a
mock of `idb` — the transaction-timing bugs above only reproduce against
real IndexedDB transaction-lifetime semantics.
