# Affidavit extraction pipeline — design

**Date:** 2026-10-13 · **Status:** awaiting review · **Spec 2 of 3**

Spec 1 is `2026-10-13-affidavit-extraction-eval-design.md` (the extraction contract and its evaluation). Spec 3 is `2026-10-13-transcriber-design.md` and depends on the tables this spec adds.

## 1. Purpose

Wire `extractAffidavit` into the application so that an uploaded affidavit PDF becomes a published, AI-labelled candidate without a person in the path, and the exceptions wait on one admin page.

Done means: an admin uploads PDFs, a worker extracts them, candidates whose ward resolves appear on the public site with AI-extracted labels, and the rest sit on `/admin/affidavits` to be matched or retried.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Scope | All of the deferred wiring: queue, worker, jobs container, upload endpoint and script, admin status page, docs change dropping GCS |
| Tying a PDF to a candidate | The AI reads identity (name, ward, party, gender) from the affidavit. No manifest. |
| Publication | Auto-publish when the AI-read ward resolves to exactly one ward. Exceptions go to an admin list. |
| Storage | Affidavit PDFs stay in Postgres (`media`, `bytea`). Google Cloud Storage is dropped. |
| Model | Opus 5.5 by default, overridable by `EXTRACTION_MODEL` |
| Structured values | A `value_data` JSON column on `candidate_fields`; `value_en` stays as rendered text |

## 3. Extraction contract changes

`src/lib/affidavit-extraction.ts` gains an `identity` object. Each member has the same `status` of `value`, `not_declared` or `unreadable`, and the same rule: the value is present if and only if the status is `value`.

| Field | Value when `status` is `value` |
|---|---|
| `identity.name` | `text`: the candidate's full name in English letters, as declared |
| `identity.ward` | `number`: the ward number contested, a whole number; `name`: the ward name in English, nullable; `corporation`: one of `north`, `south`, `east`, `west`, `central`, nullable |
| `identity.party` | `text`: the party name in English, or `Independent` |
| `identity.gender` | one of `male`, `female`, `other` |

The instruction tells the model that the ward is the local-body ward the nomination is for, and that an Assembly or Parliamentary constituency is not a ward: for such a document `identity.ward` is `not_declared`.

`confidence` remains one figure for the whole affidavit and now covers identity too.

**Evaluation.** `tests/fixtures/affidavits/expected.json` gains `name`, `party` and `gender` per fixture, from the same MyNeta pages, with the existing `verifiedBy` convention. `grade.ts` scores them: name and party are compared after lower-casing and removing punctuation and spaces; gender exactly. Ward is unscored, because the fixtures are Assembly affidavits and have none. A value with no expected figure stays `unscored`.

## 4. Data model

One migration, forward-only.

### 4.1 `candidate_affidavits` becomes the queue

| Column | Change |
|---|---|
| `candidate_id` | Becomes nullable. Null until the affidavit is matched. |
| `state` | New enum `affidavit_state`: `queued`, `extracting`, `needs_matching`, `published`, `failed`. Default `queued`. |
| `attempts` | New integer, default 0 |
| `lease_expires_at` | New timestamp, null unless `state` is `extracting` |
| `confidence` | New integer 0–100, null until extracted |
| `extraction` | New `jsonb`: the validated `AffidavitExtraction` as returned, kept for the admin page and the transcriber pre-fill |
| `failure` | New text: the last failure class and detail |
| `match_reason` | New text, set when `state` is `needs_matching`: `ward_unresolved`, `possible_duplicate` or `reported_by_transcriber` |
| `sha256` | New text, unique. Copied from the stored media row. The uniqueness is what makes a re-upload a no-op. |
| `extraction_status` | Dropped, with its enum. `state` replaces it. |

Existing rows are migrated as `published` with `sha256` filled from `media`.

### 4.2 `candidate_fields`

| Column | Purpose |
|---|---|
| `value_data` | `jsonb`, nullable. The structured value behind `value_en`, in the shapes of §3 and Spec 1 §3.1. |
| `unreadable` | boolean, default false. True when nobody, AI or person, could read the value. The public page shows such a field as unresolved. |

