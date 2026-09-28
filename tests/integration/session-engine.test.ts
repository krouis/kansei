import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { SERIES_LENGTH, XP_RULES, asItemId } from '@/domain';
import type {
  AnswerSubmission, CharacterEntry, KanaCharacter, KanjiCharacter, KanjiComponent, KanjiReading, Lesson,
  Script, VocabEntry,
} from '@/domain';
import type { ContentLibrary } from '@/content/ports';
import { openDatabase } from '@/persistence/db';
import type { Database } from '@/persistence/ports';
import { createFsrsScheduler } from '@/learning/scheduler';
import { DefaultSelector } from '@/learning/selection/selector';
import { CompositeGenerator } from '@/learning/generation';
import { KanseiGrader } from '@/learning/grading/grader';
import { KanseiSessionEngine } from '@/learning/session/engine';
import { mulberry32 } from '@/learning/generation';

/**
 * Drives a COMPLETE ten-screen series through the real, wired modules —
 * scheduler, selector, generator, grader, and persistence — rather than
 * through any of their individual unit tests. This is the seam most likely to
 * break when modules built independently are connected for the first time.
 */

function kana(overrides: Partial<KanaCharacter>): KanaCharacter {
  return {
    id: asItemId(`kana:hi:${overrides.romaji}`) as never,
    kind: 'kana',
    script: 'hiragana',
    glyph: '',
    romaji: '',
    inputVariants: [],
    group: 'basic',
    tier: 'modern-core',
    position: null,
    derivesFrom: [],
    confusableWith: [],
    strokeCount: 2,
    printVsHandwritten: null,
    note: null,
    teachingOrder: 1,
    lessonId: 'l1',
    ...overrides,
  } as KanaCharacter;
}

const CHARACTERS: KanaCharacter[] = [
  kana({ glyph: 'あ', romaji: 'a', inputVariants: ['a'], position: { row: '', column: 'a' }, teachingOrder: 1 }),
  kana({ glyph: 'い', romaji: 'i', inputVariants: ['i'], position: { row: '', column: 'i' }, teachingOrder: 2 }),
  kana({ glyph: 'う', romaji: 'u', inputVariants: ['u'], position: { row: '', column: 'u' }, teachingOrder: 3 }),
  kana({ glyph: 'え', romaji: 'e', inputVariants: ['e'], position: { row: '', column: 'e' }, teachingOrder: 4 }),
  kana({ glyph: 'お', romaji: 'o', inputVariants: ['o'], position: { row: '', column: 'o' }, teachingOrder: 5 }),
  kana({ glyph: 'か', romaji: 'ka', inputVariants: ['ka'], position: { row: 'k', column: 'a' }, teachingOrder: 6 }),
  kana({ glyph: 'き', romaji: 'ki', inputVariants: ['ki'], position: { row: 'k', column: 'i' }, teachingOrder: 7 }),
  kana({ glyph: 'く', romaji: 'ku', inputVariants: ['ku'], position: { row: 'k', column: 'u' }, teachingOrder: 8 }),
  kana({ glyph: 'け', romaji: 'ke', inputVariants: ['ke'], position: { row: 'k', column: 'e' }, teachingOrder: 9 }),
  kana({ glyph: 'こ', romaji: 'ko', inputVariants: ['ko'], position: { row: 'k', column: 'o' }, teachingOrder: 10 }),
];

/** A minimal but real ContentLibrary: no audio, no strokes, ten hiragana. */
class FixtureLibrary implements ContentLibrary {
  readonly schemaVersion = 1;
  kana(script: 'hiragana' | 'katakana'): KanaCharacter[] {
    return script === 'hiragana' ? CHARACTERS : [];
  }
  kanji(): KanjiCharacter[] {
    return [];
  }
  components(): KanjiComponent[] {
    return [];
  }
  vocab(): VocabEntry[] {
    return [];
  }
  lessons(_script?: Script | 'mixed'): Lesson[] {
    return [{ id: 'l1', title: 'Vowels', script: 'hiragana', introduces: CHARACTERS.map((c) => asItemId(String(c.id))), prerequisites: [], note: null, order: 1 }];
  }
  character(id: string): CharacterEntry | undefined {
    return CHARACTERS.find((c) => String(c.id) === id);
  }
  byGlyph(glyph: string): CharacterEntry | undefined {
    return CHARACTERS.find((c) => c.glyph === glyph);
  }
  component() {
    return undefined;
  }
  reading(): KanjiReading | undefined {
    return undefined;
  }
  readingsFor(): KanjiReading[] {
    return [];
  }
  vocabFor(): VocabEntry[] {
    return [];
  }
  vocabAvailableAt(): VocabEntry[] {
    return [];
  }
  async strokes() {
    return undefined;
  }
  hasStrokes(): boolean {
    return false; // No stroke data in this fixture: handwriting questions never generate.
  }
  audio(): undefined {
    return undefined;
  }
  hasAudio(): boolean {
    return false; // No audio in this fixture: listening questions never generate.
  }
  audioCoverage() {
    return [];
  }
  inventory() {
    return [];
  }
}

