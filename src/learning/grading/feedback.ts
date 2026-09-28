import type { Grade, Question } from '@/domain';
import type { CorrectiveFeedback, GraderContent } from './ports';

/**
 * Assemble the corrective feedback panel.
 *
 * Every screen gets feedback, including a correct one: seeing the canonical
 * answer after answering is what makes a right answer for the wrong reason
 * visible. Nothing here invents content — the answer and the "also acceptable"
 * note come from the question, the distinction comes from the grade (which the
 * grader sourced from the question or the content pack), and the audio comes
 * from the content pack or the question's own prompt.
 */
export function buildFeedback(
  question: Question,
  grade: Grade,
  content?: GraderContent | null,
): CorrectiveFeedback {
  return {
    outcome: grade.outcome,
    headline: grade.message,
    correctAnswer: question.canonicalAnswer,
    alsoAcceptable: question.alsoAcceptableNote,
    // Prefer a recording of the ANSWER; fall back to the prompt's own clip, which
    // for a listening question is the thing the learner was asked to identify.
    audio: content?.audioFor(question) ?? question.prompt.audio ?? null,
    distinction: grade.distinction,
    strokeNotes: grade.handwriting?.strokeNotes ?? [],
    uncertaintyReason: grade.handwriting?.uncertaintyReason ?? null,
    // A retry is only useful when there is something to correct. 'uncertain' also
    // offers one, because the learner deserves another go at a verdict the
    // assessor could not make — and it is recorded as a retry, so it can never
    // turn into first-attempt evidence.
    offerRetry: grade.outcome !== 'correct',
  };
}
