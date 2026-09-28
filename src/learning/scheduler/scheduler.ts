/**
 * The Kansei scheduler: FSRS-5 plus the rules FSRS does not cover.
 *
 * Responsibility is exactly one thing — WHEN an (item, skill) pair is next
 * reviewed. It does not choose what to ask, it does not choose the format, and
 * it does not decide what the learner sees next. Everything it knows about an
 * attempt arrives in the AttemptRecord.
 *
 * What is Kansei's rather than FSRS's, and why:
 *
 *  - An inconclusive handwriting assessment is not a lapse (see `update`).
 *  - Weak evidence is capped twice: once as a rating ceiling (rating.ts) and once
 *    as a hard limit on interval growth, so four-option recognition can never
 *    run the schedule out to weeks on its own.
 *  - Response time is judged per input method against the pair's own history and
 *    can only ever help (rating.ts).
 *  - A leech gets a floor under its interval instead of an ever-shrinking one.
 *  - Every interval is capped, including for a "Retained" pair: nothing is ever
 *    retired, because a kana you have not seen in six months is a kana you may
 *    well have lost.
 *  - Randomness is injected. There is no Math.random() in this module, so a
 *    session replay in a test produces byte-identical schedules.
 */

import { localDateIn } from '@/domain';
import type { AttemptRecord, EvidenceStrength, ItemId, Skill, SkillState } from '@/domain';
import type { Scheduler } from '@/learning/ports';
import {
  FSRS5_DEFAULT_WEIGHTS,
  initialDifficulty,
  initialStability,
  intervalDaysForStability,
  nextDifficulty,
  nextForgetStability,
  nextRecallStability,
  retrievability as retrievabilityAt,
  shortTermStability,
  type FsrsWeights,
} from './fsrs';
import { assessLeech } from './leech';
import { count, humaniseDays } from './phrasing';
import { EVIDENCE_RANK, deriveRating } from './rating';
import { stageFor } from './stages';

const MS_PER_DAY = 86_400_000;

export interface SchedulerTuning {
  /**
   * Target probability of recall at review time.
   *
   * 0.90 is FSRS's own default and is kept deliberately. Lower retention (0.85)
   * buys fewer reviews at the cost of more forgetting, which is the wrong trade
   * for a beginner: forgetting a kana is not a small setback, it blocks reading
   * the next word. Higher retention (0.95) roughly doubles review load for a few
   * points of accuracy, which is how a daily habit dies.
   */
  requestedRetention: number;
  /**
   * Nothing is ever retired. Six months is the longest Kansei will wait before
   * checking even a thoroughly retained character; a year would mean a learner
   * could "hold" a curriculum they can no longer read.
   */
  maxIntervalDays: number;
  /** A success never schedules sooner than the next day. */
  minSuccessIntervalDays: number;
  /** Where a lapse lands: soon, but not so soon it blocks the rest of a session. */
  relearnIntervalDays: number;
  /** A lapse never pushes the next look beyond this. */
  maxLapseIntervalDays: number;
  /**
   * Floor for a detected leech. The interval stops shrinking here, because more
   * of the same question is not the remedy (see leech.ts).
   */
  leechMinIntervalDays: number;
  /**
   * An inconclusive attempt schedules a near-term recheck instead of a lapse.
   * Short enough to happen in the same sitting, since the point is to get a
   * decidable answer while the learner is still there.
   */
  uncertainRecheckDays: number;
  /**
   * Hard cap on interval growth from a WEAK-evidence success, as a multiple of
   * the previous interval. Chosen with FSRS's 'hard' multiplier in mind: the two
   * together mean recognition-only practice creeps forward instead of leaping.
   */
  weakEvidenceGrowthCap: number;
  /** Documented ±5% fuzz, so reviews learned together do not clump for ever. */
  fuzzFraction: number;
  /** Below this, fuzz is pointless noise on an already-short interval. */
  fuzzMinIntervalDays: number;
  fastFractionOfMedian: number;
  minAttemptsForSpeedBonus: number;
  /**
   * Step size, as a fraction of the current estimate, for the running median of
   * response times. See `updateMedianEstimate` — this is an online estimator, not
   * an exact median.
   */
  medianStepFraction: number;
}

