import { useEffect, useRef, useState } from 'react';
import type { AnswerSubmission, CapturedStroke, Grade, HintKind, PairResult, Question, StrokeReference } from '@/domain';
import { normaliseAnswer } from '@/domain';
import type { Services } from '@/app/services';
import { Button, Card } from '@/ui/primitives';
import { Writing } from './Writing';

interface Draft {
  text: string; choice: string | null; hints: HintKind[]; replays: number;
  strokes: CapturedStroke[]; canvasPx: number; pairs: PairResult[]; left: string | null;
  retry: boolean; ime: boolean; elapsedMs: number; played: boolean;
}

const SKILL_LABEL: Record<string, string> = { recognition: 'Recognition', readingRecall: 'Reading', listening: 'Listening', handwriting: 'Writing' };
const REASON_LABEL: Record<string, string> = { 'due-review': 'Review', 'weak-skill': 'Review', 'confusion-repair': 'Easy to mix up', 'new-material': 'New', retry: 'Retry', focused: 'Focused practice' };
const OUTCOME_MARK: Record<string, string> = { correct: '✓', incorrect: '✕', uncertain: '〜' };

function readDraft(question: Question): Partial<Draft> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(`kansei:answer:${question.id}`) ?? 'null');
    if (!value || typeof value !== 'object') return {};
    const d = value as Draft;
    if (typeof d.text !== 'string' || !Array.isArray(d.strokes) || !Array.isArray(d.pairs) || !Array.isArray(d.hints)) return {};
    return d;
  } catch { return {}; }
}

