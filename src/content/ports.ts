import type {
  AudioRef, CharacterEntry, ComponentId, KanaCharacter, KanjiCharacter, KanjiComponent,
  KanjiReading, Lesson, OfflineReadiness, PackId, PackIndex, PackInstallState, Script,
  StrokeReference, VocabEntry,
} from '@/domain';

/**
 * Content ports.
 *
 * Content is read-only at runtime and arrives as verified packs. The library is
 * the only thing the rest of the app asks about content, and it answers honestly:
 * `hasAudio` and `hasStrokes` reflect files that actually verified on disk, so a
 * question is never generated for an asset that is not there.
 */

export interface ContentLibrary {
  readonly schemaVersion: number;
  kana(script: 'hiragana' | 'katakana'): KanaCharacter[];
  kanji(): KanjiCharacter[];
  components(): KanjiComponent[];
  vocab(): VocabEntry[];
  lessons(script?: Script | 'mixed'): Lesson[];
  character(id: string): CharacterEntry | undefined;
  byGlyph(glyph: string): CharacterEntry | undefined;
  component(id: ComponentId): KanjiComponent | undefined;
  reading(id: string): KanjiReading | undefined;
  readingsFor(glyph: string): KanjiReading[];
  vocabFor(id: string): VocabEntry[];
  /** Words whose every character has been introduced by `teachingOrder`. */
  vocabAvailableAt(teachingOrder: number): VocabEntry[];
  strokes(glyph: string): Promise<StrokeReference | undefined>;
  hasStrokes(glyph: string): boolean;
  audio(key: string): AudioRef | undefined;
  hasAudio(key: string): boolean;
  /** Real per-category audio coverage, for honest display in Settings. */
  audioCoverage(): Array<{ category: string; withAudio: number; total: number }>;
  /** Curriculum inventory by tier, so the UI never claims more than it has. */
  inventory(): Array<{ script: Script; tier: string; group: string; count: number }>;
}

export interface InstallProgress {
  packId: PackId;
  phase: 'idle' | 'downloading' | 'verifying' | 'done' | 'failed' | 'paused';
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  /** Current file, for a meaningful progress label. */
  currentPath: string | null;
  error: string | null;
}

export interface Installer {
  index(): Promise<PackIndex>;
  status(): Promise<PackInstallState[]>;
  /**
   * Install or resume a pack.
   *
   * Resumable: already-verified files are skipped, so an interrupted install
   * continues rather than restarting. Every file is checked against its SHA-256
   * before the pack is marked installed.
   */
  install(packId: PackId, onProgress: (p: InstallProgress) => void, signal?: AbortSignal): Promise<PackInstallState>;
  /** Re-verify what is on disk. This is what "Ready offline" is based on. */
  verify(packId: PackId): Promise<PackInstallState>;
  remove(packId: PackId): Promise<void>;
  /** The honest readiness report. */
  readiness(): Promise<OfflineReadiness>;
  /** Total bytes the installed packs occupy. */
  installedBytes(): Promise<number>;
}
