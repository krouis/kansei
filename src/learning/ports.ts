import type {
  AnswerSubmission, AttemptRecord, AudioRef, CharacterEntry, ConfusionRecord, Grade, ItemId,
  KanjiReading, Question, SelectionReason, SessionState, Settings, Skill, SkillState, VocabEntry,
} from '@/domain';

/**
 * Learning ports.
 *
 * Three decisions are kept strictly apart, because conflating them is what makes
 * adaptive systems behave oddly:
 *
 *   1. Scheduler   — WHEN an (item, skill) pair should next be reviewed.
 *   2. Selector    — WHICH pairs and skills make up the next ten screens.
 *   3. Generator   — WHICH question format and difficulty presents a pair.
 *
 * Each is independently testable, and none of them reaches into the others.
 */

/** 1. WHEN — the spaced-repetition scheduler. */
export interface Scheduler {
  /** Documented name and version of the algorithm, shown in About & Science. */
  readonly id: string;
  readonly version: string;
  /** State for a pair the learner has never attempted. */
  initial(itemId: ItemId, skill: Skill, readingId: string | null, now: Date): SkillState;
  /**
   * Fold one graded attempt into the pair's state.
   *
   * `evidence` matters: a correct four-option answer moves the schedule less
   * than unaided production does, and an aided answer does not count as a
   * success at all. The scheduler receives the attempt as recorded — it never
   * sees a corrected retry as if it were the first attempt.
   */
  update(state: SkillState, attempt: AttemptRecord, now: Date): SkillState;
  /** Probability the learner still retains the pair, per the model. An estimate. */
  retrievability(state: SkillState, now: Date): number;
  /** Human-readable account of why the next interval is what it is. */
  explain(state: SkillState, now: Date): string;
}

/** 2. WHICH — session composition. */
export interface SelectionPolicy {
  dueReview: number;
  weakSkillOrConfusion: number;
  newOrExtending: number;
}

export interface SelectionRequest {
  policy: SelectionPolicy;
  /** Total screens to fill. 10 for a standard series. */
  screens: number;
  now: Date;
  settings: Settings;
  /** Restrict to one item, for focused practice. */
  focusItemId: ItemId | null;
  /** Skills that may be tested — narrowed by silent or keyboard-only mode. */
  allowedSkills: Skill[];
  /** Items already chosen in this session, to avoid repeats within a series. */
  exclude: ItemId[];
}

export interface SelectedTarget {
  itemId: ItemId;
  readingId: string | null;
  skill: Skill;
  reason: SelectionReason;
  /** The pair's state, or null when it is new material. */
  state: SkillState | null;
  /** Set when this target repairs a specific confusion. */
  confusion: ConfusionRecord | null;
}

export interface Selector {
  /**
   * Choose the targets for the next series.
   *
   * Adapts when the ideal mix is unavailable: a brand-new learner has nothing
   * due, a learner returning to a backlog has far more than six, and a learner
   * who has finished the curriculum has no new material. The policy is a
   * default, not a quota, and `select` reports how it actually filled the mix.
   */
  select(request: SelectionRequest): Promise<{
    targets: SelectedTarget[];
    /** Real counts per reason, which may differ from the requested policy. */
    actual: Record<SelectionReason, number>;
    /** Plain-language note when the mix had to deviate, shown to the learner. */
    deviation: string | null;
  }>;
}

/** 3. HOW — question generation. */
export interface GenerationContext {
  now: Date;
  settings: Settings;
  /**
   * Everything that can legitimately appear as a distractor.
   *
   * `readings` is optional because it was added after the first ports were
   * frozen. When it is supplied the generator can use a reading's type (on/kun)
   * and its sound-change notes in feedback; when it is absent the generator
   * falls back to the documented ReadingId grammar (`reading:<kanji>:<kana>`),
   * which still yields the kana it needs. See generation/pool.ts.
   */
  pool: { characters: CharacterEntry[]; vocab: VocabEntry[]; readings?: KanjiReading[] };
  /** Whether a clip actually exists — no audio means no listening question. */
  hasAudio: (key: string) => boolean;
  /**
   * The clip itself. `hasAudio` alone cannot fill `Question.prompt.audio`, so a
   * listening question is only generable when this is supplied; without it the
   * generator rejects rather than presenting a silent "listening" screen.
   * Audio keys are item ids — see generation/pool.ts `audioKey`.
   */
  audio?: (key: string) => AudioRef | undefined;
  /** Whether stroke data exists — no strokes means no handwriting question. */
  hasStrokes: (glyph: string) => boolean;
  /** Deterministic randomness, so a session can be replayed in a test. */
  random: () => number;
}

export interface Generator {
  /**
   * Build a question for a target, or explain why it could not be built.
   *
   * A generator returns `null` rather than a degraded question: if the required
   * audio is missing, if four non-ambiguous options cannot be assembled, or if
   * the prompt would have more than one correct answer without context, the
   * caller tries a different format.
   */
  generate(target: SelectedTarget, ctx: GenerationContext): Promise<{
    question: Question | null;
    /** Why generation failed, for diagnostics and honest reporting. */
    rejected: string | null;
  }>;
}

/** Grading. Pure, so it is exhaustively testable. */
export interface Grader {
  grade(question: Question, submission: AnswerSubmission): Promise<Grade>;
}

/** The session engine: owns the ten-screen structure and the XP ledger. */
export interface SessionEngine {
  start(opts: {
    kind: SessionState['kind'];
    seriesCount: 1 | 2 | 3;
    focusItemId?: ItemId | null;
    now: Date;
  }): Promise<SessionState>;
  /** Resume an interrupted session, or undefined when there is none. */
  resume(): Promise<SessionState | undefined>;
  /**
   * Submit an answer for the current screen.
   *
   * Records the attempt, folds it into the scheduler, banks the screen's XP
   * once, and returns the grade plus the feedback to show. The first attempt's
   * result is preserved for ever; a corrected retry is appended, never merged.
   */
  submit(submission: AnswerSubmission, now: Date): Promise<{
    grade: Grade;
    xpAwarded: number;
    /** True when a corrected retry is offered for this screen. */
    offerRetry: boolean;
  }>;
  /** Record a guided correction. Never overwrites the first-attempt result. */
  submitRetry(submission: AnswerSubmission, now: Date): Promise<{ grade: Grade }>;
  /** Acknowledge feedback and advance. Screen XP is banked here if not already. */
  advance(now: Date): Promise<{ state: SessionState; finished: boolean }>;
  /** Abandon the session. Screen XP already earned is kept. */
  abandon(now: Date): Promise<void>;
}
