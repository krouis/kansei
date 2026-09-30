/**
 * A small looping brush-stroke mark, used to fill genuinely dead time (a
 * content download, a first boot) with something that feels like the app's
 * own hand rather than a bare progress bar.
 *
 * Deliberately abstract, not a real taught character: content packs — which
 * include the real stroke reference data — are exactly what may still be
 * installing wherever this is shown, so drawing a specific kana or kanji here
 * would either need data that isn't there yet or risk being read as a stroke
 * lesson. This is decoration, and is never presented as anything else.
 *
 * The animation is a plain CSS `stroke-dashoffset` loop (see app.css's
 * `.ink-flourish`), which collapses to a static, fully-drawn mark under
 * `prefers-reduced-motion` / an explicit reduced-motion choice.
 */
export function InkFlourish({ size = 56 }: { size?: number }) {
  return (
    <svg
      className="ink-flourish"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="presentation"
      aria-hidden="true"
    >
      <path d="M10 40 Q 22 12, 34 28 T 54 20" />
    </svg>
  );
}
