import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { LEARNING_STAGE_LABELS, LEARNING_STAGE_MARK } from '@/domain';
import type { LearningStage } from '@/domain';
import s from './ui.module.css';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ---- Button -------------------------------------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  /** Rendered before the label. Decorative, so it is hidden from assistive tech. */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        s.button,
        s[variant],
        size === 'sm' && s.sizeSm,
        size === 'lg' && s.sizeLg,
        block && s.block,
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});

/* ---- Card ---------------------------------------------------------------- */

export function Card({
  children, className, padding = 'md', flat, as: As = 'section', ...rest
}: {
  children: ReactNode; className?: string; padding?: 'none' | 'md' | 'lg'; flat?: boolean;
  as?: 'section' | 'div' | 'article' | 'li';
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As
      className={cx(s.card, flat && s.cardFlat, padding === 'md' && s.cardPad, padding === 'lg' && s.cardPadLg, className)}
      {...rest}
    >
      {children}
    </As>
  );
}

export function CardHeader({ title, note, action, id }: { title: ReactNode; note?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <header className={s.cardHeader}>
      <div>
        <h2 className={s.cardTitle} id={id}>{title}</h2>
        {note ? <p className={s.cardNote}>{note}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(s.sectionLabel, className)}>{children}</p>;
}

/* ---- Chip ---------------------------------------------------------------- */

export function Chip({ children, mark, className, title }: { children: ReactNode; mark?: string; className?: string; title?: string }) {
  return (
    <span className={cx(s.chip, className)} title={title}>
      {mark ? <span className={s.chipMark} aria-hidden="true">{mark}</span> : null}
      {children}
    </span>
  );
}

const STAGE_CLASS: Record<LearningStage, string> = {
  unseen: s.stageUnseen!,
  learning: s.stageLearning!,
  consolidating: s.stageConsolidating!,
  retained: s.stageRetained!,
};

/**
 * Learning-stage indicator.
 *
 * Three independent carriers of the same information: the tint, the mark glyph,
 * and the text. `compact` drops the visible text but keeps an accessible label,
 * so a dense grid never depends on colour alone.
 */
export function StageChip({ stage, compact, className }: { stage: LearningStage; compact?: boolean; className?: string }) {
  const label = LEARNING_STAGE_LABELS[stage];
  return (
    <span className={cx(s.chip, s.stage, STAGE_CLASS[stage], className)}>
      <span className={s.chipMark} aria-hidden="true">{LEARNING_STAGE_MARK[stage]}</span>
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/** Due for review is deliberately a separate signal from learning stage. */
export function DueChip({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cx(s.chip, s.due, className)}>
      <span className={s.chipMark} aria-hidden="true">↻</span>
      {compact ? <span className="sr-only">Due for review</span> : 'Due'}
    </span>
  );
}

/* ---- Callout ------------------------------------------------------------- */

const CALLOUT_MARK = { info: 'i', ok: '✓', warn: '!', danger: '×', note: '·' } as const;
const CALLOUT_CLASS = {
  info: s.calloutInfo, ok: s.calloutOk, warn: s.calloutWarn, danger: s.calloutDanger, note: s.calloutNote,
} as const;

export function Callout({
  tone = 'info', title, children, className, role,
}: {
  tone?: keyof typeof CALLOUT_CLASS; title?: ReactNode; children: ReactNode; className?: string;
  /** 'status' or 'alert' when the callout appears in response to an action. */
  role?: 'status' | 'alert';
}) {
  return (
    <div className={cx(s.callout, CALLOUT_CLASS[tone], className)} role={role}>
      <span className={s.calloutIcon} aria-hidden="true">{CALLOUT_MARK[tone]}</span>
      <div className={s.calloutBody}>
        {title ? <p className={s.calloutTitle}>{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/* ---- Field + input ------------------------------------------------------- */

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Hide the label visually but keep it for assistive technology. */
  labelHidden?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, labelHidden, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx(s.field, className)}>
      <label className={cx(s.label, labelHidden && 'sr-only')} htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? <p className={s.hint} id={hintId}>{hint}</p> : null}
      {error ? <p className={s.error} id={errorId}>{error}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { answer?: boolean }>(
  function Input({ className, answer, ...rest }, ref) {
    return <input ref={ref} className={cx(s.input, answer && s.answerInput, className)} {...rest} />;
  },
);

/* ---- Switch -------------------------------------------------------------- */

/**
 * A switch built on a real button with `role="switch"`, so it is keyboard
 * operable by default and announces its state. The on/off glyph means the state
 * is never carried by the track colour alone.
 */
export function Switch({
  checked, onChange, label, hint, disabled, id: providedId,
}: {
  checked: boolean; onChange: (next: boolean) => void; label: ReactNode; hint?: ReactNode;
  disabled?: boolean; id?: string;
}) {
  const generated = useId();
  const id = providedId ?? generated;
  const hintId = `${id}-hint`;
  return (
    <div className={s.switchRow}>
      <span className={s.switchText}>
        <label className={s.switchLabel} htmlFor={id}>{label}</label>
        {hint ? <p className={s.switchHint} id={hintId}>{hint}</p> : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        className={s.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={cx(s.switchMark, checked ? s.switchMarkOn : s.switchMarkOff)} aria-hidden="true">
          {checked ? 'I' : 'O'}
        </span>
        <span className={s.switchThumb} />
      </button>
    </div>
  );
}

/* ---- Segmented control --------------------------------------------------- */

/**
 * A radiogroup, not a tablist: it selects a value rather than revealing a panel.
 * Arrow keys move between options, which is what a radiogroup should do.
 */
export function Segmented<T extends string>({
  value, onChange, options, label, stretch, className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: ReactNode; hint?: string }>;
  label: string;
  stretch?: boolean;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx(s.segmented, className)}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.hint}
          tabIndex={value === option.value ? 0 : -1}
          className={cx(s.segment, stretch && s.segmentStretch)}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---- Tabs ---------------------------------------------------------------- */

export function Tabs<T extends string>({
  value, onChange, tabs, label, className,
}: {
  value: T; onChange: (next: T) => void;
  tabs: Array<{ value: T; label: ReactNode; panelId: string }>;
  label: string; className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cx(s.tabList, className)}>
      {tabs.map((tab, i) => (
        <button
          key={tab.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${tab.panelId}-tab`}
          aria-selected={value === tab.value}
          aria-controls={tab.panelId}
          tabIndex={value === tab.value ? 0 : -1}
          className={s.tab}
          onClick={() => onChange(tab.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1); }
            if (e.key === 'Home') { e.preventDefault(); move(i, -i); }
            if (e.key === 'End') { e.preventDefault(); move(i, tabs.length - 1 - i); }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ---- Dialog -------------------------------------------------------------- */

/**
 * Built on <dialog showModal()>, which gives focus trapping, Escape handling and
 * the top-layer backdrop from the platform rather than from our own code.
 */
export function Dialog({
  open, onClose, title, children, actions, className,
}: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
  actions?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx(s.dialog, className)}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className={s.dialogBody}>
        <h2 className={s.dialogTitle} id={titleId}>{title}</h2>
        {children}
      </div>
      {actions ? <div className={s.dialogActions}>{actions}</div> : null}
    </dialog>
  );
}

/* ---- Progress ------------------------------------------------------------ */

export function ProgressBar({
  value, max, label, tone = 'accent', className,
}: { value: number; max: number; label: string; tone?: 'accent' | 'ok'; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={cx(s.bar, className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-label={label}
    >
      <div className={cx(s.barFill, tone === 'ok' && s.barFillOk)} style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/** A ring for the daily XP goal. The number beside it carries the same value. */
export function ProgressRing({
  value, max, size = 44, thickness = 4, label, met,
}: { value: number; max: number; size?: number; thickness?: number; label: string; met?: boolean }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <svg
      className={s.ring}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className={s.ringTrack} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={thickness}
        className={cx(s.ringFill, met && s.ringFillMet)}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/* ---- Empty state --------------------------------------------------------- */

export function EmptyState({
  mark = '静', title, children, action,
}: { mark?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyMark} aria-hidden="true">{mark}</span>
      <p className={s.emptyTitle}>{title}</p>
      {children ? <div className={s.emptyBody}>{children}</div> : null}
      {action}
    </div>
  );
}

/* ---- Keyboard hint ------------------------------------------------------- */

/** Visible shortcut hint. Hidden from assistive tech: the control's own
 *  accessible name already states the shortcut where one exists. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd} aria-hidden="true">{children}</kbd>;
}

/* ---- Japanese glyph ------------------------------------------------------ */

/**
 * A Japanese glyph at display size.
 *
 * `face` exists because the app deliberately shows the same character in
 * different legitimate typefaces: the textbook face shows the handwritten
 * letterform, which differs from the printed one for several kana.
 */
export function Glyph({
  children, size = 'lg', face = 'sans', className, lang = 'ja', ...rest
}: {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  face?: 'sans' | 'serif' | 'hand';
  className?: string;
  lang?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const sizeClass = { sm: s.glyphSm, md: s.glyphMd, lg: s.glyphLg, xl: s.glyphXl, hero: s.glyphHero }[size];
  const faceClass = { sans: undefined, serif: s.glyphSerif, hand: s.glyphHand }[face];
  return (
    <span className={cx(s.glyph, sizeClass, faceClass, className)} lang={lang} {...rest}>
      {children}
    </span>
  );
}

export function Skeleton({ width, height, className }: { width?: string | number; height?: string | number; className?: string }) {
  return <span className={cx(s.skeleton, className)} style={{ display: 'block', inlineSize: width, blockSize: height }} aria-hidden="true" />;
}

/* ---- Live region --------------------------------------------------------- */

interface AnnouncerValue {
  /** Announce a result or state change to assistive technology. */
  announce: (message: string, urgency?: 'polite' | 'assertive') => void;
}

const AnnouncerContext = createContext<AnnouncerValue | null>(null);

/**
 * A single pair of live regions for the whole app.
 *
 * Results are announced through here rather than by moving focus, so a screen
 * reader hears "Correct. ツ." without the keyboard position jumping mid-session.
 * The message is cleared and re-set so two identical results still announce.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  const announce = useCallback((message: string, urgency: 'polite' | 'assertive' = 'polite') => {
    const set = urgency === 'assertive' ? setAssertive : setPolite;
    set('');
    // A frame's gap guarantees the region is seen to change even when the text
    // repeats; without it, an identical message is silently dropped.
    requestAnimationFrame(() => set(message));
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnouncerValue {
  const ctx = useContext(AnnouncerContext);
  // A missing provider must not crash a practice session; announcements are an
  // enhancement, and a no-op is the correct degradation.
  return ctx ?? { announce: () => {} };
}

export { cx };
