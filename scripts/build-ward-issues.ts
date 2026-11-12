/**
 * Rebuild data/ward-issues.json (the issues seeded into every ward) from a
 * ward-issue-gen GeoJSON.
 *
 *   npm run build:ward-issues -- <new_wards.geojson> [--text <issue_text.json>]
 *   npm run seed:wards            # then load the result into the database
 *
 * Input: the `out/new_wards.geojson` written by ward-issue-gen. Each feature has
 * `corporation`, `ward_id` and `top_issues` (ranked; the first 12 usable ones are used). `--text` defaults
 * to ward-issue-gen/issue_text.json next to this repo and supplies the English
 * title of every kept sub-category (`issues[..].short`) and rolled-up category
 * (`categories[..].plain` / `.other`).
 *
 * Categories listed under `skip` in data/ward-issue-titles.json are dropped before
 * the top 12 is taken, so a ward moves on to its next-ranked issue.
 *
 * CSV review export (writes nothing else, needs no Kannada, no fixed issues):
 *
 *   npm run build:ward-issues -- <new_wards.geojson> --csv issues.csv [--count 12]
 *
 * One row per ward: corporation, ward number, ward name, issue1..issueN, using the
 * same skip list, English wording and "Other" handling as the seeded data.
 *
 * Output: each ward's ranked issues followed by the fixed issues in
 * data/ward-issue-titles.json, with Kannada looked up there by English title.
 * Anything the geojson uses that has no English or Kannada text is listed and
 * nothing is written, so the file is never left half-built.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const OUT_PATH = path.join(DATA, 'ward-issues.json');
const TITLES_PATH = path.join(DATA, 'ward-issue-titles.json');
const WARDS_PATH = path.join(DATA, 'gba.geojson');
const DEFAULT_TEXT_PATH = path.join(__dirname, '..', '..', 'ward-issue-gen', 'issue_text.json');
const CORPORATION_IDS: Record<string, number> = { Central: 1, North: 2, East: 3, South: 4, West: 5 };
const RANKED_PER_WARD = 12;

type TopIssue = { category: string; sub_category: string | null; rolled_up: boolean; other?: boolean };
type Feature = { properties: { corporation: string; ward_id: string | number; ward_name: string; top_issues: TopIssue[] } };
type IssueText = {
  issues: Record<string, { short: string }>;
  categories: Record<string, { name?: string; plain?: string; other?: string }>;
};
type Titles = { skip?: string[]; english?: Record<string, string>; fixed: Array<{ key: string; titleEn: string; titleKn: string }>; kn: Record<string, string> };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

function parseArgs(argv: string[]): { geojson: string; text: string; csv: string | null; count: number } {
  const args = argv.slice(2);
  const take = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const text = take('--text') ?? DEFAULT_TEXT_PATH;
  const csv = take('--csv') ?? null;
  const count = Number(take('--count') ?? 12);
  if (args.length !== 1 || !Number.isInteger(count) || count < 1) {
    console.error('usage: npm run build:ward-issues -- <new_wards.geojson> [--text <issue_text.json>] [--csv <out.csv> [--count N]]');
    process.exit(2);
  }
  return { geojson: path.resolve(args[0]!), text: path.resolve(text), csv: csv && path.resolve(csv), count };
}

const csvCell = (value: string | number) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/** Review export: each ward's first `count` usable issues in English, no Kannada or fixed issues needed. */
function writeCsv(features: Feature[], text: IssueText, skipped: Set<string>, overrides: Record<string, string> | undefined, count: number, file: string): void {
  const header = ['corporation', 'ward_number', 'ward_name', ...Array.from({ length: count }, (_, i) => `issue${i + 1}`)];
  const body: Array<Array<string | number>> = [];
  const problems: string[] = [];
  for (const feature of features) {
    const { corporation, ward_id: wardNumber, ward_name: wardName, top_issues: top } = feature.properties;
    const used = top.filter((issue) => !skipped.has(issue.category)).slice(0, count);
    if (used.length < count) problems.push(`${corporation} ward ${wardNumber} has only ${used.length} usable issues`);
    const kept = new Set(used.filter((issue) => !issue.rolled_up).map((issue) => issue.category));
    const titles = used.map((issue) => describe({ ...issue, other: issue.rolled_up && kept.has(issue.category) }, text, overrides).titleEn ?? `[no text] ${issue.category} | ${issue.sub_category}`);
    body.push([corporation, wardNumber, wardName, ...titles, ...Array(Math.max(0, count - titles.length)).fill('')]);
  }
  body.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));
  const rows = [header, ...body];
  const missing = [...new Set(rows.flat().filter((cell) => String(cell).startsWith('[no text] ')))];
  if (problems.length) {
    console.error(`build-ward-issues: csv not written:\n  - ${problems.slice(0, 20).join('\n  - ')}`);
    process.exit(1);
  }
  if (missing.length) console.warn(`build-ward-issues: no wording in issue_text.json, raw BBMP name used (marked [no text]):\n  - ${missing.join('\n  - ')}`);
  writeFileSync(file, `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`);
  console.log(`build-ward-issues: wrote ${rows.length - 1} wards x ${count} issues to ${file}`);
}

