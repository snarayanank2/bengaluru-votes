# Affidavit Pipeline and Transcriber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An uploaded affidavit PDF is extracted by a worker, published with AI labels when its ward resolves, and then handed to a transcriber who confirms or corrects it on a desktop reading screen.

**Architecture:** `candidate_affidavits` is the extraction queue, claimed with `FOR UPDATE SKIP LOCKED` by a long-running worker. One module (`affidavit-publish.ts`) is the only writer of structured field values, used by the worker, the admin matching page and the transcriber save. Transcription is a second, separate queue of assignments drawn by one SQL statement.

**Tech Stack:** Astro SSR, TypeScript, Postgres via Drizzle (hand-written forward-only SQL migrations), `@anthropic-ai/sdk`, Zod v4 entry point, vitest with Astro's container API.

**Specs:** `docs/superpowers/specs/2026-10-13-affidavit-pipeline-design.md` (Tasks 1–7), `docs/superpowers/specs/2026-10-13-transcriber-design.md` (Tasks 8–13).

**Execution:** Native, in this session, on branch `affidavit-pipeline-transcriber`. Siva approved the specs and asked not to be consulted for approvals during implementation; integration to `main` still waits for him.

## Global Constraints

- Commit after every task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests run in the local Compose image against `bv_test`, never `gba`:
  `docker compose -f deploy/compose.local.yml run --rm --no-deps -e DATABASE_URL=postgres://gba:gba_local_dev@postgres:5432/bv_test app npx vitest run <path>`
- A failed extraction is never converted into `not_declared`.
- No real model call in any test; the worker and tests take an injected extractor.
- New Zod schemas import `* as z from 'zod/v4'`.
- Every new UI string goes into `src/i18n/en.json` with a `__hints` entry and into `kn.json` with its `__hashes` entry; `npm run translate -- --check` must pass.
- `/admin/affidavits` and `/transcribe` have no `/kn` twin and read language from `loadCuratorLang`.
- Transcriber screens are desktop only. No mobile layout.
- Logs carry ids and states, never candidate names or values.
- Models, exact ids: `claude-opus-5-5` default; `EXTRACTION_MODEL` may name any of `EXTRACTION_MODELS`.
- Assignment expiry 45 minutes. Extraction lease 15 minutes. Three extraction attempts. `low_confidence_threshold` default `70`.

## Review Focus

