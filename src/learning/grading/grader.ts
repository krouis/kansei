import {
  NON_PENALISED_HINTS, isCopyOfVisibleRomaji,
} from '@/domain';
import type {
  AnswerSubmission, Grade, HandwritingVerdict, HintKind, ItemId, Question,
} from '@/domain';
import type { AssessorClient, ToleranceProfile } from '@/handwriting/ports';
import type { ContextualGrader, GraderContent, GradingContext } from './ports';
import { gradeMatchingPairs } from './matching';
import type { MatchingBreakdown } from './matching';
import { differsOnlyByScript, expectedScript, normaliseFor } from './script';
import { inferredTolerance } from './tolerance';

/**
 * The grader.
 *
 * Pure with respect to the submission: given the same question, submission and
 * context it always returns the same grade. The only I/O is the injected
 * handwriting assessor and the read-only content lookup, both of which are
 * allowed to be absent — when they are, the grader says it could not decide
 * rather than guessing, because a fabricated verdict is worse than none.
 */

export interface GraderOptions {
  /**
   * Whether a character produced with a definitely-wrong stroke order counts as
   * a correct handwriting answer.
   *
   * Product choice: it does NOT. Kansei teaches stroke order, so an answer the
   * assessor reports as 'off' on order is not yet a correct answer for the
   * handwriting skill, even when the finished shape is recognisable. Identity
   * and order stay separate in the verdict either way, so the learner is told
   * which of the two went wrong.
   */
  strokeOrderCountsTowardCorrectness?: boolean;
  /** Canvas edge in CSS px assumed when the caller supplies no tolerance profile. */
  assumedCanvasPx?: number;
}

export interface GraderDeps {
  /** Handwriting assessment. null means handwriting questions cannot be graded. */
  assessor?: AssessorClient | null;
  /** Content lookups for corrective feedback. Absent = no specific distinctions. */
  content?: GraderContent | null;
  options?: GraderOptions;
}

/** Thrown for a response mode no format in QUESTION_TYPES produces. */
export class UnsupportedResponseModeError extends Error {
  constructor(readonly mode: string) {
    super(
      `Grading is not implemented for response mode '${mode}'. No question format ` +
        `in QUESTION_TYPES produces it, so reaching this is a bug in generation, ` +
        `not a gap to paper over with a guessed verdict.`,
    );
    this.name = 'UnsupportedResponseModeError';
  }
}

/** Extra grader output the shared `Grade` has no field for. */
export interface GradeDetail {
  grade: Grade;
  /** Per-pair breakdown for a matching screen; null otherwise. */
  matching: MatchingBreakdown | null;
  /**
   * True when the typed answer reproduced rōmaji that was on screen. Never
   * credited as character recall, and counted separately in AuxiliaryCounters.
   */
  copiedVisibleRomaji: boolean;
  /** True when the answer was accepted only because script was not specified. */
  scriptFolded: boolean;
  /** The normalised answer the grader actually compared. */
  comparedAnswer: string | null;
}

export class KanseiGrader implements ContextualGrader {
  private readonly assessor: AssessorClient | null;
  private readonly content: GraderContent | null;
  private readonly strokeOrderCounts: boolean;
  private readonly assumedCanvasPx: number;

  constructor(deps: GraderDeps = {}) {
    this.assessor = deps.assessor ?? null;
    this.content = deps.content ?? null;
    this.strokeOrderCounts = deps.options?.strokeOrderCountsTowardCorrectness ?? true;
    this.assumedCanvasPx = deps.options?.assumedCanvasPx ?? 320;
  }

  async grade(question: Question, submission: AnswerSubmission, context: GradingContext = {}): Promise<Grade> {
    return (await this.gradeDetailed(question, submission, context)).grade;
  }

