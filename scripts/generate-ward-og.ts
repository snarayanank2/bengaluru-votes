#!/usr/bin/env tsx
/**
 * Generate the per-ward social share images (task 196): 369 wards x EN/KN,
 * 1200x630 PNGs in public/og/ward/{wardId}-{lang}.png. Run by hand and
 * commit the output, whenever ward names or the card design change:
 *
 *   npm run generate:ward-og
 *
 * Ward data comes from data/gba.geojson (no database). Text is drawn by
 * headless Chromium (Playwright, a dev dependency) using the site's own
 * subset fonts from public/fonts, so Kannada conjuncts shape correctly. The
 * name shrinks until it fits its box; a name that still does not fit at the
 * minimum size fails the run rather than being clipped. Colours are the
 * design-system tokens (hero-forest surface, hero-cream text, sun accent);
 * nothing here is a party colour.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { WARD_OG_HEIGHT, WARD_OG_WIDTH, loadWardOgRows, wardOgPath, wardOgText } from '../src/lib/ward-og';
import type { Lang } from '../src/i18n';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = (file: string) =>
  `url(data:font/woff2;base64,${readFileSync(join(root, 'public/fonts', file)).toString('base64')}) format('woff2')`;

const FONT_CSS = `
@font-face { font-family: 'Manrope'; font-weight: 200 800; src: ${font('manrope-latin-wght-normal.woff2')}; }
@font-face { font-family: 'Noto Sans Kannada'; font-weight: 100 900; src: ${font('noto-sans-kannada-kannada-wght-normal.woff2')}; }
@font-face { font-family: 'PT Sans'; font-weight: 400; src: ${font('pt-sans-latin-400-normal.woff2')}; }
`;

const CSS = `
:root { --hero-forest: #132010; --hero-cream: #f2ead9; --oc-lime: #c8e537; --oc-sun: #ffd527; }
* { box-sizing: border-box; margin: 0; }
body { width: ${WARD_OG_WIDTH}px; height: ${WARD_OG_HEIGHT}px; background: var(--hero-forest); color: var(--hero-cream);
  font-family: 'Manrope', 'Noto Sans Kannada', sans-serif; position: relative; overflow: hidden; }
body::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 18px; background: var(--oc-sun); }
.card { position: absolute; inset: 56px 80px; display: flex; flex-direction: column; }
.brand { font-weight: 800; font-size: 30px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--oc-lime); }
.name { margin: 30px 0 36px; height: 290px; width: 100%; font-weight: 800; line-height: 1.12; }
.name.kn { line-height: 1.4; font-weight: 700; }
.detail { font-size: 46px; font-weight: 600; line-height: 1.3; }
.url { margin-top: auto; font-family: 'PT Sans', sans-serif; font-size: 34px; color: var(--oc-sun); }
`;

function page(lang: Lang, name: string, detail: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${FONT_CSS}${CSS}</style></head>
<body><div class="card"><div class="brand">Bengaluru Votes</div>
<div class="name ${lang}" id="name">${esc(name)}</div>
<div class="detail">${esc(detail)}</div>
<div class="url">bengaluruvotes.opencity.in</div></div></body></html>`;
}

const MAX_PX = 124;
const MIN_PX = 48;

async function main() {
  const rows = loadWardOgRows(join(root, 'data/gba.geojson'));
  const outDir = join(root, 'public/og/ward');
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: WARD_OG_WIDTH, height: WARD_OG_HEIGHT } });
  let bytes = 0;
  let largest = 0;
  const shrunk: string[] = [];
  for (const ward of rows) {
    for (const lang of ['en', 'kn'] as const) {
      const { name, detail } = wardOgText(lang, ward);
      await tab.setContent(page(lang, name, detail));
      await tab.evaluate(() => document.fonts.ready);
      const px = await tab.evaluate(
        ([max, min]) => {
          const el = document.getElementById('name') as HTMLElement;
          for (let size = max; size >= min; size -= 2) {
            el.style.fontSize = `${size}px`;
            if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return size;
          }
          return 0;
        },
        [MAX_PX, MIN_PX],
      );
      const file = wardOgPath(ward.id, lang).replace('/og/ward/', '');
      if (!px) throw new Error(`${file}: "${name}" does not fit at ${MIN_PX}px`);
      if (px < 80) shrunk.push(`${file}@${px}`);
      await tab.screenshot({ path: join(outDir, file), type: 'png' });
      const size = statSync(join(outDir, file)).size;
      bytes += size;
      largest = Math.max(largest, size);
    }
  }
  await browser.close();
  console.log(`wrote ${rows.length * 2} images, ${(bytes / 1048576).toFixed(1)} MB total, largest ${(largest / 1024).toFixed(0)} KB`);
  if (shrunk.length) console.log(`shrunk below 80px: ${shrunk.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
