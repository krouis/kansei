import type {
  AudioRef, KanaCharacter, KanjiCharacter, KanjiComponent, KanjiReading, Lesson, PackFile,
  PackIndex, PackManifest, StrokeReference, VocabEntry,
} from '@/domain';
import { isSafePackPath } from './packSource';

/**
 * Shape validation for downloaded content.
 *
 * Everything here answers one question: is this JSON actually what the manifest
 * says it is? Content arrives over the network and sits in a cache the browser
 * may evict or truncate, so a corrupt or half-written file is a normal runtime
 * state, not an impossible one. The rule throughout: never throw, collect an
 * issue, and drop the entry. A pack that is 90% readable is worth more to a
 * learner than a white screen, but the 10% must be reported, never papered over.
 */

export interface ContentIssue {
  /** 'index', a pack id, or the pack-relative file path the problem is in. */
  where: string;
  /** Learner-readable description. Shown in Settings, not only logged. */
  message: string;
  severity: 'error' | 'warning';
}

export function issue(where: string, message: string, severity: ContentIssue['severity'] = 'error'): ContentIssue {
  return { where, message, severity };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const SHA256_RE = /^[0-9a-f]{64}$/;

/* -------------------------------------------------------------------------- */
/* Pack index                                                                 */
/* -------------------------------------------------------------------------- */

function parsePackFile(raw: unknown, where: string, issues: ContentIssue[]): PackFile | null {
  if (!isRecord(raw)) {
    issues.push(issue(where, 'A file entry in the pack manifest is not an object.'));
    return null;
  }
  const { path, bytes, sha256, kind } = raw;
  if (!isStr(path) || !isSafePackPath(path)) {
    issues.push(issue(where, `A pack file has an unusable path: ${JSON.stringify(path)}.`));
    return null;
  }
  if (!isNum(bytes) || bytes < 0) {
    issues.push(issue(where, `Pack file ${path} has no valid byte size.`));
    return null;
  }
  const digest = isStr(sha256) ? sha256.trim().toLowerCase() : '';
  if (!SHA256_RE.test(digest)) {
    // Without a digest we cannot verify the file, and installing unverifiable
    // content would make "Ready offline" a guess. Refuse the entry instead.
    issues.push(issue(where, `Pack file ${path} has no SHA-256 digest, so it cannot be verified.`));
    return null;
  }
  if (kind !== 'data' && kind !== 'audio' && kind !== 'strokes' && kind !== 'font') {
    issues.push(issue(where, `Pack file ${path} has an unknown kind: ${String(kind)}.`));
    return null;
  }
  return { path, bytes, sha256: digest, kind };
}

function parseManifest(raw: unknown, issues: ContentIssue[]): PackManifest | null {
  if (!isRecord(raw)) {
    issues.push(issue('index', 'A pack entry in the content index is not an object.'));
    return null;
  }
  const id = raw['id'];
  if (!isStr(id) || id.length === 0) {
    issues.push(issue('index', 'A pack in the content index has no id.'));
    return null;
  }
  const version = raw['version'];
  if (!isStr(version) || version.length === 0) {
    issues.push(issue(id, 'This pack has no version, so updates could not be detected.'));
    return null;
  }
  if (!Array.isArray(raw['files'])) {
    issues.push(issue(id, 'This pack lists no files.'));
    return null;
  }
  const files: PackFile[] = [];
  const seen = new Set<string>();
  for (const entry of raw['files']) {
    const file = parsePackFile(entry, id, issues);
    if (!file) continue;
    if (seen.has(file.path)) {
      issues.push(issue(id, `Pack file ${file.path} is listed twice; the duplicate was ignored.`, 'warning'));
      continue;
    }
    seen.add(file.path);
    files.push(file);
  }
  if (files.length === 0) {
    issues.push(issue(id, 'None of this pack’s files could be read from the index.'));
    return null;
  }

  const rawContents = isRecord(raw['contents']) ? raw['contents'] : {};
  const count = (k: string): number => (isNum(rawContents[k]) ? (rawContents[k] as number) : 0);

  const attributions = Array.isArray(raw['attributions'])
    ? raw['attributions'].filter(isRecord).map((a) => ({
        asset: isStr(a['asset']) ? a['asset'] : 'unknown',
        source: isStr(a['source']) ? a['source'] : 'unknown',
        url: isStr(a['url']) ? a['url'] : '',
        license: isStr(a['license']) ? a['license'] : 'unknown',
        licenseUrl: isStr(a['licenseUrl']) ? a['licenseUrl'] : null,
        notes: isStr(a['notes']) ? a['notes'] : null,
      }))
    : [];
  if (attributions.length === 0) {
    // Not fatal, but a pack with no credits is a licensing problem we must see.
    issues.push(issue(id, 'This pack carries no attribution information.', 'warning'));
  }

  const declaredTotal = isNum(raw['totalBytes']) ? raw['totalBytes'] : 0;
  const summedTotal = files.reduce((n, f) => n + f.bytes, 0);
  if (declaredTotal !== 0 && declaredTotal !== summedTotal) {
    issues.push(
      issue(
        id,
        `The pack’s stated size (${declaredTotal} bytes) disagrees with its file list ` +
          `(${summedTotal} bytes); the file list is used.`,
        'warning',
      ),
    );
  }

  return {
    id,
    title: isStr(raw['title']) ? raw['title'] : id,
    description: isStr(raw['description']) ? raw['description'] : '',
    version,
    required: isBool(raw['required']) ? raw['required'] : false,
    dependsOn: isStrArray(raw['dependsOn']) ? raw['dependsOn'] : [],
    // Always the sum of the parts: progress percentages computed from a wrong
    // total are how progress bars end up over 100%.
    totalBytes: summedTotal,
    files,
    contents: {
      characters: count('characters'),
      vocab: count('vocab'),
      audioClips: count('audioClips'),
      strokeReferences: count('strokeReferences'),
    },
    attributions,
  };
}

export interface ParsedPackIndex {
  index: PackIndex | null;
  issues: ContentIssue[];
}

/** Parse and validate a PackIndex document. Never throws. */
export function parsePackIndex(raw: unknown): ParsedPackIndex {
  const issues: ContentIssue[] = [];
  let value = raw;
  if (isStr(raw)) {
    try {
      value = JSON.parse(raw) as unknown;
    } catch (err) {
      issues.push(issue('index', `The content index is not valid JSON: ${describe(err)}`));
      return { index: null, issues };
    }
  }
  if (!isRecord(value)) {
    issues.push(issue('index', 'The content index is not an object.'));
    return { index: null, issues };
  }
  if (!isNum(value['schemaVersion'])) {
    issues.push(issue('index', 'The content index has no schemaVersion.'));
    return { index: null, issues };
  }
  if (!Array.isArray(value['packs'])) {
    issues.push(issue('index', 'The content index has no pack list.'));
    return { index: null, issues };
  }
  const packs: PackManifest[] = [];
  for (const entry of value['packs']) {
    const manifest = parseManifest(entry, issues);
    if (manifest) packs.push(manifest);
  }
  const index: PackIndex = {
    schemaVersion: value['schemaVersion'],
    generatedAt: isStr(value['generatedAt']) ? value['generatedAt'] : '',
    packs,
  };
  return { index, issues };
}

export function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* -------------------------------------------------------------------------- */
/* Content entries                                                            */
/* -------------------------------------------------------------------------- */

export function parseAudioRef(raw: unknown): AudioRef | null {
  if (!isRecord(raw)) return null;
  const path = raw['path'];
  const sha256 = raw['sha256'];
  if (!isStr(path) || !isSafePackPath(path)) return null;
  if (!isStr(sha256) || !SHA256_RE.test(sha256.trim().toLowerCase())) return null;
  const attribution = isRecord(raw['attribution']) ? raw['attribution'] : null;
  if (!attribution || !isStr(attribution['source']) || !isStr(attribution['license'])) {
    // Every clip must carry provenance; an unattributed recording is not
    // shippable, so it is dropped rather than played.
    return null;
  }
  return {
    path,
    sha256: sha256.trim().toLowerCase(),
    bytes: isNum(raw['bytes']) ? raw['bytes'] : 0,
    durationMs: isNum(raw['durationMs']) ? raw['durationMs'] : null,
    attribution: {
      source: attribution['source'],
      url: isStr(attribution['url']) ? attribution['url'] : '',
      author: isStr(attribution['author']) ? attribution['author'] : 'unknown',
      license: attribution['license'],
      licenseUrl: isStr(attribution['licenseUrl']) ? attribution['licenseUrl'] : null,
      nativeSpeakerDocumented: attribution['nativeSpeakerDocumented'] === true,
    },
  };
}

export function parseKana(raw: unknown): KanaCharacter | null {
  if (!isRecord(raw) || raw['kind'] !== 'kana') return null;
  const { id, glyph, romaji, script } = raw;
  if (!isStr(id) || !isStr(glyph) || !isStr(romaji)) return null;
  if (script !== 'hiragana' && script !== 'katakana') return null;
  if (!isNum(raw['teachingOrder']) || !isNum(raw['strokeCount'])) return null;
  return raw as unknown as KanaCharacter;
}

export function parseKanji(raw: unknown): KanjiCharacter | null {
  if (!isRecord(raw) || raw['kind'] !== 'kanji') return null;
  if (!isStr(raw['id']) || !isStr(raw['glyph'])) return null;
  if (!Array.isArray(raw['meanings']) || !Array.isArray(raw['readings'])) return null;
  if (!Array.isArray(raw['components'])) return null;
  if (!isNum(raw['teachingOrder']) || !isNum(raw['strokeCount'])) return null;
  return raw as unknown as KanjiCharacter;
}

export function parseComponent(raw: unknown): KanjiComponent | null {
  if (!isRecord(raw) || raw['kind'] !== 'component') return null;
  if (!isStr(raw['id']) || !isStr(raw['glyph'])) return null;
  if (!Array.isArray(raw['roles']) || !Array.isArray(raw['glosses'])) return null;
  if (!isNum(raw['strokeCount'])) return null;
  return raw as unknown as KanjiComponent;
}

export function parseVocab(raw: unknown): VocabEntry | null {
  if (!isRecord(raw) || raw['kind'] !== 'vocab') return null;
  if (!isStr(raw['id']) || !isStr(raw['spelling']) || !isStr(raw['reading'])) return null;
  if (!isStr(raw['meaning']) || !Array.isArray(raw['requiresCharacters'])) return null;
  if (!isNum(raw['teachingOrder'])) return null;
  return raw as unknown as VocabEntry;
}

export function parseReading(raw: unknown): KanjiReading | null {
  if (!isRecord(raw)) return null;
  if (!isStr(raw['id']) || !isStr(raw['kanji']) || !isStr(raw['reading'])) return null;
  const type = raw['type'];
  if (type !== 'on' && type !== 'kun' && type !== 'nanori' && type !== 'irregular') return null;
  if (!Array.isArray(raw['exampleVocab'])) return null;
  return raw as unknown as KanjiReading;
}

export function parseLesson(raw: unknown): Lesson | null {
  if (!isRecord(raw)) return null;
  if (!isStr(raw['id']) || !isStr(raw['title'])) return null;
  if (!Array.isArray(raw['introduces']) || !isNum(raw['order'])) return null;
  const script = raw['script'];
  if (script !== 'hiragana' && script !== 'katakana' && script !== 'kanji' && script !== 'mixed') return null;
  return raw as unknown as Lesson;
}

export function parseStrokeReference(raw: unknown, glyph: string): StrokeReference | null {
  if (!isRecord(raw)) return null;
  const box = raw['viewBox'];
  if (!isRecord(box) || !isNum(box['width']) || !isNum(box['height'])) return null;
  if (box['width'] <= 0 || box['height'] <= 0) return null;
  if (!Array.isArray(raw['strokes']) || raw['strokes'].length === 0) return null;
  for (const stroke of raw['strokes']) {
    if (!isRecord(stroke) || !isStr(stroke['path'])) return null;
    const points = stroke['points'];
    // The assessor consumes `points` and never parses SVG; a stroke file without
    // usable points would make handwriting assessment silently wrong, so the
    // whole reference is rejected instead.
    if (!Array.isArray(points) || points.length < 2) return null;
    for (const p of points) {
      if (!Array.isArray(p) || p.length < 2 || !isNum(p[0]) || !isNum(p[1])) return null;
    }
  }
  const declaredGlyph = raw['glyph'];
  if (isStr(declaredGlyph) && declaredGlyph.normalize('NFC') !== glyph.normalize('NFC')) return null;
  return raw as unknown as StrokeReference;
}
