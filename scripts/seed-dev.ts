#!/usr/bin/env tsx
/**
 * Local-dev-only fixture data: two obviously-fictional candidates in every
 * real ward, plus a few ward issues, so `astro dev`
 * has something to render. This repo serves a real election, so every
 * name/party here is deliberately unmistakable as fake ("Demo Party A",
 * "(FICTIONAL)" suffixes) — never real candidate or party data.
 *
 * Depends on wards already being seeded (`npm run seed:wards` first): it
 * identifies the 369 real ward rows by their seed boundary reference, so
 * test-only ward fixtures are never populated.
 *
 * Refuses to run when NODE_ENV=production — this is dev fixture data only.
 */
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, like } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';

const DEMO_PARTIES = [
  { en: 'Demo Party A (FICTIONAL)', kn: 'ಡೆಮೊ ಪಕ್ಷ ಎ (ಕಾಲ್ಪನಿಕ)' },
  { en: 'Demo Party B (FICTIONAL)', kn: 'ಡೆಮೊ ಪಕ್ಷ ಬಿ (ಕಾಲ್ಪನಿಕ)' },
];

const FICTIONAL_PDF = Buffer.from(
  '%PDF-1.4\n% FICTIONAL TEST DATA — NOT AN ELECTION COMMISSION AFFIDAVIT\n%%EOF\n',
  'utf8',
);

export function assertNotProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'seed-dev: refusing to run with NODE_ENV=production — this seeds fictional demo data, never for prod',
    );
  }
}

export type SeedDevResult = {
  wardIds: number[];
  candidateCount: number;
  issueCount: number;
};