export const DEFAULT_TUNING: SchedulerTuning = {
  requestedRetention: 0.9,
  maxIntervalDays: 180,
  minSuccessIntervalDays: 1,
  relearnIntervalDays: 10 / (24 * 60),
  maxLapseIntervalDays: 1,
  leechMinIntervalDays: 1,
  uncertainRecheckDays: 5 / (24 * 60),
  weakEvidenceGrowthCap: 1.6,
  fuzzFraction: 0.05,
  fuzzMinIntervalDays: 1,
  fastFractionOfMedian: 0.6,
  minAttemptsForSpeedBonus: 3,
  medianStepFraction: 0.1,
};

export interface FsrsSchedulerOptions {
  /**
   * Injected randomness for interval fuzz. Required, not optional: a default of
   * Math.random would make every test that touches an interval flaky, and the
   * one thing worse than a clumped schedule is an untestable one.
   */
  random: () => number;
  weights?: FsrsWeights;
  tuning?: Partial<SchedulerTuning>;
}

/**
 * Online median estimate — deliberately NOT a mean.
 *
 * SkillState keeps one number per input method, not the sample, so an exact
 * median is impossible without storing every response time for every pair.
 * This is the standard stochastic approximation: step toward the sample by a
 * fraction of the current estimate. It converges on the median rather than the
 * mean, which matters because response times have a long right tail (the learner
 * was interrupted, the phone rang) and a mean would drift upward for ever.
 */
export function updateMedianEstimate(
  current: number | undefined,
  sampleMs: number,
  stepFraction: number,
): number {
  if (sampleMs <= 0) return current ?? 0;
  if (current === undefined || current <= 0) return sampleMs;
  const step = Math.max(1, current * stepFraction);
  if (sampleMs > current) return current + step;
  if (sampleMs < current) return Math.max(1, current - step);
  return current;
}

const rankOf = (e: 'none' | EvidenceStrength): number => EVIDENCE_RANK[e];

function strongestEvidence(
  current: SkillState['strongestEvidencePassed'],
  achieved: EvidenceStrength,
): SkillState['strongestEvidencePassed'] {
  return rankOf(achieved) > rankOf(current) ? achieved : current;
}

