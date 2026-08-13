import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import * as schema from '../../src/db/schema';
import { POST as sendgridPOST } from '../../src/pages/api/webhooks/sendgrid';
import { POST as twilioPOST } from '../../src/pages/api/webhooks/twilio';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Distinctive task-53-only fixture contacts so cleanup never touches another
// suite's suppression rows in the shared test DB.
const BOUNCE_EMAIL = 'bounce-t53@example.test';
const COMPLAINT_EMAIL = 'complaint-t53@example.test';
const TAMPER_EMAIL = 'tamper-t53@example.test';
const STOP_PHONE = '+919999888001';

const FIXTURE_EMAILS = [BOUNCE_EMAIL, COMPLAINT_EMAIL, TAMPER_EMAIL];
const FIXTURE_PHONES = [STOP_PHONE];

async function resetFixtures(): Promise<void> {
  await db.delete(schema.suppressions).where(
    inArray(schema.suppressions.contact, [...FIXTURE_EMAILS, ...FIXTURE_PHONES]),
  );
}

async function suppressionRow(contact: string, channel: 'email' | 'whatsapp') {
  const rows = await db
    .select()
    .from(schema.suppressions)
    .where(and(eq(schema.suppressions.contact, contact), eq(schema.suppressions.channel, channel)));
  return rows[0];
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await resetFixtures();
});

afterEach(async () => {
  await resetFixtures();
});

afterAll(async () => {
  await resetFixtures();
  await client.end();
});

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------

/** Signs `timestamp + body` with the EC private key and returns the base64 signature. */
function signSendGrid(privateKey: crypto.KeyObject, timestamp: string, body: string): string {
  const sign = crypto.createSign('sha256');
  sign.update(timestamp + body);
  sign.end();
  return sign.sign(privateKey, 'base64');
}

