import type { CapturedStroke } from '@/domain';

/**
 * Stroke capture over Pointer Events.
 *
 * Framework-agnostic on purpose: this is attached to a plain `HTMLElement` (a
 * `<canvas>` or an SVG surface) and reports finished strokes through a
 * callback, so the React layer only has to render.
 *
 * Rules encoded here, each because a real device would otherwise break it:
 *  - `setPointerCapture` so a fast stroke that leaves the element's bounds
 *    while the pointer is down keeps being tracked.
 *  - A SECOND simultaneous pointer is ignored outright, not merged into the
 *    first stroke — a stray palm touch while a stylus is down must not warp
 *    the stroke being drawn.
 *  - `pointercancel` (a palm rejection, a system gesture taking over) discards
 *    the in-progress stroke rather than submitting a truncated one.
 *  - `getCoalescedEvents()` is read when the browser supports it, so a fast
 *    stroke is not undersampled between two `pointermove` events.
 *  - `touch-action: none` is set on the element by the caller (this module
 *    only captures; see PRACTICE-facing components for the style), and this
 *    module additionally calls `preventDefault()` on every drawing pointer
 *    event so a stray page scroll or pull-to-refresh cannot start mid-stroke.
 */

export interface StrokeCaptureOptions {
  onStrokeStart?: (partial: CapturedStroke) => void;
  onStrokeUpdate?: (partial: CapturedStroke) => void;
  onStrokeEnd: (stroke: CapturedStroke) => void;
  onStrokeCancelled?: () => void;
}

export interface StrokeCaptureController {
  /** Remove all listeners. Call on unmount. */
  destroy(): void;
  /** True while a stroke is actively being drawn. */
  readonly drawing: boolean;
}

function pointerTypeOf(e: PointerEvent): CapturedStroke['pointerType'] {
  if (e.pointerType === 'pen' || e.pointerType === 'touch' || e.pointerType === 'mouse') return e.pointerType;
  return 'unknown';
}

/** Normalise a client-space point to 0..1 within the element's content box. */
function normalisePoint(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / w)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / h)),
  };
}

export function attachStrokeCapture(el: HTMLElement, options: StrokeCaptureOptions): StrokeCaptureController {
  let activePointerId: number | null = null;
  let current: CapturedStroke | null = null;

  const pointFromEvent = (e: PointerEvent): CapturedStroke['points'][number] => {
    const p = normalisePoint(el, e.clientX, e.clientY);
    return { x: p.x, y: p.y, t: e.timeStamp, pressure: e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : null };
  };

  const onPointerDown = (e: PointerEvent) => {
    // A second finger while one stroke is already down is ignored entirely,
    // not merged: multi-touch drawing has no sensible single interpretation.
    if (activePointerId !== null) return;
    if (!e.isPrimary && e.pointerType === 'touch') return;
    e.preventDefault();
    activePointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    current = {
      points: [pointFromEvent(e)],
      pointerType: pointerTypeOf(e),
      startedAt: e.timeStamp,
      endedAt: e.timeStamp,
    };
    options.onStrokeStart?.(current);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId || !current) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const source = events.length > 0 ? events : [e];
    for (const ev of source) current.points.push(pointFromEvent(ev));
    current.endedAt = e.timeStamp;
    options.onStrokeUpdate?.(current);
  };

  const finish = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    e.preventDefault();
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already have been released by the browser; not an error.
    }
    const finished = current;
    activePointerId = null;
    current = null;
    if (finished && finished.points.length >= 2) {
      finished.endedAt = e.timeStamp;
      options.onStrokeEnd(finished);
    } else {
      options.onStrokeCancelled?.();
    }
  };

  const onPointerUp = (e: PointerEvent) => finish(e);
  const onPointerCancel = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    activePointerId = null;
    current = null;
    options.onStrokeCancelled?.();
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  // A leftover pointerleave while captured is not a cancellation (capture keeps
  // delivering events outside the element); only a genuine up/cancel ends a
  // stroke, which is exactly what setPointerCapture is for.

  return {
    destroy() {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
    },
    get drawing() {
      return activePointerId !== null;
    },
  };
}

/** Remove the last stroke from a list. Pure, for easy testing and undo stacks. */
export function undoLastStroke(strokes: readonly CapturedStroke[]): CapturedStroke[] {
  return strokes.slice(0, -1);
}
