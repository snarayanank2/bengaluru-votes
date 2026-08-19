#!/usr/bin/env tsx
/**
 * Seed the `wards` table from data/gba.geojson and the five bilingual
 * candidate questions per ward from data/ward-candidate-questions.json.
 *
 * ── How this was inspected ───────────────────────────────────────────────
 *   node -e "const g=JSON.parse(require('fs').readFileSync('data/gba.geojson','utf8'));
 *     console.log(g.features.length); console.log(JSON.stringify(g.features[0].properties,null,2))"
 * → 369 features. The top-level GeoJSON `feature.id` is unset; the relevant
 * keys all live in `feature.properties`:
 *   id               e.g. "ward_369_final.1" — stable per-feature string id (369 unique)
 *   Corporation      "West" | "North" | "East" | "Central" | "South"
 *   corporation_id   1..5, 1:1 with Corporation (Central=1, North=2, East=3, South=4, West=5)
 *   ward_id          integer, but ONLY UNIQUE WITHIN A CORPORATION — verified:
 *                    only 112 distinct ward_id values exist city-wide across
 *                    369 features (West 1..112, North 1..72, East 1..50,
 *                    Central 1..63, South 1..72), i.e. each corporation
 *                    restarts its own ward numbering at 1. There is no
 *                    single city-wide "official ward number" field in this
 *                    source. (Corporation, ward_id) pairs ARE unique (369/369).
 *   ward_name        "25 - Vinayaka Layout"  — "<per-corp ward no> - <English name>"
 *   ward_name_kn     "ವಿನಾಯಕ ಲೇಔಟ್"          — Kannada name, present on all 369 features
 *   zone             "Zone1" | "Zone2"        — an ordinal sub-split within each
 *                    corporation (exactly 2 per corporation), NOT a human
 *                    administrative zone name
 *   zone_name        "Rajarajeshwarinagar" etc. — the real administrative zone
 *                    name (10 distinct values, 2 per corporation — these are
 *                    the familiar ex-BBMP zone names: Yelahanka, Mahadevapura,
 *                    Jayanagar, Malleshwaram, ...)
 *
 * ── Column mapping ───────────────────────────────────────────────────────
 *   wards.id          := corporation_id * 1000 + ward_id
 *                        CONCERN (reported in task-6-report.md): the source
 *                        has no single city-wide official ward number, so
 *                        this is a SYNTHESIZED stable composite key (unique
 *                        across all 369 features, range 1001..5112), not a
 *                        number printed on any ballot/voter document. A
 *                        later data task should confirm whether GBA has
 *                        published one true city-wide numbering and migrate
 *                        this key if so.
 *   wards.nameEn      := ward_name, verbatim — keeps the source's own
 *                        "<per-corp ward no> - <name>" formatting so the
 *                        per-corporation ward number citizens actually see
 *                        (e.g. on their voter card) isn't lost.
 *   wards.nameKn      := ward_name_kn, verbatim — present on all 369
 *                        features, so no placeholder is needed. Note: the
 *                        Kannada string does NOT carry the numeric prefix
 *                        the English one does (source asymmetry, passed
 *                        through as-is, not invented).
 *   wards.corporation := Corporation.toLowerCase(), validated against the
 *                        5-value enum (case-insensitive compare; throws if
 *                        an unrecognized value ever appears).
 *   wards.zone        := zone_name (the human administrative zone, e.g.
 *                        "Yelahanka") — NOT the `zone` property, which is
 *                        just an ordinal "Zone1"/"Zone2" label.
 *   wards.boundaryRef := properties.id (e.g. "ward_369_final.1") — stable
 *                        per-feature identifier the app can use to look up
 *                        the polygon in data/gba.geojson later.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';

const VALID_CORPORATIONS = new Set(['north', 'south', 'east', 'west', 'central']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GEOJSON_PATH = path.join(__dirname, '..', 'data', 'gba.geojson');
const DEFAULT_QUESTIONS_PATH = path.join(__dirname, '..', 'data', 'ward-candidate-questions.json');
const DEFAULT_CITY_ISSUES_PATH = path.join(__dirname, '..', 'data', 'city-issues.json');
const DEFAULT_WARD_FACTS_PATH = path.join(__dirname, '..', 'data', 'ward-facts.json');

type WardRow = typeof schema.wards.$inferInsert;

type GeoJsonFeature = { properties: Record<string, unknown> };
type GeoJsonFeatureCollection = { features: GeoJsonFeature[] };
type QuestionSeedData = {
  templates: Array<{ questionEn: string; questionKn: string }>;
  wards: Array<{ wardName: string; questions: number[] }>;
};

type WardQuestionRow = typeof schema.wardCandidateQuestions.$inferInsert;
type WardIssueRow = typeof schema.wardIssues.$inferInsert;
type CityIssue = { key: string; titleEn: string; titleKn: string };
type WardFactsSeedData = {
  sourceUrl: string;
  sourceDate: string;
  sourceSha256: string;
  wards: Array<{
    uid: string;
    reservationEn: string;
    reservationKn: string;
    oldWards: Array<{ number: number | null; nameEn: string; nameKn: string; percentage: number }>;
    keyAreas: Array<{ nameEn: string; nameKn: string }>;
  }>;
};

function loadWardFacts(pathname: string = DEFAULT_WARD_FACTS_PATH): WardFactsSeedData {
  const data = JSON.parse(readFileSync(pathname, 'utf8')) as WardFactsSeedData;
  if (!data.sourceUrl?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(data.sourceDate) || !/^[a-f0-9]{64}$/.test(data.sourceSha256)) {
    throw new Error('seed-wards: invalid ward facts metadata');
  }
  if (data.wards.length !== 369 || new Set(data.wards.map((ward) => ward.uid)).size !== 369) {
    throw new Error(`seed-wards: ward facts has ${data.wards.length} wards; expected 369 unique wards`);
  }
  return data;
}

function normalizedWardName(value: string): string {
  return value
    .replace(/^\s*\d+\s*-\s*/, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Parse data/gba.geojson into `wards` insert rows per the mapping above. */
