import type { CharacterId, ComponentId, ItemId, ReadingId, VocabId } from './ids';
import type { SkillApplicability } from './skills';

/** The three writing systems Kansei teaches. */
export type Script = 'hiragana' | 'katakana' | 'kanji';

/**
 * Curriculum tier. The beginner path is `modern-core` only.
 *
 * This distinction exists so the app can state honestly what it covers:
 * "all 46 modern basic hiragana" is a claim about `modern-core`, and extended
 * or historical forms are never silently folded into that count.
 */
export type CurriculumTier = 'modern-core' | 'extended' | 'historical';

/** How a kana row/column is positioned in the conventional gojūon table. */
export interface GojuonPosition {
  /** Consonant row: '' (vowel), k, s, t, n, h, m, y, r, w, plus voiced rows g, z, d, b, p. */
  row: string;
  /** Vowel column: a, i, u, e, o. */
  column: 'a' | 'i' | 'u' | 'e' | 'o';
}

/**
 * Kana grouping, used by the Character Explorer to build separate tables
 * instead of mixing modified and combined forms into the base 46.
 */
export type KanaGroup =
  | 'basic' // 46 modern basic characters
  | 'dakuten' // が ざ だ ば — voiced
  | 'handakuten' // ぱ — plosive
  | 'yoon' // きゃ しゅ ちょ — contracted (youon) combinations
  | 'extended' // katakana ファ ティ ウィ etc.
  | 'special' // small っ/ッ, ー, ん/ン
  | 'historical'; // ゐ ゑ ヰ ヱ — not on the beginner path

export interface KanaCharacter {
  id: CharacterId;
  kind: 'kana';
  script: 'hiragana' | 'katakana';
  /** The character itself, NFC-normalised. May be 2 code points for yōon (きゃ). */
  glyph: string;
  /** Displayed romanisation in the app's chosen convention (see romanization.ts). */
  romaji: string;
  /** Accepted typed input variants, lowercase. Includes Kunrei/Hepburn/IME spellings. */
  inputVariants: string[];
  group: KanaGroup;
  tier: CurriculumTier;
  position: GojuonPosition | null;
  /** The base character this is derived from: が → か, きゃ → き. */
  derivesFrom: CharacterId[];
  /** Characters learners commonly mix this up with, e.g. シ/ツ, ソ/ン, ね/れ/わ. */
  confusableWith: CharacterId[];
  /** Number of strokes in the standard handwritten form. */
  strokeCount: number;
  /**
   * Set when the common printed (Mincho/Gothic) form differs from the taught
   * handwritten form — e.g. き and さ are often printed joined but written
   * with a detached final stroke.
   */
  printVsHandwritten: string | null;
  /** Short teaching note: pronunciation, spelling rule, or usage. */
  note: string | null;
  /** Ordered teaching position within the curriculum. */
  teachingOrder: number;
  /** Lesson group id — characters introduced together. */
  lessonId: string;
}

/** A recurring graphical component, which may or may not be a dictionary radical. */
export interface KanjiComponent {
  id: ComponentId;
  kind: 'component';
  glyph: string;
  /**
   * Component role. A component can be several of these at once, so this is a list.
   *  - 'radical': the Kangxi dictionary radical used for indexing
   *  - 'recurring': a shape that recurs across characters but is not the radical
   *  - 'standalone': also a kanji in its own right
   */
  roles: Array<'radical' | 'recurring' | 'standalone'>;
  /** Kangxi radical number, when this is a dictionary radical. */
  kangxiNumber: number | null;
  /**
   * Glosses. Plural and explicitly unordered: components frequently carry
   * several unrelated senses, and some carry none that help a learner.
   */
  glosses: string[];
  /**
   * True when the component's contribution to meaning is unreliable or purely
   * phonetic. Surfaced in the UI so the app never implies one fixed meaning.
   */
  meaningIsUnreliable: boolean;
  /** Common shape variants, e.g. 水 appearing as 氵. */
  variants: string[];
  strokeCount: number;
  teachingOrder: number;
  lessonId: string;
  /** Kanji that this component appears in, restricted to the taught set. */
  appearsIn: CharacterId[];
}

/** A reading of a kanji, always taught and tracked through actual words. */
export interface KanjiReading {
  id: ReadingId;
  kanji: string;
  /** The reading in kana. */
  reading: string;
  type: 'on' | 'kun' | 'nanori' | 'irregular';
  /**
   * Words that demonstrate this reading. A reading is only taught once at
   * least one vocabulary item using it is available.
   */
  exampleVocab: VocabId[];
  /**
   * Rough share of this reading among the kanji's occurrences, when a source
   * supports an estimate. `null` when unknown — never invented.
   */
  frequencyShare: number | null;
  /** Sound changes: 一本 いっぽん — rendaku/gemination affecting the surface form. */
  notes: string | null;
}