const FIXTURE_SETTINGS = {
  version: 1, theme: 'system', japaneseTextScale: 1, reducedMotion: 'system', dailyGoalXp: 20,
  enabledQuestionTypes: [], silentPractice: true, keyboardOnlyMode: true, seriesPerSession: 1,
  selectionPolicy: { dueReview: 6, weakSkillOrConfusion: 2, newOrExtending: 2 },
  scaffoldWithdrawal: 'standard', showStreak: true,
  reminders: {
    enabled: false, times: [], weekdays: [], afterLastSeries: false, quietHours: null,
    snoozeMinutes: 15, pausedUntil: null, skipWhenGoalMet: true, notificationPermission: 'default',
  },
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z', locale: 'en', activeScripts: ['hiragana'],
  includeExtended: false, includeHistorical: false,
} as const;

function buildEngine(db: Database, seed: number): KanseiSessionEngine {
  const library = new FixtureLibrary();
  const rng = mulberry32(seed);
  return new KanseiSessionEngine({
    db,
    content: library,
    scheduler: createFsrsScheduler({ random: rng }),
    createSelector: (tx) => new DefaultSelector({ skills: tx.skills, confusions: tx.confusions, library }),
    generator: new CompositeGenerator(),
    grader: new KanseiGrader({ assessor: null, content: null }),
    getSettings: () => FIXTURE_SETTINGS as never,
    random: rng,
  });
}

let db: Database;
let engine: KanseiSessionEngine;

beforeEach(async () => {
  db = await openDatabase({ name: `kansei-session-test-${Math.random().toString(36).slice(2)}` });
  engine = buildEngine(db, 42);
});

function answerFor(question: ReturnType<typeof questionOf>, correct: boolean): AnswerSubmission {
  const q = question;
  let normalisedInput: string | null = null;
  let chosenOptionKey: string | null = null;

  if (q.options) {
    const opt = correct ? q.options.find((o) => o.correct) : q.options.find((o) => !o.correct);
    chosenOptionKey = opt?.key ?? null;
  } else if (q.acceptedAnswers.length > 0) {
    normalisedInput = correct ? q.acceptedAnswers[0]! : '__definitely_wrong__';
  }

  return {
    questionId: q.id,
    rawInput: normalisedInput,
    normalisedInput,
    chosenOptionKey,
    pairResults: q.pairs
      ? q.pairs.map((p) => ({ pairId: p.pairId, correct, remainingChoices: q.pairs!.length, forcedByElimination: false, elapsedMs: 500 }))
      : null,
    strokes: null,
    declined: false,
    hintsUsed: [],
    audioReplays: 0,
    elapsedMs: 1500,
    inputMethod: 'keyboard',
    imeUsed: false,
  };
}

function questionOf(state: Awaited<ReturnType<KanseiSessionEngine['start']>>) {
  const series = state.series[state.activeSeriesIndex]!;
  return series.screens[series.cursor]!.question;
}