export function loadWardRows(
  geojsonPath: string = DEFAULT_GEOJSON_PATH,
  wardFactsPath: string = DEFAULT_WARD_FACTS_PATH,
): WardRow[] {
  const geojson = JSON.parse(readFileSync(geojsonPath, 'utf8')) as GeoJsonFeatureCollection;
  const facts = loadWardFacts(wardFactsPath);
  const factsByUid = new Map(facts.wards.map((ward) => [ward.uid.toLowerCase(), ward]));

  return geojson.features.map((feature) => {
    const p = feature.properties;
    const featureRef = String(p.id ?? p.ward_id ?? '(unknown feature)');

    // boundaryRef must come strictly from properties.id; throw if absent
    const boundaryRefValue = String(p.id ?? '').trim();
    if (!boundaryRefValue) {
      throw new Error(`seed-wards: missing properties.id in feature (ward_id: ${p.ward_id})`);
    }

    const corporationRaw = String(p.Corporation ?? '').trim().toLowerCase();
    if (!VALID_CORPORATIONS.has(corporationRaw)) {
      throw new Error(`seed-wards: unmapped Corporation value ${JSON.stringify(p.Corporation)} in feature ${featureRef}`);
    }

    const corporationId = Number(p.corporation_id);
    const wardId = Number(p.ward_id);
    if (!Number.isInteger(corporationId) || !Number.isInteger(wardId)) {
      throw new Error(`seed-wards: non-integer corporation_id/ward_id in feature ${featureRef}`);
    }

    const nameEn = String(p.ward_name ?? '').trim();
    const nameKn = String(p.ward_name_kn ?? '').trim();
    if (!nameEn) throw new Error(`seed-wards: empty ward_name in feature ${featureRef}`);
    if (!nameKn) throw new Error(`seed-wards: empty ward_name_kn in feature ${featureRef}`);

    const zone = String(p.zone_name ?? '').trim();
    if (!zone) throw new Error(`seed-wards: empty zone_name in feature ${featureRef}`);

    const uid = `${String(p.Corporation).trim()}-${wardId}`.toLowerCase();
    const wardFacts = factsByUid.get(uid);
    if (!wardFacts) throw new Error(`seed-wards: no ward facts for ${uid}`);
    const assemblyNameEn = String(p.ac ?? '').trim();
    const assemblyNameKn = String(p.ac_kn ?? '').trim();
    const assemblyNumber = Number(p.ac_no);
    const populationTotal = Number(p.TOT_P);
    const populationMale = Number(p.TOT_M);
    const populationFemale = Number(p.TOT_F);
    if (!assemblyNameEn || !assemblyNameKn || !Number.isInteger(assemblyNumber)) {
      throw new Error(`seed-wards: invalid assembly data in feature ${featureRef}`);
    }
    if (![populationTotal, populationMale, populationFemale].every(Number.isInteger)) {
      throw new Error(`seed-wards: invalid population data in feature ${featureRef}`);
    }

    return {
      id: corporationId * 1000 + wardId,
      nameEn,
      nameKn,
      corporation: corporationRaw as WardRow['corporation'],
      zone,
      boundaryRef: boundaryRefValue,
      assemblyNumber,
      assemblyNameEn,
      assemblyNameKn,
      populationTotal,
      populationMale,
      populationFemale,
      reservationEn: wardFacts.reservationEn,
      reservationKn: wardFacts.reservationKn,
      factsSourceUrl: facts.sourceUrl,
      factsSourceDate: facts.sourceDate,
    };
  });
}

