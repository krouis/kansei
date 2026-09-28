import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '@/ui/primitives';
import { useReducedMotion } from '@/app/theme';
import c from './charts.module.css';

/**
 * Progress charts.
 *
 * Hand-built SVG rather than a charting dependency: the app must work offline
 * from local files only, the shapes needed are few, and a library would not know
 * that the daily goal changes per day or that a value must never be available
 * only as a colour.
 *
 * Every chart here follows the same three rules:
 *  - The plot is `aria-hidden` and sits beside a real <table> of the same
 *    numbers, reachable from a visible control. Nothing is colour-only.
 *  - Marks are thin, data-ends are rounded and anchored to the baseline, and the
 *    grid and axes stay recessive.
 *  - Hover and keyboard focus both reveal the same tooltip, so no information is
 *    hover-only.
 */

/* ---- Frame --------------------------------------------------------------- */

export function ChartFrame({
  title, note, children, table, tableLabel = 'Show the numbers', action,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  /** The same data as a table. Required: it is the non-visual route to the values. */
  table: ReactNode;
  tableLabel?: string;
  action?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <figure className={cx(c.frame, c.viz)} style={{ margin: 0 }}>
      <div className={c.frameHead}>
        <figcaption>
          <div className={c.frameTitle}>{title}</div>
          {note ? <div className={c.frameNote}>{note}</div> : null}
        </figcaption>
        {action}
      </div>
      {children}
      <button
        type="button"
        className={c.tableToggle}
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((v) => !v)}
      >
        {showTable ? 'Hide the numbers' : tableLabel}
      </button>
      <div id={tableId} hidden={!showTable} className="scroll-x">
        {table}
      </div>
    </figure>
  );
}

/* ---- Tooltip ------------------------------------------------------------- */

interface TipState {
  x: number;
  y: number;
  title: string;
  rows: string[];
}

function Tooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  // Flip the tooltip to the left of the cursor near the right edge so it never
  // pushes the container wider and causes a horizontal scroll.
  const flip = tip.x > width * 0.62;
  return (
    <div
      className={c.tooltip}
      style={{
        left: flip ? undefined : `${tip.x}px`,
        right: flip ? `${width - tip.x}px` : undefined,
        top: `${tip.y}px`,
        transform: 'translateY(-100%)',
      }}
      role="presentation"
    >
      <div className={c.tooltipTitle}>{tip.title}</div>
      {tip.rows.map((row) => (
        <div className={c.tooltipRow} key={row}>{row}</div>
      ))}
    </div>
  );
}

/* ---- Daily XP ------------------------------------------------------------ */

export interface DailyXpDatum {
  localDate: string;
  xp: number;
  /** The goal that applied on this date, which may differ from today's. */
  goalXp: number;
  goalMet: boolean;
}

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
};

