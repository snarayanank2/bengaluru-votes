#!/usr/bin/env tsx
/**
 * Local-dev-only fixture data: two obviously-fictional candidates in every
 * real ward, plus a few ward issues, so `astro dev`
 * has something to render. This repo serves a real election, so every
 * name/party here is deliberately unmistakable as fake ("Demo Party A",
 * "(FICTIONAL)" suffixes) — never real candidate or party data.
 *
 * Each candidate's seven affidavit fields are published the way the
 * extraction worker publishes them (`publishAffidavitFields`, structured
 * `value_data`), so the curator's and transcriber's forms open with values
 * in them. The curator's screens also get something to work on: two pending
 * flags from a fictional citizen, and two affidavits waiting to be matched.
 *
 * Idempotent: a field that already holds a structured value is left alone
 * (a correction made while testing survives a re-run), a flag is added only
 * while its target has none pending, and a waiting affidavit only once.
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
import type { AffidavitExtraction } from '../src/lib/affidavit-extraction';
import { fieldsFromExtraction, formatInr, publishAffidavitFields, type AffidavitFieldKey } from '../src/lib/affidavit-publish';
import type { MatchReason } from '../src/lib/affidavit-queue';

const DEMO_PARTIES = [
  { en: 'Demo Party A (FICTIONAL)', kn: 'ಡೆಮೊ ಪಕ್ಷ ಎ (ಕಾಲ್ಪನಿಕ)' },
  { en: 'Demo Party B (FICTIONAL)', kn: 'ಡೆಮೊ ಪಕ್ಷ ಬಿ (ಕಾಲ್ಪನಿಕ)' },
];

/** What the demo affidavit was before it was a PDF a browser can show; kept to find rows an earlier seed wrote. */
const LEGACY_FICTIONAL_PDF = Buffer.from(
  '%PDF-1.4\n% FICTIONAL TEST DATA — NOT AN ELECTION COMMISSION AFFIDAVIT\n%%EOF\n',
  'utf8',
);

export const DEMO_CITIZEN_EMAIL = 'demo-citizen-fictional@example.com';

/**
 * A one-page PDF that says `label`, so a waiting affidavit shows a page
 * beside its form. Each label gives different bytes, and so its own
 * `sha256` (`candidate_affidavits.sha256` is unique). ASCII labels only.
 */