export function loadWardFactRows(
  geojsonPath: string = DEFAULT_GEOJSON_PATH,
  wardFactsPath: string = DEFAULT_WARD_FACTS_PATH,
) {
  const facts = loadWardFacts(wardFactsPath);
  const wardIdByUid = new Map<string, number>();
  for (const ward of loadWardRows(geojsonPath, wardFactsPath)) {
    wardIdByUid.set(`${ward.corporation}-${ward.id % 1000}`, ward.id);
  }
  const overlaps: Array<typeof schema.wardOldWardOverlaps.$inferInsert> = [];
  const keyAreas: Array<typeof schema.wardKeyAreas.$inferInsert> = [];
  for (const ward of facts.wards) {
    const wardId = wardIdByUid.get(ward.uid.toLowerCase());
    if (!wardId) throw new Error(`seed-wards: facts uid not found in GeoJSON: ${ward.uid}`);
    ward.oldWards.forEach((item, index) => {
      if (!item.nameEn.trim() || !item.nameKn.trim() || !Number.isFinite(item.percentage)) {
        throw new Error(`seed-wards: invalid old ward for ${ward.uid}`);
      }
      overlaps.push({
        wardId,
        position: index + 1,
        oldWardNumber: item.number,
        oldWardNameEn: item.nameEn.trim(),
        oldWardNameKn: item.nameKn.trim(),
        publishedOverlapBasisPoints: Math.round(item.percentage * 100),
      });
    });
    ward.keyAreas.forEach((item, index) => {
      if (!item.nameEn.trim() || !item.nameKn.trim()) throw new Error(`seed-wards: invalid key area for ${ward.uid}`);
      keyAreas.push({ wardId, position: index + 1, nameEn: item.nameEn.trim(), nameKn: item.nameKn.trim() });
    });
  }
  return { overlaps, keyAreas };
}

/** Map the source's repeated per-corporation ids to our wards by unique name. */
export function loadWardCandidateQuestionRows(
  questionsPath: string = DEFAULT_QUESTIONS_PATH,
  wardGeojsonPath: string = DEFAULT_GEOJSON_PATH,
): WardQuestionRow[] {
  const data = JSON.parse(readFileSync(questionsPath, 'utf8')) as QuestionSeedData;
  const wardsByName = new Map<string, WardRow>();

  for (const ward of loadWardRows(wardGeojsonPath)) {
    const key = normalizedWardName(ward.nameEn);
    if (wardsByName.has(key)) {
      throw new Error(`seed-wards: duplicate normalized ward name ${JSON.stringify(ward.nameEn)}`);
    }
    wardsByName.set(key, ward);
  }

  if (data.wards.length !== wardsByName.size) {
    throw new Error(
      `seed-wards: question source has ${data.wards.length} wards; expected ${wardsByName.size}`,
    );
  }

  const seenWardIds = new Set<number>();
  const rows: WardQuestionRow[] = [];
  for (const sourceWard of data.wards) {
    const ward = wardsByName.get(normalizedWardName(sourceWard.wardName));
    if (!ward) {
      throw new Error(`seed-wards: question source ward not found: ${sourceWard.wardName}`);
    }
    if (seenWardIds.has(ward.id)) {
      throw new Error(`seed-wards: duplicate question source ward: ${sourceWard.wardName}`);
    }
    if (sourceWard.questions.length !== 5) {
      throw new Error(`seed-wards: ${sourceWard.wardName} has ${sourceWard.questions.length} questions; expected 5`);
    }

    seenWardIds.add(ward.id);
    sourceWard.questions.forEach((templateIndex, index) => {
      const template = data.templates[templateIndex];
      if (!template?.questionEn.trim() || !template.questionKn.trim()) {
        throw new Error(
          `seed-wards: invalid question template ${templateIndex} for ${sourceWard.wardName}`,
        );
      }
      rows.push({
        wardId: ward.id,
        position: index + 1,
        questionEn: template.questionEn.trim(),
        questionKn: template.questionKn.trim(),
      });
    });
  }

  return rows;
}

/** Upsert all five candidate questions for every seeded ward. */
export async function seedWardCandidateQuestions(
  db: Db,
  questionsPath?: string,
  wardGeojsonPath?: string,
): Promise<number> {
  const rows = loadWardCandidateQuestionRows(questionsPath, wardGeojsonPath);
  await db
    .insert(schema.wardCandidateQuestions)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.wardCandidateQuestions.wardId, schema.wardCandidateQuestions.position],
      set: {
        questionEn: sql`excluded.question_en`,
        questionKn: sql`excluded.question_kn`,
      },
    });
  return rows.length;
}

