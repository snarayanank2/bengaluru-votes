import { describe, expect, it, vi } from 'vitest';
import { buildAlert, sendAlert } from '../../../scripts/ci/alert';

const base = { commit: 'abc1234', tag: 'v2026.11.04', step: 'verify', runUrl: 'https://github.com/o/r/actions/runs/1' };
const KEY = 'placeholder-mail-key-xyz';
const env = { SENDGRID_API_KEY: KEY, SENDGRID_FROM_EMAIL: 'from@example.com', DEPLOY_ALERT_EMAIL: 'to@example.com' };

describe('buildAlert', () => {
  it('has a distinct subject per kind', () => {
    const kinds = ['test-failed', 'deploy-failed', 'rolled-back', 'rollback-failed'] as const;
    expect(new Set(kinds.map((k) => buildAlert({ kind: k, ...base }).subject)).size).toBe(4);
  });
  it('rollback-failed says production may be down', () => {
    expect(buildAlert({ kind: 'rollback-failed', ...base }).subject.toLowerCase()).toContain('production may be down');
  });
  it('text has commit, tag, step and run URL', () => {
    const { text } = buildAlert({ kind: 'deploy-failed', ...base });
    for (const s of [base.commit, base.tag, base.step, base.runUrl]) expect(text).toContain(s);
  });
});

describe('sendAlert', () => {
  const msg = { subject: 's', text: 't' };
  it('returns true on 202 and posts to SendGrid with the key only in the header', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    expect(await sendAlert(msg, env, fetchFn as never)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(init.body).not.toContain(KEY);
  });
  it('returns false and does not throw on a 500, logging no key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await sendAlert(msg, env, fetchFn as never)).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    warn.mockRestore();
  });
  it('returns false when fetch throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendAlert(msg, env, vi.fn().mockRejectedValue(new Error('net')) as never)).toBe(false);
    warn.mockRestore();
  });
  it('returns false when the key or addresses are missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sendAlert(msg, {}, vi.fn() as never)).toBe(false);
    warn.mockRestore();
  });
});