`ai_extracted` already exists and stays the two-state check marker. The columns that record who checked a value are added by Spec 3.

A curator's free-text edit (the existing `/curator/candidate/{id}` editor and the flag queue) sets `value_data` to null and `unreadable` to false, because the text no longer came from the structured value.

### 4.3 Rendering

`src/lib/affidavit-publish.ts` owns two functions. `publishAffidavitFields(tx, actor, candidateId, fields, sourceUrl)` is the only writer of structured values: it writes `value_data`, the rendered text and the flags together, so the two can never disagree. `renderField(key, data)` turns a structured value into the English text stored in `value_en`:

| Key | Text |
|---|---|
| `age` | `52` |
| `education` | `Graduate: B.Com, Bangalore University` (level, then the qualification as stated) |
| `assets` | `₹4,52,10,000 (movable ₹1,02,10,000; immovable ₹3,50,00,000)` in Indian digit grouping |
| `cases` | `2 pending, 0 convictions` |
| `gender` | `Male`, `Female` or `Other` |

Name and party are written to `candidates.name_en` and `candidates.party_en`. A `candidate_fields` row is still written for `full_name`, `party`, `ward` and `gender`, because that row is where the public page reads the AI-extracted label from.

`not_declared` publishes as `not_declared: true` with a null value. `unreadable` publishes as `unreadable: true` with a null value and `ai_extracted: true`.

## 5. The worker

`jobs/extract-affidavits.ts` is a long-running process, not a cron entry.

- **Claim:** one statement, `UPDATE candidate_affidavits SET state = 'extracting', attempts = attempts + 1, lease_expires_at = now() + interval '15 minutes' WHERE id = (SELECT id … WHERE state = 'queued' OR (state = 'extracting' AND lease_expires_at < now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …`. Two workers never take the same row, and a crashed worker's row returns after its lease.
- **Concurrency:** `EXTRACTION_CONCURRENCY`, default 10. When the queue is empty the worker sleeps five seconds.
- **Attempts:** three. `api_error`, `truncated` and `invalid_output` return the row to `queued` until the third failure, then `failed`. `refusal` goes straight to `failed`. A failure is never converted into `not_declared`.
- **No key:** without `ANTHROPIC_API_KEY` the worker logs once and exits non-zero; rows stay `queued`.
- **Shutdown:** on `SIGTERM` it stops claiming and waits for in-flight calls.
- **Logging:** affidavit id, state, tokens and seconds. Never the candidate's name or values.

### 5.1 After a successful extraction

In one transaction:

1. Store `extraction` and `confidence`.
2. **Resolve the ward.** If `identity.ward` has a number and a corporation, look up `wards.id = corporation index × 1000 + number`. If it has a number and no corporation, take the ward only when exactly one ward has that number and its English name matches the extracted name after normalising. Otherwise the ward is unresolved.
3. If the ward is unresolved, or `identity.name` or `identity.party` is not a value: `state = 'needs_matching'`, `match_reason = 'ward_unresolved'`. Nothing is published.
4. If a candidate already exists in that ward with the same normalised name: `needs_matching`, `possible_duplicate`. Never merged automatically.
5. Otherwise create the candidate (slug from ward id and name, status `filed`), set `candidate_id`, publish every field through `publishAffidavitFields` as the `system` actor with `ai_extracted: true`, `source_type: 'official'` and the stored PDF as `source_url`, and set `state = 'published'`.

Translation to Kannada is started after commit, as every other publish does.

### 5.2 Containers

- `deploy/compose.production.yml`: a new `extract-worker` service on the app image, `command: ['tsx', 'jobs/extract-affidavits.ts']`, `restart: unless-stopped`, on `back_prod`.
- `deploy/compose.local.yml`: the same service, reading `ANTHROPIC_API_KEY` from `deploy/.env.local`. The header comment that says the local stack has no jobs container is corrected.

## 6. Upload