export interface KanjiCharacter {
  id: CharacterId;
  kind: 'kanji';
  script: 'kanji';
  glyph: string;
  /** Rank in the documented frequency list. Lower is more frequent. */
  frequencyRank: number;
  /** Position in the app's teaching order — deliberately NOT the frequency rank. */
  teachingOrder: number;
  lessonId: string;
  /** Concise English meanings. */
  meanings: string[];
  /** All taught readings, each tied to words. */
  readings: ReadingId[];
  /** Components this character decomposes into, in writing order where known. */
  components: ComponentId[];
  /** Dictionary radical. */
  radical: ComponentId | null;
  strokeCount: number;
  /** Jōyō grade, when the character is a jōyō kanji. */
  jlptLevel: number | null;
  grade: number | null;
  confusableWith: CharacterId[];
  /**
   * Mnemonic. ALWAYS surfaced in the UI as a memory aid, never as etymology.
   * `source` records whether it is an invented aid or a documented origin.
   */
  mnemonic: { text: string; kind: 'memory-aid' | 'documented-origin'; source: string | null } | null;
  printVsHandwritten: string | null;
  tier: CurriculumTier;
}

export type CharacterEntry = KanaCharacter | KanjiCharacter;

/** A beginner vocabulary entry. */
export interface VocabEntry {
  id: VocabId;
  kind: 'vocab';
  /** Japanese spelling as normally written (may mix kanji and kana). */
  spelling: string;
  /** Kana reading of the whole word. */
  reading: string;
  /** Displayed romanisation. */
  romaji: string;
  /** Concise meaning — one short gloss, plus optional extras. */
  meaning: string;
  extraMeanings: string[];
  partOfSpeech: string[];
  /** Pitch-accent pattern where a source provides it; null when unknown. */
  pitchAccent: number[] | null;
  /** Every character id used by this word — the gate for when it can be taught. */
  requiresCharacters: CharacterId[];
  /** Which kanji readings this word demonstrates. */
  demonstratesReadings: ReadingId[];
  teachingOrder: number;
  lessonId: string;
  /** Frequency rank from the vocabulary source, when available. */
  frequencyRank: number | null;
  /** Provenance of the entry, for attribution. */
  source: string;
  audio: AudioRef | null;
  tier: CurriculumTier;
}

/**
 * Reference to a locally stored audio recording.
 *
 * Kansei never substitutes speech synthesis for a missing recording: if
 * `audio` is null the listening exercise is not generated at all. See
 * docs/CONTENT.md for why.
 */
export interface AudioRef {
  /** Path relative to the content pack root. */
  path: string;
  /** SHA-256 of the file, base16. Verified at install time. */
  sha256: string;
  bytes: number;
  durationMs: number | null;
  /** Speaker/recording provenance — required for every clip. */
  attribution: AudioAttribution;
}

export interface AudioAttribution {
  /** Human-readable source name, e.g. 'Wikimedia Commons'. */
  source: string;
  /** Stable URL to the original file or its description page. */
  url: string;
  /** Recording author as credited by the source. */
  author: string;
  /** SPDX-style licence id, e.g. 'CC-BY-SA-4.0', 'CC0-1.0', 'PD'. */
  license: string;
  licenseUrl: string | null;
  /** True when the source documents the speaker as a native speaker. */
  nativeSpeakerDocumented: boolean;
}

/** Stroke reference data for animation, tracing and handwriting assessment. */
export interface StrokeReference {
  /** Character this describes. */
  glyph: string;
  /** Source dataset id, e.g. 'kanjivg-20250816'. */
  source: string;
  /** Design viewBox the paths are drawn in. KanjiVG uses 109x109. */
  viewBox: { width: number; height: number };
  strokes: StrokeReferenceStroke[];
  /**
   * Accepted stroke-order variants for this character, as permutations of the
   * canonical stroke indices. Populated where a documented variant exists.
   */
  orderVariants: number[][];
}

export interface StrokeReferenceStroke {
  /** SVG path data for the stroke median/outline as provided by the source. */
  path: string;
  /**
   * Resampled polyline of the stroke's median line in design units, used by the
   * assessor. Precomputed at build time so the runtime never parses SVG paths.
   */
  points: Array<[number, number]>;
  /** Stroke type from the source when available (KanjiVG `kvg:type`). */
  type: string | null;
  /** Length of the median polyline in design units. */
  length: number;
}

export interface SkillApplicabilityByItem {
  [itemId: string]: SkillApplicability;
}

/** A lesson: the unit in which new material is introduced. */
export interface Lesson {
  id: string;
  title: string;
  script: Script | 'mixed';
  /** Ordered ids introduced by this lesson. */
  introduces: ItemId[];
  /** Lessons that should be underway before this one. */
  prerequisites: string[];
  /** Short teaching note shown when the lesson is introduced. */
  note: string | null;
  order: number;
}