  /** The full grade, including the parts `Grade` has no field for. */
  async gradeDetailed(
    question: Question,
    submission: AnswerSubmission,
    context: GradingContext = {},
  ): Promise<GradeDetail> {
    const ordinal = context.attemptOrdinal ?? 0;
    const penalised = penalisedHints(submission.hintsUsed);
    const revealed = submission.hintsUsed.includes('reveal-answer');

    // "I don't know" is an incorrect outcome, but it is not a wrong guess: there
    // is no answer to analyse, so no confusion is recorded and the feedback does
    // not tell the learner they got it wrong.
    if (submission.declined) {
      return {
        grade: {
          outcome: 'incorrect',
          unaidedFirstAttempt: false,
          message: 'You skipped this one.',
          distinction: this.distinctionFor(question, null),
          handwriting: null,
          confusedWith: null,
        },
        matching: null,
        copiedVisibleRomaji: false,
        scriptFolded: false,
        comparedAnswer: null,
      };
    }

    switch (question.response) {
      case 'choice':
        return this.gradeChoice(question, submission, ordinal, penalised, revealed);
      case 'typed':
        return this.gradeTyped(question, submission, ordinal, penalised, revealed);
      case 'matching':
        return this.gradeMatching(question, submission, ordinal, penalised, revealed);
      case 'handwriting':
        return this.gradeHandwriting(question, submission, ordinal, penalised, revealed, context.tolerance);
      default:
        throw new UnsupportedResponseModeError(question.response);
    }
  }

  // ---------------------------------------------------------------- choice

  private gradeChoice(
    question: Question,
    submission: AnswerSubmission,
    ordinal: number,
    penalised: HintKind[],
    revealed: boolean,
  ): GradeDetail {
    const options = question.options ?? [];
    const chosen = options.find((o) => o.key === submission.chosenOptionKey) ?? null;
    const correct = chosen !== null && chosen.correct && !revealed;
    const confusedWith = chosen !== null && !chosen.correct ? chosen.itemId : null;

    return {
      grade: {
        outcome: correct ? 'correct' : 'incorrect',
        unaidedFirstAttempt: unaided(correct, ordinal, penalised),
        message: this.message(correct, revealed, penalised, chosen === null ? 'no-answer' : null),
        distinction: this.distinctionFor(question, correct ? null : confusedWith),
        handwriting: null,
        confusedWith,
      },
      matching: null,
      copiedVisibleRomaji: false,
      scriptFolded: false,
      comparedAnswer: chosen?.display ?? null,
    };
  }

  // ----------------------------------------------------------------- typed

  private gradeTyped(
    question: Question,
    submission: AnswerSubmission,
    ordinal: number,
    penalised: HintKind[],
    revealed: boolean,
  ): GradeDetail {
    // Re-normalise from the raw input rather than trusting `normalisedInput`:
    // the script rule is the question's, and the UI does not own it. The
    // pre-normalised value is the fallback for a surface that sends only that.
    const raw = submission.rawInput;
    const typed = raw !== null
      ? normaliseFor(raw, question.inputScript)
      : normaliseFor(submission.normalisedInput ?? '', question.inputScript);

    const accepted = question.acceptedAnswers.map((a) => normaliseFor(a, question.inputScript));
    const matched = typed.length > 0 && accepted.includes(typed);
    const correct = matched && !revealed;

    // Accepted only because no script was specified: the learner must know they
    // were not judged on script, or they will assume the script they used was
    // the one asked for.
    const scriptFolded = correct
      && shouldFold(question)
      && !question.acceptedAnswers.map((a) => normaliseAnswerStrict(a)).includes(normaliseAnswerStrict(raw ?? typed));

    const wrongScriptOnly = !matched
      && !shouldFold(question)
      && differsOnlyByScript(typed, accepted);

    // Typing rōmaji that is visible on screen is copying, not recall. The answer
    // is still right — it is just not evidence about the character.
    const copied = correct && isCopyOfVisibleRomaji(raw ?? '', question.prompt.scaffold);

    const confusedWith = correct ? null : this.content?.itemForAnswer(typed, question) ?? null;

    let message: string;
    if (copied) {
      message = 'Correct — but that rōmaji was on screen, so it does not count as recall.';
    } else if (correct && scriptFolded) {
      message = 'Correct. This question did not specify a script, so either kana script was accepted.';
    } else if (wrongScriptOnly) {
      const want = expectedScript(accepted);
      message = want === null
        ? 'That is the right reading in the other kana script.'
        : `That is the right reading, but written in the other kana script — this one asked for ${want}.`;
    } else {
      message = this.message(correct, revealed, penalised, typed.length === 0 ? 'no-answer' : null);
    }

    return {
      grade: {
        outcome: correct ? 'correct' : 'incorrect',
        // A copied scaffold is correct but never unaided: crediting it would let
        // the scheduler conclude the character is known from reading it aloud.
        unaidedFirstAttempt: unaided(correct && !copied, ordinal, penalised),
        message,
        distinction: wrongScriptOnly
          ? null // the message already names the distinction; two sentences is noise
          : this.distinctionFor(question, correct ? null : confusedWith),
        handwriting: null,
        confusedWith,
      },
      matching: null,
      copiedVisibleRomaji: copied,
      scriptFolded,
      comparedAnswer: typed,
    };
  }

