#!/usr/bin/env node
/**
 * Verifies the design-token palette against WCAG 2.1 contrast minimums, in both
 * themes. Run by `npm run check:contrast` and in CI: a palette regression should
 * fail the build rather than ship an unreadable screen.
 *
 * Text pairs are held to 4.5:1 (AA) and body text to 7:1 (AAA). Non-text
 * indicators — stage marks, badges, borders, focus rings — are held to 3:1,
 * which is the AA requirement for non-text contrast. Note that colour is never
 * the only carrier of learning status in the UI; these ratios make the colour
 * legible, they do not make it sufficient on its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');

function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`selector not found in tokens.css: ${selector}`);
  const j = css.indexOf('}', i);
  const out = {};
  for (const [, k, v] of css.slice(i, j).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    out[k] = v;
  }
  return out;
}

const themes = {
  light: block(':root {'),
  dark: block(":root[data-theme='dark'] {"),
};

const rgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const toLinear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, minimum ratio, what it is used for] */
const PAIRS = [
  ['ink', 'paper', 7, 'body text on paper'],
  ['ink', 'surface', 7, 'body text on a card'],
  ['ink', 'paper-sunken', 7, 'body text in a well'],
  ['ink-soft', 'paper', 4.5, 'secondary text'],
  ['ink-soft', 'surface', 4.5, 'secondary text on a card'],
  ['ink-faint', 'paper', 4.5, 'tertiary text'],
  ['ink-faint', 'surface', 4.5, 'tertiary text on a card'],
  ['accent-text', 'paper', 4.5, 'link text'],
  ['accent-text', 'surface', 4.5, 'link text on a card'],
  ['accent-text', 'accent-soft', 4.5, 'link text on an accent tint'],
  ['accent-on', 'accent', 4.5, 'primary button label'],
  ['ink-inverse', 'accent', 4.5, 'inverse text on accent'],
  ['seal-text', 'paper', 4.5, 'seal-coloured text'],
  ['seal-text', 'seal-soft', 4.5, 'seal text on its tint'],
  ['ok-text', 'ok-soft', 4.5, 'success message'],
  ['ok-text', 'paper', 4.5, 'success text on paper'],
  ['warn-text', 'warn-soft', 4.5, 'warning message'],
  ['warn-text', 'paper', 4.5, 'warning text on paper'],
  ['danger-text', 'danger-soft', 4.5, 'error message'],
  ['danger-text', 'paper', 4.5, 'error text on paper'],
  ['stage-learning', 'stage-learning-soft', 3, 'learning chip'],
  ['stage-consolidating', 'stage-consolidating-soft', 3, 'consolidating chip'],
  ['stage-retained', 'stage-retained-soft', 3, 'retained chip'],
  ['stage-unseen', 'paper', 3, 'unseen mark on paper'],
  ['stage-unseen', 'surface', 3, 'unseen mark on a card'],
  ['stage-learning', 'surface', 3, 'learning mark on a card'],
  ['stage-consolidating', 'surface', 3, 'consolidating mark on a card'],
  ['stage-retained', 'surface', 3, 'retained mark on a card'],
  ['due', 'due-soft', 3, 'due-for-review badge'],
  ['due', 'surface', 3, 'due marker on a card'],
  ['rule-strong', 'paper', 3, 'input border'],
  ['rule-strong', 'surface', 3, 'input border on a card'],
  ['rule-focus', 'paper', 3, 'focus ring on paper'],
  ['rule-focus', 'surface', 3, 'focus ring on a card'],
  ['canvas-ink', 'canvas-paper', 7, 'handwriting ink'],
  ['canvas-guide', 'canvas-paper', 3, 'trace guide'],
  ['canvas-grid', 'canvas-paper', 1.2, 'canvas grid (intentionally faint)'],
];

let failures = 0;
const lines = [];
for (const [theme, palette] of Object.entries(themes)) {
  lines.push(`\n${theme.toUpperCase()}`);
  for (const [fg, bg, min, what] of PAIRS) {
    if (!palette[fg] || !palette[bg]) {
      lines.push(`  MISSING  --${fg} or --${bg}`);
      failures += 1;
      continue;
    }
    const r = contrast(palette[fg], palette[bg]);
    const ok = r >= min;
    if (!ok) failures += 1;
    lines.push(
      `  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)} (min ${min})  --${fg} on --${bg}  — ${what}`,
    );
  }
}
console.log(lines.join('\n'));
console.log(`\n${failures === 0 ? 'All contrast checks passed.' : `${failures} contrast failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
