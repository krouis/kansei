import type { IDBPDatabase } from 'idb';
import { addDays, dateRange } from '@/domain';
import type {
  AttemptRecord, AuxiliaryCounters, ConfusionRecord, DailyRecord, SessionState, Settings, SkillState, XpAward,
} from '@/domain';
import { fail, guard, storageError } from './errors';
import { EMPTY_AUXILIARY } from './repos';
import {
  AUXILIARY_KEY, BACKUP_STORES, SETTINGS_KEY, fromSkillRow, toSkillRow, type KanseiSchema, type SkillStateRow,
} from './schema';
import type { BackupFile, BackupService, ImportMode, ImportPlan } from './ports';

/**
 * The backup format.
 *
 * `formatVersion` is independent of the database SCHEMA version on purpose: a
 * schema migration can happen without the backup file shape changing at all,
 * and the reverse (a backup-file change that needs no schema migration) is
 * just as real — conflating the two would make an ordinary schema bump look
 * like a breaking backup change and vice versa.
 */
const FORMAT_VERSION = 1;
const APP_VERSION = '1.0.0';

/** `fromDays(0)` through `fromDays(n)` is used nowhere; kept for readability at call sites. */
function todayIso(): string {
  return new Date().toISOString();
}

/**
 * Canonicalise the data block before hashing: stable key order at every level,
 * so the same logical content always produces the same checksum regardless of
 * property insertion order (which JSON.stringify does NOT normalise on its
 * own). Numbers are left as-is — every numeric field in the backup is either
 * an integer or a value with fixed precision from `Date#toISOString`-derived
 * strings, so there is no float-formatting ambiguity to resolve.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalise((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checksumOf(data: BackupFile['data']): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalise(data)));
}

/**
 * Reads every backup-relevant store in one readonly transaction.
 *
 * `requireSettings` distinguishes two genuinely different callers: `export()`
 * produces a file meant to stand on its own, so a missing settings record
 * there is a real problem worth failing loudly on (in normal operation the app
 * writes default settings on first boot, long before a backup is possible).
 * `plan()`, though, reads the CURRENT database only to diff against an
 * incoming file — and the current database is very often a brand-new install
 * with nothing in it yet, which is exactly the "import my backup onto a fresh
 * device" scenario the feature exists for. Settings there is treated as absent
 * (`null`) rather than fatal.
 */
async function readAll(idb: IDBPDatabase<KanseiSchema>, requireSettings: boolean): Promise<BackupFile['data']> {
  const tx = idb.transaction([...BACKUP_STORES], 'readonly');
  return guard('reading data', async () => {
    const [settingsRow, skillRows, attempts, confusions, xp, daily, sessions, auxiliaryRow] = await Promise.all([
      tx.objectStore('settings').get(SETTINGS_KEY),
      tx.objectStore('skillStates').getAll(),
      tx.objectStore('attempts').getAll(),
      tx.objectStore('confusions').getAll(),
      tx.objectStore('xpAwards').getAll(),
      tx.objectStore('daily').getAll(),
      tx.objectStore('sessions').getAll(),
      tx.objectStore('auxiliary').get(AUXILIARY_KEY),
    ]);
    await tx.done;
    if (!settingsRow && requireSettings) {
      fail('corrupt', 'No settings record exists to export — the app has not finished its first-run setup yet.');
    }
    return {
      settings: settingsRow ? settingsRow.value : (null as unknown as Settings),
      skills: skillRows.map(fromSkillRow),
      attempts,
      confusions,
      xp,
      daily,
      sessions,
      auxiliary: auxiliaryRow ? auxiliaryRow.value : { ...EMPTY_AUXILIARY },
    };
  });
}

function countsOf(data: BackupFile['data']): Record<string, number> {
  return {
    settings: 1,
    skills: data.skills.length,
    attempts: data.attempts.length,
    confusions: data.confusions.length,
    xp: data.xp.length,
    daily: data.daily.length,
    sessions: data.sessions.length,
    auxiliary: 1,
  };
}

/** Structural checks on a parsed, but not yet trusted, backup file. */
function shapeErrors(file: unknown): string[] {
  const errors: string[] = [];
  if (typeof file !== 'object' || file === null) {
    return ['This is not a Kansei backup file — the file is not a JSON object.'];
  }
  const f = file as Record<string, unknown>;
  if (f.format !== 'kansei-backup') {
    errors.push("This is not a Kansei backup file (missing or wrong 'format' marker).");
    return errors; // Nothing else is worth checking on a file that isn't ours.
  }
  if (typeof f.formatVersion !== 'number') errors.push('Missing formatVersion.');
  if (typeof f.checksum !== 'string' || f.checksum.length !== 64) errors.push('Missing or malformed checksum.');
  const data = f.data;
  if (typeof data !== 'object' || data === null) {
    errors.push('Missing data block.');
    return errors;
  }
  const d = data as Record<string, unknown>;
  for (const key of ['skills', 'attempts', 'confusions', 'xp', 'daily', 'sessions'] as const) {
    if (!Array.isArray(d[key])) errors.push(`data.${key} is missing or not an array.`);
  }
  if (typeof d.settings !== 'object' || d.settings === null) errors.push('data.settings is missing.');
  if (typeof d.auxiliary !== 'object' || d.auxiliary === null) errors.push('data.auxiliary is missing.');
  return errors;
}

