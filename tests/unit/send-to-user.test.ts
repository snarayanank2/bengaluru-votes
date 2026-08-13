import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

// Mock the transports so no real network call ever happens, and so each test
// controls success/failure and asserts call counts precisely.
vi.mock('../../src/lib/send/sendgrid', () => ({ sendEmail: vi.fn() }));
vi.mock('../../src/lib/send/twilio', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { sendEmail } from '../../src/lib/send/sendgrid';
import { sendWhatsAppTemplate } from '../../src/lib/send/twilio';
import { sendToUser, type SendToUserUser } from '../../src/lib/send/send';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-52-specific ward id + distinctive contacts so this suite never
// collides with another test file's fixtures in the shared test DB.
const WARD_ID = 94052;
const WARD = {
  id: WARD_ID,
  nameEn: 'Send-To-User Test Ward',
  nameKn: 'ಕಳುಹಿಸು-ಬಳಕೆದಾರ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone V',
  boundaryRef: 'send-to-user-test-ward',
};

const W1_VARS = { ward: 'Send-To-User Test Ward', language: 'English', notificationsLink: 'https://bengaluruvotes.opencity.in/account/notifications' };

const FIXTURES = {
  full: { email: 'send-to-user-full@example.com', phone: '+919000000101' },
  suppressed: { email: 'send-to-user-suppressed@example.com', phone: '+919000000102' },
  sendOnce: { email: 'send-to-user-sendonce@example.com', phone: '+919000000103' },
  disabled: { email: 'send-to-user-disabled@example.com', phone: '+919000000104' },
  privacy: { email: 'send-to-user-privacy@example.com', phone: '+919000000105' },
};
const ALL_EMAILS = Object.values(FIXTURES).map((f) => f.email);

async function resetFixtures(): Promise<void> {
  await db.execute(`delete from campaign_sends where ward_id = ${WARD_ID}`);
  for (const email of ALL_EMAILS) {
    await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, email));
    await db.delete(schema.users).where(eq(schema.users.email, email));
  }
}

async function makeUser(fixture: { email: string; phone: string }): Promise<SendToUserUser> {
  const [row] = await db
    .insert(schema.users)
    .values({
      email: fixture.email,
      phone: fixture.phone,
      homeWardId: WARD_ID,
      language: 'en',
      emailEnabled: true,
      whatsappEnabled: true,
    })
    .onConflictDoUpdate({ target: schema.users.email, set: { phone: fixture.phone, homeWardId: WARD_ID } })
    .returning();
  const user = row!;
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    language: user.language,
    emailEnabled: user.emailEnabled,
    whatsappEnabled: user.whatsappEnabled,
    homeWardId: user.homeWardId,
  };
}

async function sendRows(userId: number) {
  return db.select().from(schema.campaignSends).where(eq(schema.campaignSends.userId, userId));
}

