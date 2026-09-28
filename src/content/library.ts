import type {
  AudioRef, CharacterEntry, ComponentId, KanaCharacter, KanjiCharacter, KanjiComponent,
  KanjiReading, Lesson, PackId, PackIndex, Script, StrokeReference, VocabEntry,
} from '@/domain';
import type { ContentLibrary } from './ports';
import type { PackFileSource } from './packSource';
import { isSafePackPath } from './packSource';
import type { ContentIssue } from './validate';
import {
  describe, issue, parseAudioRef, parseComponent, parseKana, parseKanji, parseLesson, parseReading,
  parseStrokeReference, parseVocab,
} from './validate';

/**
 * The content library: the only thing the rest of the app asks about content.
 *
 * Two design rules dominate this file.
 *
 * 1. LOOKUPS ARE MAPS, NOT SCANS. The explorer grid renders ~1200 cells and the
 *    question generators call `vocabFor`/`readingsFor`/`byGlyph` once per
 *    candidate item per question. Linear scans over the vocabulary array showed
 *    up immediately as jank on a mid-range phone, so every query the port
 *    declares is backed by a map or a presorted array built once at load.
 *
 * 2. `hasAudio` / `hasStrokes` NEVER GUESS. They answer from the set of files
 *    that actually verified their SHA-256 at install time. The generators trust
 *    these two predicates to decide whether a listening or handwriting question
 *    can exist at all, so a false positive here becomes a dead-end question in
 *    front of a learner. `audio()` is gated on the same set for the same reason:
 *    a caller must not be handed a reference to a file that is not on disk.
 */

/** Pack-relative paths known to have verified. Supplied by the installer. */
export type VerifiedPaths = ReadonlySet<string>;

export interface ContentLibraryInput {
  index: PackIndex;
  source: PackFileSource;
  verifiedPaths: VerifiedPaths;
  /** Restrict loading to these packs. Defaults to every pack in the index. */
  packIds?: PackId[];
}

/** A library plus everything that was wrong with the content it was built from. */
export interface LoadedContentLibrary {
  library: LoadedLibrary;
  issues: ContentIssue[];
}

/**
 * The concrete library. A superset of the `ContentLibrary` port: `issues()` and
 * `loadedPacks()` exist so Settings can show what failed instead of the app
 * quietly behaving as if a broken pack were fine.
 */
export interface LoadedLibrary extends ContentLibrary {
  issues(): ContentIssue[];
  loadedPacks(): PackId[];
}

interface RawCollections {
  kana: unknown[];
  kanji: unknown[];
  components: unknown[];
  vocab: unknown[];
  readings: unknown[];
  lessons: unknown[];
  audio: Array<{ key: string; raw: unknown }>;
  /** glyph -> pack-relative path, from a strokes index document. */
  strokeIndex: Map<string, string>;
}

