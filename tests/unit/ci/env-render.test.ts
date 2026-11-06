import { describe, expect, it } from 'vitest';
import { parseManifest, renderEnv, diffAgainstBox, valuesFromEnv, EnvRenderError, FORBIDDEN } from '../../../scripts/ci/env-render';

const entries = parseManifest(`
# comment
NODE_ENV var required
SESSION_SECRET secret required
OPTIONAL_VAR var optional
OPTIONAL_TOKEN secret optional
`);
const SENTINEL = 'sentinel-value-9f3';

describe('parseManifest', () => {
  it('parses name, kind and required', () => {
    expect(entries).toContainEqual({ name: 'SESSION_SECRET', kind: 'secret', required: true });
    expect(entries).toContainEqual({ name: 'OPTIONAL_TOKEN', kind: 'secret', required: false });
  });
  it('rejects malformed and duplicate lines', () => {
    expect(() => parseManifest('FOO nope required')).toThrow();
    expect(() => parseManifest('FOO var required\nFOO var optional')).toThrow();
  });
});

describe('renderEnv', () => {
  it('renders required and set optional keys sorted, omitting empty optionals', () => {
    expect(renderEnv(entries, { SESSION_SECRET: 'b', NODE_ENV: 'production', OPTIONAL_VAR: '' })).toBe('NODE_ENV=production\nSESSION_SECRET=b\n');
  });
  it('throws naming a missing required key, never printing values', () => {
    let err: unknown;
    try { renderEnv(entries, { NODE_ENV: SENTINEL }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EnvRenderError);
    expect((err as Error).message).toContain('SESSION_SECRET');
    expect((err as Error).message).not.toContain(SENTINEL);
  });
  it('treats an empty required value as missing', () => {
    expect(() => renderEnv(entries, { NODE_ENV: 'production', SESSION_SECRET: '' })).toThrow(/SESSION_SECRET/);
  });
  it('throws on a value containing a newline, without printing it', () => {
    let err: unknown;
    try { renderEnv(entries, { NODE_ENV: 'production', SESSION_SECRET: `${SENTINEL}\nX=1` }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EnvRenderError);
    expect((err as Error).message).toContain('SESSION_SECRET');
    expect((err as Error).message).not.toContain(SENTINEL);
  });
  it('throws when a forbidden key has a value, and not when it is empty', () => {
    for (const k of FORBIDDEN) {
      expect(() => renderEnv(entries, { NODE_ENV: 'p', SESSION_SECRET: 's', [k]: 'true' })).toThrow(new RegExp(k));
      expect(renderEnv(entries, { NODE_ENV: 'p', SESSION_SECRET: 's', [k]: '' })).toBe('NODE_ENV=p\nSESSION_SECRET=s\n');
    }
  });
  it('ignores values for keys not in the manifest', () => {
    expect(renderEnv(entries, { NODE_ENV: 'p', SESSION_SECRET: 's', GITHUB_TOKEN: 'x' })).toBe('NODE_ENV=p\nSESSION_SECRET=s\n');
  });
});

describe('renderEnv: values Compose would mangle in an unquoted env_file', () => {
  const e = [{ name: 'PW', kind: 'secret' as const, required: true }];
  for (const [label, v] of [['dollar', 'ab$cd'], ['hash', 'ab #cd'], ['quote', 'a"b'], ['apostrophe', "a'b"], ['backslash', 'a\\b'], ['backtick', 'a`b'], ['leading space', ' ab'], ['trailing space', 'ab ']] as const) {
    it(`rejects a value with a ${label}, naming the key only`, () => {
      let msg = '';
      try { renderEnv(e, { PW: v }); } catch (err) { msg = (err as Error).message; }
      expect(msg).toContain('PW');
      expect(msg).not.toContain(v.trim());
    });
  }
  it('accepts url-safe values', () => expect(renderEnv(e, { PW: 'postgres://u:p%24w@h:5432/db?x=1&y=2' })).toContain('PW=postgres://'));
});

describe('valuesFromEnv', () => {
  it('merges ALL_VARS and ALL_SECRETS JSON, secrets winning', () => {
    expect(valuesFromEnv({ ALL_VARS: '{"A":"1","B":"v"}', ALL_SECRETS: '{"B":"s"}' })).toEqual({ A: '1', B: 's' });
  });
  it('falls back to the plain environment', () => {
    expect(valuesFromEnv({ A: '1' })).toEqual({ A: '1' });
  });
});

describe('diffAgainstBox', () => {
  const rendered = 'NODE_ENV=production\nSESSION_SECRET=new\n';
  it('reports a key on the box but not in the manifest', () => {
    const d = diffAgainstBox(entries, 'NODE_ENV=production\nSESSION_SECRET=new\nEXTRA=1\n', rendered);
    expect(d.missingInManifest).toEqual(['EXTRA']);
  });
  it('reports changed values by key name only', () => {
    const d = diffAgainstBox(entries, `NODE_ENV=production\nSESSION_SECRET=${SENTINEL}\n`, rendered);
    expect(d.changed).toEqual(['SESSION_SECRET']);
    expect(JSON.stringify(d)).not.toContain(SENTINEL);
  });
  it('reports keys the deploy would add and keys it would remove', () => {
    const d = diffAgainstBox(entries, 'NODE_ENV=production\nOPTIONAL_TOKEN=x\n', rendered);
    expect(d.missingOnBox).toEqual(['SESSION_SECRET']);
    expect(d.wouldBeRemoved).toEqual(['OPTIONAL_TOKEN']);
  });
  it('treats an empty value on the box as absent and ignores quotes and comments', () => {
    const d = diffAgainstBox(entries, '# c\nNODE_ENV="production"\nSESSION_SECRET=new\nOPTIONAL_VAR=\n', rendered);
    expect(d).toEqual({ missingInManifest: [], missingOnBox: [], changed: [], wouldBeRemoved: [] });
  });
});

describe('deploy/env.production.manifest', () => {
  it('parses and covers the core keys the app and stack read', async () => {
    const { readFileSync } = await import('node:fs');
    const real = parseManifest(readFileSync(new URL('../../../deploy/env.production.manifest', import.meta.url), 'utf8'));
    const names = real.map((e) => e.name);
    for (const k of ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'FLAGS_ABUSE_SECRET', 'GA_MEASUREMENT_ID', 'GEOCODE_DAILY_BUDGET', 'GOOGLE_GEOCODING_API_KEY', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID', 'MAPS_ENABLED', 'NODE_ENV', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_USER', 'RECAPTCHA_SECRET_KEY', 'RECAPTCHA_SITE_KEY', 'SESSION_SECRET', 'SITE_ORIGIN']) {
      expect(names).toContain(k);
    }
    for (const k of FORBIDDEN) expect(names).not.toContain(k);
  });
});
