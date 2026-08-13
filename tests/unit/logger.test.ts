import { describe, it, expect, vi } from 'vitest';

// SENTRY_DSN must be unset for this whole file — importing logger.ts with no
// DSN configured must be a clean no-op (no network, no throw). Cleared
// up-front in case the surrounding shell happens to export one.
delete process.env.SENTRY_DSN;

import { scrubPii, sentryBeforeSend, isSentryInitialized } from '../../src/lib/logger';

describe('src/lib/logger.ts#scrubPii', () => {
  it('redacts email, phone, contact, address, destination VALUES', () => {
    const input = {
      email: 'citizen@example.com',
      phone: '+91 98765 43210',
      contact: 'someone@example.com',
      address: '123 MG Road, Bengaluru',
      destination: '9876543210',
    };
    const out = scrubPii(input) as Record<string, unknown>;
    expect(out.email).toBe('[redacted]');
    expect(out.phone).toBe('[redacted]');
    expect(out.contact).toBe('[redacted]');
    expect(out.address).toBe('[redacted]');
    expect(out.destination).toBe('[redacted]');
  });

  it('redacts credential-ish keys: password, token, secret, authorization, cookie, api_key/apikey', () => {
    const input = {
      password: 'hunter2',
      token: 'abc.def.ghi',
      secret: 'shh',
      authorization: 'Bearer abc123',
      cookie: 'bv_session=abc',
      api_key: 'key-1',
      apiKey: 'key-2',
    };
    const out = scrubPii(input) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.secret).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.cookie).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
  });

  it('is case-insensitive on key matching', () => {
    const out = scrubPii({ Email: 'a@b.com', PHONE: '9876543210' }) as Record<string, unknown>;
    expect(out.Email).toBe('[redacted]');
    expect(out.PHONE).toBe('[redacted]');
  });

  it('leaves opaque keys (event, wardId, count, code, status) UNCHANGED', () => {
    const input = { event: 'user_login', wardId: 42, count: 3, code: 'auth', status: 'sent' };
    const out = scrubPii(input) as Record<string, unknown>;
    expect(out).toEqual(input);
  });

  it('scrubs nested objects recursively', () => {
    const input = { event: 'x', request: { headers: { authorization: 'Bearer abc' }, user: { email: 'a@b.com' } } };
    const out = scrubPii(input) as any;
    expect(out.request.headers.authorization).toBe('[redacted]');
    expect(out.request.user.email).toBe('[redacted]');
    expect(out.event).toBe('x');
  });

  it('scrubs arrays recursively', () => {
    const input = { items: [{ email: 'a@b.com', wardId: 1 }, { email: 'c@d.com', wardId: 2 }] };
    const out = scrubPii(input) as any;
    expect(out.items[0].email).toBe('[redacted]');
    expect(out.items[0].wardId).toBe(1);
    expect(out.items[1].email).toBe('[redacted]');
  });

  it('does not hang or throw on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { event: 'x', email: 'a@b.com' };
    cyclic.self = cyclic;
    expect(() => scrubPii(cyclic)).not.toThrow();
    const out = scrubPii(cyclic) as any;
    expect(out.email).toBe('[redacted]');
    expect(out.self).toBe('[circular]');
  });

  it('does not hang or throw on deeply-nested (acyclic) input', () => {
    let deep: Record<string, unknown> = { email: 'a@b.com' };
    for (let i = 0; i < 500; i++) {
      deep = { nested: deep };
    }
    expect(() => scrubPii(deep)).not.toThrow();
  });

  it('two sibling fields sharing the same object reference are both scrubbed, not marked circular', () => {
    const shared = { email: 'a@b.com' };
    const input = { first: shared, second: shared };
    const out = scrubPii(input) as any;
    expect(out.first.email).toBe('[redacted]');
    expect(out.second.email).toBe('[redacted]');
  });

  it('passes through non-PII primitive values unchanged', () => {
    expect(scrubPii(42)).toBe(42);
    expect(scrubPii(true)).toBe(true);
    expect(scrubPii(null)).toBe(null);
    expect(scrubPii(undefined)).toBe(undefined);
  });

  it('defense-in-depth: scrubs an email/phone-shaped VALUE even under an opaque key', () => {
    const out = scrubPii({ message: 'contact me at citizen@example.com' }) as Record<string, unknown>;
    expect(out.message).not.toContain('citizen@example.com');
  });
});

describe('src/lib/logger.ts Sentry integration', () => {
  it('does NOT init Sentry when SENTRY_DSN is unset (no network, no throw)', () => {
    expect(isSentryInitialized()).toBe(false);
  });

  it('sentryBeforeSend redacts an email carried in `extra`', () => {
    const fixture = {
      message: 'something broke',
      extra: { email: 'citizen@example.com', wardId: 42 },
    } as any;
    const scrubbed = sentryBeforeSend(fixture);
    expect(scrubbed).not.toBeNull();
    expect((scrubbed as any).extra.email).toBe('[redacted]');
    expect((scrubbed as any).extra.wardId).toBe(42);
  });

  it('sentryBeforeSend redacts an email carried in `request`', () => {
    const fixture = {
      message: 'something broke',
      request: { data: { email: 'citizen@example.com' }, headers: { cookie: 'bv_session=abc' } },
    } as any;
    const scrubbed = sentryBeforeSend(fixture);
    expect((scrubbed as any).request.data.email).toBe('[redacted]');
    expect((scrubbed as any).request.headers.cookie).toBe('[redacted]');
  });

  it('sentryBeforeSend redacts contact fields inside breadcrumbs', () => {
    const fixture = {
      message: 'something broke',
      breadcrumbs: [{ message: 'user action', data: { destination: '9876543210' } }],
    } as any;
    const scrubbed = sentryBeforeSend(fixture);
    expect((scrubbed as any).breadcrumbs[0].data.destination).toBe('[redacted]');
  });

  it('sentryBeforeSend redacts an email embedded in the free-text message string', () => {
    const fixture = { message: 'failed to notify citizen@example.com' } as any;
    const scrubbed = sentryBeforeSend(fixture);
    expect((scrubbed as any).message).not.toContain('citizen@example.com');
  });
});

describe('src/lib/log.ts#logEvent', () => {
  it('emits through the pino logger (logger.info), not console.log, with the {event, ...fields} shape', async () => {
    const { logger } = await import('../../src/lib/logger');
    const { logEvent } = await import('../../src/lib/log');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as any);
    try {
      logEvent('ward_lookup', { wardId: 12, result: 'ward' });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith({ event: 'ward_lookup', wardId: 12, result: 'ward' });
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("a logEvent field that happens to be PII-keyed would still be scrubbed (formatters.log runs scrubPii on logger.info's merging object)", async () => {
    const { logger } = await import('../../src/lib/logger');
    const { logEvent } = await import('../../src/lib/log');
    // logger.info -> pino's formatters.log(object) -> scrubPii(object) before
    // serialization; assert that hook actually redacts by inspecting what
    // pino would serialize, via the exported `scrubPii` applied to the same
    // shape logEvent constructs (formatters.log is not itself exported, so
    // this checks the composition logEvent -> logger.info relies on).
    const { scrubPii } = await import('../../src/lib/logger');
    const fields = { email: 'citizen@example.com', wardId: 12 };
    const merged = { event: 'accidental_pii', ...fields };
    expect((scrubPii(merged) as any).email).toBe('[redacted]');
    expect((scrubPii(merged) as any).wardId).toBe(12);
    // And logEvent really does route through logger.info (not console.log).
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as any);
    try {
      logEvent('accidental_pii', fields);
      expect(infoSpy).toHaveBeenCalledWith(merged);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
