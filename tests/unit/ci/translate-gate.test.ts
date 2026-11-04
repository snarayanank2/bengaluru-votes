import { describe, expect, it } from 'vitest';
import { evaluateTranslateCheck } from '../../../scripts/ci/translate-gate';

const header = 'translate --check: missing or stale Kannada targets found:';
const privacy = '  - content file: content/pages/kn/privacy.md';

describe('evaluateTranslateCheck', () => {
  it('passes on exit 0', () => {
    expect(evaluateTranslateCheck('translate --check: all Kannada i18n keys and content pages are up to date.', 0)).toEqual({ ok: true, unexpected: [] });
  });
  it('passes when the only stale entry is content/pages/kn/privacy.md', () => {
    expect(evaluateTranslateCheck(`${header}\n${privacy}\n`, 1)).toEqual({ ok: true, unexpected: [] });
  });
  it('fails when another content file is stale', () => {
    const r = evaluateTranslateCheck(`${header}\n${privacy}\n  - content file: content/pages/kn/terms.md\n`, 1);
    expect(r.ok).toBe(false);
    expect(r.unexpected).toEqual(['content file: content/pages/kn/terms.md']);
  });
  it('fails when any i18n key is stale', () => {
    const r = evaluateTranslateCheck(`${header}\n  - i18n key: home.title\n${privacy}\n`, 1);
    expect(r.ok).toBe(false);
    expect(r.unexpected).toEqual(['i18n key: home.title']);
  });
  it('fails on exit 1 with no parseable entries', () => {
    const r = evaluateTranslateCheck('boom: something else broke\nmore', 1);
    expect(r.ok).toBe(false);
    expect(r.unexpected[0]).toContain('boom');
  });
});