function fictionalPdf(label: string): Buffer {
  const text = `BT /F1 16 Tf 56 760 Td (FICTIONAL TEST DATA - NOT AN ELECTION COMMISSION AFFIDAVIT) Tj 0 -28 Td (${label}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** What the AI would have read from a demo candidate's affidavit. `n` is 0 or 1: the candidate's place in the ward. */
function demoExtraction(n: number, wardNumber: number, name: string, party: string): AffidavitExtraction {
  const movableInr = n === 0 ? 834567 : 1245678;
  const immovableInr = n === 0 ? 400000 : 1100000;
  return {
    age: { status: 'value', years: n === 0 ? 41 : 52 },
    education: { status: 'value', level: 'Post Graduate', stated: 'Demo postgraduate qualification (FICTIONAL TEST DATA)' },
    assets: { status: 'value', movableInr, immovableInr, totalInr: movableInr + immovableInr, note: null },
    cases: { status: 'value', pending: 0, convictions: 0, note: null },
    identity: {
      name: { status: 'value', text: name },
      ward: { status: 'value', number: wardNumber, name: null, corporation: null },
      party: { status: 'value', text: party },
      gender: { status: 'value', gender: n === 0 ? 'female' : 'male' },
    },
    confidence: 90,
  };
}

/** The Kannada beside each published English value: demo data is seeded already translated, as it always was. */
function demoKannada(e: AffidavitExtraction, nameKn: string, partyKn: string): Record<AffidavitFieldKey, string> {
  return {
    full_name: nameKn,
    party: partyKn,
    gender: e.identity.gender.gender === 'female' ? 'ಮಹಿಳೆ' : 'ಪುರುಷ',
    age: String(e.age.years),
    education: 'ಸ್ನಾತಕೋತ್ತರ: ಡೆಮೊ ಸ್ನಾತಕೋತ್ತರ ಅರ್ಹತೆ (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)',
    assets: `${formatInr(e.assets.totalInr!)} (ಚರ ${formatInr(e.assets.movableInr!)}; ಸ್ಥಿರ ${formatInr(e.assets.immovableInr!)})`,
    cases: `${e.cases.pending} ಬಾಕಿ, ${e.cases.convictions} ಶಿಕ್ಷೆ`,
  };
}

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
  /** The two pending demo flags (assets, ward) on the first ward's second candidate. */
  flagItemIds: number[];
  /** The two demo affidavits waiting to be matched, unless a curator has matched them since. */
  waitingAffidavitIds: number[];
};

/** Seed two fake candidates in every ward, a few fake ward issues, and work for the curator's screens. */
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
  const candidateIds = new Map<string, number>();

  // One PDF shared by every demo candidate.
  const demoPdf = fictionalPdf('Demo affidavit: shared by every demo candidate');
  const pdfHash = createHash('sha256').update(demoPdf).digest('hex');
  let [pdfMedia] = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(eq(schema.media.sha256, pdfHash))
    .limit(1);
  if (!pdfMedia) {
    [pdfMedia] = await db
      .insert(schema.media)
      .values({
        bytes: demoPdf,
        contentType: 'application/pdf',
        sha256: pdfHash,
        size: demoPdf.length,
      })
      .returning({ id: schema.media.id });
  }
  if (!pdfMedia) throw new Error('seed-dev: failed to create fictional affidavit media');
  const affidavitUrl = `/media/${pdfMedia.id}/${pdfHash.slice(0, 16)}`;

  // A database seeded before the demo affidavit was a readable PDF: move its
  // rows onto the new one. Stored media is immutable, so the old row stays.
  const legacyHash = createHash('sha256').update(LEGACY_FICTIONAL_PDF).digest('hex');
  const [legacy] = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(eq(schema.media.sha256, legacyHash))
    .orderBy(schema.media.id)
    .limit(1);
  if (legacy) {
    await db.update(schema.candidateAffidavits).set({ mediaId: pdfMedia.id }).where(eq(schema.candidateAffidavits.mediaId, legacy.id));
    await db
      .update(schema.candidateFields)
      .set({ sourceUrl: affidavitUrl })
      .where(eq(schema.candidateFields.sourceUrl, `/media/${legacy.id}/${legacyHash.slice(0, 16)}`));
  }

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

      // The seven affidavit fields, structured, as the extraction worker
      // would have published them: AI-extracted, checked by nobody.
      const extraction = demoExtraction(n, wardId, nameEn, party.en);
      const stored = await db
        .select({ fieldKey: schema.candidateFields.fieldKey, valueData: schema.candidateFields.valueData })
        .from(schema.candidateFields)
        .where(eq(schema.candidateFields.candidateId, candidate.id));
      const structured = new Set(stored.filter((field) => field.valueData !== null).map((field) => field.fieldKey));
      const toPublish = fieldsFromExtraction(extraction).filter((field) => !structured.has(field.key));
      if (toPublish.length > 0) {
        const kannada = demoKannada(extraction, nameKn, party.kn);
        await db.transaction(async (tx) => {
          await publishAffidavitFields(tx, { userId: null, role: 'system' }, candidate.id, toPublish, { sourceUrl: affidavitUrl, checked: false });
          for (const field of toPublish) {
            await tx
              .update(schema.candidateFields)
              .set({ valueKn: kannada[field.key], translationStatus: 'done' })
              .where(and(eq(schema.candidateFields.candidateId, candidate.id), eq(schema.candidateFields.fieldKey, field.key)));
          }
        });
      }

      // The ward label and the affidavit document have no structured value.
      await db
        .insert(schema.candidateFields)
        .values(
          [
            { key: 'ward', en: `Ward ${wardId} (FICTIONAL TEST DATA)`, kn: `ವಾರ್ಡ್ ${wardId} (ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ದತ್ತಾಂಶ)`, aiExtracted: n === 1 },
            { key: 'ec_affidavit', en: 'Fictional test affidavit', kn: 'ಕಾಲ್ಪನಿಕ ಪರೀಕ್ಷಾ ಅಫಿಡವಿಟ್', aiExtracted: n === 0 },
          ].map((value) => ({
            candidateId: candidate.id,
            fieldKey: value.key,
            valueEn: value.en,
            valueKn: value.kn,
            authoredLang: 'en' as const,
            translationStatus: 'done' as const,
            sourceType: 'official' as const,
            sourceUrl: affidavitUrl,
            aiExtracted: value.aiExtracted,
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
          state: 'published',
        });
      }
      candidateIds.set(slug, candidate.id);
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

  const firstWardId = wardIds[0]!;
  const secondWardId = wardIds[1] ?? firstWardId;
  const flagItemIds = await seedDemoFlags(db, candidateIds.get(`demo-ward-${firstWardId}-candidate-2`)!, firstWardId, secondWardId);
  const waitingAffidavitIds = await seedWaitingAffidavits(db, candidateIds.get(`demo-ward-${secondWardId}-candidate-1`)!, secondWardId);

  return { wardIds, candidateCount, issueCount, flagItemIds, waitingAffidavitIds };
}

/**
 * Two pending flags from a fictional citizen on one candidate: one on the
 * declared assets (a field fix) and one on the ward (a ward move). A target
 * that already has a pending flag is left as it is.
 */
async function seedDemoFlags(db: Db, candidateId: number, wardId: number, otherWardId: number): Promise<number[]> {
  await db
    .insert(schema.users)
    .values({ email: DEMO_CITIZEN_EMAIL, role: 'citizen', status: 'active' })
    .onConflictDoNothing({ target: schema.users.email });
  const [citizen] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, DEMO_CITIZEN_EMAIL));
  if (!citizen) throw new Error('seed-dev: failed to seed the demo citizen');

  const flags = [
    {
      key: 'assets',
      detail: 'Demo flag: the total is lower than the affidavit says (FICTIONAL TEST DATA).',
      suggestedValue: '₹15,00,000',
    },
    {
      key: 'ward',
      detail: 'Demo flag: this candidate filed from a different ward (FICTIONAL TEST DATA).',
      suggestedValue: `Ward ${otherWardId}`,
    },
  ];

  const ids: number[] = [];
  for (const flag of flags) {
    const targetRef = `candidate:${candidateId}:${flag.key}`;
    const [pending] = await db
      .select({ id: schema.flagItems.id })
      .from(schema.flagItems)
      .where(and(eq(schema.flagItems.targetRef, targetRef), eq(schema.flagItems.status, 'pending')));
    if (pending) {
      ids.push(pending.id);
      continue;
    }
    const [item] = await db
      .insert(schema.flagItems)
      .values({ wardId, targetType: 'candidate_field', targetRef })
      .returning({ id: schema.flagItems.id });
    if (!item) throw new Error(`seed-dev: failed to seed a flag on ${targetRef}`);
    await db.insert(schema.flagSubmissions).values({
      flagItemId: item.id,
      userId: citizen.id,
      detail: flag.detail,
      suggestedValue: flag.suggestedValue,
    });
    ids.push(item.id);
  }
  return ids;
}

/**
 * Two affidavits waiting to be matched: one the AI could not place in a
 * ward, with no candidate yet, and one a transcriber sent back from a
 * candidate it is already published on. Each has its own PDF. Seeded once:
 * after a curator matches one it stays matched.
 */
async function seedWaitingAffidavits(db: Db, sentBackCandidateId: number, sentBackWardId: number): Promise<number[]> {
  const unplaced = demoExtraction(0, 999, 'Unmatched Test Candidate (FICTIONAL)', DEMO_PARTIES[0]!.en);
  unplaced.identity.ward.name = 'Demo Nagar (FICTIONAL)';
  unplaced.confidence = 62;
  const sentBack = demoExtraction(0, sentBackWardId, 'Sent Back Test Candidate (FICTIONAL)', DEMO_PARTIES[1]!.en);

  const waiting: Array<{ label: string; reason: MatchReason; candidateId: number | null; note: string | null; extraction: AffidavitExtraction }> = [
    { label: 'Demo affidavit 1: ward not resolved', reason: 'ward_unresolved', candidateId: null, note: null, extraction: unplaced },
    {
      label: 'Demo affidavit 2: sent back by a transcriber',
      reason: 'reported_by_transcriber',
      candidateId: sentBackCandidateId,
      note: 'Demo note: the affidavit names a different ward from the one this candidate is listed in (FICTIONAL TEST DATA).',
      extraction: sentBack,
    },
  ];

  const ids: number[] = [];
  for (const item of waiting) {
    const bytes = fictionalPdf(item.label);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const [existing] = await db
      .select({ id: schema.candidateAffidavits.id, state: schema.candidateAffidavits.state })
      .from(schema.candidateAffidavits)
      .where(eq(schema.candidateAffidavits.sha256, sha256));
    if (existing) {
      if (existing.state === 'needs_matching') ids.push(existing.id);
      continue;
    }
    const [stored] = await db
      .insert(schema.media)
      .values({ bytes, contentType: 'application/pdf', sha256, size: bytes.length })
      .returning({ id: schema.media.id });
    if (!stored) throw new Error('seed-dev: failed to store a waiting affidavit');
    const [row] = await db
      .insert(schema.candidateAffidavits)
      .values({
        candidateId: item.candidateId,
        mediaId: stored.id,
        state: 'needs_matching',
        matchReason: item.reason,
        matchNote: item.note,
        extraction: item.extraction,
        confidence: item.extraction.confidence,
        sha256,
      })
      .returning({ id: schema.candidateAffidavits.id });
    if (!row) throw new Error('seed-dev: failed to seed a waiting affidavit');
    ids.push(row.id);
  }
  return ids;
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
        `ensured ${result.issueCount} ward issues across wards ${result.wardIds.join(', ')}; ` +
        `${result.flagItemIds.length} pending demo flags, ${result.waitingAffidavitIds.length} affidavits waiting to be matched`,
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
