import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const TOKENS_PATH = path.join(ROOT, 'src', 'styles', 'tokens.css');
const GLOBAL_PATH = path.join(ROOT, 'src', 'styles', 'global.css');
const SRC_DIR = path.join(ROOT, 'src');
const FONTS_DIR = path.join(ROOT, 'public', 'fonts');

const tokensCss = readFileSync(TOKENS_PATH, 'utf8');
const globalCss = readFileSync(GLOBAL_PATH, 'utf8');

/** Recursively list every file under `dir`, as absolute paths. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const SRC_FILES = walk(SRC_DIR);

describe('tokens.css — semantic tokens (design-system.md §2.2)', () => {
  const semanticTokens = [
    '--color-text',
    '--color-text-muted',
    '--color-bg',
    '--color-surface',
    '--color-border',
    '--color-primary',
    '--color-primary-surface',
    '--color-accent',
    '--color-accent-surface',
    '--color-danger',
    '--color-danger-surface',
    '--color-on-primary',
    '--color-on-accent',
    '--color-footer',
    '--color-on-footer',
  ];

  it.each(semanticTokens)('defines %s', (token) => {
    // Match "--token:" so e.g. --color-text doesn't false-positive on
    // --color-text-muted.
    const re = new RegExp(`${token}\\s*:`);
    expect(tokensCss).toMatch(re);
  });
});

describe('tokens.css — primitives (design-system.md §2.1)', () => {
  const primitives: Array<[string, string]> = [
    ['--oc-forest', '#426133'],
    ['--oc-leaf', '#5e8b48'],
    ['--oc-lime', '#c8e537'],
    ['--oc-sun', '#ffd527'],
    ['--oc-brick', '#a62635'],
    ['--oc-rose', '#d33a4c'],
    ['--ink', '#1a1a1a'],
    ['--gray-600', '#616161'],
    ['--gray-300', '#c1c1c1'],
    ['--gray-100', '#f0f0f0'],
    ['--forest-tint', '#eef3ea'],
    ['--sun-tint', '#fff8d6'],
    ['--brick-tint', '#faeceb'],
    ['--white', '#ffffff'],
    ['--oc-black', '#000000'],
  ];

  it('has exactly 15 primitives to check (spot-check coverage guard)', () => {
    expect(primitives).toHaveLength(15);
  });

  it.each(primitives)('%s is exactly %s', (token, hex) => {
    const re = new RegExp(`${token}\\s*:\\s*${hex}\\s*;`, 'i');
    expect(tokensCss).toMatch(re);
  });
});

describe('no text-transform: uppercase anywhere under src/', () => {
  it('contains no uppercase text-transform declaration', () => {
    const offenders: string[] = [];
    const re = /text-transform\s*:\s*uppercase/i;
    for (const file of SRC_FILES) {
      const contents = readFileSync(file, 'utf8');
      if (re.test(contents)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no hex color literals outside tokens.css', () => {
  it('contains no hex color literal in any .astro/.css/.ts/.tsx file other than tokens.css', () => {
    const hexRe = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?\b/;
    const exts = new Set(['.astro', '.css', '.ts', '.tsx']);
    const offenders: string[] = [];

    for (const file of SRC_FILES) {
      if (file === TOKENS_PATH) continue;
      if (!exts.has(path.extname(file))) continue;
      const contents = readFileSync(file, 'utf8');
      if (hexRe.test(contents)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('font payload (design-system.md §11, ~120KB target)', () => {
  it('total committed public/fonts/*.woff2 payload is at or under the 150KB hard ceiling', () => {
    const files = readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'));
    expect(files.length).toBeGreaterThan(0);

    let total = 0;
    const breakdown: Record<string, number> = {};
    for (const file of files) {
      const { size } = statSync(path.join(FONTS_DIR, file));
      total += size;
      breakdown[file] = size;
    }

    // Hard ceiling per task-11 controller decision: 153600 bytes (150KB).
    // See .superpowers/sdd/task-11-report.md for the actual achieved total
    // and the DONE_WITH_CONCERNS writeup if this assertion fails.
    expect(total, `font files: ${JSON.stringify(breakdown, null, 2)}`).toBeLessThanOrEqual(153_600);
  });
});

describe('global.css — fonts and font-loading (design-system.md §5.1)', () => {
  it('uses font-display: swap', () => {
    expect(globalCss).toMatch(/font-display\s*:\s*swap/);
  });

  it('declares a Kannada unicode-range covering U+0C80', () => {
    expect(globalCss).toMatch(/unicode-range:[^;]*U\+0C80/);
  });
});
