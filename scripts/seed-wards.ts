#!/usr/bin/env tsx
/**
 * Seed the `wards` table from data/gba.geojson.
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
import { sql } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';

const VALID_CORPORATIONS = new Set(['north', 'south', 'east', 'west', 'central']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GEOJSON_PATH = path.join(__dirname, '..', 'data', 'gba.geojson');

type WardRow = typeof schema.wards.$inferInsert;

type GeoJsonFeature = { properties: Record<string, unknown> };
type GeoJsonFeatureCollection = { features: GeoJsonFeature[] };

/** Parse data/gba.geojson into `wards` insert rows per the mapping above. */
export function loadWardRows(geojsonPath: string = DEFAULT_GEOJSON_PATH): WardRow[] {
  const geojson = JSON.parse(readFileSync(geojsonPath, 'utf8')) as GeoJsonFeatureCollection;

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

    return {
      id: corporationId * 1000 + wardId,
      nameEn,
      nameKn,
      corporation: corporationRaw as WardRow['corporation'],
      zone,
      boundaryRef: boundaryRefValue,
    };
  });
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
      },
    });

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
    console.log(`seed-wards: upserted ${count} wards`);
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
