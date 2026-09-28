#!/usr/bin/env node
/**
 * build-icons.mjs — Kansei's app mark, as SVG and as the PWA raster set.
 *
 *   node scripts/assets/build-icons.mjs [--quiet]
 *
 * The mark is an original brush-stroke abstraction, not a glyph lifted from a
 * font. That is deliberate: tracing a character out of Klee One or Noto would
 * make the app icon a derivative of an OFL font, which drags the OFL's
 * licensing and naming rules onto Kansei's identity. These paths are drawn by
 * hand and carry the repository's own licence.
 *
 * Two strokes — a rising horizontal and a vertical with a はね hook — sit on a
 * warm paper ground with a small vermilion seal in the corner. Colours are the
 * app's own tokens from src/styles/tokens.css, so the icon and the app agree.
 *
 * Rasterisation uses whatever the machine already has: rsvg-convert, then a
 * headless Chromium/Chrome, then ImageMagick. No new dependency is added — a
 * PNG encoder is not worth a devDependency for six files built once.
 *
 * Outputs to public/icons/:
 *   icon.svg  icon-dark.svg  icon-maskable.svg  favicon.svg
 *   icon-192.png  icon-512.png  icon-512-maskable.png  apple-touch-icon.png
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'public', 'icons');
const QUIET = process.argv.includes('--quiet');
const log = (...a) => { if (!QUIET) console.log(...a); };

/* ---- Palette: src/styles/tokens.css ------------------------------------- */
const LIGHT = { paper: '#fbf9f4', rule: '#e4dfd4', ink: '#1f3a5f', seal: '#b1432c' };
const DARK = { paper: '#14161a', rule: '#2b2f37', ink: '#8fb3dd', seal: '#e08d76' };

/* ---- The mark, drawn in a 100x100 box ------------------------------------ *
 * Filled outlines rather than stroked lines, so the strokes can carry brush
 * taper: each starts with pressure and thins as it travels, the way a brush
 * actually behaves. Kept to two strokes — at 192px anything busier turns to mud.
 */
const STROKE_HORIZONTAL =
  'M8.5,31.4C31,26.4 58,21.9 88.6,18.6L89.8,23.6C59.8,27.6 32,32.4 10.6,39.9Z';
const STROKE_VERTICAL =
  'M62.4,12.8C60.6,33.6 58.6,53.4 55.4,69.8C53.2,81.6 44.6,88.4 32.8,90.8' +
  'L29.4,84.6C39.8,82.4 46.4,77.2 47.6,68.4C49.6,52.2 50.8,32.8 51.8,12.8Z';
const SEAL = { x: 74, y: 74, size: 13, r: 2.6 };

/* Proportions of the 512 design, kept as ratios so any output size is exact. */
const INSET_RATIO = 74 / 512;
const RADIUS_RATIO = 112 / 512;
/*
 * Maskable safe area. A maskable icon may be cropped to any shape inside the
 * central 80% of the canvas, so everything that must survive has to sit in the
 * circle of radius 0.4 * size about the centre. The largest square inside that
 * circle has a half-side of 0.4 / sqrt(2) = 0.2828 of the size, i.e. an inset of
 * 0.2172. Insetting by 116/512 = 0.2266 keeps the mark comfortably inside, and
 * the paper runs full bleed so no mask shape can expose a bare corner.
 */
const MASKABLE_INSET_RATIO = 116 / 512;

/**
 * The mark is designed on a 512 canvas; every measurement below is expressed as
 * a fraction of the canvas so the same drawing can be emitted at any size. That
 * matters for rasterisation: rendering an SVG that already has the target
 * width/height avoids asking the rasteriser to rescale, which is where
 * fractional-scale rounding artefacts come from.
 *
 * @param {{paper:string,rule:string,ink:string,seal:string}} c
 * @param {object} o
 * @param {number} o.size        output canvas size
 * @param {number} o.insetRatio  padding around the mark, as a fraction of size
 * @param {number} o.radiusRatio corner radius as a fraction of size, 0 = full bleed
 * @param {boolean} o.hairline   draw the paper's edge rule
 */
