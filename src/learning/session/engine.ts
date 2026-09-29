import {
  SERIES_LENGTH, asSessionId, stamp,
  type AnswerSubmission, type AttemptRecord, type Grade, type ItemId, type Question,
  type SessionKind, type SessionState, type Settings, type SeriesScreen, type SeriesState,
} from '@/domain';
import type { Database } from '@/persistence/ports';
import type { ContentLibrary } from '@/content/ports';
import type { GradeDetail } from '@/learning/grading/grader';
import { toleranceForSubmission } from '@/handwriting/tolerance';
import type { GradingContext, ContextualGrader } from '@/learning/grading/ports';
import type {
  Generator, GenerationContext, Scheduler, SelectedTarget, SessionEngine, Selector,
} from '@/learning/ports';
import type { Transaction } from '@/persistence/ports';
import { XpLedger } from '@/learning/xp';
import { policyFromSettings } from '@/learning/selection/selector';
import { planRevisit } from '@/learning/selection/revisit';
import { buildGenerationPool, audioLookup } from './pool';
import { placementTargetsFor } from './placement';

/** The grader dependency this engine actually needs: grade() plus the richer
 * gradeDetailed() KanseiGrader provides, which the shared ContextualGrader
 * port does not declare (it is additive, KanseiGrader-specific API). */
export interface DetailedGrader extends ContextualGrader {
  gradeDetailed(question: Question, submission: AnswerSubmission, context?: GradingContext): Promise<GradeDetail>;
}

/**
 * The session engine.
 *
 * Owns the ten-screen structure and wires the four independent engines
 * (scheduler, selector, generator, grader) plus the XP ledger together behind
 * ONE transaction per graded screen. Nothing here decides WHEN a pair is due,
 * WHICH pairs make a series, or HOW a pair is asked about — it calls the
 * modules that do, in order, and persists the result.
 *
 * GENERATION TIMING. `SeriesState.screens` is fully populated (10 concrete
 * `Question`s) as soon as a series starts, not generated lazily screen by
 * screen. `selector.select()` decides the ORDER and MIX for the whole series
 * at once — that decision genuinely needs the whole series in view (the
 * interleaving guard compares each target against its neighbours). Delayed
 * revisits are therefore implemented as a REPLACEMENT: when an error is
 * graded on screen N, `planRevisit` computes which later, not-yet-reached
 * screen should carry the revisit, and that screen's target and question are
 * regenerated in place. A screen the learner has already reached is never
 * touched. When no room remains in the current series the revisit is queued
 * onto the NEXT series' opening screens instead (see `startSeries`); a
 * standalone standard session (kind 'standard', one series) has no next
 * series to defer to, and the revisit is simply not re-asked this session —
 * it will still surface the next time the item comes due, since its
 * scheduler state already reflects the lapse.
 */

export interface SessionEngineDeps {
  db: Database;
  content: ContentLibrary;
  scheduler: Scheduler;
  /**
   * `DefaultSelector` is bound to one transaction's `skills`/`confusions`
   * repos (they are only ever valid for that transaction's lifetime — see
   * repos.ts's TxScope), so the engine cannot hold a single long-lived
   * `Selector` instance the way it does the scheduler and generator. This
   * factory builds a fresh one from whichever transaction is currently open.
   */
  createSelector: (tx: Transaction) => Selector;
  generator: Generator;
  grader: DetailedGrader;
  /** Current settings. Read fresh on every call, since a session can span a settings change. */
  getSettings: () => Settings;
  /** Non-seeded in production; a seeded generator in tests for determinism. */
  random?: () => number;
}

const SCHEMA_VERSION = 1;

export class KanseiSessionEngine implements SessionEngine {
  private readonly ledger = new XpLedger();
  private current: SessionState | null = null;

  constructor(private readonly deps: SessionEngineDeps) {}

  private random(): number {
    return this.deps.random ? this.deps.random() : Math.random();
  }