export function createBackupService(idb: IDBPDatabase<KanseiSchema>): BackupService {
  return {
    async export(): Promise<BackupFile> {
      const data = await readAll(idb, true);
      const checksum = await checksumOf(data);
      return {
        format: 'kansei-backup',
        formatVersion: FORMAT_VERSION,
        schemaVersion: idb.version,
        exportedAt: todayIso(),
        appVersion: APP_VERSION,
        contentVersions: {},
        counts: countsOf(data),
        data,
        checksum,
      };
    },

    async plan(file: unknown, mode: ImportMode): Promise<ImportPlan> {
      const errors = shapeErrors(file);
      if (errors.length > 0) {
        return { mode, valid: false, errors, warnings: [], effects: [], migrations: [] };
      }
      const candidate = file as BackupFile;

      const warnings: string[] = [];
      const recomputed = await checksumOf(candidate.data);
      if (recomputed !== candidate.checksum) {
        return {
          mode,
          valid: false,
          errors: ['The backup file failed its integrity check (checksum mismatch) — it may be truncated or edited.'],
          warnings: [],
          effects: [],
          migrations: [],
        };
      }

      if (candidate.formatVersion > FORMAT_VERSION) {
        return {
          mode,
          valid: false,
          errors: [
            `This backup was made by a newer version of Kansei (format ${candidate.formatVersion}; ` +
              `this app understands up to ${FORMAT_VERSION}). Update the app before importing it.`,
          ],
          warnings: [],
          effects: [],
          migrations: [],
        };
      }
      const migrations: string[] = [];
      if (candidate.formatVersion < FORMAT_VERSION) {
        migrations.push(`backup format v${candidate.formatVersion} → v${FORMAT_VERSION} (no transform defined yet)`);
      }

      // Compute real effects against what is currently stored, without writing
      // anything — the learner sees this before deciding to apply it.
      const current = await readAll(idb, false);
      const effects: ImportPlan['effects'] = [];

      const attemptIds = new Set(current.attempts.map((a) => a.id));
      const newAttempts = candidate.data.attempts.filter((a) => !attemptIds.has(a.id)).length;
      effects.push({
        store: 'attempts',
        adding: mode === 'replace' ? candidate.data.attempts.length : newAttempts,
        updating: 0, // Attempts are append-only and keyed by id; a merge never rewrites one.
        keeping: mode === 'replace' ? 0 : current.attempts.length,
        removing: mode === 'replace' ? current.attempts.length : 0,
      });

      const skillKey = (s: { itemId: unknown; skill: unknown; readingId: unknown }) =>
        `${String(s.itemId)}|${String(s.skill)}|${s.readingId ?? ''}`;
      const currentSkillKeys = new Set(current.skills.map(skillKey));
      const incomingSkillKeys = new Set(candidate.data.skills.map(skillKey));
      effects.push({
        store: 'skills',
        adding: mode === 'replace'
          ? candidate.data.skills.length
          : candidate.data.skills.filter((s) => !currentSkillKeys.has(skillKey(s))).length,
        updating: mode === 'replace' ? 0 : candidate.data.skills.filter((s) => currentSkillKeys.has(skillKey(s))).length,
        keeping: mode === 'replace' ? 0 : current.skills.filter((s) => !incomingSkillKeys.has(skillKey(s))).length,
        removing: mode === 'replace' ? current.skills.length : 0,
      });

      const xpKeys = new Set(current.xp.map((x) => x.dedupeKey));
      const newXp = candidate.data.xp.filter((x) => !xpKeys.has(x.dedupeKey)).length;
      effects.push({
        store: 'xp',
        adding: mode === 'replace' ? candidate.data.xp.length : newXp,
        // XP awards are immutable once banked (the dedupeKey IS the record), so
        // a merge never "updates" one — it either adds a new award or, because
        // the key already exists, leaves the existing one untouched. This is
        // exactly what keeps a merge from ever double-counting XP.
        updating: 0,
        keeping: mode === 'replace' ? 0 : current.xp.length,
        removing: mode === 'replace' ? current.xp.length : 0,
      });

      const dailyDates = new Set(current.daily.map((d) => d.localDate));
      effects.push({
        store: 'daily',
        adding: mode === 'replace' ? candidate.data.daily.length : candidate.data.daily.filter((d) => !dailyDates.has(d.localDate)).length,
        updating: mode === 'replace' ? 0 : candidate.data.daily.filter((d) => dailyDates.has(d.localDate)).length,
        keeping: mode === 'replace' ? 0 : current.daily.filter((d) => !candidate.data.daily.some((c) => c.localDate === d.localDate)).length,
        removing: mode === 'replace' ? current.daily.length : 0,
      });

      const sessionIds = new Set(current.sessions.map((s) => s.id));
      effects.push({
        store: 'sessions',
        adding: mode === 'replace' ? candidate.data.sessions.length : candidate.data.sessions.filter((s) => !sessionIds.has(s.id)).length,
        updating: mode === 'replace' ? 0 : candidate.data.sessions.filter((s) => sessionIds.has(s.id)).length,
        keeping: mode === 'replace' ? 0 : current.sessions.filter((s) => !candidate.data.sessions.some((c) => c.id === s.id)).length,
        removing: mode === 'replace' ? current.sessions.length : 0,
      });

      effects.push({
        store: 'confusions',
        adding: mode === 'replace' ? candidate.data.confusions.length : 0,
        updating: mode === 'replace' ? 0 : candidate.data.confusions.length,
        keeping: mode === 'replace' ? 0 : Math.max(0, current.confusions.length - candidate.data.confusions.length),
        removing: mode === 'replace' ? current.confusions.length : 0,
      });

      effects.push({ store: 'settings', adding: 0, updating: 1, keeping: 0, removing: 0 });
      effects.push({ store: 'auxiliary', adding: 0, updating: mode === 'replace' ? 1 : 0, keeping: mode === 'merge' ? 1 : 0, removing: 0 });

      if (mode === 'merge' && current.skills.length > 0 && candidate.data.skills.length > 0) {
        warnings.push(
          'Merging skill progress: where both the device and the backup have a record for the same character and ' +
            'skill, the one with the LATER lastReviewedAt wins. This can occasionally look like a small step ' +
            'backward if the device you are importing into has practised more recently on one item than the backup.',
        );
      }
      if (candidate.appVersion !== APP_VERSION) {
        warnings.push(`This backup was made by app version ${candidate.appVersion}; you are running ${APP_VERSION}.`);
      }

      return { mode, valid: true, errors: [], warnings, effects, migrations };
    },

    async apply(file: BackupFile, plan: ImportPlan): Promise<void> {
      if (!plan.valid) fail('unknown', 'Refusing to apply an import plan that was not valid.');
      const tx = idb.transaction([...BACKUP_STORES], 'readwrite');
      try {
        if (plan.mode === 'replace') {
          await Promise.all([
            tx.objectStore('attempts').clear(),
            tx.objectStore('skillStates').clear(),
            tx.objectStore('confusions').clear(),
            tx.objectStore('xpAwards').clear(),
            tx.objectStore('daily').clear(),
            tx.objectStore('sessions').clear(),
          ]);
        }

        await Promise.all([
          ...file.data.attempts.map((a: AttemptRecord) =>
            plan.mode === 'replace'
              ? tx.objectStore('attempts').add(a)
              : tx.objectStore('attempts').index('id').getKey(a.id).then((existing) =>
                  existing === undefined ? tx.objectStore('attempts').add(a) : undefined,
                ),
          ),
          ...file.data.skills.map((s: SkillState) => {
            const row: SkillStateRow = toSkillRow(s);
            if (plan.mode === 'replace') return tx.objectStore('skillStates').put(row);
            // Merge conflict rule: later lastReviewedAt wins. An item never
            // reviewed on either side (both null) keeps whichever is already
            // stored, so a merge is idempotent when re-applied.
            return tx.objectStore('skillStates').get([s.itemId, s.skill, row.readingKey]).then((existing) => {
              if (!existing) return tx.objectStore('skillStates').put(row);
              const incomingIsNewer = (s.lastReviewedAt ?? '') > (existing.lastReviewedAt ?? '');
              return incomingIsNewer ? tx.objectStore('skillStates').put(row) : undefined;
            });
          }),
          ...file.data.confusions.map((c: ConfusionRecord) => tx.objectStore('confusions').put(c)),
          ...file.data.xp.map((x: XpAward) =>
            // `getKey` before `add`, not `add` caught for ConstraintError: an
            // unhandled request error aborts the WHOLE transaction during the
            // native event's synchronous dispatch, before a JS `.catch()` on
            // the wrapped promise ever runs — see the identical fix in
            // repos.ts's Xp.award() for the full explanation. Checking first
            // makes re-importing the same backup (the common case) a clean
            // no-op instead of silently rolling back every other write in
            // this same apply() call.
            tx.objectStore('xpAwards').getKey(x.dedupeKey).then((existingKey) =>
              existingKey === undefined ? tx.objectStore('xpAwards').add(x) : undefined,
            ),
          ),
          ...file.data.daily.map((d: DailyRecord) => tx.objectStore('daily').put(d)),
          ...file.data.sessions.map((s: SessionState) => tx.objectStore('sessions').put(s)),
          tx.objectStore('settings').put({ id: SETTINGS_KEY, value: file.data.settings as Settings }),
          tx.objectStore('auxiliary').put({ id: AUXILIARY_KEY, value: file.data.auxiliary as AuxiliaryCounters }),
        ]);

        await tx.done;
      } catch (cause) {
        tx.abort();
        await tx.done.catch(() => {});
        throw storageError(cause, 'applying a backup import');
      }
    },
  };
}

// Re-exported for callers that want to compute a date range over the imported
// daily records without pulling in the whole domain/time module directly.
export { addDays, dateRange };