One function, `enqueueAffidavit(bytes, { originUrl, uploadedBy })` in `src/lib/affidavit-queue.ts`: validates the bytes as a PDF under the existing 20 MB cap, computes the SHA-256, returns `{ kind: 'duplicate', id }` if that hash is already queued, and otherwise stores the media row and inserts a `queued` affidavit.

Callers:

- **`POST /admin/affidavits`**: admin only, multipart, one or more PDFs per request. Responds with a redirect to the status page and a count of queued, duplicate and rejected files. Request body limit raised for this route only.
- **`scripts/upload-affidavits.ts <dir>`** (`npm run upload:affidavits`): enqueues every `.pdf` in a directory and prints the same counts. Uses `DATABASE_URL`; makes no API calls.
- **The curator candidate editor's affidavit upload** calls `enqueueAffidavit` and then sets `candidate_id`, so the worker skips ward resolution and publishes onto that candidate. `src/lib/extract.ts` and its tests are deleted.

## 7. The admin page

`/admin/affidavits`, admin only, no `/kn` twin, linked from the admin console.

- **Counts** by state.
- **Upload form** for §6.
- **Needs matching.** One row per affidavit: link to the PDF, the reason, and the AI-read name, party, gender and ward. The admin edits name and party if needed, picks the ward from a searchable list, and confirms. Confirm creates the candidate (or, for a possible duplicate, offers "attach to the existing candidate" beside "create a separate candidate") and publishes the stored extraction exactly as §5.1 step 5 does. Identity typed by the admin is published as checked by a person; the affidavit values keep the AI label.
- **Failed.** Failure class and detail, with **Retry** (back to `queued`, attempts reset) and **Discard** (deletes the affidavit and its media row; only offered when no candidate is attached).

## 8. Removed and changed docs

- `src/lib/extract.ts`, `tests/unit/extract*.test.ts`, the `extraction_status` enum.
- `docs/architecture.md` §2, §6, §7, §10, §13 and `docs/milestones.md` §11: affidavit PDFs are stored in Postgres; the GCS bucket, its credentials and its backup story are removed. The cost is stated in their place: roughly 4,000 PDFs of up to 20 MB each are carried by every nightly dump.
- `docs/project-dependencies.md` §6.19 (the bucket) is marked as no longer gating anything.
- `deploy/runbook.md`: `EXTRACTION_MODEL`, `EXTRACTION_CONCURRENCY`, and how to start, stop and read the worker.

## 9. Tests

No API calls; the worker takes an injected extractor.

- `affidavit-extraction.test.ts`: identity schema and the status/value rule for each identity field.
- `extraction-grade.test.ts`: name, party and gender scoring.
- `affidavit-queue.test.ts`: duplicate hash, non-PDF, oversize.
- `affidavit-worker.test.ts`: two concurrent claims take different rows; an expired lease is reclaimed; three failures reach `failed`; a refusal fails at once; ward resolved publishes; unresolved ward publishes nothing; possible duplicate publishes nothing; a failed extraction publishes nothing.
- `affidavit-publish.test.ts`: `renderField` for every key, `not_declared` and `unreadable`.
- `tests/routes/admin-affidavits.test.ts`: non-admin gets 403; upload; confirm a match; retry; discard.
- The existing curator editor tests are updated for the enqueue behaviour.

## 10. Known costs

- A wrong AI-read ward is public until a person reads that affidavit.
- Identity fields have only nine fixtures behind them, none with a ward.
- Affidavits in Postgres enlarge every dump.

## 11. Done when

1. `npm test` and `npm run typecheck` pass.
2. `npm run eval:extraction` on the fixtures reports name, party and gender scores for Opus 5.5.
3. In the local stack, three fixture PDFs uploaded through `/admin/affidavits` are extracted by the worker and reach `needs_matching`; an admin matches them and their candidate pages show AI-extracted values with a link to the PDF.

## 12. Out of scope

Transcriber screens and assignments (Spec 3), the Batch API, nomination-list import, automatic duplicate merging, non-Anthropic providers, and a mobile layout for `/admin/affidavits`.