describe('session engine: a complete series end to end', () => {
  it('runs exactly ten screens and banks exactly 20 XP for a perfect series', async () => {
    let state = await engine.start({ kind: 'standard', seriesCount: 1, now: new Date('2026-01-01T09:00:00.000Z') });
    expect(state.series).toHaveLength(1);
    expect(state.series[0]!.screens).toHaveLength(SERIES_LENGTH);

    let screensSeen = 0;
    for (let i = 0; i < SERIES_LENGTH; i += 1) {
      const q = questionOf(state);
      const submission = answerFor(q, true);
      const now = new Date(`2026-01-01T09:0${i}:00.000Z`);
      const { xpAwarded } = await engine.submit(submission, now);
      expect(xpAwarded).toBe(XP_RULES.perScreen);
      const { state: next, finished } = await engine.advance(now);
      state = next;
      screensSeen += 1;
      if (i < SERIES_LENGTH - 1) expect(finished).toBe(false);
      else expect(finished).toBe(true);
    }
    expect(screensSeen).toBe(SERIES_LENGTH);

    const total = await db.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(XP_RULES.perCompleteSeries); // 10 * 1 + 10 bonus = 20
    expect(state.status).toBe('completed');
  });

  it('preserves the first-attempt result through a corrected retry, and never double-counts XP', async () => {
    const state = await engine.start({ kind: 'standard', seriesCount: 1, now: new Date('2026-01-01T09:00:00.000Z') });
    const q = questionOf(state);

    const wrong = answerFor(q, false);
    const { grade: firstGrade, xpAwarded } = await engine.submit(wrong, new Date('2026-01-01T09:00:00.000Z'));
    expect(firstGrade.outcome).toBe('incorrect');
    expect(xpAwarded).toBe(1);

    const corrected = answerFor(q, true);
    const { grade: retryGrade } = await engine.submitRetry(corrected, new Date('2026-01-01T09:00:05.000Z'));
    expect(retryGrade.outcome).toBe('correct');

    // The screen's PRESERVED first-attempt result must still read incorrect —
    // a retry is appended, never merged over the original.
    const series = state.series[0]!;
    const screen = series.screens[series.cursor]!;
    expect(screen.result?.grade.outcome).toBe('incorrect');
    expect(screen.retries).toHaveLength(1);
    expect(screen.retries[0]!.grade.outcome).toBe('correct');

    // Advancing must not award XP a second time for this screen.
    await engine.advance(new Date('2026-01-01T09:00:06.000Z'));
    const total = await db.transact('readonly', (tx) => tx.xp.total());
    expect(total).toBe(1); // exactly one screen's XP, not two.

    // The scheduler must have recorded the FIRST attempt's outcome (incorrect),
    // not the retry's — an immediate corrected retry is not unaided recall. A
    // brand-new item's first-ever wrong answer is not a "lapse" (that term
    // means falling from an already-succeeded state), so the properties that
    // actually distinguish "first attempt was wrong" are checked instead.
    const skillState = await db.transact('readonly', (tx) => tx.skills.get(q.targetItemId, q.skill, q.targetReadingId));
    expect(skillState?.totalAttempts).toBe(1);
    expect(skillState?.unaidedFirstAttemptCorrect).toBe(0);
    expect(skillState?.stage).not.toBe('retained');
  });

  it('updates skill state only for the skill actually tested', async () => {
    const state = await engine.start({ kind: 'standard', seriesCount: 1, now: new Date('2026-01-01T09:00:00.000Z') });
    const q = questionOf(state);
    await engine.submit(answerFor(q, true), new Date('2026-01-01T09:00:00.000Z'));

    const tested = await db.transact('readonly', (tx) => tx.skills.get(q.targetItemId, q.skill, q.targetReadingId));
    expect(tested).toBeDefined();

    // No OTHER skill for the same item should have been touched.
    const others = (['recognition', 'readingRecall', 'listening', 'handwriting'] as const).filter((s) => s !== q.skill);
    for (const other of others) {
      const state2 = await db.transact('readonly', (tx) => tx.skills.get(q.targetItemId, other));
      expect(state2).toBeUndefined();
    }
  });

  it('resumes an interrupted session at the exact screen it left off on', async () => {
    const started = await engine.start({ kind: 'standard', seriesCount: 1, now: new Date('2026-01-01T09:00:00.000Z') });
    const q0 = questionOf(started);
    await engine.submit(answerFor(q0, true), new Date('2026-01-01T09:00:00.000Z'));
    await engine.advance(new Date('2026-01-01T09:00:01.000Z'));

    // Simulate a reload: a brand-new engine instance, same database.
    const freshEngine = buildEngine(db, 7);
    const resumed = await freshEngine.resume();
    expect(resumed).toBeDefined();
    expect(resumed!.series[0]!.cursor).toBe(1); // Advanced past screen 0, not restarted.
    expect(resumed!.id).toBe(started.id);
  });
});