1. **Two workers or two transcribers at the same instant** must never be given the same row. Tests in Tasks 4 and 9 run concurrent claims and draws.
2. **A crashed worker or a transcriber who walks away** must not strand an affidavit. Lease and assignment expiry tests in Tasks 4 and 9.
3. **A save after the assignment expired** must write nothing. Task 9.
4. **The same PDF uploaded twice**, including concurrently, must produce one affidavit. Task 4 (unique `sha256`, conflict handled, not a 500).
5. **A curator's free-text edit after a transcriber's save** must not leave stale structured data behind the text. Task 3.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/affidavit-extraction.ts` (modify) | Adds `identity` to schema, checks and instruction |
| `scripts/eval-extraction/grade.ts`, `report.ts` (modify) | Scores name, party, gender |
| `drizzle/0012_affidavit_queue.sql`, `0013_transcription.sql` | Migrations |
| `src/db/schema.ts` (modify) | New columns, enums, table |
| `src/lib/affidavit-publish.ts` (new) | `renderField`, `publishAffidavitFields`, `fieldsFromExtraction` |
| `src/lib/affidavit-queue.ts` (new) | `enqueueAffidavit`, `claimNextAffidavit`, `completeExtraction`, `failExtraction`, `resolveWard`, admin actions |
| `jobs/extract-affidavits.ts` (new) | The worker loop |
| `scripts/upload-affidavits.ts` (new) | Directory upload |
| `src/pages/admin/affidavits.astro`, `src/features/pages/admin/Affidavits.astro` (new) | Admin page |
| `src/lib/transcribe.ts` (new) | Draw, load, submit, release, report |
| `src/layouts/TranscriberLayout.astro`, `src/pages/transcribe/{index,[id],guide}.astro`, `src/features/pages/transcribe/{Start,Reading,Guide}.astro`, `src/islands/TranscribeForm.ts` (new) | Screens |
| `src/middleware.ts`, `src/lib/csp.ts`, `src/lib/publish.ts`, `src/lib/curator.ts`, `src/lib/settings.ts`, `src/lib/login-flow.ts` (modify) | Guards, CSP, actor role, enqueue, setting, landing |
| `src/lib/extract.ts`, `tests/unit/extract.test.ts` (delete) | Old extractor |

Shared types, defined in `affidavit-publish.ts` and used everywhere after:

```ts
export const AFFIDAVIT_FIELD_KEYS = ['full_name', 'party', 'gender', 'age', 'education', 'assets', 'cases'] as const;
export type AffidavitFieldKey = (typeof AFFIDAVIT_FIELD_KEYS)[number];
export type FieldStatus = 'value' | 'not_declared' | 'unreadable';
export type FieldData =
  | { key: 'full_name' | 'party'; status: FieldStatus; text: string | null }
  | { key: 'gender'; status: FieldStatus; gender: 'male' | 'female' | 'other' | null }
  | { key: 'age'; status: FieldStatus; years: number | null }
  | { key: 'education'; status: FieldStatus; level: EducationLevel | null; stated: string | null }
  | { key: 'assets'; status: FieldStatus; movableInr: number | null; immovableInr: number | null }
  | { key: 'cases'; status: FieldStatus; pending: number | null; convictions: number | null };
export type PublishActor = { userId: number | null; role: 'system' | 'admin' | 'transcriber' };
export function renderField(data: FieldData): string | null;          // null unless status is 'value'
export function checkFieldData(data: FieldData): string | null;       // same rules as checkExtraction
export function fieldsFromExtraction(e: AffidavitExtraction): FieldData[];   // all seven, ward excluded
export function sameFieldData(a: FieldData, b: FieldData): boolean;
export async function publishAffidavitFields(tx: Tx, actor: PublishActor, candidateId: number,
  fields: FieldData[], opts: { sourceUrl: string; checked: boolean; aiExtraction?: AffidavitExtraction }): Promise<number[]>; // field ids needing translation
```

---

### Task 1: Identity in the extraction contract and the evaluation

**Files:** modify `src/lib/affidavit-extraction.ts`, `scripts/eval-extraction/grade.ts`, `scripts/eval-extraction/report.ts`, `tests/fixtures/affidavits/expected.json`, `tests/fixtures/affidavits/README.md`; tests `tests/unit/affidavit-extraction.test.ts`, `tests/unit/extraction-grade.test.ts`.

**Produces:** `AffidavitExtraction['identity']`:

```ts
identity: z.strictObject({
  name:   z.strictObject({ status, text: z.string().nullable() }),
  ward:   z.strictObject({ status, number: z.number().int().nullable(), name: z.string().nullable(),
                           corporation: z.enum(['north','south','east','west','central']).nullable() }),
  party:  z.strictObject({ status, text: z.string().nullable() }),
  gender: z.strictObject({ status, gender: z.enum(['male','female','other']).nullable() }),
})
```

- [ ] Tests first: a valid extraction with identity parses; `name.status = value` with null text is `invalid_output`; `ward.status = value` requires `number` only (`name` and `corporation` may be null); `ward.status = not_declared` with a number set is `invalid_output`; ward number below 1 is `invalid_output`; empty-string name or party with status `value` is `invalid_output`.
- [ ] Run, see them fail.
- [ ] Add the schema, extend `checkExtraction`, add the identity paragraph to `EXTRACTION_INSTRUCTION` (ward is the local-body ward; an Assembly or Parliamentary constituency is `not_declared`; party is `Independent` when none).
- [ ] Grade tests first: `normalizeName('B.A. Basavaraj') === normalizeName('ba basavaraj')`; name and party `correct` / `wrong` / `abstained` / `unscored`; gender exact.
- [ ] Extend `grade.ts` (`name`, `party`, `gender` scored values) and the by-field table in `report.ts`.
- [ ] `expected.json`: add `name` and `party` from each fixture's MyNeta page (`verifiedBy: myneta`); `gender` only where that page states it, else `null`.
- [ ] Run both unit test files; commit.

### Task 2: Migration 0012 and schema

**Files:** create `drizzle/0012_affidavit_queue.sql`; modify `drizzle/meta/_journal.json`, `src/db/schema.ts`, `tests/unit/schema.test.ts`.

```sql
CREATE TYPE "public"."affidavit_state" AS ENUM('queued','extracting','needs_matching','published','failed');--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "state" "affidavit_state" DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "extraction" jsonb;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "match_reason" text;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "sha256" text;--> statement-breakpoint
UPDATE "candidate_affidavits" a SET "sha256" = m."sha256", "state" = 'published' FROM "media" m WHERE m."id" = a."media_id";--> statement-breakpoint
-- Older rows may share a PDF; keep the hash unique by suffixing the later duplicates.
UPDATE "candidate_affidavits" a SET "sha256" = a."sha256" || ':' || a."id"
  WHERE EXISTS (SELECT 1 FROM "candidate_affidavits" b WHERE b."sha256" = a."sha256" AND b."id" < a."id");--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ALTER COLUMN "sha256" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_affidavits_sha256_uq" ON "candidate_affidavits" ("sha256");--> statement-breakpoint
