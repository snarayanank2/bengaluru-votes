/** Retired status/upload actions are forbidden for every role on this page. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { Fixtures, client, db, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import CandidateRoute from '../../src/pages/curator/candidate/[id].astro';
const fx = new Fixtures('retired-candidate-upload-');
const WARD = ward(99470, 'Retired Upload Test Ward');
let curator: Auth, admin: Auth;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD);
  curator = await fx.person('curator');
  admin = await fx.person('admin');
});
afterAll(async () => { await fx.cleanup(); await client.end(); });

describe('candidate editor restrictions', () => {
  it.each(['curator', 'admin'])('removes status and ingestion controls for %s and rejects direct submissions', async (role) => {
    const auth = role === 'admin' ? admin : curator;
    const c = await fx.candidateWithAffidavit(WARD.id);
    const page = (form?: FormData) => run(CandidateRoute, `/curator/candidate/${c.candidateId}`, { auth, form, params: { id: String(c.candidateId) } });
    const html = await (await page()).text();
    expect(html).not.toContain('name="status"');
    expect(html).not.toContain('name="affidavitFile"');
    expect(html).toContain(c.pdfUrl.replace(/&/g, '&#38;'));
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(schema.media);
    for (const action of ['core', 'affidavit']) {
      const form = tokenForm(auth, { formAction: action, status: 'withdrawn' });
      form.set('affidavitFile', new File(['%PDF-1.4 fictional test'], 'test.pdf', { type: 'application/pdf' }));
      expect((await page(form)).status).toBe(403);
    }
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(schema.media)).toEqual(before);
    const [row] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, c.candidateId));
    expect(row.status).toBe('filed');
  });
});