function describe(issue: TopIssue, text: IssueText, overrides: Record<string, string> = {}): { key: string; titleEn: string | undefined; source: string } {
  if (!issue.rolled_up) {
    const source = `${issue.category} | ${issue.sub_category}`;
    return { key: slug(issue.sub_category ?? ''), titleEn: overrides[source] ?? text.issues[source]?.short, source: `issues["${source}"]` };
  }
  const category = text.categories[issue.category];
  const name = category?.name ?? issue.category;
  const titleEn = issue.other
    ? (category?.other ?? `Other issues related to ${name}`)
    : (category?.plain ?? `Issues related to ${name}`);
  return { key: `category-${issue.other ? 'other-' : ''}${slug(issue.category)}`, titleEn, source: `categories["${issue.category}"]` };
}

function main(): void {
  const { geojson, text: textPath, csv, count } = parseArgs(process.argv);
  const features = readJson<{ features: Feature[] }>(geojson).features;
  const text = readJson<IssueText>(textPath);
  const titles = readJson<Titles>(TITLES_PATH);
  const skipped = new Set(titles.skip ?? []);
  if (csv) return writeCsv(features, text, skipped, titles.english, count, csv);
  const knownWards = new Set(
    readJson<{ features: Array<{ properties: { corporation_id: number; ward_id: number } }> }>(WARDS_PATH)
      .features.map((f) => f.properties.corporation_id * 1000 + Number(f.properties.ward_id)),
  );

  const problems: string[] = [];
  const issues = new Map<string, { titleEn: string; titleKn: string }>();
  const wards: Record<string, string[]> = {};
  for (const feature of features) {
    const { corporation, ward_id: wardNumber, top_issues: top } = feature.properties;
    const corporationId = CORPORATION_IDS[corporation];
    if (!corporationId) { problems.push(`unknown corporation "${corporation}" (ward ${wardNumber})`); continue; }
    const wardId = corporationId * 1000 + Number(wardNumber);
    if (!knownWards.has(wardId)) problems.push(`ward ${wardId} (${corporation} ${wardNumber}) is not in gba.geojson`);
    const available = top.filter((issue) => !skipped.has(issue.category)).length;
    if (available < RANKED_PER_WARD) problems.push(`ward ${wardId} has ${available} usable ranked issues, need at least ${RANKED_PER_WARD}`);
    // The geojson computes `other` over its whole list; recompute it over the issues we keep.
    const used = top.filter((issue) => !skipped.has(issue.category)).slice(0, RANKED_PER_WARD);
    const keptCategories = new Set(used.filter((issue) => !issue.rolled_up).map((issue) => issue.category));

    const keys: string[] = [];
    for (const issue of used) {
      const { key, titleEn, source } = describe({ ...issue, other: issue.rolled_up && keptCategories.has(issue.category) }, text, titles.english);
      if (!titleEn) { problems.push(`no English text for ${source} in ${path.basename(textPath)}`); continue; }
      const titleKn = titles.kn[titleEn];
      if (!titleKn) { problems.push(`no Kannada title for "${titleEn}" (add it to data/ward-issue-titles.json "kn")`); continue; }
      const known = issues.get(key);
      if (known && known.titleEn !== titleEn) problems.push(`key "${key}" maps to both "${known.titleEn}" and "${titleEn}"`);
      issues.set(key, { titleEn, titleKn });
      keys.push(key);
    }
    wards[String(wardId)] = [...keys, ...titles.fixed.map((fixed) => fixed.key)];
  }
  for (const fixed of titles.fixed) issues.set(fixed.key, { titleEn: fixed.titleEn, titleKn: fixed.titleKn });

  for (const [wardId, keys] of Object.entries(wards)) {
    const english = keys.map((key) => issues.get(key)?.titleEn);
    if (new Set(keys).size !== keys.length || new Set(english).size !== english.length) {
      problems.push(`ward ${wardId} has duplicate issues: ${english.join(' | ')}`);
    }
  }
  for (const wardId of knownWards) if (!wards[String(wardId)]) problems.push(`ward ${wardId} is missing from the geojson`);

  if (problems.length) {
    const unique = [...new Set(problems)];
    console.error(`build-ward-issues: ${unique.length} problem(s), nothing written:\n  - ${unique.slice(0, 40).join('\n  - ')}`);
    process.exit(1);
  }

  const sortedWards = Object.fromEntries(Object.entries(wards).sort(([a], [b]) => Number(a) - Number(b)));
  const output = {
    _source: `Top ${RANKED_PER_WARD} grievance categories per ward from ${path.basename(geojson)} (ward-issue-gen), titled from ${path.basename(textPath)}, followed by the fixed issues in ward-issue-titles.json. Ward ids are corporation_id * 1000 + ward number. Regenerate with scripts/build-ward-issues.ts; do not edit by hand.`,
    issues: [...issues].sort(([a], [b]) => a.localeCompare(b)).map(([key, title]) => ({ key, ...title })),
    wards: sortedWards,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`build-ward-issues: wrote ${Object.keys(sortedWards).length} wards, ${output.issues.length} distinct issues to data/ward-issues.json`);
}

main();