  // -------------------------------------------------------------- matching

  private gradeMatching(
    question: Question,
    submission: AnswerSubmission,
    ordinal: number,
    penalised: HintKind[],
    revealed: boolean,
  ): GradeDetail {
    const pairs = question.pairs ?? [];
    const breakdown = gradeMatchingPairs(pairs, submission.pairResults ?? []);
    const allResolved = breakdown.pairs.length === pairs.length && pairs.length > 0;
    const correct = allResolved && breakdown.correctCount === pairs.length && !revealed;

    // One screen, one confusion: the first mismatch is the informative one, and
    // recording all of them would triple-count a single muddle.
    const confusedWith = breakdown.confusions[0]?.confusedWith ?? null;
    const itemId = breakdown.confusions[0]?.itemId ?? null;

    const message = correct
      ? pairs.length > 1 && breakdown.forcedCorrectCount > 0
        ? `All ${pairs.length} matched. The last pair was the only one left, so it counts for less.`
        : `All ${pairs.length} matched.`
      : `${breakdown.correctCount} of ${pairs.length} matched.`;

    return {
      grade: {
        outcome: correct ? 'correct' : 'incorrect',
        unaidedFirstAttempt: unaided(correct, ordinal, penalised),
        message,
        distinction: correct || itemId === null || confusedWith === null
          ? this.distinctionFor(question, null)
          : this.content?.confusableNote(itemId, confusedWith) ?? this.distinctionFor(question, null),
        handwriting: null,
        confusedWith,
      },
      matching: breakdown,
      copiedVisibleRomaji: false,
      scriptFolded: false,
      comparedAnswer: null,
    };
  }

  // ----------------------------------------------------------- handwriting

