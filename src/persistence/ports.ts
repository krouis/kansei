import type {
  AttemptRecord, AuxiliaryCounters, ConfusionRecord, DailyRecord, ItemId, PackInstallState,
  SessionId, SessionState, Settings, Skill, SkillState, XpAward,
} from '@/domain';

/**
 * Persistence ports.
 *
 * Everything the app stores goes through these interfaces so the storage engine
 * (IndexedDB) stays replaceable and testable. Two rules are load-bearing:
 *
 *  - Writes that must not be partially applied go through `transact`, which
 *    runs a callback inside a single IndexedDB transaction. Recording an answer
 *    touches the attempt log, the skill state, the confusion table, the XP
 *    ledger and the session snapshot; a crash must never leave those disagreeing.
 *  - Every failure is surfaced, never swallowed. A quota error or a blocked
 *    upgrade becomes a `StorageFailure` the UI shows to the learner.
 */

export interface StorageFailure {
  kind: 'quota-exceeded' | 'blocked' | 'corrupt' | 'unavailable' | 'version-conflict' | 'unknown';
  message: string;
  /** True when retrying the same operation could plausibly succeed. */
  retryable: boolean;
  cause?: unknown;
}

export class StorageError extends Error {
  constructor(readonly failure: StorageFailure) {
    super(failure.message);
    this.name = 'StorageError';
  }
}

/** A unit of work that either fully applies or does not apply at all. */
export interface Transaction {
  attempts: AttemptRepo;
  skills: SkillRepo;
  confusions: ConfusionRepo;
  xp: XpRepo;
  sessions: SessionRepo;
  daily: DailyRepo;
  auxiliary: AuxiliaryRepo;
}

export interface Database {
  /** Schema version currently open. */
  readonly version: number;
  transact<T>(scope: 'readonly' | 'readwrite', fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): void;
  /** Bytes used and available, when the browser reports them. */
  estimate(): Promise<{ usageBytes: number | null; quotaBytes: number | null }>;
  /** Ask for storage that the browser will not evict under pressure. */
  requestPersistence(): Promise<{ persisted: boolean; supported: boolean }>;
}

export interface AttemptRepo {
  append(record: AttemptRecord): Promise<void>;
  /** Attempts for one item, newest first. */
  forItem(itemId: ItemId, limit?: number): Promise<AttemptRecord[]>;
  forSession(sessionId: SessionId): Promise<AttemptRecord[]>;
  /** Attempts in a local-date range, for the statistics screens. */
  betweenDates(fromLocalDate: string, toLocalDate: string): Promise<AttemptRecord[]>;
  count(): Promise<number>;
}

export interface SkillRepo {
  get(itemId: ItemId, skill: Skill, readingId?: string | null): Promise<SkillState | undefined>;
  put(state: SkillState): Promise<void>;
  /** All states for one item, across skills and readings. */
  forItem(itemId: ItemId): Promise<SkillState[]>;
  /** States due at or before `at`, optionally limited to one skill. */
  due(at: string, skill?: Skill, limit?: number): Promise<SkillState[]>;
  /** Everything, for the explorer grid and the statistics screens. */
  all(): Promise<SkillState[]>;
  countByStage(): Promise<Record<string, number>>;
}

export interface ConfusionRepo {
  record(itemId: ItemId, confusedWith: ItemId, skill: Skill, at: string): Promise<void>;
  /** Unresolved confusions, most frequent first. */
  top(limit: number): Promise<ConfusionRecord[]>;
  forItem(itemId: ItemId): Promise<ConfusionRecord[]>;
  markRepairScheduled(itemId: ItemId, confusedWith: ItemId, skill: Skill): Promise<void>;
  resolve(itemId: ItemId, confusedWith: ItemId, skill: Skill, at: string): Promise<void>;
}

export interface XpRepo {
  /**
   * Bank an award. Idempotent on `dedupeKey`: a repeat call with a key already
   * present is a no-op that returns `false`, which is what makes reload,
   * session restore and double submission safe.
   */
  award(award: XpAward): Promise<boolean>;
  hasAward(dedupeKey: string): Promise<boolean>;
  totalForDate(localDate: string): Promise<number>;
  betweenDates(fromLocalDate: string, toLocalDate: string): Promise<XpAward[]>;
  total(): Promise<number>;
}

export interface SessionRepo {
  save(state: SessionState): Promise<void>;
  get(id: SessionId): Promise<SessionState | undefined>;
  /** The session to resume, when one was interrupted. */
  active(): Promise<SessionState | undefined>;
  recent(limit: number): Promise<SessionState[]>;
  markAbandoned(id: SessionId, at: string): Promise<void>;
}

export interface DailyRepo {
  /**
   * Upsert a day. The goal in force is written WITH the day, so a later change
   * to the daily goal never rewrites what the learner already achieved.
   */
  upsert(record: DailyRecord): Promise<void>;
  get(localDate: string): Promise<DailyRecord | undefined>;
  betweenDates(fromLocalDate: string, toLocalDate: string): Promise<DailyRecord[]>;
  all(): Promise<DailyRecord[]>;
}

export interface AuxiliaryRepo {
  get(): Promise<AuxiliaryCounters>;
  put(counters: AuxiliaryCounters): Promise<void>;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  /** Fires when settings change in another tab. */
  subscribe(fn: (settings: Settings) => void): () => void;
}

export interface PackStateStore {
  get(packId: string): Promise<PackInstallState | undefined>;
  put(state: PackInstallState): Promise<void>;
  all(): Promise<PackInstallState[]>;
}

/** Versioned backup envelope. */
export interface BackupFile {
  /** Fixed marker so an unrelated JSON file is rejected with a clear message. */
  format: 'kansei-backup';
  /** Backup format version, independent of the database schema version. */
  formatVersion: number;
  /** The database schema version the data was exported from. */
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  /** Content pack versions in use, so an import can warn about a mismatch. */
  contentVersions: Record<string, string>;
  counts: Record<string, number>;
  data: {
    settings: Settings;
    skills: SkillState[];
    attempts: AttemptRecord[];
    confusions: ConfusionRecord[];
    xp: XpAward[];
    daily: DailyRecord[];
    sessions: SessionState[];
    auxiliary: AuxiliaryCounters;
  };
  /** SHA-256 of the canonicalised `data` block, to detect truncation. */
  checksum: string;
}

export type ImportMode = 'merge' | 'replace';

export interface ImportPlan {
  mode: ImportMode;
  valid: boolean;
  /** Blocking problems. A plan with any of these cannot be applied. */
  errors: string[];
  /** Non-blocking notes the learner should read before applying. */
  warnings: string[];
  /** What would change, stated per store, so the learner can decide. */
  effects: Array<{ store: string; adding: number; updating: number; keeping: number; removing: number }>;
  /** Migration steps needed to bring the file to the current schema. */
  migrations: string[];
}

export interface BackupService {
  export(): Promise<BackupFile>;
  /** Parse and validate without touching the database. */
  plan(file: unknown, mode: ImportMode): Promise<ImportPlan>;
  /** Apply a plan. Atomic: either the whole import applies, or none of it does. */
  apply(file: BackupFile, plan: ImportPlan): Promise<void>;
}