const emptyCollections = (): RawCollections => ({
  kana: [], kanji: [], components: [], vocab: [], readings: [], lessons: [],
  audio: [], strokeIndex: new Map(),
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const nfc = (s: string): string => s.normalize('NFC');

/** Directory part of a pack-relative path, with its trailing slash. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut + 1);
}

/**
 * Derive the conventional stroke-file name for a glyph.
 *
 * KanjiVG-derived files are named by zero-padded code point, which is how
 * scripts/content/build-strokes.mjs emits them. This is only a fallback: a
 * strokes index document, when the pack ships one, always wins, because a
 * generator may legitimately name files differently.
 */
function derivedStrokePath(glyph: string): string | null {
  const chars = Array.from(nfc(glyph));
  // Multi-code-point glyphs (yōon like きゃ) are written as two characters and
  // have no single stroke file. Claiming one would break tracing.
  if (chars.length !== 1) return null;
  const cp = (chars[0] as string).codePointAt(0);
  if (cp === undefined) return null;
  return `strokes/${cp.toString(16).padStart(5, '0')}.json`;
}

/* -------------------------------------------------------------------------- */
/* Document classification                                                    */
/* -------------------------------------------------------------------------- */

const COLLECTION_KEYS: Record<string, keyof RawCollections | 'strokeIndexCandidate'> = {
  kana: 'kana', hiragana: 'kana', katakana: 'kana',
  kanji: 'kanji',
  components: 'components', radicals: 'components',
  vocab: 'vocab', vocabulary: 'vocab', words: 'vocab',
  readings: 'readings',
  lessons: 'lessons',
  audio: 'audio', clips: 'audio',
  characters: 'strokeIndexCandidate',
};

/**
 * Sort one loose entry into a collection.
 *
 * The domain types carry their own `kind` discriminator (`'kana'`, `'kanji'`,
 * `'component'`, `'vocab'`), so entry-level routing is exact for those. Readings
 * and lessons have no discriminator, so they are identified by the `reading:` id
 * namespace and by the presence of `introduces` respectively. Anything that
 * matches nothing is reported rather than silently dropped — an unclassified
 * entry usually means the content generator changed shape.
 */
function routeEntry(entry: unknown, out: RawCollections): boolean {
  if (!isRecord(entry)) return false;
  switch (entry['kind']) {
    case 'kana': out.kana.push(entry); return true;
    case 'kanji': out.kanji.push(entry); return true;
    case 'component': out.components.push(entry); return true;
    case 'vocab': out.vocab.push(entry); return true;
    default: break;
  }
  const id = entry['id'];
  if (typeof id === 'string' && id.startsWith('reading:')) {
    out.readings.push(entry);
    return true;
  }
  if (Array.isArray(entry['introduces'])) {
    out.lessons.push(entry);
    return true;
  }
  return false;
}

function absorbAudio(value: unknown, out: RawCollections): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue;
      const key = item['key'] ?? item['id'] ?? item['glyph'] ?? item['spelling'];
      if (typeof key === 'string') out.audio.push({ key, raw: item['ref'] ?? item });
    }
    return;
  }
  if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) out.audio.push({ key, raw });
  }
}

/** A `characters` map whose values carry a `file` is a strokes index, not a character list. */
function looksLikeStrokeIndex(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const first = Object.values(value)[0];
  return isRecord(first) && typeof first['file'] === 'string';
}

function absorbStrokeIndex(
  value: Record<string, Record<string, unknown>>,
  baseDir: string,
  out: RawCollections,
  issues: ContentIssue[],
  where: string,
): void {
  for (const [glyph, meta] of Object.entries(value)) {
    const file = meta['file'];
    if (typeof file !== 'string') continue;
    const path = file.includes('/') ? file : baseDir + file;
    if (!isSafePackPath(path)) {
      issues.push(issue(where, `Stroke file path for ${glyph} is unusable and was ignored.`));
      continue;
    }
    out.strokeIndex.set(nfc(glyph), path);
  }
}

/**
 * Pull collections out of one data document.
 *
 * Three shapes are accepted, because the content build is a separate program and
 * pinning it to exactly one container shape would make the two halves brittle:
 * a bare array of entries, an object keyed by collection name, and
 * `{ kind, entries }`. Anything else is an error, not a silent no-op.
 */