  private async gradeHandwriting(
    question: Question,
    submission: AnswerSubmission,
    ordinal: number,
    penalised: HintKind[],
    revealed: boolean,
    supplied: ToleranceProfile | undefined,
  ): Promise<GradeDetail> {
    const strokes = submission.strokes ?? [];
    const glyph = handwritingTarget(question);

    if (strokes.length === 0) {
      // Nothing was drawn. That is a definite non-answer, not an uncertainty.
      return this.handwritingDetail(question, {
        outcome: 'incorrect',
        unaidedFirstAttempt: false,
        message: 'Nothing was drawn.',
        distinction: this.distinctionFor(question, null),
        handwriting: null,
        confusedWith: null,
      });
    }

    const unavailable = this.handwritingUnavailable(question);
    if (unavailable !== null) {
      return this.handwritingDetail(question, unavailable);
    }

    const reference = await this.content!.strokeReference(glyph);
    if (reference === undefined) {
      return this.handwritingDetail(
        question,
        uncertainGrade(
          `There is no stroke reference for ${glyph} in the installed content, so this ` +
            `writing was not assessed.`,
        ),
      );
    }

    const tolerance = supplied ?? inferredToleranceFor(submission, this.assumedCanvasPx);
    const verdict = await this.assessor!.assess({
      targetGlyph: glyph,
      reference,
      strokes,
      mode: 'recall',
      tolerance,
      alternatives: await this.content!.confusableReferences(glyph),
    });

    const orderDefinitelyWrong = this.strokeOrderCounts && verdict.strokeOrder.status === 'off';
    const outcome: Grade['outcome'] = verdict.uncertain
      ? 'uncertain'
      : verdict.confidence >= tolerance.correctAtOrAbove && !orderDefinitelyWrong && !revealed
        ? 'correct'
        : 'incorrect';

    const alt = verdict.bestAlternative;
    const confusedWith = outcome === 'correct' || alt === null
      ? null
      : this.content!.itemForGlyph(alt.glyph);

    return this.handwritingDetail(question, {
      outcome,
      // 'uncertain' is not success and not failure: it must never be folded into
      // the unaided flag the scheduler keys on.
      unaidedFirstAttempt: unaided(outcome === 'correct', ordinal, penalised),
      message: handwritingMessage(outcome, verdict, orderDefinitelyWrong),
      distinction: outcome === 'correct'
        ? null
        : this.handwritingDistinction(question, verdict, confusedWith, orderDefinitelyWrong),
      handwriting: verdict,
      confusedWith,
    });
  }

  /**
   * Why handwriting cannot be graded right now, as a grade the UI can show.
   *
   * Returning 'uncertain' with the reason stated verbatim is the honest answer:
   * the learner is told the writing was not judged, and the scheduler treats it
   * as no evidence. It must never be reported as correct or as a failure.
   */
  private handwritingUnavailable(question: Question): Grade | null {
    if (this.assessor === null) {
      return uncertainGrade(
        'Handwriting assessment is not available in this build, so this writing was not judged.',
      );
    }
    if (this.content === null) {
      return uncertainGrade(
        'The stroke reference for this character could not be loaded, so this writing was not judged.',
      );
    }
    if (handwritingTarget(question).length === 0) {
      return uncertainGrade(
        'This question does not name the character to write, so this writing was not judged.',
      );
    }
    return null;
  }

  private handwritingDetail(question: Question, grade: Grade): GradeDetail {
    return {
      grade,
      matching: null,
      copiedVisibleRomaji: false,
      scriptFolded: false,
      comparedAnswer: handwritingTarget(question),
    };
  }

  private handwritingDistinction(
    question: Question,
    verdict: HandwritingVerdict,
    confusedWith: ItemId | null,
    orderDefinitelyWrong: boolean,
  ): string | null {
    // Prefer the content pack's documented note about the pair the learner
    // actually produced — that is the one sentence worth reading.
    if (confusedWith !== null) {
      const note = this.distinctionFor(question, confusedWith);
      if (note !== null) return note;
    }
    // Otherwise report what the assessor itself measured. These are statements
    // about the strokes drawn, not linguistic claims.
    if (orderDefinitelyWrong && verdict.strokeOrder.detail !== null) return verdict.strokeOrder.detail;
    if (verdict.strokeCount.status === 'off' && verdict.strokeCount.detail !== null) {
      return verdict.strokeCount.detail;
    }
    if (verdict.strokeDirection.status === 'off' && verdict.strokeDirection.detail !== null) {
      return verdict.strokeDirection.detail;
    }
    return this.distinctionFor(question, null);
  }

  // ----------------------------------------------------------- distinction

