import { describe, expect, it } from 'vitest';
import { parseManifest, renderEnv, diffAgainstBox, valuesFromEnv, EnvRenderError } from '../../../scripts/ci/env-render';

const entries = parseManifest(`
# comment
NODE_ENV var required
SESSION_SECRET secret required
GOOGLE_SEARCH_CX var optional
SENTRY_DSN secret optional
`);
const SENTINEL = 'sentinel-value-9f3';

describe('parseManifest', () => {
  it('parses name, kind and required', () => {
    expect(entries).toContainEqual({ name: 'SESSION_SECRET', kind: 'secret', required: true });
    expect(entries).toContainEqual({ name: 'SENTRY_DSN', kind: 'secret', required: false });
  });
  it('rejects malformed and duplicate lines', () => {
    expect(() => parseManifest('FOO nope required')).toThrow();
    expect(() => parseManifest('FOO var required\nFOO var optional')).toThrow();
  });
});

describe('renderEnv', () => {
  it('renders required and set optional keys sorted, omitting empty optionals', () => {
    expect(renderEnv(entries, { SESSION_SECRET: 'b', NODE_ENV: 'production', GOOGLE_SEARCH_CX: '' })).toBe('NODE_ENV=production\nSESSION_SECRET=b\n');
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
  it('throws when a forbidden key has a value', () => {
    expect(() => renderEnv(entries, { NODE_ENV: 'p', SESSION_SECRET: 's', OTP_TEST_SINK: 'true' })).toThrow(/OTP_TEST_SINK/);
    expect(() => renderEnv(entries, { NODE_ENV: 'p', SESSION_SECRET: 's', SENDS_DISABLED: 'true' })).toThrow(/SENDS_DISABLED/);
  });
  it('ignores values for keys not in the manifest', () => {
    expect(renderEnv(entries, { NODE_ENV: 'p', SESSION_SECRET: 's', GITHUB_TOKEN: 'x' })).toBe('NODE_ENV=p\nSESSION_SECRET=s\n');
  });
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
    const d = diffAgainstBox(entries, 'NODE_ENV=production\nSENTRY_DSN=x\n', rendered);
    expect(d.missingOnBox).toEqual(['SESSION_SECRET']);
    expect(d.wouldBeRemoved).toEqual(['SENTRY_DSN']);
  });
  it('treats an empty value on the box as absent and ignores quotes and comments', () => {
    const d = diffAgainstBox(entries, '# c\nNODE_ENV="production"\nSESSION_SECRET=new\nGOOGLE_SEARCH_CX=\n', rendered);
    expect(d).toEqual({ missingInManifest: [], missingOnBox: [], changed: [], wouldBeRemoved: [] });
  });
});

describe('deploy/env.production.manifest', () => {
  it('parses and covers every key found on the box on 2026-11-04', async () => {
    const { readFileSync } = await import('node:fs');
    const real = parseManifest(readFileSync(new URL('../../../deploy/env.production.manifest', import.meta.url), 'utf8'));
    const names = real.map((e) => e.name);
    for (const k of ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'FLAGS_ABUSE_SECRET', 'GA_MEASUREMENT_ID', 'GEOCODE_DAILY_BUDGET', 'GOOGLE_GEOCODING_API_KEY', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX', 'MAPS_ENABLED', 'MASTER_PASSWORD', 'NEWS_QUERY_DAILY_BUDGET', 'NODE_ENV', 'OTP_DAILY_SEND_BUDGET', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_USER', 'RECAPTCHA_SECRET_KEY', 'RECAPTCHA_SITE_KEY', 'RETENTION_ENABLED', 'SESSION_SECRET', 'SITE_ORIGIN']) {
      expect(names).toContain(k);
    }
    expect(names).not.toContain('OTP_TEST_SINK');
    expect(names).not.toContain('SENDS_DISABLED');
  });
});