function svg(c, { size = 512, insetRatio = INSET_RATIO, radiusRatio = RADIUS_RATIO, hairline = true } = {}) {
  const inset = size * insetRatio;
  const radius = size * radiusRatio;
  const span = size - inset * 2;
  const s = span / 100;
  const bg = radius > 0
    ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${c.paper}"/>`
    : `<rect width="${size}" height="${size}" fill="${c.paper}"/>`;
  const edge = hairline && radius > 0
    ? `<rect x="${(size * 0.008).toFixed(2)}" y="${(size * 0.008).toFixed(2)}" ` +
      `width="${(size * 0.984).toFixed(2)}" height="${(size * 0.984).toFixed(2)}" ` +
      `rx="${(radius - size * 0.008).toFixed(2)}" fill="none" ` +
      `stroke="${c.rule}" stroke-width="${(size * 0.016).toFixed(2)}"/>`
    : '';
  const seal =
    `<rect x="${SEAL.x}" y="${SEAL.y}" width="${SEAL.size}" height="${SEAL.size}" ` +
    `rx="${SEAL.r}" fill="${c.seal}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<title>Kansei</title>
${bg}
${edge}
<g transform="translate(${inset.toFixed(4)} ${inset.toFixed(4)}) scale(${s.toFixed(6)})" fill="${c.ink}">
<path d="${STROKE_HORIZONTAL}"/>
<path d="${STROKE_VERTICAL}"/>
</g>
<g transform="translate(${inset.toFixed(4)} ${inset.toFixed(4)}) scale(${s.toFixed(6)})">${seal}</g>
</svg>
`;
}

/**
 * Favicon: one file that answers to both themes, because a browser tab has no
 * way to ask us for a second one. Full bleed and no hairline — at 16px a
 * rounded corner and an edge rule are indistinguishable from noise.
 */
function faviconSvg() {
  const body = (c) =>
    `<rect width="64" height="64" fill="${c.paper}"/>` +
    `<g transform="translate(7 7) scale(0.5)" fill="${c.ink}">` +
    `<path d="${STROKE_HORIZONTAL}"/><path d="${STROKE_VERTICAL}"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<title>Kansei</title>
<style>
  .dark { display: none }
  @media (prefers-color-scheme: dark) {
    .light { display: none }
    .dark { display: inline }
  }
</style>
<g class="light">${body(LIGHT)}</g>
<g class="dark">${body(DARK)}</g>
</svg>
`;
}

/* ---- Rasterisation ------------------------------------------------------- */
const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;

function pickRasteriser() {
  if (have('rsvg-convert')) return 'rsvg';
  for (const b of ['chromium', 'google-chrome', 'chromium-browser', 'google-chrome-stable']) {
    if (have(b)) return `chrome:${b}`;
  }
  if (have('magick')) return 'magick';
  if (have('convert')) return 'convert';
  throw new Error(
    'No SVG rasteriser found. Install one of: rsvg-convert (librsvg), chromium, or ImageMagick.',
  );
}

/**
 * `svgPath` is always authored at exactly `size`, so every backend renders 1:1.
 */