  async start(opts: {
    kind: SessionKind;
    seriesCount: 1 | 2 | 3;
    focusItemId?: ItemId | null;
    now: Date;
  }): Promise<SessionState> {
    const existing = await this.resume();
    if (existing) {
      this.current = existing;
      return existing;
    }

    const s = stamp(opts.now);
    const settings = this.deps.getSettings();
    // A placement check is a one-off sample, never a linked round: forcing
    // seriesCount to 1 here means a caller can never accidentally ask for a
    // multi-series placement, which buildSeries()'s placement branch does not
    // model (it always resamples the same even spread across the curriculum).
    const seriesCount = opts.kind === 'placement' ? 1 : opts.seriesCount;
    const session: SessionState = {
      id: asSessionId(`sess_${opts.now.getTime().toString(36)}_${Math.floor(this.random() * 1e9).toString(36)}`),
      kind: opts.kind,
      seriesCount,
      status: 'active',
      series: [],
      activeSeriesIndex: 0,
      startedAt: s.at,
      endedAt: null,
      localDate: s.localDate,
      timeZone: s.timeZone,
      utcOffsetMinutes: s.utcOffsetMinutes,
      focusItemId: opts.focusItemId ?? null,
      enabledQuestionTypes: settings.enabledQuestionTypes,
      silentMode: settings.silentPractice,
      keyboardOnlyMode: settings.keyboardOnlyMode,
      activeMs: 0,
      version: SCHEMA_VERSION,
    };

    const first = await this.buildSeries(session, 0, [], opts.now, opts.focusItemId ?? null);
    session.series.push(first);

    await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));
    this.current = session;
    return session;
  }

  async resume(): Promise<SessionState | undefined> {
    const active = await this.deps.db.transact('readonly', (tx) => tx.sessions.active());
    if (active) this.current = active;
    return active;
  }

  private requireCurrent(): SessionState {
    if (!this.current) throw new Error('No active session. Call start() or resume() first.');
    return this.current;
  }

  private busy = false;

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('A session operation is already in progress.');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }

  /** Compare inside the write transaction: another tab may have advanced. */
  private async assertCurrent(tx: Transaction, original: SessionState): Promise<void> {
    const stored = await tx.sessions.get(original.id);
    if (JSON.stringify(stored) !== JSON.stringify(original)) {
      throw new Error('This session changed in another tab. Resume it before continuing.');
    }
  }

  private screenOf(session: SessionState): { series: SeriesState; screen: SeriesScreen } {
    if (session.status !== 'active') throw new Error('This session is no longer active.');
    const series = session.series[session.activeSeriesIndex];
    const screen = series?.screens[series.cursor];
    if (!series || !screen) throw new Error('Session cursor is out of range.');
    return { series, screen };
  }

  async submit(submission: AnswerSubmission, now: Date): Promise<{ grade: Grade; xpAwarded: number; offerRetry: boolean }> {
    return this.exclusive(async () => {
      const original = this.requireCurrent();
      const session = structuredClone(original);
      const { series, screen } = this.screenOf(session);
      if (submission.questionId !== screen.question.id) throw new Error('Answer belongs to a different question.');
      if (screen.result) throw new Error('This screen already has a first-attempt result; use submitRetry.');
      const detail = await this.deps.grader.gradeDetailed(screen.question, submission, { attemptOrdinal: 0, tolerance: submission.canvasPx ? toleranceForSubmission(submission.canvasPx, (submission.strokes ?? []).map(s => s.pointerType)) : undefined });
      const s = stamp(now);
      const record = this.buildAttemptRecord(session, screen.question, submission, detail.grade, 0, s);
      screen.result = { submission, grade: detail.grade, at: s.at };
      session.activeMs += submission.elapsedMs;
      // Asset/generator work must finish BEFORE opening an IndexedDB transaction.
      if (detail.grade.outcome === 'incorrect') await this.queueRevisit(series, screen, now);
      await this.deps.db.transact('readwrite', async (tx) => {
        await this.assertCurrent(tx, original);
        await tx.attempts.append(record);
        const existing = await tx.skills.get(record.itemId, record.skill, record.readingId);
        const state = existing ?? this.deps.scheduler.initial(record.itemId, record.skill, record.readingId, now);
        // The scheduler itself handles uncertainty without a memory penalty.
        await tx.skills.put(this.deps.scheduler.update(state, record, now));
        if (record.confusedWithItemId) await tx.confusions.record(record.itemId, record.confusedWithItemId, record.skill, s.at);
        if (detail.copiedVisibleRomaji || specExercisesIme(screen.question)) {
          const aux = await tx.auxiliary.get();
          await tx.auxiliary.put({
            ...aux,
            copiedVisibleRomaji: aux.copiedVisibleRomaji + Number(detail.copiedVisibleRomaji),
            imeQuestions: aux.imeQuestions + Number(specExercisesIme(screen.question)),
            imeCorrect: aux.imeCorrect + Number(specExercisesIme(screen.question) && detail.grade.outcome === 'correct'),
            lastAt: s.at,
          });
        }
        await tx.sessions.save(session);
      });
      Object.assign(original, session);
      return { grade: detail.grade, xpAwarded: 0, offerRetry: detail.grade.outcome !== 'correct' && !submission.declined };
    });
  }

  async submitRetry(submission: AnswerSubmission, now: Date): Promise<{ grade: Grade }> {
    return this.exclusive(async () => {
      const original = this.requireCurrent();
      const session = structuredClone(original);
      const { screen } = this.screenOf(session);
      if (submission.questionId !== screen.question.id) throw new Error('Answer belongs to a different question.');
      if (!screen.result) throw new Error('Cannot retry a screen with no first-attempt result.');
      const ordinal = screen.retries.length + 1;
      const detail = await this.deps.grader.gradeDetailed(screen.question, submission, { attemptOrdinal: ordinal, tolerance: submission.canvasPx ? toleranceForSubmission(submission.canvasPx, (submission.strokes ?? []).map(s => s.pointerType)) : undefined });
      const s = stamp(now);
      const record = this.buildAttemptRecord(session, screen.question, submission, detail.grade, ordinal, s);
      screen.retries.push({ submission, grade: detail.grade, at: s.at });
      await this.deps.db.transact('readwrite', async (tx) => {
        await this.assertCurrent(tx, original);
        await tx.attempts.append(record);
        if (record.confusedWithItemId) await tx.confusions.record(record.itemId, record.confusedWithItemId, record.skill, s.at);
        await tx.sessions.save(session);
      });
      Object.assign(original, session);
      return { grade: detail.grade };
    });
  }

  async advance(now: Date): Promise<{ state: SessionState; finished: boolean }> {
    return this.exclusive(async () => {
      const original = this.requireCurrent();
      if (original.status === 'completed') return { state: original, finished: true };
      const session = structuredClone(original);
      const { series, screen } = this.screenOf(session);
      if (!screen.result) throw new Error('Cannot advance past a screen with no result.');
      screen.feedbackAcknowledged = true;
      const last = series.cursor === SERIES_LENGTH - 1;
      if (!last) series.cursor += 1;
      else if (session.activeSeriesIndex + 1 < (session.seriesCount ?? 1)) {
        const carried = series.revisitQueue.filter((r) => r.afterScreenIndex >= SERIES_LENGTH - 1);
        session.series.push(await this.buildSeries(session, session.activeSeriesIndex + 1, carried, now, session.focusItemId));
        session.activeSeriesIndex += 1;
      } else {
        session.status = 'completed';
        session.endedAt = now.toISOString();
      }
      const input = {
        sessionId: session.id, seriesIndex: series.index, now,
        timeZone: stamp(now).timeZone, goalXp: this.deps.getSettings().dailyGoalXp,
      };
      await this.deps.db.transact('readwrite', async (tx) => {
        await this.assertCurrent(tx, original);
        const award = await this.ledger.awardScreen(tx, {
          ...input, screenIndex: screen.index, activeMs: screen.result!.submission.elapsedMs,
        });
        screen.xpAwarded += award.amount;
        if (last) {
          await this.ledger.awardSeriesCompletion(tx, { ...input, activeMs: 0 });
          series.completionBonusAwarded = true;
          series.completedAt = now.toISOString();
        }
        await tx.sessions.save(session);
      });
      Object.assign(original, session);
      return { state: original, finished: session.status === 'completed' };
    });
  }

  async abandon(now: Date): Promise<void> {
    return this.exclusive(async () => {
      const original = this.requireCurrent();
      const session = structuredClone(original);
      session.status = 'abandoned';
      session.endedAt = now.toISOString();
      await this.deps.db.transact('readwrite', async (tx) => {
        await this.assertCurrent(tx, original);
        await tx.sessions.save(session);
      });
      this.current = null;
    });
  }

  // ---- Series construction --------------------------------------------

  private async buildSeries(
    session: SessionState,
    index: number,
    carriedRevisits: SeriesState['revisitQueue'],
    now: Date,
    focusItemId: ItemId | null,
  ): Promise<SeriesState> {
    const settings = this.deps.getSettings();
    const ctx = this.generationContext(settings, now);

    let targets: SelectedTarget[];
    if (session.kind === 'placement') {
      // The optional placement check samples recognition only, evenly across
      // taught hiragana/katakana, and skips the due/weak/new-material mix
      // entirely — see placement.ts for why, and its scope limits.
      targets = placementTargetsFor([...this.deps.content.kana('hiragana'), ...this.deps.content.kana('katakana')]);
      if (targets.length === 0) {
        throw new Error('No installed kana to build a placement check from.');
      }
    } else {
      const policy = policyFromSettings(settings);
      const allowedSkills = this.allowedSkillsFor(session);
      const selection = await this.deps.db.transact('readonly', (tx) =>
        this.deps.createSelector(tx).select({
          policy,
          screens: SERIES_LENGTH,
          now,
          settings,
          focusItemId,
          allowedSkills,
          exclude: [],
        }),
      );
      targets = selection.targets as SelectedTarget[];
    }

    const screens: SeriesScreen[] = [];
    for (let i = 0; i < SERIES_LENGTH; i += 1) {
      const target = targets[i];
      if (!target) {
        throw new Error(`Selector returned ${targets.length} targets; a series needs exactly ${SERIES_LENGTH}.`);
      }
      const question = await this.generateOrFallback(target, ctx);
      screens.push({ index: i, question, result: null, retries: [], feedbackAcknowledged: false, xpAwarded: 0 });
    }

    // Seed carried-over revisits from a prior series onto this one's early
    // screens, respecting the same minimum-gap rule from the series start.
    const carriedSlots: number[] = [];
    for (const carried of carriedRevisits) {
      const plan = planRevisit({
        itemId: carried.itemId,
        skill: carried.skill ?? 'recognition',
        erroredAtScreenIndex: -1,
        seriesLength: SERIES_LENGTH,
        occupiedScreenIndexes: carriedSlots,
      });
      if (plan.screenIndex !== null) {
        const replacement = await this.generateOrFallback(
          { itemId: carried.itemId, readingId: carried.readingId ?? null, skill: carried.skill ?? 'recognition', reason: 'confusion-repair', state: null, confusion: null },
          ctx,
        );
        const slot = screens[plan.screenIndex];
        if (slot) slot.question = replacement;
        carriedSlots.push(plan.screenIndex);
      }
    }

    return { index, screens, cursor: 0, revisitQueue: [], completedAt: null, completionBonusAwarded: false };
  }

  private allowedSkillsFor(session: SessionState) {
    const all: Array<Question['skill']> = ['recognition', 'readingRecall', 'listening', 'handwriting'];
    return all.filter((s) => !(session.silentMode && s === 'listening') && !(session.keyboardOnlyMode && s === 'handwriting'));
  }

  private generationContext(settings: Settings, now: Date): GenerationContext {
    const library = this.deps.content;
    return {
      now,
      settings,
      pool: buildGenerationPool(library),
      hasAudio: (key) => library.hasAudio(key),
      audio: audioLookup(library),
      hasStrokes: (glyph) => library.hasStrokes(glyph),
      random: () => this.random(),
    };
  }

  /**
   * Generate a question for a target, trying up to a few alternative targets
   * (same reason, drawn from a fresh single-slot selection) if the first
   * choice cannot produce a safe question — e.g. its only audio is missing.
   * Throws only if content is thin enough that no substitute exists either,
   * which is an honest failure rather than a silently short series.
   */
  private async generateOrFallback(target: SelectedTarget, ctx: GenerationContext): Promise<Question> {
    const first = await this.deps.generator.generate(target, ctx);
    if (first.question) return first.question;

    // One fallback: the same item, forced to 'recognition', which every
    // applicable item supports if it supports anything at all.
    const fallbackTarget: SelectedTarget = { ...target, skill: 'recognition', readingId: null };
    const fallback = await this.deps.generator.generate(fallbackTarget, ctx);
    if (fallback.question) return fallback.question;

    throw new Error(
      `Could not generate a question for ${String(target.itemId)} (${target.skill}): ${first.rejected ?? 'no reason given'}`,
    );
  }

  private async queueRevisit(series: SeriesState, screen: SeriesScreen, now: Date): Promise<void> {
    const plan = planRevisit({
      itemId: screen.question.targetItemId,
      skill: screen.question.skill,
      readingId: screen.question.targetReadingId,
      erroredAtScreenIndex: screen.index,
      seriesLength: SERIES_LENGTH,
      occupiedScreenIndexes: series.revisitQueue.map((r) => r.afterScreenIndex + 1),
    });
    series.revisitQueue.push({ skill: screen.question.skill, readingId: screen.question.targetReadingId, itemId: screen.question.targetItemId, afterScreenIndex: plan.afterScreenIndex, reason: plan.reason });

    if (plan.screenIndex !== null && plan.screenIndex > series.cursor) {
      const target: SelectedTarget = {
        itemId: screen.question.targetItemId,
        readingId: screen.question.targetReadingId,
        skill: screen.question.skill,
        reason: 'confusion-repair',
        state: null,
        confusion: null,
      };
      const ctx = this.generationContext(this.deps.getSettings(), now);
      const result = await this.deps.generator.generate(target, ctx);
      const slot = series.screens[plan.screenIndex];
      if (result.question && slot && !slot.result) slot.question = result.question;
    }
  }

  private buildAttemptRecord(
    session: SessionState,
    question: Question,
    submission: AnswerSubmission,
    grade: Grade,
    ordinal: number,
    s: ReturnType<typeof stamp>,
  ): AttemptRecord {
    return {
      id: `att_${s.at}_${Math.floor(this.random() * 1e9).toString(36)}`,
      sessionId: session.id,
      questionId: question.id,
      itemId: question.targetItemId,
      readingId: question.targetReadingId,
      skill: question.skill,
      questionType: question.type,
      direction: question.direction,
      evidence: question.evidence,
      selectionReason: question.selectionReason,
      focusedPractice: question.focusedPractice,
      attemptOrdinal: ordinal,
      outcome: grade.outcome,
      unaidedFirstAttempt: grade.unaidedFirstAttempt,
      declined: submission.declined,
      hintsUsed: submission.hintsUsed,
      audioReplays: submission.audioReplays,
      elapsedMs: submission.elapsedMs,
      inputMethod: submission.inputMethod,
      imeUsed: submission.imeUsed,
      answerGiven: submission.normalisedInput ?? submission.chosenOptionKey,
      confusedWithItemId: grade.confusedWith,
      at: s.at,
      localDate: s.localDate,
      timeZone: s.timeZone,
      utcOffsetMinutes: s.utcOffsetMinutes,
      handwriting: grade.handwriting
        ? {
            confidence: grade.handwriting.confidence,
            uncertain: grade.handwriting.uncertain,
            strokeCountOk: grade.handwriting.strokeCount.status === 'ok',
            strokeOrderOk: grade.handwriting.strokeOrder.status === 'ok',
            shapeScore: grade.handwriting.shape.score,
            pointerType: submission.strokes?.[0]?.pointerType ?? 'unknown',
            strokeCountGiven: submission.strokes?.length ?? 0,
            strokeCountExpected: submission.strokes?.length ?? 0,
          }
        : null,
    };
  }
}

/** True when this question's format exercises IME input, per its own spec. */
function specExercisesIme(question: Question): boolean {
  // Deliberately duplicated rather than importing specFor here: session/
  // depends on learning/generation only for this one flag, and the question
  // already carries everything else it needs. Kept in sync by
  // generation/specs.ts being the single authored source; see its README.
  return question.type === 'audio-to-typed' || question.type === 'word-reading' || question.type === 'kanji-in-word-context';
}
