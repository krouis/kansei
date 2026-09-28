import {
  SERIES_LENGTH, asSessionId, stamp,
  type AnswerSubmission, type AttemptRecord, type Grade, type ItemId, type Question,
  type SessionKind, type SessionState, type Settings, type SeriesScreen, type SeriesState,
} from '@/domain';
import type { Database } from '@/persistence/ports';
import type { ContentLibrary } from '@/content/ports';
import type { GradeDetail } from '@/learning/grading/grader';
import type { ContextualGrader } from '@/learning/grading/ports';
import type {
  Generator, GenerationContext, Scheduler, SelectedTarget, SessionEngine, Selector,
} from '@/learning/ports';
import type { Transaction } from '@/persistence/ports';
import { XpLedger } from '@/learning/xp';
import { policyFromSettings } from '@/learning/selection/selector';
import { planRevisit } from '@/learning/selection/revisit';
import { buildGenerationPool, audioLookup } from './pool';

/** The grader dependency this engine actually needs: grade() plus the richer
 * gradeDetailed() KanseiGrader provides, which the shared ContextualGrader
 * port does not declare (it is additive, KanseiGrader-specific API). */
export interface DetailedGrader extends ContextualGrader {
  gradeDetailed(question: Question, submission: AnswerSubmission, context?: { attemptOrdinal?: number }): Promise<GradeDetail>;
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
    const session: SessionState = {
      id: asSessionId(`sess_${opts.now.getTime().toString(36)}_${Math.floor(this.random() * 1e9).toString(36)}`),
      kind: opts.kind,
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

    // seriesCount is stored implicitly as session.series.length once every
    // series has been started; only the first is built now, matching the
    // lazy-per-series generation this engine uses (see the class doc comment).
    const first = await this.buildSeries(session, 0, [], opts.now, opts.focusItemId ?? null);
    session.series.push(first);

    await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));
    this.current = session;
    // Stash the requested total so startNextSeries knows when to stop.
    seriesTargets.set(session.id, opts.seriesCount);
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

  private currentScreen(): { series: SeriesState; screen: SeriesScreen } {
    const session = this.requireCurrent();
    const series = session.series[session.activeSeriesIndex];
    if (!series) throw new Error('Active series index is out of range.');
    const screen = series.screens[series.cursor];
    if (!screen) throw new Error('Series cursor is out of range.');
    return { series, screen };
  }

  async submit(submission: AnswerSubmission, now: Date): Promise<{ grade: Grade; xpAwarded: number; offerRetry: boolean }> {
    const session = this.requireCurrent();
    const { series, screen } = this.currentScreen();
    if (screen.result) {
      throw new Error('This screen already has a first-attempt result; use submitRetry for a corrected retry.');
    }

    const detail = await this.deps.grader.gradeDetailed(screen.question, submission, { attemptOrdinal: 0 });
    const s = stamp(now);
    const record = this.buildAttemptRecord(session, screen.question, submission, detail.grade, 0, s);

    let xpAwarded = 0;
    await this.deps.db.transact('readwrite', async (tx) => {
      await tx.attempts.append(record);

      // The scheduler only ever sees the graded FIRST attempt — a corrected
      // retry must never look like unaided recall to it.
      if (record.outcome !== 'uncertain') {
        const stateKey = { itemId: record.itemId, skill: record.skill, readingId: record.readingId };
        const existing = await tx.skills.get(stateKey.itemId, stateKey.skill, stateKey.readingId);
        const state = existing ?? this.deps.scheduler.initial(stateKey.itemId, stateKey.skill, stateKey.readingId, now);
        const updated = this.deps.scheduler.update(state, record, now);
        await tx.skills.put(updated);
      } else {
        // 'uncertain' leaves memory state untouched but still needs a row to
        // exist so a near-term recheck can be scheduled from SOMETHING; create
        // one at its current (possibly unseen) state if none exists yet.
        const existing = await tx.skills.get(record.itemId, record.skill, record.readingId);
        if (!existing) {
          await tx.skills.put(this.deps.scheduler.initial(record.itemId, record.skill, record.readingId, now));
        }
      }

      if (record.confusedWithItemId) {
        await tx.confusions.record(record.itemId, record.confusedWithItemId, record.skill, s.at);
      }

      if (detail.copiedVisibleRomaji) {
        const aux = await tx.auxiliary.get();
        await tx.auxiliary.put({ ...aux, copiedVisibleRomaji: aux.copiedVisibleRomaji + 1, lastAt: s.at });
      }
      if (specExercisesIme(screen.question)) {
        const aux = await tx.auxiliary.get();
        await tx.auxiliary.put({
          ...aux,
          imeQuestions: aux.imeQuestions + 1,
          imeCorrect: aux.imeCorrect + (detail.grade.outcome === 'correct' ? 1 : 0),
          lastAt: s.at,
        });
      }

      const award = await this.ledger.awardScreen(tx, {
        sessionId: session.id,
        seriesIndex: series.index,
        screenIndex: screen.index,
        now,
        timeZone: s.timeZone,
        goalXp: this.deps.getSettings().dailyGoalXp,
        activeMs: submission.elapsedMs,
      });
      xpAwarded = award.amount;
    });

    screen.result = { submission, grade: detail.grade, at: s.at };
    screen.xpAwarded += xpAwarded;
    session.activeMs += submission.elapsedMs;

    if (detail.grade.outcome === 'incorrect') {
      this.queueRevisit(series, screen, now);
    }

    await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));

    const offerRetry = detail.grade.outcome !== 'correct' && !submission.declined;
    return { grade: detail.grade, xpAwarded, offerRetry };
  }

  async submitRetry(submission: AnswerSubmission, now: Date): Promise<{ grade: Grade }> {
    const session = this.requireCurrent();
    const { screen } = this.currentScreen();
    if (!screen.result) throw new Error('Cannot retry a screen with no first-attempt result.');

    const ordinal = screen.retries.length + 1;
    const detail = await this.deps.grader.gradeDetailed(screen.question, submission, { attemptOrdinal: ordinal });
    const s = stamp(now);
    const record = this.buildAttemptRecord(session, screen.question, submission, detail.grade, ordinal, s);

    // Recorded for history and for confusion statistics, but deliberately NOT
    // folded into the scheduler: an immediate corrected retry is answered with
    // the mistake still fresh, which is not equivalent to unaided delayed
    // recall, and must never inflate the pair's memory state.
    await this.deps.db.transact('readwrite', async (tx) => {
      await tx.attempts.append(record);
      if (record.confusedWithItemId) {
        await tx.confusions.record(record.itemId, record.confusedWithItemId, record.skill, s.at);
      }
    });

    screen.retries.push({ submission, grade: detail.grade, at: s.at });
    await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));
    return { grade: detail.grade };
  }

  async advance(now: Date): Promise<{ state: SessionState; finished: boolean }> {
    const session = this.requireCurrent();
    const series = session.series[session.activeSeriesIndex];
    if (!series) throw new Error('Active series index is out of range.');
    const screen = series.screens[series.cursor];
    if (!screen) throw new Error('Series cursor is out of range.');
    if (!screen.result) throw new Error('Cannot advance past a screen with no result.');
    screen.feedbackAcknowledged = true;

    // Defensive re-bank: normally already credited in submit(); idempotent via
    // the dedupe key, so this only does anything if that first bank was lost
    // to an interruption between submit() and this call.
    if (screen.xpAwarded === 0) {
      const s = stamp(now);
      let awarded = 0;
      await this.deps.db.transact('readwrite', async (tx) => {
        const award = await this.ledger.awardScreen(tx, {
          sessionId: session.id, seriesIndex: series.index, screenIndex: screen.index,
          now, timeZone: s.timeZone, goalXp: this.deps.getSettings().dailyGoalXp, activeMs: 0,
        });
        awarded = award.amount;
      });
      screen.xpAwarded += awarded;
    }

    const isLastScreen = series.cursor === SERIES_LENGTH - 1;
    if (!isLastScreen) {
      series.cursor += 1;
      await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));
      return { state: session, finished: false };
    }

    // Series complete: bank the completion bonus once.
    if (!series.completionBonusAwarded) {
      const s = stamp(now);
      let fresh = false;
      await this.deps.db.transact('readwrite', async (tx) => {
        const award = await this.ledger.awardSeriesCompletion(tx, {
          sessionId: session.id, seriesIndex: series.index, now, timeZone: s.timeZone,
          goalXp: this.deps.getSettings().dailyGoalXp, activeMs: 0,
        });
        fresh = award.fresh;
      });
      series.completionBonusAwarded = fresh || series.completionBonusAwarded;
      series.completedAt = s.at;
    }

    const targetSeriesCount = seriesTargets.get(session.id) ?? 1;
    const hasMoreSeries = session.activeSeriesIndex + 1 < targetSeriesCount;
    if (hasMoreSeries) {
      const carried = series.revisitQueue.filter((r) => r.afterScreenIndex >= SERIES_LENGTH - 1);
      const next = await this.buildSeries(session, session.activeSeriesIndex + 1, carried, now, session.focusItemId);
      session.series.push(next);
      session.activeSeriesIndex += 1;
      await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));
      return { state: session, finished: false };
    }

    session.status = 'completed';
    session.endedAt = stamp(now).at;
    await this.deps.db.transact('readwrite', (tx) => tx.sessions.save(session));
    seriesTargets.delete(session.id);
    return { state: session, finished: true };
  }

  async abandon(now: Date): Promise<void> {
    const session = this.requireCurrent();
    const s = stamp(now);
    session.status = 'abandoned';
    session.endedAt = s.at;
    await this.deps.db.transact('readwrite', (tx) => tx.sessions.markAbandoned(session.id, s.at));
    seriesTargets.delete(session.id);
    this.current = null;
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

    const targets = selection.targets as SelectedTarget[];
    const ctx = this.generationContext(settings, now);

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
    for (const carried of carriedRevisits) {
      const plan = planRevisit({
        itemId: carried.itemId,
        skill: 'recognition', // Cross-series carry-over does not track the original skill; see README.
        erroredAtScreenIndex: -1,
        seriesLength: SERIES_LENGTH,
        occupiedScreenIndexes: [],
      });
      if (plan.screenIndex !== null) {
        const replacement = await this.generateOrFallback(
          { itemId: carried.itemId, readingId: null, skill: 'recognition', reason: 'confusion-repair', state: null, confusion: null },
          ctx,
        );
        const slot = screens[plan.screenIndex];
        if (slot) slot.question = replacement;
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

  private queueRevisit(series: SeriesState, screen: SeriesScreen, now: Date): void {
    void now;
    const plan = planRevisit({
      itemId: screen.question.targetItemId,
      skill: screen.question.skill,
      readingId: screen.question.targetReadingId,
      erroredAtScreenIndex: screen.index,
      seriesLength: SERIES_LENGTH,
      occupiedScreenIndexes: series.revisitQueue.map((r) => r.afterScreenIndex + 1),
    });
    series.revisitQueue.push({ itemId: screen.question.targetItemId, afterScreenIndex: plan.afterScreenIndex, reason: plan.reason });

    if (plan.screenIndex !== null && plan.screenIndex > series.cursor) {
      const target: SelectedTarget = {
        itemId: screen.question.targetItemId,
        readingId: screen.question.targetReadingId,
        skill: screen.question.skill,
        reason: 'confusion-repair',
        state: null,
        confusion: null,
      };
      const ctx = this.generationContext(this.deps.getSettings(), new Date());
      // Fire-and-forget replacement is deliberately awaited by the caller of
      // advance()/submit() via the queueMicrotask below is NOT used — this is
      // synchronous state mutation territory, so we schedule the regeneration
      // inline the next time buildSeries would have looked at it. Since
      // screens are pre-generated, mutate the slot directly and asynchronously
      // update it before the learner can reach it (screens ahead of cursor are
      // never shown until reached).
      void this.deps.generator.generate(target, ctx).then((result) => {
        if (result.question) {
          const slot = series.screens[plan.screenIndex as number];
          if (slot && !slot.result) slot.question = result.question;
        }
      });
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

/** Session id → requested series count. In-memory only; not part of persisted state. */
const seriesTargets = new Map<string, number>();
