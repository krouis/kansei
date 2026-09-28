import type { Question } from '@/domain';
import { normaliseAnswer } from '@/domain';

/**
 * The final gate every generated question passes through before it may be
 * shown. This is rule (d) made mechanical: a choice question is rejected,
 * never merely warned about, if a distractor's own displayed value would
 * itself be accepted as correct.
 *
 * Deliberately conservative: it checks the OPTIONS as displayed, not the
 * generator's internal reasoning, so a bug in a specific generator's ambiguity
 * handling cannot slip a genuinely double-answer question past review.
 */
export function validateQuestion(question: Question): { ok: true } | { ok: false; reason: string } {
  if (question.options) {
    const correctCount = question.options.filter((o) => o.correct).length;
    if (correctCount !== 1) {
      return { ok: false, reason: `Expected exactly one correct option, found ${correctCount}.` };
    }
    const keys = new Set<string>();
    const displays = new Set<string>();
    for (const opt of question.options) {
      if (keys.has(opt.key)) return { ok: false, reason: `Duplicate option key '${opt.key}'.` };
      keys.add(opt.key);
      const norm = normaliseAnswer(opt.display);
      if (displays.has(norm)) return { ok: false, reason: `Two options display the same value '${opt.display}'.` };
      displays.add(norm);
    }
    // A distractor whose value is itself accepted would silently create a
    // second correct option even though only one is FLAGGED correct.
    const correct = question.options.find((o) => o.correct);
    if (correct) {
      for (const opt of question.options) {
        if (opt.correct) continue;
        const norm = normaliseAnswer(opt.display);
        if (question.acceptedAnswers.some((a) => normaliseAnswer(a) === norm)) {
          return { ok: false, reason: `Distractor '${opt.display}' is itself an accepted answer.` };
        }
      }
    }
    if (question.options.length < 2) {
      return { ok: false, reason: 'A choice question needs at least two options.' };
    }
  }

  if (question.pairs) {
    if (question.pairs.length < 2) return { ok: false, reason: 'A matching screen needs at least two pairs.' };
    const rightDisplays = new Set<string>();
    const leftIds = new Set<string>();
    for (const pair of question.pairs) {
      const rNorm = normaliseAnswer(pair.right.display);
      if (rightDisplays.has(rNorm)) {
        return { ok: false, reason: `Two pairs share the reading '${pair.right.display}'.` };
      }
      rightDisplays.add(rNorm);
      if (leftIds.has(String(pair.left.itemId))) {
        return { ok: false, reason: 'Two pairs share the same left-hand character.' };
      }
      leftIds.add(String(pair.left.itemId));
    }
  }

  if (question.acceptedAnswers.length === 0) {
    return { ok: false, reason: 'A question must accept at least one answer.' };
  }
  const normAccepted = question.acceptedAnswers.map((a) => normaliseAnswer(a));
  if (new Set(normAccepted).size !== normAccepted.length) {
    return { ok: false, reason: 'acceptedAnswers contains a duplicate after normalisation.' };
  }

  if (question.response === 'choice' && !question.options) {
    return { ok: false, reason: "response is 'choice' but no options were supplied." };
  }
  if (question.response === 'matching' && !question.pairs) {
    return { ok: false, reason: "response is 'matching' but no pairs were supplied." };
  }
  if (question.response === 'handwriting' && question.requiredStrokeData.length === 0) {
    return { ok: false, reason: 'A handwriting question must declare its required stroke reference.' };
  }
  if (question.prompt.audio && question.requiredAudio.length === 0) {
    return { ok: false, reason: 'A question with an audio prompt must declare its required audio key.' };
  }

  return { ok: true };
}