export function createFsrsScheduler(options: FsrsSchedulerOptions): Scheduler {
  const w = options.weights ?? FSRS5_DEFAULT_WEIGHTS;
  const t: SchedulerTuning = { ...DEFAULT_TUNING, ...options.tuning };
  const speedRules = {
    fastFractionOfMedian: t.fastFractionOfMedian,
    minAttemptsForSpeedBonus: t.minAttemptsForSpeedBonus,
  };

  /** ±fuzzFraction, from the injected RNG. Short intervals are left alone. */
  const fuzz = (days: number): number => {
    if (days < t.fuzzMinIntervalDays) return days;
    const factor = 1 + (options.random() * 2 - 1) * t.fuzzFraction;
    return days * factor;
  };

  const dueFrom = (now: Date, intervalDays: number): string =>
    new Date(now.getTime() + intervalDays * MS_PER_DAY).toISOString();

  return {
    id: 'fsrs-5-kansei',
    version: '1.0.0',

    initial(itemId: ItemId, skill: Skill, readingId: string | null, now: Date): SkillState {
      return {
        itemId,
        skill,
        readingId,
        stage: 'unseen',
        // Zero means "no model yet". The first graded attempt seeds S₀ and D₀
        // from the rating; there is no prior to invent before then.
        stability: 0,
        difficulty: 0,
        streak: 0,
        spacedSuccesses: 0,
        totalAttempts: 0,
        unaidedFirstAttemptCorrect: 0,
        aidedAttempts: 0,
        lapses: 0,
        firstSeenAt: null,
        lastReviewedAt: null,
        lastUnaidedSuccessAt: null,
        // An unseen pair is eligible from the moment it exists; whether it is
        // actually introduced is the selector's decision, not the scheduler's.
        dueAt: now.toISOString(),
        lastIntervalDays: 0,
        medianMsByInput: {},
        scaffoldLevel: 0,
        strongestEvidencePassed: 'none',
      };
    },

    update(state: SkillState, attempt: AttemptRecord, now: Date): SkillState {
      if (attempt.itemId !== state.itemId || attempt.skill !== state.skill) {
        throw new Error(
          `Attempt ${attempt.id} is for ${String(attempt.itemId)}/${attempt.skill}, not ${String(state.itemId)}/${state.skill}`,
        );
      }

      // Only the first, graded attempt schedules anything. A guided retry teaches
      // the learner something, but "right on the second go, after being shown the
      // answer" is not evidence of recall and must never reach the memory model.
      if (attempt.attemptOrdinal > 0) return state;

      // The timing baseline is built from every real attempt, right or wrong,
      // including inconclusive ones: the time spent drawing a character is a fact
      // about drawing, independent of whether the assessor could read it. A
      // declined attempt is excluded — "I don't know" is instant and would drag
      // the baseline down, making later answers look slow.
      const medianMsByInput = attempt.declined
        ? state.medianMsByInput
        : {
            ...state.medianMsByInput,
            [attempt.inputMethod]: updateMedianEstimate(
              state.medianMsByInput[attempt.inputMethod],
              attempt.elapsedMs,
              t.medianStepFraction,
            ),
          };

      const verdict = deriveRating(state, attempt, speedRules);

      if (verdict.kind === 'no-evidence') {
        // HARD PRODUCT RULE: an assessor that could not decide must not cost the
        // learner anything. Stability, difficulty, streak, lapses and the success
        // counters are all left exactly as they were, and `lastReviewedAt` is NOT
        // advanced either — advancing it would reset the forgetting clock and
        // silently inflate retrievability on the strength of a non-observation.
        // Only a near-term recheck is scheduled, so a decidable answer can be
        // obtained while the learner is still in the session.
        const recheck: SkillState = {
          ...state,
          totalAttempts: state.totalAttempts + 1,
          medianMsByInput,
          firstSeenAt: state.firstSeenAt ?? attempt.at,
          dueAt: dueFrom(now, t.uncertainRecheckDays),
          lastIntervalDays: t.uncertainRecheckDays,
        };
        return { ...recheck, stage: stageFor(recheck) };
      }

      const { rating, evidence, success, aided } = verdict;

      // ---- memory model -------------------------------------------------------
      const hasModel = state.lastReviewedAt !== null && state.stability > 0;
      const elapsedDays = state.lastReviewedAt
        ? Math.max(0, (now.getTime() - Date.parse(state.lastReviewedAt)) / MS_PER_DAY)
        : 0;

      let stability: number;
      let difficulty: number;
      if (!hasModel) {
        stability = initialStability(w, rating);
        difficulty = initialDifficulty(w, rating);
      } else {
        const r = retrievabilityAt(elapsedDays, state.stability);
        // Stability is computed from the difficulty as it was *before* this
        // review, matching the reference implementation's ordering.
        if (elapsedDays < 1) {
          stability =
            rating === 'again'
              ? nextForgetStability(w, state.difficulty, state.stability, r)
              : shortTermStability(w, state.stability, rating);
        } else {
          stability =
            rating === 'again'
              ? nextForgetStability(w, state.difficulty, state.stability, r)
              : nextRecallStability(w, state.difficulty, state.stability, r, rating);
        }
        difficulty = nextDifficulty(w, state.difficulty, rating);
      }

      // ---- counters -----------------------------------------------------------
      // A lapse is a failure of something that had been recalled unaided at least
      // once. Failing a pair you have never yet produced is simply still learning
      // it, and counting that as a lapse would label every hard new character a
      // leech on day one.
      const isLapse = !success && state.unaidedFirstAttemptCorrect > 0;

      // Distinct local dates, using the calendar date the learner was living in.
      // Strictly-later only: a date going backwards (travel, a corrected clock)
      // must not be able to inflate the count.
      const previousSuccessDate =
        state.lastUnaidedSuccessAt === null
          ? null
          : localDateIn(new Date(state.lastUnaidedSuccessAt), attempt.timeZone);
      const isNewSuccessDate =
        success && (previousSuccessDate === null || attempt.localDate > previousSuccessDate);

      // ---- interval -----------------------------------------------------------
      let intervalDays = intervalDaysForStability(stability, t.requestedRetention);
      const projected: SkillState = {
        ...state,
        lapses: state.lapses + (isLapse ? 1 : 0),
        totalAttempts: state.totalAttempts + 1,
        unaidedFirstAttemptCorrect: state.unaidedFirstAttemptCorrect + (success ? 1 : 0),
      };
      const leech = assessLeech(projected);

      if (success) {
        intervalDays = Math.max(intervalDays, t.minSuccessIntervalDays);
        if (evidence === 'weak') {
          // Second half of the weak-evidence cap. The rating ceiling already
          // slows stability growth; this bounds the *schedule* directly so that
          // no run of four-option questions can stretch the gap out to weeks.
          const previous = Math.max(state.lastIntervalDays, t.minSuccessIntervalDays);
          intervalDays = Math.min(intervalDays, previous * t.weakEvidenceGrowthCap);
        }
      } else {
        intervalDays = Math.min(
          Math.max(intervalDays, t.relearnIntervalDays),
          t.maxLapseIntervalDays,
        );
        if (leech.isLeech) {
          // Do not keep shrinking. A leech needs different treatment, which the
          // selector arranges; hammering it every ten minutes only crowds out the
          // rest of the session.
          intervalDays = Math.max(intervalDays, t.leechMinIntervalDays);
        }
      }

      intervalDays = Math.min(intervalDays, t.maxIntervalDays);
      // Fuzz last, then re-apply the cap: the ±5% must not be able to push an
      // interval past the documented maximum.
      intervalDays = Math.min(fuzz(intervalDays), t.maxIntervalDays);

      const next: SkillState = {
        ...state,
        stability,
        difficulty,
        streak: success ? state.streak + 1 : 0,
        spacedSuccesses: state.spacedSuccesses + (isNewSuccessDate ? 1 : 0),
        totalAttempts: state.totalAttempts + 1,
        unaidedFirstAttemptCorrect: state.unaidedFirstAttemptCorrect + (success ? 1 : 0),
        aidedAttempts: state.aidedAttempts + (aided ? 1 : 0),
        lapses: projected.lapses,
        firstSeenAt: state.firstSeenAt ?? attempt.at,
        lastReviewedAt: attempt.at,
        lastUnaidedSuccessAt: success ? attempt.at : state.lastUnaidedSuccessAt,
        dueAt: dueFrom(now, intervalDays),
        lastIntervalDays: intervalDays,
        medianMsByInput,
        strongestEvidencePassed: success
          ? strongestEvidence(state.strongestEvidencePassed, evidence)
          : state.strongestEvidencePassed,
      };

      return { ...next, stage: stageFor(next) };
    },

    retrievability(state: SkillState, now: Date): number {
      // No review, no memory to model. Reporting 1.0 for an unseen pair would be
      // a lie the selector would act on.
      if (state.lastReviewedAt === null || state.stability <= 0) return 0;
      const elapsedDays = Math.max(
        0,
        (now.getTime() - Date.parse(state.lastReviewedAt)) / MS_PER_DAY,
      );
      return retrievabilityAt(elapsedDays, state.stability);
    },

    explain(state: SkillState, now: Date): string {
      if (state.dueAt === null || state.totalAttempts === 0) {
        return 'This has not been scheduled yet — it will turn up as new material.';
      }

      const daysUntil = (Date.parse(state.dueAt) - now.getTime()) / MS_PER_DAY;
      const when =
        daysUntil <= 0
          ? 'This is due for review now.'
          : `Next check in ${humaniseDays(daysUntil)}.`;

      const leech = assessLeech(state);
      if (leech.explanation !== null) return `${when} ${leech.explanation}`;

      if (state.streak === 0) {
        return `${when} The gap was shortened because the last answer was not right unaided.`;
      }
      if (state.strongestEvidencePassed === 'weak') {
        return `${when} You have got it right ${count(state.streak, 'time')} in a row, but only by picking it from options, so the gap grows slowly until you can produce it yourself.`;
      }
      return `${when} The gap grew to ${humaniseDays(state.lastIntervalDays)} because you have got it right unaided ${count(state.streak, 'time')} in a row.`;
    },
  };
}