function rasterise(kind, svgPath, pngPath, size) {
  if (kind === 'rsvg') {
    execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', pngPath, svgPath], { stdio: 'inherit' });
    return;
  }
  if (kind.startsWith('chrome:')) {
    const bin = kind.slice('chrome:'.length);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kansei-icons-'));
    try {
      // Screenshot the SVG document directly. Wrapping it in an <img> inside a
      // data: URL does not work: that document has an opaque origin and is
      // refused access to file://, which yields a silently blank capture.
      execFileSync(bin, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        `--user-data-dir=${profile}`,
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${size},${size}`,
        `--screenshot=${pngPath}`,
        `file://${svgPath}`,
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
    return;
  }
  const bin = kind === 'magick' ? 'magick' : 'convert';
  const args = kind === 'magick'
    ? ['-background', 'none', '-density', '384', svgPath, '-resize', `${size}x${size}`, pngPath]
    : ['-background', 'none', '-density', '384', svgPath, '-resize', `${size}x${size}`, pngPath];
  execFileSync(bin, args, { stdio: 'inherit' });
}

/** Read a PNG header and confirm it is a real, correctly sized image. */
function verifyPng(file, expect) {
  const buf = fs.readFileSync(file);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig)) {
    throw new Error(`${path.basename(file)} is not a PNG`);
  }
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error(`${path.basename(file)} has no IHDR`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== expect || height !== expect) {
    throw new Error(`${path.basename(file)} is ${width}x${height}, expected ${expect}x${expect}`);
  }
  if (buf.length < 500) {
    throw new Error(`${path.basename(file)} is only ${buf.length} bytes — probably blank`);
  }
  return { width, height, bytes: buf.length };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const kind = pickRasteriser();
  log(`rasteriser: ${kind}`);

  /** Each named variant, as a function of output size. */
  const VARIANTS = {
    light: (size) => svg(LIGHT, { size, hairline: true }),
    dark: (size) => svg(DARK, { size, hairline: true }),
    maskable: (size) => svg(LIGHT, { size, insetRatio: MASKABLE_INSET_RATIO, radiusRatio: 0, hairline: false }),
  };

  const svgs = [
    ['icon.svg', VARIANTS.light(512)],
    ['icon-dark.svg', VARIANTS.dark(512)],
    ['icon-maskable.svg', VARIANTS.maskable(512)],
    ['favicon.svg', faviconSvg()],
  ];
  for (const [name, body] of svgs) {
    fs.writeFileSync(path.join(OUT, name), body);
    log(`  ${name.padEnd(22)} ${String(body.length).padStart(6)} bytes`);
  }

  const pngs = [
    ['icon-192.png', 'light', 192],
    ['icon-512.png', 'light', 512],
    ['icon-512-maskable.png', 'maskable', 512],
    // iOS applies its own mask and never honours transparency, so the Apple
    // touch icon is the full-bleed square rather than the rounded tile.
    ['apple-touch-icon.png', 'maskable', 180],
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kansei-svg-'));
  const report = [];
  try {
    for (const [name, variant, size] of pngs) {
      // Author the SVG at exactly the output size so nothing has to rescale.
      const src = path.join(tmp, `${name}.svg`);
      fs.writeFileSync(src, VARIANTS[variant](size));
      const dest = path.join(OUT, name);
      rasterise(kind, src, dest, size);
      const v = verifyPng(dest, size);
      report.push({ file: name, variant, ...v });
      log(`  ${name.padEnd(22)} ${String(v.bytes).padStart(6)} bytes  ${v.width}x${v.height}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(OUT, 'index.json'),
    JSON.stringify({
      schema: 'kansei-icon-index/1',
      generatedAt: new Date().toISOString(),
      generatedBy: 'scripts/assets/build-icons.mjs',
      reproduce: ['node scripts/assets/build-icons.mjs'],
      rasteriser: kind,
      maskableSafeArea: {
        canvas: 512,
        inset: Math.round(512 * MASKABLE_INSET_RATIO),
        note: 'Mark confined to the central 80% safe circle; paper is full bleed.',
      },
      palette: { light: LIGHT, dark: DARK },
      license: 'Original artwork, under the repository licence (AGPL-3.0-or-later). Not derived from any font.',
      svg: svgs.map(([f, b]) => ({ file: f, bytes: b.length })),
      png: report,
    }, null, 2) + '\n',
  );
  log(`wrote ${path.relative(REPO, path.join(OUT, 'index.json'))}`);
}

main();
