import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Exercise } from '@/features/practice/Exercise';
import type { Services } from '@/app/services';
import { asItemId, asQuestionId, type Grade, type Question } from '@/domain';
import { chimeCorrect, chimeIncorrect } from '@/audio/chime';

vi.mock('@/audio/chime', () => ({ chimeCorrect: vi.fn(), chimeIncorrect: vi.fn() }));

const incorrect: Grade = { outcome: 'incorrect', unaidedFirstAttempt: false, message: 'Try again.', distinction: null, handwriting: null, confusedWith: null };
const correct: Grade = { outcome: 'correct', unaidedFirstAttempt: true, message: 'Correct.', distinction: null, handwriting: null, confusedWith: null };
const uncertain: Grade = { outcome: 'uncertain', unaidedFirstAttempt: false, message: 'Could not tell.', distinction: null, handwriting: null, confusedWith: null };
function question(overrides: Partial<Question> = {}): Question {
  return { id: asQuestionId('exercise-test'), type: 'character-to-reading-typed', targetItemId: asItemId('kana:hi:ga'), targetReadingId: null,
    skill: 'readingRecall', direction: 'glyph-to-reading', response: 'typed', inputScript: 'kana', evidence: 'strong',
    prompt: { text: 'が', textIsJapanese: true, audio: null, instruction: 'Type the reading', context: null, scaffold: null },
    options: null, pairs: null, acceptedAnswers: ['が'], canonicalAnswer: 'が', alsoAcceptableNote: null,
    allowedHints: ['reveal-answer'], distinction: null, selectionReason: 'due-review', focusedPractice: false, requiredAudio: [], requiredStrokeData: [], ...overrides };
}
function mount(q = question(), extra: Partial<React.ComponentProps<typeof Exercise>> = {}) {
  const props = { question: q, result: null, busy: false, services: { content: { audio: () => undefined, strokes: async () => undefined }, audio: { unlock: vi.fn(async () => true), play: vi.fn(async () => {}) }, settings: { silentPractice: false, playChimes: false } } as unknown as Services,
    onSubmit: vi.fn(async () => {}), onRetry: vi.fn(async () => {}), onAdvance: vi.fn(async () => {}), ...extra };
  return { ...render(<Exercise {...props} />), props };
}
function mountGraded(result: Grade, settings: { silentPractice: boolean; playChimes: boolean }) {
  return mount(question(), { result, services: { content: { audio: () => undefined, strokes: async () => undefined }, audio: { unlock: vi.fn(async () => true), play: vi.fn(async () => {}) }, settings } as unknown as Services });
}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe('exercise chimes', () => {
  it('chimes once when a correct answer is revealed, with chimes on', () => {
    mountGraded(correct, { silentPractice: false, playChimes: true });
    expect(chimeCorrect).toHaveBeenCalledTimes(1);
    expect(chimeIncorrect).not.toHaveBeenCalled();
  });
  it('chimes once when an incorrect answer is revealed, with chimes on', () => {
    mountGraded(incorrect, { silentPractice: false, playChimes: true });
    expect(chimeIncorrect).toHaveBeenCalledTimes(1);
    expect(chimeCorrect).not.toHaveBeenCalled();
  });
  it('does not chime for an uncertain outcome — it is never a judged pass or fail', () => {
    mountGraded(uncertain, { silentPractice: false, playChimes: true });
    expect(chimeCorrect).not.toHaveBeenCalled();
    expect(chimeIncorrect).not.toHaveBeenCalled();
  });
  it('stays silent when chimes are turned off', () => {
    mountGraded(correct, { silentPractice: false, playChimes: false });
    expect(chimeCorrect).not.toHaveBeenCalled();
  });
  it('stays silent during silent practice even if chimes are otherwise on', () => {
    mountGraded(correct, { silentPractice: true, playChimes: true });
    expect(chimeCorrect).not.toHaveBeenCalled();
  });
  it('chimes again for a guided correction’s own result once it re-reveals feedback', () => {
    const { rerender, props } = mountGraded(incorrect, { silentPractice: false, playChimes: true });
    expect(chimeIncorrect).toHaveBeenCalledTimes(1);
    const retried = { ...incorrect, outcome: 'correct' as const, unaidedFirstAttempt: false, message: 'Correct.' };
    rerender(<Exercise {...props} retryResult={retried} />);
    expect(chimeCorrect).toHaveBeenCalledTimes(1);
  });
});