/** Expand the shared 20-issue catalog into one bilingual row per ward. */
export function loadCityIssueRows(
  cityIssuesPath: string = DEFAULT_CITY_ISSUES_PATH,
  wardGeojsonPath: string = DEFAULT_GEOJSON_PATH,
): WardIssueRow[] {
  const issues = JSON.parse(readFileSync(cityIssuesPath, 'utf8')) as CityIssue[];
  if (!Array.isArray(issues) || issues.length !== 20) {
    throw new Error(`seed-wards: city issue catalog has ${issues.length} issues; expected 20`);
  }
  const keys = new Set<string>();
  issues.forEach((issue, index) => {
    if (!issue.key?.trim() || !issue.titleEn?.trim() || !issue.titleKn?.trim()) {
      throw new Error(`seed-wards: invalid city issue at position ${index + 1}`);
    }
    if (keys.has(issue.key)) throw new Error(`seed-wards: duplicate city issue key ${issue.key}`);
    keys.add(issue.key);
  });

  return loadWardRows(wardGeojsonPath).flatMap((ward) => issues.map((issue, index) => ({
    wardId: ward.id,
    catalogKey: issue.key.trim(),
    titleEn: issue.titleEn.trim(),
    titleKn: issue.titleKn.trim(),
    authoredLang: 'en' as const,
    translationStatus: 'done' as const,
    position: index + 1,
  })));
}

export async function seedCityIssues(db: Db, cityIssuesPath?: string, wardGeojsonPath?: string): Promise<number> {
  const rows = loadCityIssueRows(cityIssuesPath, wardGeojsonPath);
  // Keep batches comfortably below Postgres's bind-parameter limit.
  for (let offset = 0; offset < rows.length; offset += 500) {
    await db.insert(schema.wardIssues).values(rows.slice(offset, offset + 500)).onConflictDoUpdate({
      target: [schema.wardIssues.wardId, schema.wardIssues.catalogKey],
      targetWhere: sql`${schema.wardIssues.catalogKey} is not null`,
      set: {
        titleEn: sql`excluded.title_en`,
        titleKn: sql`excluded.title_kn`,
        translationStatus: 'done',
        position: sql`excluded.position`,
      },
    });
  }
  return rows.length;
}

/** Upsert every ward row from data/gba.geojson. Idempotent. Returns the row count. */
export async function seedWards(db: Db, geojsonPath?: string): Promise<number> {
  const rows = loadWardRows(geojsonPath);

  const ids = new Set(rows.map((r) => r.id));
  if (ids.size !== rows.length) {
    // Guard protecting the composite-key scheme (corporation_id * 1000 + ward_id):
    // catches any ward_id >= 1000 collision that would break key uniqueness.
    throw new Error(`seed-wards: duplicate composite ward ids detected (${rows.length} rows, ${ids.size} unique ids)`);
  }

  await db
    .insert(schema.wards)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.wards.id,
      set: {
        nameEn: sql`excluded.name_en`,
        nameKn: sql`excluded.name_kn`,
        corporation: sql`excluded.corporation`,
        zone: sql`excluded.zone`,
        boundaryRef: sql`excluded.boundary_ref`,
        assemblyNumber: sql`excluded.assembly_number`,
        assemblyNameEn: sql`excluded.assembly_name_en`,
        assemblyNameKn: sql`excluded.assembly_name_kn`,
        populationTotal: sql`excluded.population_total`,
        populationMale: sql`excluded.population_male`,
        populationFemale: sql`excluded.population_female`,
        reservationEn: sql`excluded.reservation_en`,
        reservationKn: sql`excluded.reservation_kn`,
        factsSourceUrl: sql`excluded.facts_source_url`,
        factsSourceDate: sql`excluded.facts_source_date`,
      },
    });

  const facts = loadWardFactRows(geojsonPath);
  await db.delete(schema.wardOldWardOverlaps).where(inArray(schema.wardOldWardOverlaps.wardId, [...ids]));
  await db.delete(schema.wardKeyAreas).where(inArray(schema.wardKeyAreas.wardId, [...ids]));
  for (let offset = 0; offset < facts.overlaps.length; offset += 500) {
    await db.insert(schema.wardOldWardOverlaps).values(facts.overlaps.slice(offset, offset + 500));
  }
  for (let offset = 0; offset < facts.keyAreas.length; offset += 500) {
    await db.insert(schema.wardKeyAreas).values(facts.keyAreas.slice(offset, offset + 500));
  }

  await seedWardCandidateQuestions(db, undefined, geojsonPath);
  await seedCityIssues(db, undefined, geojsonPath);

  return rows.length;
}

async function main() {
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
    const count = await seedWards(db);
    console.log(`seed-wards: upserted ${count} wards with facts, ${count * 5} candidate questions, and ${count * 20} city issues`);
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