/** Seed two fake candidates in every ward and a few fake ward issues. */
export async function seedDev(db: Db): Promise<SeedDevResult> {
  assertNotProduction();

  const wardRows = await db
    .select({ id: schema.wards.id })
    .from(schema.wards)
    .where(like(schema.wards.boundaryRef, 'ward_369_final.%'))
    .orderBy(schema.wards.id);

  if (wardRows.length < 1) {
    throw new Error('seed-dev: no wards found — run `npm run seed:wards` first');
  }

  const wardIds = wardRows.map((w) => w.id);

  let candidateCount = 0;
  let issueCount = 0;

  const pdfHash = createHash('sha256').update(FICTIONAL_PDF).digest('hex');
  let [pdfMedia] = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(eq(schema.media.sha256, pdfHash))
    .limit(1);
  if (!pdfMedia) {
    [pdfMedia] = await db
      .insert(schema.media)
      .values({
        bytes: FICTIONAL_PDF,
        contentType: 'application/pdf',
        sha256: pdfHash,
        size: FICTIONAL_PDF.length,
      })
      .returning({ id: schema.media.id });
  }
  if (!pdfMedia) throw new Error('seed-dev: failed to create fictional affidavit media');
  const affidavitUrl = `/media/${pdfMedia.id}/${pdfHash.slice(0, 16)}`;

  for (const [i, wardId] of wardIds.entries()) {
    for (let n = 0; n < 2; n++) {
      const slug = `demo-ward-${wardId}-candidate-${n + 1}`;
      const party = DEMO_PARTIES[(i + n) % DEMO_PARTIES.length]!;
      const nameEn = `Test Candidate ${wardId}-${n + 1} (FICTIONAL)`;
      const nameKn = `ಪರೀಕ್ಷಾ ಅಭ್ಯರ್ಥಿ ${wardId}-${n + 1} (ಕಾಲ್ಪನಿಕ)`;
      const [candidate] = await db
        .insert(schema.candidates)
        .values({
          slug,
          wardId,
          nameEn,
          nameKn,
          partyEn: party.en,
          partyKn: party.kn,
          status: 'contesting',
        })
        .onConflictDoUpdate({
          target: schema.candidates.slug,
          set: { wardId, nameEn, nameKn, partyEn: party.en, partyKn: party.kn, status: 'contesting' },
        })
        .returning({ id: schema.candidates.id });
      if (!candidate) throw new Error(`seed-dev: failed to seed ${slug}`);

      const values = [
        { key: 'full_name', en: nameEn, kn: nameKn },
        { key: 'ward', en: `Ward ${wardId} (FICTIONAL TEST DATA)`, kn: `ವಾರ್ಡ್ ${wardId} (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)` },
        { key: 'party', en: party.en, kn: party.kn },
        { key: 'gender', en: n === 0 ? 'Woman' : 'Man', kn: n === 0 ? 'ಮಹಿಳೆ' : 'ಪುರುಷ' },
        { key: 'age', en: n === 0 ? '41' : '52', kn: n === 0 ? '41' : '52' },
        { key: 'education', en: 'Demo postgraduate qualification (FICTIONAL TEST DATA)', kn: 'ಡೆಮೊ ಸ್ನಾತಕೋತ್ತರ ಅರ್ಹತೆ (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)' },
        { key: 'assets', en: n === 0 ? '₹12,34,567 (FICTIONAL TEST DATA)' : '₹23,45,678 (FICTIONAL TEST DATA)', kn: n === 0 ? '₹12,34,567 (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)' : '₹23,45,678 (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)' },
        { key: 'cases', en: 'No criminal cases declared (FICTIONAL TEST DATA)', kn: 'ಯಾವುದೇ ಕ್ರಿಮಿನಲ್ ಪ್ರಕರಣಗಳನ್ನು ಘೋಷಿಸಿಲ್ಲ (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)' },
        { key: 'ec_affidavit', en: 'Fictional test affidavit', kn: 'ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ಅಫಿಡವಿಟ್' },
      ];

      await db
        .insert(schema.candidateFields)
        .values(
          values.map((value, fieldIndex) => ({
            candidateId: candidate.id,
            fieldKey: value.key,
            valueEn: value.en,
            valueKn: value.kn,
            authoredLang: 'en' as const,
            translationStatus: 'done' as const,
            sourceType: 'official' as const,
            sourceUrl: affidavitUrl,
            aiExtracted: (n + fieldIndex) % 2 === 0,
          })),
        )
        .onConflictDoNothing({
          target: [schema.candidateFields.candidateId, schema.candidateFields.fieldKey],
        });

      const [existingAffidavit] = await db
        .select({ id: schema.candidateAffidavits.id })
        .from(schema.candidateAffidavits)
        .where(
          and(
            eq(schema.candidateAffidavits.candidateId, candidate.id),
            eq(schema.candidateAffidavits.mediaId, pdfMedia.id),
          ),
        )
        .limit(1);
      if (!existingAffidavit) {
        await db.insert(schema.candidateAffidavits).values({
          candidateId: candidate.id,
          mediaId: pdfMedia.id,
          extractionStatus: 'done',
        });
      }
      candidateCount++;
    }

    if (i >= 3) continue;
    const issueTitle = `Demo issue for ward ${wardId} (FICTIONAL TEST DATA)`;
    const [existingIssue] = await db
      .select({ id: schema.wardIssues.id })
      .from(schema.wardIssues)
      .where(and(eq(schema.wardIssues.wardId, wardId), eq(schema.wardIssues.titleEn, issueTitle)));

    if (!existingIssue) {
      await db.insert(schema.wardIssues).values({
        wardId,
        titleEn: issueTitle,
        position: 0,
      });
    }
    issueCount++;
  }

  return { wardIds, candidateCount, issueCount };
}

async function main() {
  assertNotProduction();

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Set it before running, e.g. against the\n' +
        'local stack (deploy/compose.local.yml):\n' +
        'export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/gba',
    );
    process.exit(1);
  }

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const result = await seedDev(db);
    console.log(
      `seed-dev: seeded ${result.candidateCount} fictional candidates and ` +
        `ensured ${result.issueCount} ward issues across wards ${result.wardIds.join(', ')}`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
