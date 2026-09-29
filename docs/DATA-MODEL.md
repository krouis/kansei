# Data model

The IndexedDB schema (database name `kansei`), how it is guaranteed
consistent, how it changes, and how progress moves between devices. For the
persistence *modules* (which file does what) see
[`src/persistence/README.md`](../src/persistence/README.md); this file is the
schema and the guarantees, independent of which module implements them.

## Object stores

| Store | Key | Indexes | Holds |
|---|---|---|---|
| `attempts` | auto-increment | `id` (unique), `sessionId`, `itemId`, `localDate`, `[itemId, skill]` | The append-only attempt log — the source every statistic is derived from. |
| `skillStates` | `[itemId, skill, readingKey]` | `dueAt`, `stage`, `[skill, dueAt]` | Memory state, one record per (item, skill, reading). |
| `confusions` | `[itemId, confusedWithItemId, skill]` | `count`, `resolvedAt` | Directional confusion counts (シ→ツ is tracked separately from ツ→シ). |
| `xpAwards` | `dedupeKey` | `localDate` | The XP ledger. |
| `daily` | `localDate` | — | One record per local calendar date. |
| `sessions` | `id` | `status`, `startedAt` | Session snapshots, saved after every graded screen. |
| `settings` | fixed (`"settings"`) | — | The learner's preferences. |
| `auxiliary` | fixed (`"counters"`) | — | IME/typing counters, deliberately separate from skill progress. |
| `packState` | `packId` | — | Which pack files verified on *this device*. |

A few choices worth knowing before touching this schema:

- **`attempts` is keyed by auto-increment, not by timestamp.** Two attempts
  can tie to the millisecond, and a device clock correction can make `at` go
  backwards; insertion order is the only ordering that is actually always
  "newest first." The domain's own `id` lives in a *unique* index instead,
  which is what makes a backup merge idempotent — the same attempt can never
  be stored twice, as a schema guarantee rather than an application check.
- **`skillStates`' compound primary key doubles as a range query.**
  `[itemId, skill, readingKey]` means the prefix `[itemId]` answers "every
  skill state for this item" directly (`keyRanges.itemPrefix`), with no
  separate `itemId` index needed. `readingKey` is `readingId ?? ''` — IndexedDB
  keys cannot be `null`, so the empty string is the documented, reversible
  stand-in for "not about a specific reading."
- **`dueAt` being absent from its own index is load-bearing, not a bug.** An
  unseen pair has `dueAt: null`, and null is simply not indexable — so it is
  absent from the `dueAt` index, meaning the due-review query can never
  accidentally surface unseen material. Introducing new material is the
  selector's job, not the scheduler's.
- **`xpAwards`' primary key *is* the dedupe key.** This is the entire
  mechanism behind "XP can never be awarded twice for the same screen": a
  reload, a session restore, a double-tapped submit, and a backup merge all
  produce the identical key, and the storage engine's own uniqueness
  constraint turns every one of them into a no-op, not application logic that
  has to remember to check.
- **`packState` is excluded from backups on purpose.** It describes which
  files verified *on this device* — restoring it from another device's
  backup would claim content is installed when it has not been downloaded
  here at all.

Full field-by-field types are `KanseiSchema` in
[`src/persistence/schema.ts`](../src/persistence/schema.ts) — the source of
truth; this table is a map of it, not a copy.

## Transactions

Every write that must not be partially applied goes through
`Database.transact(scope, fn)`, which opens ONE transaction over the seven
learning-record stores and hands `fn` a `Transaction` whose repos are all
bound to it. Grading a screen — the attempt, the updated skill state, a
confusion record, the XP award, the daily total — commits together or not at
all. The two real bugs this uncovered (an unhandled request error silently
aborting the whole transaction; a thrown JS error NOT aborting it on its own)
are documented in [`src/persistence/README.md`](../src/persistence/README.md)
because they are exactly the kind of thing that looks correct on inspection
and only breaks under a real IndexedDB engine.

## Migrations

Schema changes are named, ordered `Migration` units (`up`, synchronous schema
work; an optional async `backfill`) — never one `if (oldVersion < N)` ladder.
Policy, enforced by convention:

- **Additive only.** A migration may create stores/indexes and fill in
  missing fields. It may never delete a store, delete a field, or narrow a
  value — for a learner whose only copy of their progress is this device,
  anything lost in an upgrade is lost permanently.
- **Idempotent.** Every step checks whether its store/index already exists,
  so a half-applied upgrade (a tab killed mid-`versionchange`) re-runs
  safely.
- **All-or-nothing.** Migrations run inside IndexedDB's single
  `versionchange` transaction; a failed step aborts it, the stored version
  does not advance, and the previous build's shape is left intact and still
  usable.

Version 2 (already shipped) added `attempts.itemId_skill`,
`skillStates.skill_dueAt`, and `confusions.resolvedAt`, and backfilled
`repairScheduled`/`resolvedAt` onto confusion records `v1` wrote before those
fields existed on `ConfusionRecord` — proving the mechanism against a real
upgrade rather than leaving it theoretical.

## Backup format

Versioned independently of the schema (`formatVersion`, currently 1) — a
schema migration and a backup-format change are different events and are
never conflated. A backup is a JSON file: a fixed `format: 'kansei-backup'`
marker, `schemaVersion` and `appVersion` for diagnostics, per-store `counts`,
the full `data` block (settings, skill states, attempts, confusions, XP
awards, daily records, sessions, auxiliary counters), and a SHA-256
`checksum` over a canonicalised (stable key order) serialisation of `data`,
so a later edit or a truncated download is caught before anything is
imported.

`plan(file, mode)` **never writes anything** — it validates the shape,
verifies the checksum, rejects a `formatVersion` newer than this build
understands (with a message naming the exact versions involved, not a
generic failure), and computes real per-store effects
(adding/updating/keeping/removing) against whatever is currently stored, so
the learner sees exactly what an import will do before agreeing to it.
`apply(file, plan)` is atomic: either the whole import lands or none of it
does.

- **Merge**: attempts union by `id` (append-only, so this is exact); a
  skill-state conflict keeps whichever side has the later `lastReviewedAt`;
  XP awards union by `dedupeKey`, which is what makes re-importing the same
  backup a safe no-op instead of double-counted XP; confusion, daily, and
  session records are upserted by their own key.
- **Replace**: every learning-record store is cleared, then the backup's
  data is written in full.

## What this does *not* give you

Progress is device-local by default. There is no automatic cross-device
sync — moving to another browser, device, or profile requires an explicit
export/import. Browser storage can still be cleared by the user or evicted by
the OS; `requestPersistence()` (wired to `navigator.storage.persist()`) asks
the browser not to evict it under pressure, but a persisted grant is not a
guarantee, and the Settings screen says so rather than implying otherwise.