describe('src/lib/send/send.ts sendToUser', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db
      .insert(schema.wards)
      .values(WARD)
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: WARD.nameEn } });
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD_ID));
    await client.end();
  });

  beforeEach(async () => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendWhatsAppTemplate).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ ok: false, status: 'not_configured' });
    await resetFixtures();
  });

  afterEach(() => {
    delete process.env.SENDS_DISABLED;
  });

  it('a user with email+phone, both enabled, no suppression: email sent (ledger "sent"), whatsapp attempted and not_configured -> "failed", which does NOT block the email', async () => {
    const user = await makeUser(FIXTURES.full);

    const { results } = await sendToUser(user, 'W1', W1_VARS);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);

    const emailResult = results.find((r) => r.channel === 'email');
    const waResult = results.find((r) => r.channel === 'whatsapp');
    expect(emailResult).toEqual({ channel: 'email', status: 'sent' });
    expect(waResult).toEqual({ channel: 'whatsapp', status: 'failed' });

    const rows = await sendRows(user.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.channel === 'email')!.status).toBe('sent');
    expect(rows.find((r) => r.channel === 'whatsapp')!.status).toBe('failed');
  });

  it('the HTML handed to sendEmail is rendered from the W1 template Markdown (real tags), not the literal Markdown source', async () => {
    const user = await makeUser(FIXTURES.full);

    await sendToUser(user, 'W1', W1_VARS);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [, subject, html] = vi.mocked(sendEmail).mock.calls[0]!;
    expect(subject).toBe("You're set up for Send-To-User Test Ward ward updates");

    // Real HTML structure, rendered from the Markdown source (**bold**
    // list items become <strong>/<ul><li>, the bare notifications URL is
    // autolinked to <a href=...>).
    expect(html).toContain('<strong>Ward:</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain(`<a href="${W1_VARS.notificationsLink}"`);

    // NOT literal, unrendered Markdown syntax.
    expect(html).not.toContain('**');
    expect(html).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
  });

  it('a suppressed email: that channel is skipped with ledger status "suppressed", sendEmail is never called; whatsapp (unsuppressed) still proceeds', async () => {
    const user = await makeUser(FIXTURES.suppressed);
    await db.insert(schema.suppressions).values({ contact: FIXTURES.suppressed.email, channel: 'email', reason: 'bounce' });

    const { results } = await sendToUser(user, 'W1', W1_VARS);

    expect(sendEmail).not.toHaveBeenCalled();
    const emailResult = results.find((r) => r.channel === 'email');
    expect(emailResult).toEqual({ channel: 'email', status: 'suppressed' });

    const rows = await sendRows(user.id);
    expect(rows.find((r) => r.channel === 'email')!.status).toBe('suppressed');

    // whatsapp wasn't suppressed, so it was still attempted (and got the mocked not_configured -> failed).
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });

  it('SEND-ONCE: calling sendToUser twice for the same (code, user) does not re-send and does not write a duplicate campaign_sends row', async () => {
    const user = await makeUser(FIXTURES.sendOnce);

    const first = await sendToUser(user, 'W1', W1_VARS);
    expect(first.results.find((r) => r.channel === 'email')).toEqual({ channel: 'email', status: 'sent' });

    const second = await sendToUser(user, 'W1', W1_VARS);
    // Same statuses reported, but the underlying transports were not called again.
    expect(second.results.find((r) => r.channel === 'email')).toEqual({ channel: 'email', status: 'sent' });
    expect(second.results.find((r) => r.channel === 'whatsapp')).toEqual({ channel: 'whatsapp', status: 'failed' });

    expect(sendEmail).toHaveBeenCalledTimes(1); // not 2
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1); // not 2

    const rows = await sendRows(user.id);
    expect(rows).toHaveLength(2); // one per channel, never duplicated — send_once_uq holds
  });

  it('SENDS_DISABLED="true": no transport is invoked, but a campaign_sends row is still written as "sent" (send-once ledger holds in staging too)', async () => {
    process.env.SENDS_DISABLED = 'true';
    const user = await makeUser(FIXTURES.disabled);

    const { results } = await sendToUser(user, 'W1', W1_VARS);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();

    expect(results.find((r) => r.channel === 'email')).toEqual({ channel: 'email', status: 'sent' });
    expect(results.find((r) => r.channel === 'whatsapp')).toEqual({ channel: 'whatsapp', status: 'sent' });

    const rows = await sendRows(user.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
  });

  it('never logs the contact (email or phone) to console — only code/userId/channel/status', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const user = await makeUser(FIXTURES.privacy);

    await sendToUser(user, 'W1', W1_VARS);

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    logSpy.mockRestore();

    expect(logged).not.toContain(FIXTURES.privacy.email);
    expect(logged).not.toContain(FIXTURES.privacy.phone);
  });

  it('throws when neither opts.wardId nor user.homeWardId is available', async () => {
    const user = await makeUser(FIXTURES.full);
    const userWithoutWard: SendToUserUser = { ...user, homeWardId: null };
    await expect(sendToUser(userWithoutWard, 'W1', W1_VARS)).rejects.toThrow(/wardId/);
  });
});
