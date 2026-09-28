#!/usr/bin/env node
/**
 * Validates the data-visualisation palette.
 *
 * Progress charts encode two kinds of value, and each gets the encoding that
 * suits it rather than whichever colours were to hand:
 *
 *  - Learning stage and practice volume are ORDINAL, so they use a single-hue
 *    sequential ramp. This check enforces what makes a ramp readable: strictly
 *    monotonic lightness, and enough separation between neighbouring steps to be
 *    told apart. A ramp needs no colour-vision discrimination at all, which is
 *    why it is the right choice here — four muted hues cannot pass a CVD check,
 *    and the "not started" state is a near-grey that never will.
 *  - Accuracy per skill is CATEGORICAL, but it is drawn as small multiples with
 *    one bar each, so identity comes from the row label and no hue set is needed.
 *
 * Run by `npm run check:viz`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/features/progress/charts.module.css'), 'utf8');

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToOklab(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}
const deltaE = (x, y) => {
  const A = hexToOklab(x), B = hexToOklab(y);
  return Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b) * 100;
};
const luminance = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Pull `--viz-<name>: #hex` declarations out of a selector block. */
function ramp(selector, prefix, count) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`selector not found: ${selector}`);
  const j = css.indexOf('}', i);
  const block = css.slice(i, j);
  const out = [];
  for (let n = 1; n <= count; n += 1) {
    const m = block.match(new RegExp(`--${prefix}-${n}:\\s*(#[0-9a-fA-F]{3,8})`));
    if (!m) throw new Error(`missing --${prefix}-${n} in ${selector}`);
    out.push(m[1]);
  }
  return out;
}

/** Minimum perceptual gap between neighbouring ramp steps (OKLab ×100). */
const MIN_STEP_DELTA = 8;
/** The darkest ramp step also carries marks and must read against the surface. */
const MIN_MARK_CONTRAST = 3;

let failures = 0;
const check = (ok, line) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line}`);
};

for (const [mode, selector, surface] of [
  ['light', '.viz {', '#ffffff'],
  ['dark', ":root[data-theme='dark'] .viz {", '#1c1f25'],
]) {
  console.log(`\n${mode.toUpperCase()}  (surface ${surface})`);
  const seq = ramp(selector, 'viz-seq', 5);

  // Monotonic lightness, in the direction the ramp is meant to run: light to
  // dark on a light surface, dark to light on a dark one.
  const ls = seq.map((c) => hexToOklab(c).L);
  const ascending = mode === 'dark';
  const monotonic = ls.every((L, i) => i === 0 || (ascending ? L > ls[i - 1] : L < ls[i - 1]));
  check(monotonic, `sequential ramp lightness is monotonic ${ascending ? 'up' : 'down'}: ${ls.map((L) => L.toFixed(3)).join(' → ')}`);

  for (let i = 1; i < seq.length; i += 1) {
    const d = deltaE(seq[i - 1], seq[i]);
    check(d >= MIN_STEP_DELTA, `step ${i}→${i + 1} separation ΔE ${d.toFixed(1)} (min ${MIN_STEP_DELTA})  ${seq[i - 1]} → ${seq[i]}`);
  }

  const markStep = mode === 'dark' ? seq[4] : seq[4];
  check(
    contrast(markStep, surface) >= MIN_MARK_CONTRAST,
    `darkest/brightest step ${markStep} vs surface: ${contrast(markStep, surface).toFixed(2)}:1 (min ${MIN_MARK_CONTRAST})`,
  );

  // The goal reference line and the axis ink must both be legible.
  for (const name of ['viz-goal', 'viz-axis', 'viz-ink']) {
    const m = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector))).match(
      new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`),
    );
    if (!m) { check(false, `missing --${name}`); continue; }
    const min = name === 'viz-ink' ? 4.5 : 3;
    check(contrast(m[1], surface) >= min, `--${name} ${m[1]} vs surface: ${contrast(m[1], surface).toFixed(2)}:1 (min ${min})`);
  }
}

console.log(`\n${failures === 0 ? 'Visualisation palette OK.' : `${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