describe('exercise input evidence', () => {
  it('does not submit during IME composition, then submits NFC-normalized text with IME evidence', async () => {
    const { props } = mount();
    const input = screen.getByRole('textbox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'か\u3099' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    fireEvent.submit(input.closest('form')!);
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ rawInput: 'か\u3099', normalisedInput: 'が', imeUsed: true }));
  });

  it('connects pairs using only keyboard and records chosen items and elimination evidence', async () => {
    const pairs = [['あ','a'],['い','i'],['う','u']].map(([glyph, reading], i) => ({ pairId: String(i), left: { display: glyph!, itemId: asItemId(`kana:hi:${reading}`) }, right: { display: reading!, itemId: asItemId(`kana:hi:${reading}`) } }));
    const { props } = mount(question({ type: 'match-pairs', response: 'matching', pairs }));
    const user = userEvent.setup();
    for (const [left, right] of [['あ','i'],['い','a'],['う','u']]) {
      for (const name of [left, right]) {
        const target = screen.getByRole('button', { name });
        for (let n = 0; document.activeElement !== target && n < 30; n++) await user.tab();
        expect(target).toHaveFocus();
        await user.keyboard('{Enter}');
      }
    }
    await user.tab();
    expect(screen.getByRole('button', { name: 'Check answer' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const answer = vi.mocked(props.onSubmit).mock.calls[0]?.[0];
    expect(answer?.pairResults).toEqual([
      expect.objectContaining({ pairId: '0', chosenRightItemId: 'kana:hi:i', correct: false, remainingChoices: 3, forcedByElimination: false }),
      expect.objectContaining({ pairId: '1', chosenRightItemId: 'kana:hi:a', correct: false, remainingChoices: 2, forcedByElimination: false }),
      expect.objectContaining({ pairId: '2', correct: true, remainingChoices: 1, forcedByElimination: true }),
    ]);
  });

  it('counts replays separately from the first audio play without treating them as hints', async () => {
    const base = question();
    const { props } = mount({ ...base, prompt: { ...base.prompt, audio: { path: '/test.ogg' } as import('@/domain').AudioRef } });
    await userEvent.click(screen.getByRole('button', { name: '▶ Play audio' }));
    await userEvent.click(screen.getByRole('button', { name: '▶ Replay audio' }));
    await userEvent.click(screen.getByRole('button', { name: 'I don’t know' }));
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ audioReplays: 1, hintsUsed: [] }));
  });

  it('records a reveal and a decline without substituting a correct answer', async () => {
    const { props } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'I don’t know' }));
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ declined: true, hintsUsed: ['reveal-answer'], rawInput: '' }));
  });

  it('keeps a correction editable if saving it fails', async () => {
    mount(question(), { result: incorrect, onRetry: vi.fn(async () => { throw new Error('Storage is full'); }) });
    await userEvent.click(screen.getByRole('button', { name: 'Guided correction' }));
    await userEvent.type(screen.getByRole('textbox'), 'ga');
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is full');
    expect(screen.getByRole('textbox')).toHaveValue('ga');
  });

  it('retains a draft and hints when navigating away and back in the same tab', async () => {
    const first = mount();
    await userEvent.type(screen.getByRole('textbox'), 'ga');
    await userEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    first.unmount();
    const next = mount();
    expect(screen.getByRole('textbox')).toHaveValue('ga');
    await userEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(next.props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hintsUsed: ['reveal-answer'] }));
  });

  it('keeps original feedback distinct from a successful guided correction', () => {
    mount(question(), { result: incorrect, retryResult: { ...incorrect, outcome: 'correct', message: 'Correct.' } });
    expect(screen.getByText('First attempt: Try again.')).toBeInTheDocument();
    expect(screen.getByText('Second try: Correct.')).toBeInTheDocument();
  });

  it('submits a keyboard-selected choice by pressing Enter, with nothing focused', async () => {
    const options = [
      { key: 'a', display: 'あ', itemId: null, correct: true, distractorReason: null },
      { key: 'b', display: 'い', itemId: null, correct: false, distractorReason: 'random-in-pool' },
    ];
    const { props } = mount(question({ response: 'choice', options }));
    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ chosenOptionKey: 'a' })));
  });

  it('advances past feedback by pressing Enter, with nothing focused', async () => {
    const { props } = mount(question(), { result: incorrect });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(props.onAdvance).toHaveBeenCalled());
  });

  it('leaves Enter to a focused button instead of also advancing past feedback', async () => {
    const { props } = mount(question(), { result: incorrect });
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Guided correction' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onAdvance).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeInTheDocument();
  });

  it('does not start a second submission while the first is pending', async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    mount(question(), { onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'I don’t know' }));
    await userEvent.click(screen.getByRole('button', { name: 'I don’t know' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

it('captures real pointer strokes and coaches reversed trace direction, with undo and clear', async () => {
  const { Writing } = await import('@/features/practice/Writing');
  const { buildSamplesFor } = await import('../fixtures/handwriting-samples');
  const { useState } = await import('react');
  const sample = buildSamplesFor('一', '二');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  function Surface() {
    const [strokes, setStrokes] = useState<import('@/domain').CapturedStroke[]>([]);
    return <Writing reference={sample.reference} strokes={strokes} onChange={setStrokes} guides />;
  }
  render(<Surface />);
  const canvas = screen.getByRole('img', { name: /Handwriting canvas/ });
  Object.assign(canvas, { setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ width: 300, height: 300, left: 0, top: 0 }) });
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'pen' }, isPrimary: { value: true }, pressure: { value: 0.7 } });
    fireEvent(canvas, event);
  };
  const points = [...sample.reference.strokes[0]!.points].reverse();
  pointer('pointerdown', points[0]![0] / 109 * 300, points[0]![1] / 109 * 300);
  for (const [x, y] of points.slice(1)) pointer('pointermove', x / 109 * 300, y / 109 * 300);
  pointer('pointerup', points.at(-1)![0] / 109 * 300, points.at(-1)![1] / 109 * 300);
  expect(screen.getByRole('status')).toHaveTextContent('other direction');
  expect(canvas.querySelectorAll('polyline')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Undo stroke' }));
  expect(canvas.querySelectorAll('polyline')).toHaveLength(0);
  pointer('pointerdown', 40, 150); pointer('pointermove', 260, 150); pointer('pointerup', 260, 150);
  expect(canvas.querySelectorAll('polyline')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(canvas.querySelectorAll('polyline')).toHaveLength(0);
  vi.unstubAllGlobals();
});