function sendgridRequest(
  body: string,
  headers: Record<string, string>,
): Request {
  return new Request('http://localhost/api/webhooks/sendgrid', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /api/webhooks/sendgrid', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const originalKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    else process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = originalKey;
  });

  it('valid bounce event -> 200, no-store, writes (email, "email", "bounce")', async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKeyB64;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify([{ event: 'bounce', email: BOUNCE_EMAIL }]);
    const signature = signSendGrid(privateKey, timestamp, body);

    const res = await sendgridPOST({
      request: sendgridRequest(body, {
        'x-twilio-email-event-webhook-signature': signature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      }),
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const row = await suppressionRow(BOUNCE_EMAIL, 'email');
    expect(row).toBeDefined();
    expect(row!.reason).toBe('bounce');
  });

  it('valid spamreport event -> writes (email, "email", "complaint")', async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKeyB64;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify([{ event: 'spamreport', email: COMPLAINT_EMAIL }]);
    const signature = signSendGrid(privateKey, timestamp, body);

    const res = await sendgridPOST({
      request: sendgridRequest(body, {
        'x-twilio-email-event-webhook-signature': signature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      }),
    } as any);

    expect(res.status).toBe(200);
    const row = await suppressionRow(COMPLAINT_EMAIL, 'email');
    expect(row).toBeDefined();
    expect(row!.reason).toBe('complaint');
  });

  it('ignores other event types (e.g. "delivered") without writing a suppression', async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKeyB64;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify([{ event: 'delivered', email: BOUNCE_EMAIL }]);
    const signature = signSendGrid(privateKey, timestamp, body);

    const res = await sendgridPOST({
      request: sendgridRequest(body, {
        'x-twilio-email-event-webhook-signature': signature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      }),
    } as any);

    expect(res.status).toBe(200);
    const row = await suppressionRow(BOUNCE_EMAIL, 'email');
    expect(row).toBeUndefined();
  });

  it('tampered signature -> 403, writes nothing', async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKeyB64;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify([{ event: 'bounce', email: TAMPER_EMAIL }]);
    // Sign a DIFFERENT body so the signature doesn't match what's sent.
    const signature = signSendGrid(privateKey, timestamp, JSON.stringify([{ event: 'bounce', email: 'other@example.test' }]));

    const res = await sendgridPOST({
      request: sendgridRequest(body, {
        'x-twilio-email-event-webhook-signature': signature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      }),
    } as any);

    expect(res.status).toBe(403);
    const row = await suppressionRow(TAMPER_EMAIL, 'email');
    expect(row).toBeUndefined();
  });

  it('missing headers -> 403', async () => {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKeyB64;
    const body = JSON.stringify([{ event: 'bounce', email: TAMPER_EMAIL }]);
    const res = await sendgridPOST({ request: sendgridRequest(body, {}) } as any);
    expect(res.status).toBe(403);
  });

  it('missing SENDGRID_WEBHOOK_PUBLIC_KEY -> 403 (fail-closed)', async () => {
    delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify([{ event: 'bounce', email: TAMPER_EMAIL }]);
    const signature = signSendGrid(privateKey, timestamp, body);

    const res = await sendgridPOST({
      request: sendgridRequest(body, {
        'x-twilio-email-event-webhook-signature': signature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      }),
    } as any);

    expect(res.status).toBe(403);
    const row = await suppressionRow(TAMPER_EMAIL, 'email');
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

const TWILIO_URL = 'https://bengaluruvotes.opencity.in/api/webhooks/twilio';

function computeTwilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const sortedNames = [...params.keys()].sort();
  let signedString = url;
  for (const name of sortedNames) {
    signedString += name + (params.get(name) ?? '');
  }
  return crypto.createHmac('sha1', authToken).update(signedString, 'utf8').digest('base64');
}

function twilioRequest(params: URLSearchParams, signature?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    host: 'bengaluruvotes.opencity.in',
    'x-forwarded-proto': 'https',
  };
  if (signature !== undefined) headers['x-twilio-signature'] = signature;
  return new Request(TWILIO_URL, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
}

describe('POST /api/webhooks/twilio', () => {
  const TEST_TOKEN = 'test-twilio-auth-token-t53';
  const originalToken = process.env.TWILIO_AUTH_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalToken;
  });

  it('Body=STOP -> 200, writes (normalizedPhone, "whatsapp", "stop")', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    const params = new URLSearchParams({ From: `whatsapp:${STOP_PHONE}`, Body: 'STOP' });
    const signature = computeTwilioSignature(TEST_TOKEN, TWILIO_URL, params);

    const res = await twilioPOST({ request: twilioRequest(params, signature) } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeDefined();
    expect(row!.reason).toBe('stop');
  });

  it('lowercase/whitespace-padded stop keyword still matches (trim+uppercase)', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    const params = new URLSearchParams({ From: `whatsapp:${STOP_PHONE}`, Body: '  stop  ' });
    const signature = computeTwilioSignature(TEST_TOKEN, TWILIO_URL, params);

    const res = await twilioPOST({ request: twilioRequest(params, signature) } as any);

    expect(res.status).toBe(200);
    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeDefined();
  });

  it('MessageStatus=delivered -> 200, no suppression written', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    const params = new URLSearchParams({ From: `whatsapp:${STOP_PHONE}`, MessageStatus: 'delivered' });
    const signature = computeTwilioSignature(TEST_TOKEN, TWILIO_URL, params);

    const res = await twilioPOST({ request: twilioRequest(params, signature) } as any);

    expect(res.status).toBe(200);
    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeUndefined();
  });

  it('wrong signature -> 403, writes nothing', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    const params = new URLSearchParams({ From: `whatsapp:${STOP_PHONE}`, Body: 'STOP' });
    const wrongSignature = computeTwilioSignature('a-completely-different-token', TWILIO_URL, params);

    const res = await twilioPOST({ request: twilioRequest(params, wrongSignature) } as any);

    expect(res.status).toBe(403);
    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeUndefined();
  });

  it('missing signature header -> 403', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    const params = new URLSearchParams({ From: `whatsapp:${STOP_PHONE}`, Body: 'STOP' });
    const res = await twilioPOST({ request: twilioRequest(params) } as any);
    expect(res.status).toBe(403);
  });

  it('missing TWILIO_AUTH_TOKEN -> 403 (fail-closed)', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const params = new URLSearchParams({ From: `whatsapp:${STOP_PHONE}`, Body: 'STOP' });
    const signature = computeTwilioSignature(TEST_TOKEN, TWILIO_URL, params);

    const res = await twilioPOST({ request: twilioRequest(params, signature) } as any);

    expect(res.status).toBe(403);
    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeUndefined();
  });

  it('non-form Content-Type (JSON body) with a truthy signature header -> 403, not 500, writes nothing', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    // Node's Request.formData() throws a TypeError for a JSON body -> this
    // must fail closed (403), never escape as an uncaught 500.
    const res = await twilioPOST({
      request: new Request(TWILIO_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'bengaluruvotes.opencity.in',
          'x-forwarded-proto': 'https',
          'x-twilio-signature': 'anything-truthy',
        },
        body: JSON.stringify({ From: `whatsapp:${STOP_PHONE}`, Body: 'STOP' }),
      }),
    } as any);

    expect(res.status).toBe(403);
    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeUndefined();
    const bounceRow = await suppressionRow(BOUNCE_EMAIL, 'email');
    expect(bounceRow).toBeUndefined();
  });

  it('STOP keyword with From absent -> 200, no suppression written (empty-phone no-op)', async () => {
    process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
    const params = new URLSearchParams({ Body: 'STOP' });
    const signature = computeTwilioSignature(TEST_TOKEN, TWILIO_URL, params);

    const res = await twilioPOST({ request: twilioRequest(params, signature) } as any);

    expect(res.status).toBe(200);
    const row = await suppressionRow(STOP_PHONE, 'whatsapp');
    expect(row).toBeUndefined();
  });
});