CREATE INDEX "candidate_affidavits_state_idx" ON "candidate_affidavits" ("state");--> statement-breakpoint
ALTER TABLE "candidate_affidavits" DROP COLUMN "extraction_status";--> statement-breakpoint
DROP TYPE "public"."extraction_status";--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "value_data" jsonb;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "unreadable" boolean DEFAULT false NOT NULL;
```

- [ ] Write the migration, the journal entry (idx 12) and the matching Drizzle schema.
- [ ] Fix every compile error from the dropped `extractionStatus` (seeds, curator.ts, tests) by moving to `state`.
- [ ] Run `tests/unit/schema.test.ts` and `npm run typecheck`; commit.

### Task 3: `affidavit-publish.ts`

**Files:** create `src/lib/affidavit-publish.ts`, `tests/unit/affidavit-publish.test.ts`; modify `src/lib/publish.ts`.

- [ ] Tests first, pure: `renderField` gives `52`; `Graduate: B.Com`; `₹4,52,10,000 (movable ₹1,02,10,000; immovable ₹3,50,00,000)`; `2 pending, 0 convictions`; `Male`; null for `not_declared` and `unreadable`. `checkFieldData` rejects age 0, negative rupees, value-status with a null, non-value status with a value.
- [ ] Tests first, database: `publishAffidavitFields` as `system` writes `value_data`, text, `ai_extracted = true`, `source_type = 'official'`; `full_name` and `party` also update `candidates`; `unreadable` writes `unreadable = true`, null text; a later curator `publishCandidateField` on the same key sets `value_data` null and `unreadable` false (Review Focus 5).
- [ ] Implement. In `publish.ts`, add `'transcriber'` to `Actor['role']` and make `publishCandidateFieldTx` write `valueData: null, unreadable: false`.
- [ ] Run; commit.

### Task 4: Queue, ward resolution and the worker

**Files:** create `src/lib/affidavit-queue.ts`, `jobs/extract-affidavits.ts`, `tests/unit/affidavit-queue.test.ts`, `tests/unit/affidavit-worker.test.ts`.

```ts
export type EnqueueResult = { kind: 'queued'; id: number } | { kind: 'duplicate'; id: number }
  | { kind: 'rejected'; reason: 'unsupported_media_type' | 'media_too_large' };