export function Exercise({ question: q, result, retryResult, services, busy, onSubmit, onAdvance, onRetry }: {
  question: Question; result: Grade | null; services: Services; busy: boolean;
  retryResult?: Grade | null;
  onSubmit: (answer: AnswerSubmission) => Promise<void>; onAdvance: () => Promise<void>;
  onRetry: (answer: AnswerSubmission) => Promise<void>;
}) {
  const [draft] = useState(() => readDraft(q));
  const [text, setText] = useState(draft.text ?? ''); const [choice, setChoice] = useState<string | null>(draft.choice ?? null);
  const [played, setPlayed] = useState(draft.played ?? false);
  const [hints, setHints] = useState<HintKind[]>(draft.hints ?? []); const [replays, setReplays] = useState(draft.replays ?? 0);
  const [strokes, setStrokes] = useState<CapturedStroke[]>(draft.strokes ?? []); const [canvasPx, setCanvasPx] = useState(draft.canvasPx ?? 300);
  const [reference, setReference] = useState<StrokeReference | null>(null);
  const [pairs, setPairs] = useState<PairResult[]>(draft.pairs ?? []); const [left, setLeft] = useState<string | null>(draft.left ?? null);
  const [retry, setRetry] = useState(draft.retry ?? false); const [error, setError] = useState('');
  const [draftWarning, setDraftWarning] = useState('');
  const composing = useRef(false); const ime = useRef(draft.ime ?? false); const started = useRef(performance.now() - (draft.elapsedMs ?? 0));
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const showing = result && !retry;
  const answered = q.response === 'choice' ? choice !== null : q.response === 'typed' ? text.trim().length > 0 : q.response === 'matching' ? pairs.length === q.pairs?.length : strokes.length > 0;
  useEffect(() => {
    try {
      sessionStorage.setItem(`kansei:answer:${q.id}`, JSON.stringify({ text, choice, hints, replays, strokes, canvasPx, pairs, left, retry, played, ime: ime.current, elapsedMs: performance.now() - started.current } satisfies Draft));
      setDraftWarning('');
    } catch { setDraftWarning('This unsubmitted answer cannot be saved in this tab. Submit it before navigating away.'); }
  }, [q.id, text, choice, hints, replays, strokes, canvasPx, pairs, left, retry, played]);
  const advance = async () => {
    try {
      await onAdvance();
      sessionStorage.removeItem(`kansei:answer:${q.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const send = async (declined = false) => {
    if (composing.current || busy || submitting.current) return;
    submitting.current = true;
    setError('');
    const pointer = strokes[0]?.pointerType;
    const answer: AnswerSubmission = { questionId: q.id, rawInput: text, normalisedInput: normaliseAnswer(text), chosenOptionKey: choice,
      pairResults: pairs, strokes, canvasPx, declined, hintsUsed: hints, audioReplays: replays,
      elapsedMs: Math.max(0, performance.now() - started.current), inputMethod: pointer === 'pen' ? 'stylus' : pointer === 'touch' ? 'touch' : pointer === 'mouse' ? 'mouse' : 'keyboard', imeUsed: ime.current };
    try {
      await (retry ? onRetry(answer) : onSubmit(answer));
      setRetry(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
    }
  };
  const play = async () => { const audio = showing ? services.content.audio(q.targetItemId) : q.prompt.audio; if (!audio) return; try { await services.audio.unlock(); await services.audio.play(audio); if (played) setReplays(n => n + 1); setPlayed(true); } catch (e) { setError(String(e)); } };
  // Mirrors of send/advance, read inside the keydown listener instead of
  // listed as its dependencies: both are recreated every render, so
  // depending on them directly would tear the listener down and rebuild it
  // on every keystroke (same reasoning as Writing.tsx's referenceRef/guidesRef).
  const sendRef = useRef(send); sendRef.current = send;
  const advanceRef = useRef(advance); advanceRef.current = advance;
  useEffect(() => { let active = true; if (q.requiredStrokeData[0]) void services.content.strokes(q.requiredStrokeData[0]).then(r => { if (active) setReference(r ?? null); }).catch(e => setError(String(e))); return () => { active = false; }; }, [q, services]);
  useEffect(() => { if (q.response === 'typed' && !showing) input.current?.focus(); }, [q, showing]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (busy || e.isComposing || composing.current || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
      // A focused button already handles its own Enter/Space activation
      // natively; only step in when nothing is — the common case right
      // after submitting, when the just-removed "Check answer" button
      // leaves focus on nothing in particular.
      const onButton = e.target instanceof Element && e.target.closest('button');
      if (showing) {
        if (onButton || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        void advanceRef.current();
        return;
      }
      if (/^[1-4]$/.test(e.key) && q.options?.[Number(e.key) - 1]) { e.preventDefault(); setChoice(q.options[Number(e.key) - 1]!.key); return; }
      if (!onButton && e.key === 'Enter' && answered) { e.preventDefault(); void sendRef.current(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [q, busy, showing, answered]);
  return <Card padding="lg" className="exercise">
    <p className="eyebrow">{SKILL_LABEL[q.skill] ?? q.skill} · {q.focusedPractice ? 'Focused practice' : (REASON_LABEL[q.selectionReason] ?? q.selectionReason)}</p>
    <h2>{q.prompt.instruction}</h2>
    {q.prompt.text && <div className={`prompt ${q.prompt.textIsJapanese ? 'jp' : ''}`} lang={q.prompt.textIsJapanese ? 'ja' : undefined} style={{ fontFamily: q.prompt.face === 'serif' ? 'var(--font-jp-serif)' : q.prompt.face === 'textbook' ? 'var(--font-jp-hand)' : undefined }}>{q.prompt.text}</div>}
    {q.prompt.context && <p>{q.prompt.context}</p>}{q.prompt.scaffold && <p>{q.prompt.scaffold}</p>}
    {(q.prompt.audio || (showing && services.content.audio(q.targetItemId))) && <Button onClick={() => void play()}>▶ {played ? 'Replay audio' : 'Play audio'}</Button>}
    {error && <p role="alert">{error}</p>}
    {draftWarning && <p role="alert">{draftWarning}</p>}
    {!showing ? <form onSubmit={e => { e.preventDefault(); if (answered) void send(); }}>
      {q.options && <div className="choices">{q.options.map((o, i) => <Button key={o.key} aria-pressed={choice === o.key} disabled={busy} className="choice" onClick={() => setChoice(o.key)}><span className="keycap">{i + 1}</span><span lang="ja">{o.display}</span></Button>)}</div>}
      {q.response === 'typed' && <label className="field">Your answer ({q.inputScript})<input ref={input} value={text} disabled={busy} onChange={e => setText(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} onCompositionStart={() => { composing.current = true; ime.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)) e.preventDefault(); }} /></label>}
      {q.pairs && <><p>Select a character, then its matching reading. No dragging needed.</p><div className="matching"><div>{q.pairs.map(p => <Button key={p.pairId} disabled={busy || pairs.some(r => r.pairId === p.pairId)} aria-pressed={left === p.pairId} onClick={() => setLeft(p.pairId)}>{p.left.display}</Button>)}</div><div>{[...q.pairs].sort((a,b) => a.right.display.localeCompare(b.right.display,'ja')).map(p => <Button key={p.pairId} disabled={busy || !left || pairs.some(r => r.chosenRightItemId === p.right.itemId)} onClick={() => { const n = q.pairs!.length - pairs.length; setPairs([...pairs,{ pairId: left!, chosenRightItemId: p.right.itemId, correct: q.pairs!.find(x => x.pairId === left)!.right.itemId === p.right.itemId, remainingChoices: n, forcedByElimination: n === 1, elapsedMs: performance.now() - started.current }]);setLeft(null); }}>{p.right.display}</Button>)}</div></div><p role="status">{pairs.length} of {q.pairs.length} pairs connected</p></>}
      {q.response === 'handwriting' && <Writing reference={reference} strokes={strokes} guides={retry || hints.includes('reference-animation')} disabled={busy} onChange={(s,size) => { setStrokes(s);setCanvasPx(size); }} />}
      {(retry || hints.includes('reveal-answer')) && <p className="answer jp" lang="ja">{q.canonicalAnswer}</p>}
      <div className="actions"><Button type="submit" variant="primary" disabled={busy || !answered}>Check answer</Button><Button disabled={busy} onClick={() => void send(true)}>I don’t know</Button></div>
      <div className="actions"><Button disabled={busy} onClick={() => setHints(h => [...new Set([...h, 'reveal-answer' as const])])}>Reveal answer</Button>{q.response === 'handwriting' && q.allowedHints.includes('reference-animation') && <Button disabled={busy || !reference} onClick={() => setHints(h => [...new Set([...h, 'reference-animation' as const])])}>Show writing guide</Button>}</div>
    </form> : <div className={`feedback feedback-${result.outcome}`} role="status" aria-live="polite"><h3><span className="feedback-mark" aria-hidden="true">{OUTCOME_MARK[result.outcome]}</span>{retryResult ? `First attempt: ${result.message}` : result.message}</h3>{retryResult && <p>Second try: {retryResult.message}</p>}<div className="answer jp" lang="ja">{q.canonicalAnswer}</div>{result.distinction && <p>{result.distinction}</p>}{q.alsoAcceptableNote && <p>{q.alsoAcceptableNote}</p>}{result.handwriting && <ul>{(['identity','strokeCount','strokeOrder','strokeDirection','shape'] as const).map(k => <li key={k}>{k}: {result.handwriting![k].status}</li>)}</ul>}{result.handwriting?.uncertaintyReason && <p>{result.handwriting.uncertaintyReason}</p>}{result.handwriting?.strokeNotes.map((note, index) => <p key={index}>Stroke {note.strokeIndex + 1}: {note.note}</p>)}<div className="actions"><Button variant="primary" disabled={busy} onClick={() => void advance()}>Continue · +1 XP</Button>{result.outcome !== 'correct' && <Button disabled={busy} title="Practising the correct motion again — it will not change the grade above." onClick={() => { setRetry(true);setStrokes([]);setText('');setChoice(null);setPairs([]);setLeft(null);setError(''); }}>Guided correction</Button>}</div></div>}
  </Card>;
}