function classifyDocument(
  value: unknown,
  path: string,
  out: RawCollections,
  issues: ContentIssue[],
): void {
  if (Array.isArray(value)) {
    let unrouted = 0;
    for (const entry of value) if (!routeEntry(entry, out)) unrouted += 1;
    if (unrouted > 0) {
      issues.push(issue(path, `${unrouted} entr${unrouted === 1 ? 'y was' : 'ies were'} in an unrecognised format and ignored.`));
    }
    return;
  }
  if (!isRecord(value)) {
    issues.push(issue(path, 'This content file is neither a list nor an object.'));
    return;
  }

  // { kind: 'vocab', entries: [...] }
  const kind = value['kind'];
  if (typeof kind === 'string' && Array.isArray(value['entries'])) {
    const target = COLLECTION_KEYS[kind] ?? COLLECTION_KEYS[`${kind}s`];
    if (target === 'audio') {
      absorbAudio(value['entries'], out);
      return;
    }
    if (target && target !== 'strokeIndexCandidate') {
      const bucket = out[target];
      if (Array.isArray(bucket)) {
        for (const entry of value['entries']) bucket.push(entry);
        return;
      }
    }
    // Unknown container kind: fall through to per-entry routing rather than
    // dropping the file.
    for (const entry of value['entries']) routeEntry(entry, out);
    return;
  }

  const baseDir = dirOf(path);
  let matched = false;
  for (const [key, raw] of Object.entries(value)) {
    const target = COLLECTION_KEYS[key];
    if (!target) continue;
    if (target === 'audio') {
      absorbAudio(raw, out);
      matched = true;
      continue;
    }
    if (target === 'strokeIndexCandidate') {
      if (looksLikeStrokeIndex(raw)) {
        absorbStrokeIndex(raw, baseDir, out, issues, path);
        matched = true;
      } else if (Array.isArray(raw)) {
        for (const entry of raw) routeEntry(entry, out);
        matched = true;
      }
      continue;
    }
    if (Array.isArray(raw)) {
      const bucket = out[target];
      if (Array.isArray(bucket)) {
        for (const entry of raw) bucket.push(entry);
        matched = true;
      }
    }
  }
  if (!matched) {
    issues.push(issue(path, 'No recognised content collections were found in this file.'));
  }
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether a pack file should be parsed as a data document at load time.
 *
 * Stroke files and audio clips are read lazily — parsing 1200 stroke files on
 * startup would cost more than the whole rest of the boot. The one exception is
 * a `index.json` sitting inside a non-data directory: that is a manifest of the
 * lazy files and is needed up front.
 */
function isEagerDataFile(kind: string, path: string): boolean {
  if (kind === 'data') return true;
  return path.endsWith('/index.json');
}

export async function loadContentLibrary(input: ContentLibraryInput): Promise<LoadedContentLibrary> {
  const issues: ContentIssue[] = [];
  const raw = emptyCollections();
  const wanted = input.packIds ? new Set(input.packIds) : null;
  const loadedPacks: PackId[] = [];

  for (const pack of input.index.packs) {
    if (wanted && !wanted.has(pack.id)) continue;
    let readAnything = false;
    for (const file of pack.files) {
      if (!isEagerDataFile(file.kind, file.path)) continue;
      if (!input.verifiedPaths.has(file.path)) {
        issues.push(
          issue(
            pack.id,
            `${file.path} has not been downloaded and verified, so its content is unavailable.`,
            'warning',
          ),
        );
        continue;
      }
      const response = await input.source.readCached(file.path);
      if (!response) {
        issues.push(issue(pack.id, `${file.path} verified earlier but is no longer in storage.`));
        continue;
      }
      let parsed: unknown;
      try {
        parsed = (await response.json()) as unknown;
      } catch (err) {
        // A truncated cache entry lands here. Report it; do not throw.
        issues.push(issue(file.path, `This content file could not be read: ${describe(err)}`));
        continue;
      }
      classifyDocument(parsed, file.path, raw, issues);
      readAnything = true;
    }
    if (readAnything) loadedPacks.push(pack.id);
  }

  return {
    library: buildLibrary(input, raw, issues, loadedPacks),
    issues,
  };
}

/* -------------------------------------------------------------------------- */
/* Index construction                                                         */
/* -------------------------------------------------------------------------- */

interface VocabGate {
  entry: VocabEntry;
  /** Highest teachingOrder among the characters this word needs. */
  gate: number;
}

function byTeachingOrder<T extends { teachingOrder: number; id: string }>(a: T, b: T): number {
  return a.teachingOrder - b.teachingOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function buildLibrary(
  input: ContentLibraryInput,
  raw: RawCollections,
  issues: ContentIssue[],
  loadedPacks: PackId[],
): LoadedLibrary {
  const verified = input.verifiedPaths;

  /* --- entries ---------------------------------------------------------- */
  const kanaAll: KanaCharacter[] = [];
  const kanjiAll: KanjiCharacter[] = [];
  const componentsAll: KanjiComponent[] = [];
  const vocabAll: VocabEntry[] = [];
  const readingsAll: KanjiReading[] = [];
  const lessonsAll: Lesson[] = [];

  const dropped = { kana: 0, kanji: 0, component: 0, vocab: 0, reading: 0, lesson: 0 };
  for (const r of raw.kana) { const v = parseKana(r); if (v) kanaAll.push(v); else dropped.kana += 1; }
  for (const r of raw.kanji) { const v = parseKanji(r); if (v) kanjiAll.push(v); else dropped.kanji += 1; }
  for (const r of raw.components) { const v = parseComponent(r); if (v) componentsAll.push(v); else dropped.component += 1; }
  for (const r of raw.vocab) { const v = parseVocab(r); if (v) vocabAll.push(v); else dropped.vocab += 1; }
  for (const r of raw.readings) { const v = parseReading(r); if (v) readingsAll.push(v); else dropped.reading += 1; }
  for (const r of raw.lessons) { const v = parseLesson(r); if (v) lessonsAll.push(v); else dropped.lesson += 1; }
  for (const [name, count] of Object.entries(dropped)) {
    if (count > 0) issues.push(issue('content', `${count} ${name} entr${count === 1 ? 'y' : 'ies'} did not match the expected format and were skipped.`));
  }

  kanaAll.sort(byTeachingOrder);
  kanjiAll.sort(byTeachingOrder);
  componentsAll.sort(byTeachingOrder);
  vocabAll.sort(byTeachingOrder);
  lessonsAll.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

  /* --- primary maps ----------------------------------------------------- */
  const hiragana = kanaAll.filter((k) => k.script === 'hiragana');
  const katakana = kanaAll.filter((k) => k.script === 'katakana');

  const charById = new Map<string, CharacterEntry>();
  const charByGlyph = new Map<string, CharacterEntry>();
  const registerChar = (entry: CharacterEntry): void => {
    const id = String(entry.id);
    if (charById.has(id)) {
      issues.push(issue('content', `Two characters share the id ${id}; the first was kept.`));
      return;
    }
    charById.set(id, entry);
    const glyph = nfc(entry.glyph);
    if (!charByGlyph.has(glyph)) charByGlyph.set(glyph, entry);
  };
  for (const k of kanaAll) registerChar(k);
  for (const k of kanjiAll) registerChar(k);

  const componentById = new Map<string, KanjiComponent>();
  for (const c of componentsAll) componentById.set(String(c.id), c);

  const vocabById = new Map<string, VocabEntry>();
  for (const v of vocabAll) vocabById.set(String(v.id), v);

  const readingById = new Map<string, KanjiReading>();
  const readingsByGlyph = new Map<string, KanjiReading[]>();
  for (const r of readingsAll) {
    readingById.set(String(r.id), r);
    const glyph = nfc(r.kanji);
    const list = readingsByGlyph.get(glyph);
    if (list) list.push(r);
    else readingsByGlyph.set(glyph, [r]);
  }

  /* --- reverse maps for vocabFor ---------------------------------------- */
  const vocabByCharacter = new Map<string, VocabEntry[]>();
  const vocabByReading = new Map<string, VocabEntry[]>();
  const push = (map: Map<string, VocabEntry[]>, key: string, entry: VocabEntry): void => {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  };
  const gates: VocabGate[] = [];
  for (const v of vocabAll) {
    let gate = 0;
    for (const charId of v.requiresCharacters) {
      const key = String(charId);
      push(vocabByCharacter, key, v);
      const char = charById.get(key);
      if (!char) {
        // A word that needs a character we do not have can never be taught.
        // Infinity keeps it permanently out of vocabAvailableAt rather than
        // letting it leak into a lesson with an unrenderable character.
        gate = Number.POSITIVE_INFINITY;
        issues.push(issue('content', `Word ${String(v.id)} needs character ${key}, which is not installed.`, 'warning'));
        continue;
      }
      if (gate !== Number.POSITIVE_INFINITY) gate = Math.max(gate, char.teachingOrder);
    }
    for (const readingId of v.demonstratesReadings ?? []) push(vocabByReading, String(readingId), v);
    gates.push({ entry: v, gate });
  }
  // Sorted by gate so vocabAvailableAt is a binary search, not a filter: the
  // generators call it on every session build.
  gates.sort((a, b) => a.gate - b.gate || byTeachingOrder(a.entry, b.entry));

  /* --- audio index ------------------------------------------------------ */
  const audioByKey = new Map<string, AudioRef>();
  const alias = (key: string, ref: AudioRef): void => {
    if (key.length === 0) return;
    if (!audioByKey.has(key)) audioByKey.set(key, ref);
  };
  for (const { key, raw: rawRef } of raw.audio) {
    const ref = parseAudioRef(rawRef);
    if (!ref) {
      issues.push(issue('audio', `The clip listed for “${key}” is missing its path, digest or attribution and was dropped.`));
      continue;
    }
    alias(key, ref);
    alias(ref.path, ref);
    // Aliases so a caller can ask by whichever handle it has: the item id, the
    // glyph, or the word as written.
    const char = charById.get(key);
    if (char) alias(nfc(char.glyph), ref);
    const word = vocabById.get(key);
    if (word) { alias(nfc(word.spelling), ref); alias(nfc(word.reading), ref); }
  }
  for (const v of vocabAll) {
    const ref = parseAudioRef(v.audio);
    if (!ref) continue;
    alias(String(v.id), ref);
    alias(nfc(v.spelling), ref);
    alias(ref.path, ref);
  }

  /* --- strokes ---------------------------------------------------------- */
  const strokePathByGlyph = new Map<string, string>(raw.strokeIndex);
  const strokePathFor = (glyph: string): string | undefined => {
    const key = nfc(glyph);
    const fromIndex = strokePathByGlyph.get(key);
    if (fromIndex !== undefined) return fromIndex;
    const derived = derivedStrokePath(key);
    // Only offer the derived name when that file actually verified; otherwise
    // hasStrokes would promise a file nobody ever produced.
    if (derived && verified.has(derived)) {
      strokePathByGlyph.set(key, derived);
      return derived;
    }
    return undefined;
  };
  const strokeCache = new Map<string, Promise<StrokeReference | undefined>>();

  /* --- honest asset predicates ------------------------------------------ */
  const hasStrokes = (glyph: string): boolean => {
    const path = strokePathFor(glyph);
    return path !== undefined && verified.has(path);
  };
  const audio = (key: string): AudioRef | undefined => {
    const ref = audioByKey.get(key) ?? audioByKey.get(nfc(key));
    if (!ref) return undefined;
    // Gated on verification, not merely on the entry existing: handing back a
    // ref to a file that is not on disk is how a listening question gets
    // generated for silence.
    return verified.has(ref.path) ? ref : undefined;
  };
  const hasAudio = (key: string): boolean => audio(key) !== undefined;

  /* --- inventory -------------------------------------------------------- */
  const inventory = (): Array<{ script: Script; tier: string; group: string; count: number }> => {
    const counts = new Map<string, { script: Script; tier: string; group: string; count: number }>();
    const bump = (script: Script, tier: string, group: string): void => {
      const key = `${script}|${tier}|${group}`;
      const row = counts.get(key);
      if (row) row.count += 1;
      else counts.set(key, { script, tier, group, count: 1 });
    };
    for (const k of kanaAll) bump(k.script, k.tier, k.group);
    // Kanji have no `group` field, so grade is the grouping a learner can read.
    // Inventing a group name would misrepresent the curriculum.
    for (const k of kanjiAll) bump('kanji', k.tier, k.grade === null ? 'ungraded' : `grade ${k.grade}`);
    return [...counts.values()].sort(
      (a, b) => a.script.localeCompare(b.script) || a.tier.localeCompare(b.tier) || a.group.localeCompare(b.group),
    );
  };

  const audioCoverage = (): Array<{ category: string; withAudio: number; total: number }> => {
    const rows: Array<{ category: string; withAudio: number; total: number }> = [];
    const row = (category: string, items: Array<{ id: string }>): void => {
      let withAudio = 0;
      for (const item of items) if (hasAudio(String(item.id))) withAudio += 1;
      rows.push({ category, withAudio, total: items.length });
    };
    row('Hiragana', hiragana);
    row('Katakana', katakana);
    row('Kanji', kanjiAll);
    row('Vocabulary', vocabAll);
    return rows;
  };

  return {
    schemaVersion: input.index.schemaVersion,
    kana: (script) => (script === 'hiragana' ? hiragana : katakana).slice(),
    kanji: () => kanjiAll.slice(),
    components: () => componentsAll.slice(),
    vocab: () => vocabAll.slice(),
    lessons: (script) => (script === undefined ? lessonsAll.slice() : lessonsAll.filter((l) => l.script === script)),
    character: (id) => charById.get(id) ?? charByGlyph.get(nfc(id)),
    byGlyph: (glyph) => charByGlyph.get(nfc(glyph)),
    component: (id: ComponentId) => componentById.get(String(id)),
    reading: (id) => readingById.get(id),
    readingsFor: (glyph) => (readingsByGlyph.get(nfc(glyph)) ?? []).slice(),
    vocabFor: (id) => {
      // Accepts a character id, a reading id, or a bare glyph — callers hold
      // different handles depending on which screen they came from.
      const direct = vocabByCharacter.get(id) ?? vocabByReading.get(id);
      if (direct) return direct.slice();
      const viaGlyph = charByGlyph.get(nfc(id));
      if (viaGlyph) return (vocabByCharacter.get(String(viaGlyph.id)) ?? []).slice();
      return [];
    },
    vocabAvailableAt: (teachingOrder) => {
      // Binary search for the first gate above the cutoff.
      let lo = 0;
      let hi = gates.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((gates[mid] as VocabGate).gate <= teachingOrder) lo = mid + 1;
        else hi = mid;
      }
      return gates.slice(0, lo).map((g) => g.entry).sort(byTeachingOrder);
    },
    strokes: async (glyph) => {
      const key = nfc(glyph);
      const existing = strokeCache.get(key);
      if (existing) return existing;
      const path = strokePathFor(key);
      if (path === undefined || !verified.has(path)) return undefined;
      const pending = (async (): Promise<StrokeReference | undefined> => {
        // readCached, not read: falling back to the network here would return
        // bytes nobody verified, under a predicate (`hasStrokes`) that claims
        // they were verified.
        const response = await input.source.readCached(path);
        if (!response) {
          issues.push(issue(path, `Stroke data for ${key} is no longer in storage.`));
          return undefined;
        }
        let parsed: unknown;
        try {
          parsed = (await response.json()) as unknown;
        } catch (err) {
          issues.push(issue(path, `Stroke data for ${key} could not be read: ${describe(err)}`));
          return undefined;
        }
        const ref = parseStrokeReference(parsed, key);
        if (!ref) issues.push(issue(path, `Stroke data for ${key} is not in the expected format.`));
        return ref ?? undefined;
      })();
      strokeCache.set(key, pending);
      return pending;
    },
    hasStrokes,
    audio,
    hasAudio,
    audioCoverage,
    inventory,
    issues: () => issues.slice(),
    loadedPacks: () => loadedPacks.slice(),
  };
}