export async function enqueueAffidavit(bytes: Buffer, opts: { uploadedBy: number; originUrl?: string | null; candidateId?: number | null }): Promise<EnqueueResult>;
export async function claimNextAffidavit(): Promise<{ id: number; mediaId: number; candidateId: number | null; attempts: number } | null>;
export async function resolveWard(ward: AffidavitExtraction['identity']['ward']): Promise<number | null>;
export async function completeExtraction(id: number, extraction: AffidavitExtraction): Promise<'published' | 'needs_matching'>;
export async function failExtraction(id: number, failure: ExtractionFailure, detail: string): Promise<'queued' | 'failed'>;
export async function processOne(extractor: (pdf: Buffer) => Promise<ExtractionOutcome>): Promise<boolean>; // false when queue empty
export const MAX_ATTEMPTS = 3;
```

Claim statement:

```sql
UPDATE candidate_affidavits SET state = 'extracting', attempts = attempts + 1,
       lease_expires_at = now() + interval '15 minutes'
 WHERE id = (SELECT id FROM candidate_affidavits
              WHERE state = 'queued' OR (state = 'extracting' AND lease_expires_at < now())
              ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, media_id, candidate_id, attempts
```

`resolveWard`: corporation index is the order of `corporationEnum` used by `scripts/seed-wards.ts`; with a corporation, `id = index × 1000 + number` if that ward exists; without one, the single ward whose number (`id % 1000`) matches and whose normalised English name equals the normalised extracted name; else null.

- [ ] Queue tests: PDF enqueues; same bytes again is `duplicate` with the same id; two concurrent enqueues of the same bytes give one row and no throw (Review Focus 4); a PNG and a 21 MB buffer are `rejected`.
- [ ] Worker tests with a fake extractor: ten concurrent `claimNextAffidavit` over ten rows return ten distinct ids, an eleventh returns null (Review Focus 1); a row `extracting` with a past lease is claimed again (Review Focus 2); `api_error` three times ends `failed` with nothing published; `refusal` once ends `failed`; resolved ward creates a candidate with slug `<wardId>-<name-slug>`, seven fields AI-labelled, state `published`; unresolved ward ends `needs_matching / ward_unresolved` with no candidate; same ward and normalised name as an existing candidate ends `needs_matching / possible_duplicate`; a row with `candidateId` preset publishes onto it without resolving; a slug collision gets a numeric suffix.
- [ ] Implement the library, then the worker: `EXTRACTION_CONCURRENCY` loops of `processOne`, 5 s sleep when empty, exit 1 without `ANTHROPIC_API_KEY`, stop claiming on `SIGTERM`.
- [ ] Run; commit.

### Task 5: Curator upload enqueues; delete the old extractor

**Files:** modify `src/lib/curator.ts`, `src/features/pages/curator/CandidateEdit.astro`, `src/pages/curator/candidate/[id].astro`, `tests/routes/curator-candidate-affidavit.test.ts`, `tests/unit/curator.test.ts`, seeds; delete `src/lib/extract.ts`, `tests/unit/extract.test.ts`.

- [ ] Update the route test: an upload leaves one `queued` affidavit with `candidate_id` set and the page says extraction is queued; a duplicate PDF is a validation message.
- [ ] `handleCandidateAffidavitPublish` calls `enqueueAffidavit(bytes, { uploadedBy, originUrl, candidateId })`; outcome becomes `{ kind: 'saved' }`; replace the "extraction failed" notice key with a "queued" one.
- [ ] Delete the old module and test; `grep -r "lib/extract'" src tests jobs scripts` is empty.
- [ ] Run curator tests and typecheck; commit.

### Task 6: `/admin/affidavits`

**Files:** create `src/pages/admin/affidavits.astro`, `src/features/pages/admin/Affidavits.astro`, `tests/routes/admin-affidavits.test.ts`; modify `src/lib/affidavit-queue.ts`, `src/features/pages/admin/Console.astro`, `src/i18n/en.json`, `src/i18n/kn.json`, `astro.config.mjs` or the route for the body limit.

```ts
export async function loadAffidavitAdmin(): Promise<{ counts: Record<AffidavitState, number>; needsMatching: MatchRow[]; failed: FailedRow[] }>;
export async function confirmMatch(actor: { userId: number }, id: number, input: { wardId: number; name: string; party: string; attachToCandidateId?: number }): Promise<{ candidateId: number }>;
export async function retryAffidavit(id: number): Promise<void>;     // failed -> queued, attempts 0
export async function discardAffidavit(id: number): Promise<void>;   // only when candidate_id is null
```

`confirmMatch` publishes name and party as checked (`ai_extracted = false`) and the remaining stored extraction as AI-labelled, and sets state `published`.

- [ ] Route tests: anonymous redirects to login; curator and transcriber get 403; POST without CSRF is 403; upload of two PDFs queues two and reports counts; GET lists a needs-matching row with the AI identity and a PDF link; `match` creates the candidate, publishes, and the row leaves the list; `match` with an unknown ward is a 400 message; `retry` requeues; `discard` removes row and media; `discard` on an attached affidavit is refused.
- [ ] Implement lib functions, route twin (form actions `upload`, `match`, `retry`, `discard`; `?notice=` after redirect), view (counts, upload form, the two lists, ward `<select>` with a datalist-free plain list of all wards as `number name (corporation)`), console link, i18n keys in both files.
- [ ] `npm run translate -- --check`; run route tests; commit.

### Task 7: Upload script, containers, docs

**Files:** create `scripts/upload-affidavits.ts`; modify `package.json`, `deploy/compose.local.yml`, `deploy/compose.production.yml`, `deploy/runbook.md`, `docs/architecture.md`, `docs/milestones.md`, `docs/project-dependencies.md`.

- [ ] Script: `tsx scripts/upload-affidavits.ts <dir> --as <admin-email>`; enqueues each `.pdf`; prints queued, duplicate, rejected counts; exits 1 if the admin email is unknown.
- [ ] `extract-worker` service in both compose files (`command: ['npx','tsx','jobs/extract-affidavits.ts']`, same image and env file as `app`, depends on healthy postgres); fix the local header comment.
- [ ] Runbook rows for `EXTRACTION_MODEL`, `EXTRACTION_CONCURRENCY`; worker start, stop, logs.
- [ ] Docs: PDFs in Postgres, GCS removed, dump-size cost stated.
- [ ] Commit.

### Task 8: Migration 0013 and schema

**Files:** create `drizzle/0013_transcription.sql`; modify journal, `src/db/schema.ts`, `src/lib/settings.ts`.

```sql
CREATE TYPE "public"."assignment_state" AS ENUM('open','submitted','abandoned');--> statement-breakpoint
CREATE TABLE "transcription_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "affidavit_id" integer NOT NULL REFERENCES "candidate_affidavits"("id") ON DELETE CASCADE,
  "transcriber_id" integer NOT NULL REFERENCES "users"("id"),
  "state" "assignment_state" DEFAULT 'open' NOT NULL,
  "drawn_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "closed_at" timestamp
);--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_open_affidavit_uq" ON "transcription_assignments" ("affidavit_id") WHERE state = 'open';--> statement-breakpoint
CREATE INDEX "transcription_transcriber_idx" ON "transcription_assignments" ("transcriber_id","state");--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "transcribed_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "match_note" text;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "checked_by" integer;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "confirmed_ai" boolean;
```

- [ ] Migration, journal, schema; add `low_confidence_threshold` to `SETTING_KEYS`; `publishAffidavitFields` writes `checked_by`, `checked_at`, `confirmed_ai` when `opts.checked`; `src/lib/erasure.ts` nulls `checked_by` and reassigns or deletes assignments for an erased user (check how it treats `flag_items.resolved_by` and follow it).
- [ ] Extend `affidavit-publish.test.ts`: checked publish by a transcriber sets the three columns and clears `ai_extracted`; `confirmed_ai` true for an unchanged value, false for a changed one; checked `unreadable` keeps `ai_extracted` and sets no `checked_by`.
- [ ] Run; commit.

### Task 9: `transcribe.ts`

**Files:** create `src/lib/transcribe.ts`, `tests/unit/transcribe.test.ts`.

```ts
export const ASSIGNMENT_MINUTES = 45;
export async function drawAssignment(transcriberId: number): Promise<number | null>;        // assignment id
export async function loadAssignment(transcriberId: number, assignmentId: number): Promise<AssignmentView | null>; // null unless open, unexpired, caller's
export async function submitAssignment(transcriberId: number, assignmentId: number, form: FormData): Promise<SubmitOutcome>;
export async function releaseAssignment(transcriberId: number, assignmentId: number): Promise<boolean>;
export async function reportWrongDocument(transcriberId: number, assignmentId: number, note: string): Promise<'reported' | 'note_required' | 'not_found'>;
export async function countSubmittedToday(transcriberId: number): Promise<number>;
export type SubmitOutcome = { kind: 'saved'; candidateId: number } | { kind: 'expired' }
  | { kind: 'invalid'; errors: Partial<Record<AffidavitFieldKey, string>>; values: FieldData[]; checked: AffidavitFieldKey[] };