it('does not drop an in-progress stroke when the stroke reference resolves mid-draw', async () => {
  // Exercise.tsx fetches the StrokeReference asynchronously after a
  // handwriting question renders, so `reference` starts null and flips to
  // the loaded value moments later — exactly the shape of a real "start
  // writing the instant the question appears" scenario. Writing.tsx used to
  // depend on `reference` (and `guides`) in the effect that mounts
  // attachStrokeCapture, so that resolution tore the listeners down and
  // rebuilt them mid-stroke: the new controller never saw the pointerdown
  // that started the stroke, so the eventual pointerup was silently
  // ignored — the learner lifts the pen, nothing is recorded, and "Check
  // answer" just stays disabled with no explanation. Found live via a
  // Playwright session against a real production build.
  const { Writing } = await import('@/features/practice/Writing');
  const { buildSamplesFor } = await import('../fixtures/handwriting-samples');
  const { useState } = await import('react');
  const sample = buildSamplesFor('一', '二');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  function Surface() {
    const [strokes, setStrokes] = useState<import('@/domain').CapturedStroke[]>([]);
    const [reference, setReference] = useState<import('@/domain').StrokeReference | null>(null);
    return <>
      <button onClick={() => setReference(sample.reference)}>resolve reference</button>
      <Writing reference={reference} strokes={strokes} onChange={setStrokes} guides />
    </>;
  }
  render(<Surface />);
  const canvas = screen.getByRole('img', { name: /Handwriting canvas/ });
  Object.assign(canvas, { setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ width: 300, height: 300, left: 0, top: 0 }) });
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true }, pressure: { value: 0.5 } });
    fireEvent(canvas, event);
  };
  // Begin the stroke while `reference` is still null (the pre-load state).
  pointer('pointerdown', 40, 150);
  pointer('pointermove', 120, 150);
  // The fetch resolves mid-stroke: guides has real reference data to trace
  // against for the first time, which is exactly the prop change that used
  // to tear the capture listeners down.
  await userEvent.click(screen.getByRole('button', { name: 'resolve reference' }));
  pointer('pointermove', 200, 150);
  pointer('pointerup', 260, 150);
  // The stroke must have been captured despite the mid-draw prop change.
  expect(canvas.querySelectorAll('polyline')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Undo stroke' })).toBeEnabled();
  vi.unstubAllGlobals();
});
