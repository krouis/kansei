import type { AudioRef } from './content';
import type { ItemId, QuestionId } from './ids';
import type { AuxiliarySkill, EvidenceStrength, Skill } from './skills';

/**
 * The ten implemented question formats.
 *
 * Each format is described by a QuestionSpec (see `specs.ts`) that states what
 * skill it assesses, which direction the prompt runs, what counts as a valid
 * answer, which hints are allowed, how it scores, and which ambiguity checks
 * must pass before it may be shown.
 */
export const QUESTION_TYPES = [
  'audio-to-character-choice', // 1. hear a sound, pick the character (4 options)
  'romaji-to-kana-choice', // 2. see rōmaji, pick the kana (4 options)
  'character-to-reading-choice', // 3. see a character, pick its reading (4 options)
  'character-to-reading-typed', // 4. see a character, type its reading (no options)
  'match-pairs', // 5. match ~3 character/reading pairs
  'audio-to-typed', // 6. hear a word, type its reading or Japanese spelling
  'prompt-to-handwriting', // 7. write the target by hand
  'confusable-discrimination', // 8. tell visually similar characters apart
  'word-reading', // 9. read a short word
  'kanji-in-word-context', // 10. kanji reading or writing inside a word
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Which way the prompt runs. Recorded on every attempt. */
export type PromptDirection =
  | 'audio-to-glyph'
  | 'romaji-to-glyph'
  | 'glyph-to-reading'
  | 'reading-to-glyph'
  | 'audio-to-reading'
  | 'meaning-to-glyph'
  | 'glyph-to-glyph';

/** How the learner answers. */
export type ResponseMode = 'choice' | 'typed' | 'handwriting' | 'matching' | 'ordering';

/** Text-entry expectation, which decides normalisation and IME handling. */
export type InputScript = 'kana' | 'romaji' | 'japanese-any' | 'none';

/**
 * Hints the learner may request. Every use is recorded on the attempt and
 * suppresses the "unaided" flag used by the scheduler.
 */
export type HintKind =
  | 'audio-replay' // NOT a hint: replaying audio is part of a listening question
  | 'romaji-scaffold'
  | 'first-stroke'
  | 'stroke-count'
  | 'reference-animation'
  | 'meaning'
  | 'component-breakdown'
  | 'reveal-answer'; // full reveal — always marks the attempt as failed

/** A hint that does not weaken the evidence, because it is part of the task. */
export const NON_PENALISED_HINTS: ReadonlySet<HintKind> = new Set<HintKind>(['audio-replay']);

export interface QuestionSpec {
  type: QuestionType;
  title: string;
  /** Primary skill the format assesses. */
  assesses: Skill;
  /** Additional ability the format exercises but must not be credited as the skill. */
  alsoExercises: AuxiliarySkill[];
  direction: PromptDirection;
  response: ResponseMode;
  inputScript: InputScript;
  /**
   * How strong the evidence is for `assesses`. Recognition among four options is
   * weaker evidence than unaided production, and the scheduler weights it so.
   */
  evidence: EvidenceStrength;
  allowedHints: HintKind[];
  /** Scoring rules in plain language, shown in About & Science. */
  scoring: string;
  /** Preconditions the generator must verify before emitting the question. */
  ambiguityChecks: string[];
  /** True when the format can be answered without audio (silent-practice safe). */
  silentSafe: boolean;
  /** True when the format needs a drawing surface (substituted in keyboard-only mode). */
  requiresPointer: boolean;
  /** Typical time allowance in ms used only for statistics, never as a deadline. */
  typicalMs: number;
}

/** One selectable option in a choice question. */
export interface ChoiceOption {
  /** Stable key for keyboard shortcuts and announcements. */
  key: string;
  /** What is displayed. */
  display: string;
  /** Item this option refers to, when it is a content item. */
  itemId: ItemId | null;
  correct: boolean;
  /**
   * Why this distractor was chosen — 'confusable', 'same-row', 'same-reading',
   * 'random-in-pool'. Recorded so confusion statistics are meaningful.
   */
  distractorReason: string | null;
}

export interface MatchPair {
  pairId: string;
  left: { display: string; itemId: ItemId };
  right: { display: string; itemId: ItemId };
}

/**
 * Japanese typeface the prompt should be rendered in.
 *
 * Legitimate font variation is one rung of the difficulty ladder: a learner who
 * has only ever seen Noto Sans has learned one font, not the character. The app
 * bundles a gothic (Noto Sans JP), a serif (Noto Serif JP) and a textbook face
 * (Klee One); the UI maps these onto --font-jp, --font-jp-serif and
 * --font-jp-hand. 'textbook' is also the face used whenever the printed form
 * differs from the taught handwritten form, so a model to copy is never wrong.
 */
export type PromptFace = 'gothic' | 'serif' | 'textbook';

/** The prompt shown to the learner. */
export interface QuestionPrompt {
  /** Main visible text, e.g. the character or the rōmaji. Empty for audio-only. */
  text: string | null;
  /** Rendered large and in a Japanese face when true. */
  textIsJapanese: boolean;
  audio: AudioRef | null;
  /** Short instruction, e.g. 'Write this in katakana'. */
  instruction: string;
  /**
   * Disambiguating context, e.g. the word a kanji reading is asked in, or
   * 'this is a katakana word'. Required whenever the bare prompt has more than
   * one valid answer.
   */
  context: string | null;
  /** Rōmaji scaffold, shown only while the item is still scaffolded. */
  scaffold: string | null;
  /**
   * Typeface to render `text` in. Optional so that existing prompt literals keep
   * compiling; absent means 'gothic', the default face.
   */
  face?: PromptFace;
}

/**
 * A generated, ready-to-present question. Fully serialisable so an interrupted
 * session can be restored exactly as it was.
 */
export interface Question {
  id: QuestionId;
  type: QuestionType;
  /** The item whose skill this question updates. */
  targetItemId: ItemId;
  /** For kanji reading questions this is the specific reading being tested. */
  targetReadingId: string | null;
  skill: Skill;
  direction: PromptDirection;
  response: ResponseMode;
  inputScript: InputScript;
  evidence: EvidenceStrength;
  prompt: QuestionPrompt;
  options: ChoiceOption[] | null;
  pairs: MatchPair[] | null;
  /**
   * Every answer the grader accepts, already normalised. More than one entry
   * means the question legitimately has multiple right answers.
   */
  acceptedAnswers: string[];
  /** The canonical answer shown in feedback. */
  canonicalAnswer: string;
  /** Additional answers that are correct but outside what was asked for. */
  alsoAcceptableNote: string | null;
  allowedHints: HintKind[];
  /** Explanation used in corrective feedback — one short sentence. */
  distinction: string | null;
  /** Why this question was selected: due review, weak skill, or new material. */
  selectionReason: SelectionReason;
  /** True when the learner chose this specific character in focused practice. */
  focusedPractice: boolean;
  /** Content ids needed to render — used to verify assets before the session. */
  requiredAudio: string[];
  requiredStrokeData: string[];
}

export type SelectionReason = 'due-review' | 'weak-skill' | 'confusion-repair' | 'new-material' | 'retry' | 'focused';

/** What the learner did. */
export interface AnswerSubmission {
  questionId: QuestionId;
  /** Raw text as typed, before normalisation. Kept for debugging ambiguity. */
  rawInput: string | null;
  /** Normalised answer actually compared. */
  normalisedInput: string | null;
  chosenOptionKey: string | null;
  /** Matching results, one entry per pair, in the order the learner resolved them. */
  pairResults: PairResult[] | null;
  strokes: CapturedStroke[] | null;
  /** True when the learner pressed "I don't know". */
  declined: boolean;
  hintsUsed: HintKind[];
  audioReplays: number;
  /** ms from question presentation to submission. */
  elapsedMs: number;
  /** How the answer was entered, for fair interpretation of response time. */
  inputMethod: InputMethod;
  /** True when an IME composition was active at any point during entry. */
  imeUsed: boolean;
}

export type InputMethod = 'keyboard' | 'touch' | 'mouse' | 'stylus' | 'unknown';

export interface PairResult {
  pairId: string;
  /**
   * The right-hand item the learner actually attached to this pair's left-hand
   * item. Present whenever the presentation layer can report it, which lets the
   * grader verify the pair itself instead of trusting a precomputed boolean, and
   * lets a mismatch be recorded in the confusion table. Absent for a legacy or
   * reduced surface, in which case `correct` is taken as given.
   */
  chosenRightItemId?: ItemId | null;
  correct: boolean;
  /**
   * How many options remained when this pair was resolved. The last pair in a
   * three-pair screen is often forced, so it is weak evidence; the grader
   * records this and the scheduler discounts it.
   */
  remainingChoices: number;
  /** True when only one possibility remained, making the answer unavoidable. */
  forcedByElimination: boolean;
  elapsedMs: number;
}

/** A single captured pen/finger/mouse stroke. */
export interface CapturedStroke {
  /** Points in normalised canvas space (0..1 on both axes). */
  points: Array<{ x: number; y: number; t: number; pressure: number | null }>;
  /** Pointer type reported by the browser for this stroke. */
  pointerType: 'touch' | 'pen' | 'mouse' | 'unknown';
  startedAt: number;
  endedAt: number;
}

/** The grader's verdict. */
export interface Grade {
  /** 'correct' | 'incorrect' | 'uncertain'. Uncertain is never a memory failure. */
  outcome: 'correct' | 'incorrect' | 'uncertain';
  /**
   * True only when the answer was right, unaided, on the first attempt.
   * This is the value that drives scheduling.
   */
  unaidedFirstAttempt: boolean;
  /** Human-readable reason, shown in feedback. */
  message: string;
  /** The specific distinction to explain, e.g. 'ツ has three strokes; シ has three too, but…'. */
  distinction: string | null;
  /** Per-aspect detail for handwriting. */
  handwriting: HandwritingVerdict | null;
  /** When the learner's answer was valid but for a different item. */
  confusedWith: ItemId | null;
}

export interface HandwritingVerdict {
  /** Overall confidence 0..1 that the intended character was produced. */
  confidence: number;
  /** Independent sub-assessments — never collapsed into one score. */
  identity: HandwritingAspect;
  strokeCount: HandwritingAspect;
  strokeOrder: HandwritingAspect;
  strokeDirection: HandwritingAspect;
  shape: HandwritingAspect;
  /** Per-stroke notes for coaching, indexed by the learner's stroke number. */
  strokeNotes: Array<{ strokeIndex: number; note: string; severity: 'info' | 'warn' }>;
  /** True when the assessor could not decide; the UI offers retry/compare. */
  uncertain: boolean;
  /** Reason the assessor was uncertain, shown verbatim to the learner. */
  uncertaintyReason: string | null;
  /** Character the strokes matched better, when that is informative. */
  bestAlternative: { glyph: string; confidence: number } | null;
}

export interface HandwritingAspect {
  status: 'ok' | 'close' | 'off' | 'unknown';
  /** 0..1, or null when not assessable. */
  score: number | null;
  detail: string | null;
}