```

Draw, one statement:

```sql
WITH expired AS (
  UPDATE transcription_assignments SET state = 'abandoned', closed_at = now()
   WHERE state = 'open' AND expires_at < now() RETURNING affidavit_id
), mine AS (
  SELECT id FROM transcription_assignments
   WHERE transcriber_id = $1 AND state = 'open' AND expires_at >= now() LIMIT 1
), pick AS (
  SELECT a.id FROM candidate_affidavits a
   WHERE a.state = 'published' AND a.transcribed_at IS NULL AND a.candidate_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM mine)
     AND NOT EXISTS (SELECT 1 FROM transcription_assignments t
                      WHERE t.affidavit_id = a.id AND t.state = 'open' AND t.expires_at >= now())
   ORDER BY CASE
       WHEN EXISTS (SELECT 1 FROM candidate_fields f WHERE f.candidate_id = a.candidate_id AND f.unreadable) THEN 1
       WHEN a.confidence < $2 THEN 2 ELSE 3 END, random()
   FOR UPDATE OF a SKIP LOCKED LIMIT 1
), ins AS (
  INSERT INTO transcription_assignments (affidavit_id, transcriber_id, expires_at)
  SELECT id, $1, now() + interval '45 minutes' FROM pick RETURNING id
)
SELECT id FROM mine UNION ALL SELECT id FROM ins
```

Because the `expired` CTE's effect is not visible to `pick` in the same statement, `pick` tests expiry by time (`t.expires_at >= now()`), and the partial unique index is defined on `state = 'open'`; the insert for an affidavit whose only open row is expired would violate it. So `drawAssignment` runs the expiry `UPDATE` and the draw as two statements in one transaction. The draw statement alone still picks and assigns atomically.

Form field names: `status.<key>`, `checked.<key>`, and `name`, `party`, `gender`, `age`, `educationLevel`, `educationStated`, `movableInr`, `immovableInr`, `pending`, `convictions`. Rupee and count inputs accept digits with optional commas and spaces.

- [ ] Draw tests: tier 1 before tier 2 before tier 3 (three affidavits, three draws by three users, assert order); twenty concurrent draws by twenty users over twenty affidavits give twenty distinct affidavits (Review Focus 1); a second draw by the same user returns the same id; an expired assignment is abandoned and its affidavit is drawn again, including by the same user (Review Focus 2); `transcribed_at` set, `needs_matching`, `failed` are never drawn; empty queue is null; the threshold comes from `app_settings`.
- [ ] Submit tests: ticked fields checked with `checked_by`; unticked untouched; `confirmed_ai` true and false; *Not declared*; *Cannot read*; nothing ticked is `invalid`; age `abc` is `invalid` and writes nothing; expired assignment is `expired` and writes nothing (Review Focus 3); another user's assignment is `expired`; `1,02,10,000` parses as 10210000; affidavit gets `transcribed_at`, assignment `submitted`.
- [ ] Release and report tests: release reopens the affidavit; report without a note is `note_required`; report sets `needs_matching`, `reported_by_transcriber`, `match_note`, and abandons.
- [ ] Implement; run; commit.

### Task 10: Middleware, layout, screens

**Files:** modify `src/middleware.ts`, `src/lib/csp.ts`, `src/lib/login-flow.ts` (or the login page) for the landing redirect, `tests/routes/middleware.test.ts`, `tests/unit/csp.test.ts`, i18n files; create `src/layouts/TranscriberLayout.astro`, the three route twins, the three feature components, `src/islands/TranscribeForm.ts`, `tests/routes/transcribe.test.ts`.

- [ ] Route tests: anonymous `/transcribe` redirects to `/login?next=%2Ftranscribe`; citizen and curator 403; transcriber and admin 200 with a Start button; POST `start` redirects to `/transcribe/<id>`; a second visit shows Resume; another transcriber's assignment id is 404; a non-numeric id is 404; POST without CSRF is 403; valid `save` redirects to `/transcribe?saved=1` and the candidate page then renders the checked label; invalid `save` is 400 with the typed value still in the input; `release` and `report` redirect; `/transcribe/guide` renders; CSP on `/transcribe/<id>` has `frame-src 'self'` and elsewhere does not; `/transcribe` responses carry `X-Robots-Tag: noindex` and `cache-control: no-store`.
- [ ] Middleware: `/transcribe` guard for `transcriber | admin`, add to `AUTH_FORM_PREFIXES` and `NOINDEX_PREFIXES`. Login: when `next` is `/` and the signed-in role is `transcriber`, land on `/transcribe`.
- [ ] `/media/...` must be frameable by the app's own pages: check its response headers and the CSP `frame-ancestors`, and allow `'self'` for `/media` only.
- [ ] Layout and screens per spec §5–§6: two columns (`grid-template-columns: minmax(0, 58fr) minmax(360px, 42fr)`), sticky full-height iframe, one `<fieldset>` per field, three-way radio, tick, AI note, already-checked marker; actions Save and continue, Release, and a `<details>` for Wrong ward or wrong document.
- [ ] Island: disables a group's inputs when status is not *Value*, recomputes the assets total, and shows the time left. Without JavaScript the form still submits.
- [ ] i18n in both files; `translate --check`; run route tests; commit.

### Task 11: Unresolved state on public pages

**Files:** modify `src/features/pages/Candidate.astro`, `src/features/pages/Compare.astro`, `src/components/CandidateProfileField.astro`, i18n; tests `tests/routes/candidate.test.ts`, `tests/routes/compare.test.ts`.

- [ ] Tests: a field with `unreadable = true` renders "Could not be read from the affidavit" in English and its Kannada string under `/kn`, and does not render "Not declared".
- [ ] Implement; run; commit.

### Task 12: Docs

- [ ] `docs/milestones.md` §10, `docs/architecture.md` §6–§7, `AGENTS.md` (Roles paragraph: transcriber routes now exist; test-database note unchanged), `deploy/runbook.md`.
- [ ] Commit.

### Task 13: Whole-suite gate

- [ ] `npm test`, `npm run typecheck`, `npm run translate -- --check` in the Compose image. Fix what fails. Commit.

### Task 14: Live verification, screenshots, deck

- [ ] Rebuild the local stack with the worker; migrations apply to `gba`.
- [ ] `agent-browser skills get core`, viewport 1440 × 900.
- [ ] Follow spec §10 steps 1–7, screenshot each step into the session scratchpad.
- [ ] Stop the agent-browser daemon afterwards (it drives Siva's real Chrome).
- [ ] Build the PowerPoint walkthrough from the screenshots; upload to Drive folder `1gepUUcdv57v6z3ffnUnGri1geikmZiKi`; report the link and anything that failed.