const longDate = (iso: string) => {
  // Parsed as UTC deliberately: the string is already a local calendar date, so
  // re-interpreting it in the viewer's zone would shift it by a day.
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * Daily XP with the goal that applied on each day.
 *
 * The goal is drawn as a step line rather than one flat rule, because the
 * learner can change it and history must not be rewritten: a day on which the
 * goal was 10 XP shows a 10 XP line even if the goal is 40 today.
 */
export function DailyXpChart({ data, height = 168 }: { data: DailyXpDatum[]; height?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const reduced = useReducedMotion();

  const pad = { top: 18, right: 8, bottom: 22, left: 30 };
  // Bars get a fixed width so a long range scrolls rather than compressing into
  // unreadable hairlines.
  const barWidth = 12;
  const gap = 4;
  const plotWidth = Math.max(data.length * (barWidth + gap) - gap, 1);
  const width = plotWidth + pad.left + pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const maxValue = Math.max(10, ...data.map((d) => Math.max(d.xp, d.goalXp)));
  // Round the axis top to a friendly number so the gridlines read cleanly.
  const step = maxValue <= 40 ? 10 : maxValue <= 120 ? 20 : 50;
  const axisTop = Math.ceil(maxValue / step) * step;
  const y = (v: number) => pad.top + plotHeight - (v / axisTop) * plotHeight;
  const x = (i: number) => pad.left + i * (barWidth + gap);

  const ticks = Array.from({ length: axisTop / step + 1 }, (_, i) => i * step);

  // The goal step path: a horizontal run per day, stepping where it changes.
  const goalPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(d.goalXp)}L${x(i) + barWidth} ${y(d.goalXp)}`)
    .join('');

  const total = data.reduce((sum, d) => sum + d.xp, 0);
  const metDays = data.filter((d) => d.goalMet).length;

  return (
    <ChartFrame
      title="Daily XP"
      note={`${total} XP over ${data.length} day${data.length === 1 ? '' : 's'} · goal met on ${metDays}`}
      table={
        <table className={c.table}>
          <caption>Daily XP against the goal that applied on each day.</caption>
          <thead>
            <tr><th scope="col">Date</th><th scope="col">XP</th><th scope="col">Goal that day</th><th scope="col">Goal met</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.localDate}>
                <td>{d.localDate}</td><td>{d.xp}</td><td>{d.goalXp}</td><td>{d.goalMet ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className={c.plotWrap}>
        <div className={c.plotScroll}>
          <svg
            className={c.plot}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width, maxWidth: 'none' }}
            aria-hidden="true"
            onPointerLeave={() => setTip(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className={c.gridLine} x1={pad.left} y1={y(t)} x2={width - pad.right} y2={y(t)} />
                <text className={c.axisText} x={pad.left - 6} y={y(t) + 3.5} textAnchor="end">{t}</text>
              </g>
            ))}

            {data.map((d, i) => {
              const barHeight = Math.max(d.xp > 0 ? 2 : 0, (d.xp / axisTop) * plotHeight);
              return (
                <g key={d.localDate}>
                  <rect
                    className={d.goalMet ? c.barMet : c.bar}
                    x={x(i)}
                    y={y(d.xp)}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    ry={4}
                    style={reduced ? undefined : { transition: 'y 320ms cubic-bezier(.22,.61,.36,1), height 320ms cubic-bezier(.22,.61,.36,1)' }}
                  />
                  {/* Goal met carries a glyph too, so it is not shade-only. */}
                  {d.goalMet ? (
                    <circle className={c.metMark} cx={x(i) + barWidth / 2} cy={pad.top - 7} r={2.5} />
                  ) : null}
                  {/* A generous, invisible hit area: the bar itself is only 12px. */}
                  <rect
                    className={c.barHover}
                    x={x(i) - gap / 2}
                    y={pad.top}
                    width={barWidth + gap}
                    height={plotHeight}
                    onPointerEnter={() =>
                      setTip({
                        x: x(i) + barWidth / 2,
                        y: pad.top + plotHeight,
                        title: longDate(d.localDate),
                        rows: [`${d.xp} XP`, `Goal that day: ${d.goalXp}`, d.goalMet ? 'Goal met' : 'Goal not met'],
                      })
                    }
                  />
                </g>
              );
            })}

            <path className={c.goalStep} d={goalPath} />
            <line className={c.axisLine} x1={pad.left} y1={pad.top + plotHeight} x2={width - pad.right} y2={pad.top + plotHeight} />

            {data.map((d, i) =>
              // Label roughly every seventh day so the axis never crowds.
              i % Math.max(1, Math.ceil(data.length / 8)) === 0 ? (
                <text key={d.localDate} className={c.axisText} x={x(i) + barWidth / 2} y={height - 7} textAnchor="middle">
                  {shortDate(d.localDate)}
                </text>
              ) : null,
            )}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </ChartFrame>
  );
}

/* ---- Practice calendar --------------------------------------------------- */

export interface CalendarDatum {
  localDate: string;
  xp: number;
  goalXp: number;
  goalMet: boolean;
}

const CAL_CLASS = [c.calCell0, c.calCell1, c.calCell2, c.calCell3, c.calCell4, c.calCell5];

/**
 * A practice calendar.
 *
 * Intensity is the share of that day's own goal, not an absolute XP figure, so a
 * learner with a 10 XP goal and one with a 60 XP goal both see a full cell for a
 * day they completed. A met day also carries a ring, so "met" never depends on
 * judging one shade against another.
 */
export function PracticeCalendar({ data, weeks = 26 }: { data: CalendarDatum[]; weeks?: number }) {
  const byDate = useMemo(() => new Map(data.map((d) => [d.localDate, d])), [data]);

  const columns = useMemo(() => {
    if (data.length === 0) return [];
    const last = data[data.length - 1]!.localDate;
    const end = new Date(`${last}T00:00:00Z`);
    // Walk back to the Sunday at or before the start of the window.
    const endDow = end.getUTCDay();
    const endOfWeek = new Date(end.getTime() + (6 - endDow) * 86400000);
    const start = new Date(endOfWeek.getTime() - (weeks * 7 - 1) * 86400000);
    const cols: Array<Array<{ iso: string; datum: CalendarDatum | undefined; future: boolean }>> = [];
    for (let w = 0; w < weeks; w += 1) {
      const col: Array<{ iso: string; datum: CalendarDatum | undefined; future: boolean }> = [];
      for (let d = 0; d < 7; d += 1) {
        const day = new Date(start.getTime() + (w * 7 + d) * 86400000);
        const iso = day.toISOString().slice(0, 10);
        col.push({ iso, datum: byDate.get(iso), future: iso > last });
      }
      cols.push(col);
    }
    return cols;
  }, [data, byDate, weeks]);

  const [tip, setTip] = useState<TipState | null>(null);
  const practised = data.filter((d) => d.xp > 0).length;

  const level = (d: CalendarDatum | undefined) => {
    if (!d || d.xp <= 0) return 0;
    const share = d.goalXp > 0 ? d.xp / d.goalXp : 1;
    if (share >= 1) return 5;
    if (share >= 0.66) return 4;
    if (share >= 0.4) return 3;
    if (share >= 0.15) return 2;
    return 1;
  };

  return (
    <ChartFrame
      title="Practice calendar"
      note={`Practised on ${practised} of the last ${data.length} recorded day${data.length === 1 ? '' : 's'}`}
      table={
        <table className={c.table}>
          <caption>Days practised, with XP and the goal that applied.</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">XP</th><th scope="col">Goal that day</th></tr></thead>
          <tbody>
            {data.filter((d) => d.xp > 0).map((d) => (
              <tr key={d.localDate}><td>{d.localDate}</td><td>{d.xp}</td><td>{d.goalXp}</td></tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className={c.plotWrap}>
        <div className={c.plotScroll}>
          <div style={{ display: 'flex' }} aria-hidden="true">
            <div className={c.calDays}>
              {['', 'M', '', 'W', '', 'F', ''].map((label, i) => (
                <span className={c.calDayLabel} key={i}>{label}</span>
              ))}
            </div>
            <div className={c.calGrid} onPointerLeave={() => setTip(null)}>
              {columns.map((col, w) => (
                <div className={c.calWeek} key={w}>
                  {col.map(({ iso, datum, future }) => (
                    <span
                      key={iso}
                      className={cx(
                        c.calCell,
                        CAL_CLASS[level(datum)],
                        datum?.goalMet && c.calCellMet,
                      )}
                      style={future ? { visibility: 'hidden' } : undefined}
                      onPointerEnter={(e) => {
                        if (future) return;
                        const host = e.currentTarget.closest(`.${c.plotWrap}`) as HTMLElement | null;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const hostRect = host?.getBoundingClientRect();
                        setTip({
                          x: rect.left - (hostRect?.left ?? 0) + rect.width / 2,
                          y: rect.top - (hostRect?.top ?? 0),
                          title: longDate(iso),
                          rows: datum && datum.xp > 0
                            ? [`${datum.xp} XP`, `Goal that day: ${datum.goalXp}`]
                            : ['No practice'],
                        });
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <Tooltip tip={tip} width={520} />
      </div>
      <div className={c.calLegend}>
        <span>Less</span>
        <span className={c.calLegendScale} aria-hidden="true">
          {CAL_CLASS.map((cls, i) => <span className={cx(c.calCell, cls)} key={i} />)}
        </span>
        <span>More (share of that day&rsquo;s goal)</span>
      </div>
    </ChartFrame>
  );
}

/* ---- Horizontal bars (small multiples) ---------------------------------- */

export interface HBarDatum {
  label: string;
  /** 0..1, or null when there is not enough data to report a rate. */
  value: number | null;
  /** Denominator, shown so a 100% from two attempts is not read as mastery. */
  count: number;
  /** Below this many attempts the row reports "not enough data" instead. */
  minCount?: number;
  detail?: string;
}

/**
 * One bar per row, all in a single hue.
 *
 * Identity comes from the row label, which is why no categorical palette is
 * needed here — and a row with too few attempts says so rather than drawing a
 * bar that would read as a real rate.
 */
export function HBarList({
  title, note, data, unit = '%', table,
}: {
  title: ReactNode; note?: ReactNode; data: HBarDatum[]; unit?: string; table?: ReactNode;
}) {
  return (
    <ChartFrame
      title={title}
      note={note}
      table={
        table ?? (
          <table className={c.table}>
            <thead><tr><th scope="col">Item</th><th scope="col">Rate</th><th scope="col">Attempts</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td>{d.value === null || d.count < (d.minCount ?? 5) ? '—' : `${Math.round(d.value * 100)}${unit}`}</td>
                  <td>{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    >
      <div className={c.hbarList}>
        {data.map((d) => {
          const enough = d.value !== null && d.count >= (d.minCount ?? 5);
          return (
            <div className={c.hbarRow} key={d.label}>
              <span className={c.hbarLabel}>{d.label}</span>
              {enough ? (
                <span
                  className={c.hbarTrack}
                  role="img"
                  aria-label={`${d.label}: ${Math.round(d.value! * 100)}${unit} from ${d.count} attempts`}
                >
                  <span className={c.hbarFill} style={{ inlineSize: `${Math.round(d.value! * 100)}%` }} />
                </span>
              ) : (
                <span className={c.hbarInsufficient}>Not enough practice yet</span>
              )}
              <span className={c.hbarValue}>
                {enough ? `${Math.round(d.value! * 100)}${unit}` : '—'}
                <span style={{ color: 'var(--ink-faint)' }}>{` · ${d.count}`}</span>
              </span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

/* ---- Stage composition --------------------------------------------------- */

export interface StageBarDatum {
  label: string;
  learning: number;
  consolidating: number;
  retained: number;
  /** Not started. Drawn as the unfilled track, not as a series colour. */
  unseen: number;
}

/**
 * Characters by learning stage, per skill.
 *
 * The three reached stages use consecutive steps of the sequential ramp, because
 * stage is ordinal; "not started" is the empty track. Segments are separated by
 * a 2px surface gap so neighbouring steps never blend, and each segment is
 * labelled in the table view.
 */
export function StageBars({ title, note, data }: { title: ReactNode; note?: ReactNode; data: StageBarDatum[] }) {
  return (
    <ChartFrame
      title={title}
      note={note}
      table={
        <table className={c.table}>
          <caption>Characters by learning stage. Stages are based on repeated, spaced, unaided performance.</caption>
          <thead>
            <tr>
              <th scope="col">Skill</th><th scope="col">Learning</th>
              <th scope="col">Consolidating</th><th scope="col">Retained</th><th scope="col">Not started</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td><td>{d.learning}</td><td>{d.consolidating}</td><td>{d.retained}</td><td>{d.unseen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className={c.hbarList}>
        {data.map((d) => {
          const total = d.learning + d.consolidating + d.retained + d.unseen;
          const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
          return (
            <div className={c.hbarRow} key={d.label}>
              <span className={c.hbarLabel}>{d.label}</span>
              <span
                className={c.hbarTrack}
                style={{ blockSize: '0.75rem' }}
                role="img"
                aria-label={`${d.label}: ${d.retained} retained, ${d.consolidating} consolidating, ${d.learning} learning, ${d.unseen} not started, of ${total}`}
              >
                <span style={{ display: 'flex', blockSize: '100%', gap: 2 }}>
                  {d.learning > 0 ? <span className={c.seg1} style={{ inlineSize: `${pct(d.learning)}%` }} /> : null}
                  {d.consolidating > 0 ? <span className={c.seg2} style={{ inlineSize: `${pct(d.consolidating)}%` }} /> : null}
                  {d.retained > 0 ? <span className={c.seg3} style={{ inlineSize: `${pct(d.retained)}%` }} /> : null}
                </span>
              </span>
              <span className={c.hbarValue}>
                {d.retained}
                <span style={{ color: 'var(--ink-faint)' }}>{` / ${total}`}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className={c.calLegend}>
        {[
          ['Learning', c.seg1],
          ['Consolidating', c.seg2],
          ['Retained', c.seg3],
          ['Not started', c.barTrack],
        ].map(([label, cls]) => (
          <span key={label as string} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className={cx(c.calCell, cls as string)} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}

/* ---- Trend line ---------------------------------------------------------- */

export interface TrendPoint {
  label: string;
  /** 0..1, or null when the window had too few reviews to report. */
  value: number | null;
  count: number;
}

/**
 * A trend over time — used for delayed, unaided retention.
 *
 * Windows with too few reviews are a genuine gap in the line rather than a
 * smoothed-over guess, because inventing a value here would misrepresent how
 * much evidence there is.
 */
export function TrendLine({
  title, note, data, height = 140,
}: { title: ReactNode; note?: ReactNode; data: TrendPoint[]; height?: number }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const pad = { top: 14, right: 12, bottom: 22, left: 34 };
  const width = Math.max(280, data.length * 34) + pad.left + pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const plotWidth = width - pad.left - pad.right;

  const x = (i: number) => pad.left + (data.length <= 1 ? plotWidth / 2 : (i / (data.length - 1)) * plotWidth);
  const y = (v: number) => pad.top + plotHeight - v * plotHeight;

  // Break the path wherever data is missing rather than bridging the gap.
  const segments: Array<Array<{ i: number; v: number }>> = [];
  let current: Array<{ i: number; v: number }> = [];
  data.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ i, v: p.value });
    }
  });
  if (current.length) segments.push(current);

  return (
    <ChartFrame
      title={title}
      note={note}
      table={
        <table className={c.table}>
          <caption>Delayed, unaided retention by period. A dash means too few reviews in that period to report a rate.</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">Retention</th><th scope="col">Reviews</th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td>{p.value === null ? '—' : `${Math.round(p.value * 100)}%`}</td>
                <td>{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className={c.plotWrap}>
        <div className={c.plotScroll}>
          <svg
            className={c.plot}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width, maxWidth: 'none' }}
            aria-hidden="true"
            onPointerLeave={() => setTip(null)}
          >
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line className={c.gridLine} x1={pad.left} y1={y(t)} x2={width - pad.right} y2={y(t)} />
                <text className={c.axisText} x={pad.left - 6} y={y(t) + 3.5} textAnchor="end">{`${t * 100}%`}</text>
              </g>
            ))}
            {segments.map((seg, si) => (
              <path
                key={si}
                className={c.line}
                d={seg.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i)} ${y(p.v)}`).join(' ')}
              />
            ))}
            {data.map((p, i) =>
              p.value === null ? null : (
                <g key={p.label}>
                  <circle className={c.point} cx={x(i)} cy={y(p.value)} r={4} />
                  <rect
                    className={c.barHover}
                    x={x(i) - 16}
                    y={pad.top}
                    width={32}
                    height={plotHeight}
                    onPointerEnter={() =>
                      setTip({
                        x: x(i),
                        y: y(p.value!) - 6,
                        title: p.label,
                        rows: [`${Math.round(p.value! * 100)}% retained`, `${p.count} review${p.count === 1 ? '' : 's'}`],
                      })
                    }
                  />
                </g>
              ),
            )}
            <line className={c.axisLine} x1={pad.left} y1={pad.top + plotHeight} x2={width - pad.right} y2={pad.top + plotHeight} />
            {data.map((p, i) =>
              i % Math.max(1, Math.ceil(data.length / 6)) === 0 ? (
                <text key={p.label} className={c.axisText} x={x(i)} y={height - 7} textAnchor="middle">{p.label}</text>
              ) : null,
            )}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </ChartFrame>
  );
}
