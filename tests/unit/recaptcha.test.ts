/**
 * src/lib/recaptcha.ts (Task 50) — reCAPTCHA v3 server-side verification for
 * the ONE anonymous write path (/api/eoi). No network calls here at all:
 * every "Google call" is the injected `verifier`, per the module's own
 * design (architecture.md §7/§13).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { verifyRecaptcha } from '../../src/lib/recaptcha';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.RECAPTCHA_SECRET_KEY;
const ORIGINAL_LOCAL_BYPASS = process.env.ALLOW_INSECURE_LOCAL_RECAPTCHA;
const ORIGINAL_SITE_ORIGIN = process.env.SITE_ORIGIN;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.RECAPTCHA_SECRET_KEY;
  } else {
    process.env.RECAPTCHA_SECRET_KEY = ORIGINAL_SECRET;
  }
  if (ORIGINAL_LOCAL_BYPASS === undefined) delete process.env.ALLOW_INSECURE_LOCAL_RECAPTCHA;
  else process.env.ALLOW_INSECURE_LOCAL_RECAPTCHA = ORIGINAL_LOCAL_BYPASS;
  if (ORIGINAL_SITE_ORIGIN === undefined) delete process.env.SITE_ORIGIN;
  else process.env.SITE_ORIGIN = ORIGINAL_SITE_ORIGIN;
});

describe('verifyRecaptcha', () => {
  it('injected verifier: success:true, score 0.9 (>= default 0.5) -> ok:true, score echoed', async () => {
    const result = await verifyRecaptcha('some-token', {
      secret: 'test-secret',
      verifier: async () => ({ success: true, score: 0.9 }),
    });
    expect(result.ok).toBe(true);
    expect(result.score).toBe(0.9);
  });

  it('injected verifier: success:true, score 0.3 (< default 0.5) -> ok:false', async () => {
    const result = await verifyRecaptcha('some-token', {
      secret: 'test-secret',
      verifier: async () => ({ success: true, score: 0.3 }),
    });
    expect(result.ok).toBe(false);
    expect(result.score).toBe(0.3);
    expect(result.reason).toBe('low_score');
  });

  it('injected verifier: success:false -> ok:false regardless of score', async () => {
    const result = await verifyRecaptcha('some-token', {
      secret: 'test-secret',
      verifier: async () => ({ success: false, score: 0.9 }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('verification_failed');
  });

  it('respects a custom minScore option', async () => {
    const result = await verifyRecaptcha('some-token', {
      secret: 'test-secret',
      minScore: 0.8,
      verifier: async () => ({ success: true, score: 0.7 }),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a valid token minted for a different v3 action', async () => {
    const result = await verifyRecaptcha('some-token', {
      secret: 'test-secret',
      expectedAction: 'issue_vote',
      verifier: async () => ({ success: true, score: 0.9, action: 'eoi' }),
    });
    expect(result).toEqual({ ok: false, score: 0.9, reason: 'wrong_action' });
  });

  it('no secret configured + NODE_ENV !== production -> ok:true (dev accept), verifier never called', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.RECAPTCHA_SECRET_KEY;

    let verifierCalled = false;
    const result = await verifyRecaptcha('some-token', {
      verifier: async () => {
        verifierCalled = true;
        return { success: true, score: 1 };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('no_secret_dev');
    expect(verifierCalled).toBe(false);
  });

  it('no secret configured + NODE_ENV === production -> ok:false (fail closed, misconfigured)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RECAPTCHA_SECRET_KEY;

    const result = await verifyRecaptcha('some-token', {});

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('misconfigured');
  });

  it('allows the explicit no-key bypass only for a loopback site origin', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RECAPTCHA_SECRET_KEY;
    process.env.ALLOW_INSECURE_LOCAL_RECAPTCHA = 'true';
    process.env.SITE_ORIGIN = 'http://localhost:4321';
    expect(await verifyRecaptcha('local')).toEqual({ ok: true, reason: 'local_explicit_bypass' });
    process.env.SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
    expect((await verifyRecaptcha('local')).ok).toBe(false);
  });

  it('an explicit opts.secret is used over process.env.RECAPTCHA_SECRET_KEY', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'env-secret';
    let receivedSecret: string | undefined;
    const result = await verifyRecaptcha('some-token', {
      secret: 'opts-secret',
      verifier: async (_token, secret) => {
        receivedSecret = secret;
        return { success: true, score: 0.9 };
      },
    });
    expect(result.ok).toBe(true);
    expect(receivedSecret).toBe('opts-secret');
  });
});
