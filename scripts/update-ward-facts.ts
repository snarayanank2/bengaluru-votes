#!/usr/bin/env tsx
/**
 * Refresh the minimized ward-facts snapshot from Bengaluru Wards/OpenCity.
 *
 * The committed snapshot is what seeding reads; seeding never calls a remote
 * service. Pass --translate when new English place names need Kannada values.
 * Existing translations are retained by exact English-name match.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE_URL = 'https://bengaluruwards.opencity.in/public/data/wards.csv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ward-facts.json');

type ExistingSnapshot = {
  wards?: Array<{
    reservationEn: string;
    reservationKn: string;
    oldWards: Array<{ nameEn: string; nameKn: string }>;
    keyAreas: Array<{ nameEn: string; nameKn: string }>;
  }>;
};

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

async function translate(value: string): Promise<string> {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.search = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'kn', dt: 't', q: value }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`translation failed (${response.status}) for ${value}`);
  const data = await response.json() as Array<Array<Array<string>>>;
  return data[0].map((part) => part[0]).join('').trim();
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`ward facts download failed: ${response.status}`);
  const lastModified = response.headers.get('last-modified');
  if (!lastModified || Number.isNaN(Date.parse(lastModified))) {
    throw new Error('ward facts source has no valid Last-Modified header');
  }
  const sourceDate = new Date(lastModified).toISOString().slice(0, 10);
  const csv = await response.text();
  const rows = parseCsv(csv);
  const headers = rows.shift();
  if (!headers) throw new Error('ward facts source has no header');
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  for (const required of ['uid', 'reservation', 'old_wards', 'neighbourhoods']) {
    if (column[required] === undefined) throw new Error(`ward facts source lacks ${required}`);
  }
  if (rows.length !== 369) throw new Error(`ward facts source has ${rows.length} wards; expected 369`);

  const existing = existsSync(OUTPUT_PATH)
    ? JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as ExistingSnapshot
    : {};
  const translations = new Map<string, string>();
  for (const ward of existing.wards ?? []) {
    if (ward.reservationEn && ward.reservationKn) translations.set(ward.reservationEn, ward.reservationKn);
    for (const item of [...(ward.oldWards ?? []), ...(ward.keyAreas ?? [])]) {
      if (item.nameEn && item.nameKn) translations.set(item.nameEn, item.nameKn);
    }
  }

  const parsed = rows.map((row) => {
    const oldWards = row[column.old_wards].split(';').map((value) => value.trim()).filter(Boolean).map((value) => {
      const match = value.match(/^(?:(\d+)\s*-\s*)?(.+?)\s*\(([\d.]+)%\)$/);
      if (!match) throw new Error(`unrecognized old ward: ${value}`);
      return { number: match[1] ? Number(match[1]) : null, nameEn: match[2].trim(), percentage: Number(match[3]) };
    });
    return {
      uid: row[column.uid].trim(),
      reservationEn: row[column.reservation].trim(),
      oldWards,
      keyAreas: row[column.neighbourhoods].split(';').map((value) => value.trim()).filter(Boolean),
    };
  });
  if (new Set(parsed.map((ward) => ward.uid)).size !== 369) throw new Error('ward facts source contains duplicate uids');

  const needed = [...new Set(parsed.flatMap((ward) => [
    ward.reservationEn,
    ...ward.oldWards.map((item) => item.nameEn),
    ...ward.keyAreas,
  ]))].filter((value) => value && !translations.has(value));
  if (needed.length && !process.argv.includes('--translate')) {
    throw new Error(`${needed.length} Kannada translations are missing; rerun with --translate`);
  }
  let next = 0;
  async function worker() {
    while (next < needed.length) {
      const index = next++;
      translations.set(needed[index], await translate(needed[index]));
      if ((index + 1) % 50 === 0) console.log(`translated ${index + 1}/${needed.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  const snapshot = {
    sourceUrl: SOURCE_URL,
    sourceDate,
    sourceSha256: createHash('sha256').update(csv).digest('hex'),
    wards: parsed.map((ward) => ({
      uid: ward.uid,
      reservationEn: ward.reservationEn,
      reservationKn: translations.get(ward.reservationEn),
      oldWards: ward.oldWards.map((item) => ({
        number: item.number,
        nameEn: item.nameEn,
        nameKn: translations.get(item.nameEn),
        percentage: item.percentage,
      })),
      keyAreas: ward.keyAreas.map((nameEn) => ({ nameEn, nameKn: translations.get(nameEn) })),
    })),
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`wrote ${OUTPUT_PATH} (${snapshot.wards.length} wards)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
