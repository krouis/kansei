import { useEffect, useRef, useState } from 'react';
import type { CapturedStroke, StrokeReference } from '@/domain';
import { attachStrokeCapture } from '@/handwriting/capture';
import { createTraceCoach } from '@/handwriting/coach';
import { toleranceFor } from '@/handwriting/tolerance';
import { Button } from '@/ui/primitives';
import { useReducedMotion } from '@/app/theme';

export function Writing({ reference, strokes, onChange, guides, disabled = false }: {
  reference: StrokeReference | null; strokes: CapturedStroke[];
  onChange: (strokes: CapturedStroke[], size: number) => void; guides: boolean; disabled?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const value = useRef(strokes); value.current = strokes;
  const change = useRef(onChange); change.current = onChange;
  const [partial, setPartial] = useState<CapturedStroke | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const [coaching, setCoaching] = useState('');
  const reduced = useReducedMotion();
  useEffect(() => {
    const svg = ref.current;
    if (!svg || disabled) return;
    const controller = attachStrokeCapture(svg as unknown as HTMLElement, {
      onStrokeStart: s => setPartial({ ...s, points: [...s.points] }),
      onStrokeUpdate: s => setPartial({ ...s, points: [...s.points] }),
      onStrokeEnd: s => {
        setPartial(null);
        const size = svg.getBoundingClientRect().width;
        if (guides && reference) {
          const tolerance = toleranceFor(size, s.pointerType);
          const coach = createTraceCoach(reference, tolerance);
          // Recompute the next expected stroke after undo/clear; a rejected
          // trace remains visible until the learner explicitly undoes it.
          for (const previous of value.current) coach.evaluateStroke(previous, coach.expectedStrokeIndex, { reference, tolerance, targetGlyph: reference.glyph, mode: 'learning', alternatives: [] });
          const result = coach.evaluateStroke(s, coach.expectedStrokeIndex, { reference, tolerance, targetGlyph: reference.glyph, mode: 'learning', alternatives: [] });
          setCoaching(result.coaching + (result.accepted ? '' : ' Undo that stroke to try it again.'));
        }
        change.current([...value.current, s], size);
      },
      onStrokeCancelled: () => setPartial(null),
    });
    return () => controller.destroy();
  }, [disabled, guides, reference]);
  useEffect(() => { if (!strokes.length) setCoaching(''); }, [strokes.length]);
  useEffect(() => {
    if (replay === null || !reference) return;
    const timer = setTimeout(() => setReplay(replay >= reference.strokes.length ? null : replay + 1), reduced ? 1500 : 650);
    return () => clearTimeout(timer);
  }, [replay, reference, reduced]);
  return <div className="writing">
    <svg ref={ref} viewBox="0 0 109 109" role="img" aria-label="Handwriting canvas. Draw with a finger, mouse, or stylus." className="writing-canvas">
      <path d="M54.5 0V109M0 54.5H109" stroke="var(--canvas-grid)" strokeWidth=".4" strokeDasharray="2 2" />
      {guides && reference?.strokes.map((s, i) => <path key={i} d={s.path} fill="none" stroke={replay !== null && i < replay ? 'var(--accent)' : 'var(--canvas-guide)'} strokeWidth="2" strokeLinecap="round" />)}
      {[...strokes, ...(partial ? [partial] : [])].map((s, i) => <polyline key={i} points={s.points.map(p => `${p.x * 109},${p.y * 109}`).join(' ')} fill="none" stroke="var(--canvas-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    <div className="actions"><Button disabled={disabled || !strokes.length} onClick={() => onChange(strokes.slice(0, -1), ref.current?.getBoundingClientRect().width ?? 300)}>Undo stroke</Button><Button disabled={disabled || !strokes.length} onClick={() => onChange([], ref.current?.getBoundingClientRect().width ?? 300)}>Clear</Button>{guides && reference && <Button onClick={() => setReplay(reduced ? reference.strokes.length : 1)}>Replay reference</Button>}</div>
    {guides && <p role="status" aria-live="polite">{coaching || 'Follow the guide in stroke order. This is guided practice, not unaided recall.'}</p>}
    {guides && <small>Stroke reference: KanjiVG · Ulrich Apel and contributors · CC BY-SA 3.0. Canonical form; legitimate variants are not yet comprehensively supported.</small>}
  </div>;
}
