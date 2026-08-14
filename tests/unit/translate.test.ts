import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import {
  staleKeys,
  staleContentFiles,
  buildPrompt,
  sha256,
  extractText,
} from '../../scripts/translate';

// Independent hash computation (doesn't reuse the module's own sha256) so the
// staleKeys/staleContentFiles tests aren't trivially self-confirming.
function independentSha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

describe('sha256', () => {
  it('matches a standard sha256 hex digest', () => {
    expect(sha256('hello')).toBe(independentSha256('hello'));
  });
});

describe('staleKeys()', () => {
  it('flags a key missing from kn.__hashes', () => {
    const en = { 'nav.signIn': 'Sign in' };
    const kn = { 'nav.signIn': 'ಲಾಗಿನ್', __hashes: {} };
    expect(staleKeys(en, kn)).toEqual(['nav.signIn']);
  });

  it('flags a key whose stored hash no longer matches the current EN value', () => {
    const en = { 'nav.signIn': 'Sign in (changed)' };
    const kn = { 'nav.signIn': 'ಲಾಗಿನ್', __hashes: { 'nav.signIn': 'not-the-real-hash' } };
    expect(staleKeys(en, kn)).toEqual(['nav.signIn']);
  });

  it('does not flag a key whose hash matches the current EN value', () => {
    const en = { 'nav.signIn': 'Sign in' };
    const kn = {
      'nav.signIn': 'ಲಾಗಿನ್',
      __hashes: { 'nav.signIn': independentSha256('Sign in') },
    };
    expect(staleKeys(en, kn)).toEqual([]);
  });

  it('ignores __-prefixed keys on both sides', () => {
    const en = {
      'nav.signIn': 'Sign in',
      __hints: { 'nav.signIn': 'a hint, not a translatable string' },
    };
    const kn = {
      'nav.signIn': 'ಲಾಗಿನ್',
      __hashes: { 'nav.signIn': independentSha256('Sign in') },
    };
    expect(staleKeys(en, kn)).toEqual([]);
  });

  it('handles kn.json with no __hashes block at all (first run)', () => {
    const en = { a: 'Hello', b: 'World' };
    const kn = {};
    expect(staleKeys(en, kn).sort()).toEqual(['a', 'b']);
  });
});

describe('staleContentFiles()', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDirs() {
    const root = mkdtempSync(join(tmpdir(), 'translate-test-'));
    dirs.push(root);
    const enDir = join(root, 'en');
    const knDir = join(root, 'kn');
    mkdirSync(enDir);
    mkdirSync(knDir);
    return { enDir, knDir };
  }

  it('flags an EN file with no KN counterpart', () => {
    const { enDir, knDir } = makeDirs();
    writeFileSync(join(enDir, 'about.md'), '---\ntitle: About\ndescription: d\n---\nBody text.');
    expect(staleContentFiles(enDir, knDir)).toEqual(['about.md']);
  });

  it('flags a KN file whose sourceHash no longer matches the current EN file', () => {
    const { enDir, knDir } = makeDirs();
    writeFileSync(join(enDir, 'about.md'), '---\ntitle: About\ndescription: d\n---\nBody text.');
    writeFileSync(
      join(knDir, 'about.md'),
      matter.stringify('KN body', { title: 'KN title', description: 'KN d', sourceHash: 'stale-hash' }),
    );
    expect(staleContentFiles(enDir, knDir)).toEqual(['about.md']);
  });

  it('does not flag a KN file whose sourceHash matches the current EN file', () => {
    const { enDir, knDir } = makeDirs();
    const enRaw = '---\ntitle: About\ndescription: d\n---\nBody text.';
    writeFileSync(join(enDir, 'about.md'), enRaw);
    writeFileSync(
      join(knDir, 'about.md'),
      matter.stringify('KN body', {
        title: 'KN title',
        description: 'KN d',
        sourceHash: independentSha256(enRaw),
      }),
    );
    expect(staleContentFiles(enDir, knDir)).toEqual([]);
  });

  it('returns multiple stale/missing files sorted', () => {
    const { enDir, knDir } = makeDirs();
    writeFileSync(join(enDir, 'b-page.md'), '---\ntitle: B\ndescription: d\n---\nBody.');
    writeFileSync(join(enDir, 'a-page.md'), '---\ntitle: A\ndescription: d\n---\nBody.');
    expect(staleContentFiles(enDir, knDir)).toEqual(['a-page.md', 'b-page.md']);
  });
});

describe('buildPrompt()', () => {
  it('includes the source text', () => {
    const prompt = buildPrompt('Hello, world.', [], {});
    expect(prompt).toContain('Hello, world.');
  });

  it('includes every hint passed in', () => {
    const hints = [
      "render 'report card' as ವರದಿ ಪತ್ರ, not a literal translation",
      'NOTA should stay Latin-script',
    ];
    const prompt = buildPrompt('Some source text', hints, {});
    for (const hint of hints) {
      expect(prompt).toContain(hint);
    }
  });

  it('includes every glossary rendering passed in', () => {
    const glossary: Record<string, { kn: string; note?: string }> = {
      ward: { kn: 'ವಾರ್ಡ್' },
      'report card': { kn: 'ವರದಿ ಪತ್ರ', note: 'candidate summary page' },
    };
    const prompt = buildPrompt('Some source text', [], glossary);
    expect(prompt).toContain('ವಾರ್ಡ್');
    expect(prompt).toContain('ವರದಿ ಪತ್ರ');
    expect(prompt).toContain('candidate summary page');
  });

  it('instructs the model to preserve HTML comments and Markdown structure', () => {
    const prompt = buildPrompt('some source', [], {});
    expect(prompt.toLowerCase()).toContain('html comment');
    expect(prompt.toLowerCase()).toContain('markdown');
  });
});

/**
 * Regression coverage for the 2026-08-14 failure: `content/pages/kn/privacy.md`
 * (the longest content file) failed twice with "response contained no text
 * block" while every shorter target succeeded.
 *
 * The cause was not an empty response. claude-sonnet-5 runs adaptive thinking
 * whenever the request omits `thinking`, and `max_tokens` bounds thinking AND
 * response text together — so a budget that fits a short target can be spent
 * entirely on thinking for a long one, leaving a response whose only block is
 * a thinking block (empty text by default). The old message pointed at the
 * model; the real fix was the token budget.
 */
describe('extractText()', () => {
  const textResponse = (text: string) => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
  });

  it('returns the trimmed text of a normal response', () => {
    expect(extractText(textResponse('  ಅನುವಾದ  '), 'kn.json')).toBe('ಅನುವಾದ');
  });

  it('skips a leading thinking block to find the text', () => {
    const response = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'ಅನುವಾದ' },
      ],
    };
    expect(extractText(response, 'kn.json')).toBe('ಅನುವಾದ');
  });

  // The actual failure. The error must name the output budget, because that is
  // what the operator has to change — retrying or blaming the model does not
  // help, and the old wording sent us looking in the wrong place.
  it('blames the output budget when the response stopped at max_tokens', () => {
    const response = { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] };

    expect(() => extractText(response, 'content/pages/kn/privacy.md')).toThrow(/max_tokens/);
    expect(() => extractText(response, 'content/pages/kn/privacy.md')).toThrow(
      /content\/pages\/kn\/privacy\.md/,
    );
  });

  // A genuinely empty response is a different fault and keeps its own message.
  it('reports a missing text block when the response ended normally', () => {
    const response = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] };
    expect(() => extractText(response, 'kn.json')).toThrow(/no text block/);
  });
});