  /**
   * ONE short sentence naming the specific distinction.
   *
   * Order of preference, and the reason for it: the question's own
   * `distinction` was written against this exact prompt; the content pack's
   * confusable note is documented for the pair; anything else would be the
   * grader inventing a linguistic claim, so it does not. When nothing specific
   * is known the caller gets null and shows the correct answer alone — a true
   * silence beats a plausible-sounding invention.
   */
  private distinctionFor(question: Question, confusedWith: ItemId | null): string | null {
    if (confusedWith !== null) {
      const note = this.content?.confusableNote(question.targetItemId, confusedWith) ?? null;
      if (note !== null && note.trim().length > 0) return note.trim();
    }
    if (question.distinction !== null && question.distinction.trim().length > 0) {
      return question.distinction.trim();
    }
    return null;
  }

  private message(
    correct: boolean,
    revealed: boolean,
    penalised: HintKind[],
    problem: 'no-answer' | null,
  ): string {
    if (revealed) return 'You revealed the answer, so this one does not count as recalled.';
    if (problem === 'no-answer') return 'No answer was given.';
    if (correct) {
      return penalised.length > 0
        ? 'Correct, with a hint. It will come round again without one.'
        : 'Correct.';
    }
    return 'Not quite.';
  }
}

// -------------------------------------------------------------- helpers

/**
 * Hints that weaken the evidence. 'audio-replay' is explicitly NOT one of them:
 * replaying the clip is how a listening question is answered, and counting it
 * would make every listening answer look aided.
 */
export function penalisedHints(hints: HintKind[]): HintKind[] {
  return hints.filter((h) => !NON_PENALISED_HINTS.has(h));
}

/**
 * The flag the scheduler keys on. Three conditions, all required: the answer was
 * right, it was the first attempt, and no penalised hint was used. A reveal is a
 * penalised hint, so it fails this by construction.
 */
export function unaided(correct: boolean, attemptOrdinal: number, penalised: HintKind[]): boolean {
  return correct && attemptOrdinal === 0 && penalised.length === 0;
}

function shouldFold(question: Question): boolean {
  return question.inputScript === 'japanese-any';
}

/** Script-sensitive normalisation, used to detect that folding did the work. */
function normaliseAnswerStrict(s: string): string {
  return normaliseFor(s, 'kana');
}

function handwritingTarget(question: Question): string {
  // The glyph to write is the canonical answer for a write-this-character
  // question, and the prompt text when the prompt itself is the character.
  const candidate = question.canonicalAnswer.trim().length > 0
    ? question.canonicalAnswer.trim()
    : (question.prompt.text ?? '').trim();
  return candidate;
}

function inferredToleranceFor(submission: AnswerSubmission, canvasPx: number): ToleranceProfile {
  const pointer = submission.strokes?.[0]?.pointerType ?? 'unknown';
  const base = inferredTolerance(pointer);
  return { ...base, canvasPx };
}

function uncertainGrade(reason: string): Grade {
  return {
    outcome: 'uncertain',
    unaidedFirstAttempt: false,
    message: reason,
    distinction: null,
    handwriting: {
      confidence: 0,
      identity: unknownAspect(),
      strokeCount: unknownAspect(),
      strokeOrder: unknownAspect(),
      strokeDirection: unknownAspect(),
      shape: unknownAspect(),
      strokeNotes: [],
      uncertain: true,
      uncertaintyReason: reason,
      bestAlternative: null,
    },
    confusedWith: null,
  };
}

function unknownAspect() {
  return { status: 'unknown' as const, score: null, detail: null };
}

function handwritingMessage(
  outcome: Grade['outcome'],
  verdict: HandwritingVerdict,
  orderDefinitelyWrong: boolean,
): string {
  if (outcome === 'uncertain') {
    return verdict.uncertaintyReason ?? 'Not sure about this one — try it again or compare with the model.';
  }
  if (outcome === 'correct') return 'Correct.';
  if (orderDefinitelyWrong) return 'The character is recognisable, but the stroke order was not right.';
  if (verdict.bestAlternative !== null) return `That looks closer to ${verdict.bestAlternative.glyph}.`;
  return 'Not quite.';
}
