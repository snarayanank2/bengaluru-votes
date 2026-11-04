# Candidate data operations

How roughly 4,000 GBA candidate affidavits across 369 wards become published, sourced report cards: who does each step, what the code does, and what it costs. Election dates are offsets from the announcement **N** in [election-timelines.md](election-timelines.md); whether the affidavits can be obtained at all is [ksec-data-risk.md](ksec-data-risk.md).

## 1. The pipeline

| Stage | Who | Where | Publishes? |
|---|---|---|---|
| 1. Bulk loading (§2) | Admin (Siva) | `/admin/affidavits`, `npm run upload:affidavits` | No |
| 2. AI extraction (§3) | `extract-worker` | `jobs/extract-affidavits.ts` | Yes, immediately, labelled AI-extracted, when the ward resolves |
| 3. Transcription (§4) | Paid Kannada-reading transcribers | `/transcribe` | Yes, immediately, labelled checked by a person |
| 4. Curation (§5) | Two curators on a rota | `/curator/queue`, `/curator/matching` | Yes, immediately |

- Stages overlap. **Nothing waits for the notification, the final candidate list or a complete set**: each affidavit moves on as soon as the one before it is done.
- Every published value links to the stored affidavit PDF (`/media/{id}/{hash}`), served from Postgres.
- A value is in one of two states: *AI-extracted* or *checked by a person*. There is no second reading, consensus or approval step; citizen flags (§5) are the correction net.
- Public report cards show seven affidavit fields (§3.2) plus the ward. Rejected and withdrawn candidates are §6.

**Timing envelope.** Three elapsed days of AI extraction (§3.6) followed by five working days of transcription (§4.4): about eight days after a complete usable set is ready. From a complete set at nominations close (N+12) that is around N+20; from the final list (N+15), around N+23, the assumed poll day, with no margin. Early partial loading brings this forward; late files push it back.

## 2. Bulk loading

**Owner:** the admin (Siva). **Start:** as soon as the first filed affidavits are online. Do not wait for final lists.

- **Upload form:** `/admin/affidavits` (admin only), one or more PDFs per request.
- **Bulk script:** `npm run upload:affidavits -- <directory> --as <admin email>` (`scripts/upload-affidavits.ts`). Uses `DATABASE_URL`; makes no API calls.
- Both call `enqueueAffidavit` (`src/lib/affidavit-queue.ts`): validates a PDF of at most 20 MB, stores it in Postgres (`media`), and inserts a `queued` row in `candidate_affidavits`. A PDF whose SHA-256 is already stored is reported as a duplicate and skipped, so reruns are safe.
- No manifest is needed: the AI reads who the affidavit is for (§3.4).
- The admin also owns the **Failed** list on `/admin/affidavits`: **Retry** (back to `queued`, attempts reset) or **Discard** (deletes the affidavit and its PDF; refused once a candidate is attached). Curators cannot upload, retry or discard.
- Late arrivals are loaded the same way, whenever they appear.

Loading time and any acquisition charges are not measured or budgeted.

## 3. AI extraction

### 3.1 The worker

| Item | Value |
|---|---|
| Process | `jobs/extract-affidavits.ts`, long-running; the `extract-worker` service in `deploy/compose.production.yml` (operations: `deploy/runbook.md`) |
| Extraction module | `src/lib/affidavit-extraction.ts` (pure, no database) |
| Model | `EXTRACTION_MODEL`, default `claude-opus-5-5`; one of Haiku 5.5, Sonnet 5.5, Opus 5.5 |
| Concurrency | `EXTRACTION_CONCURRENCY`, default 10 (1–50); `deploy/compose.local.yml` defaults to 3 |
| Input | The PDF itself, sent as a document block. No separate OCR step |
| Claim | Atomic `SKIP LOCKED` claim with a 15-minute lease; a dead worker's affidavit is reclaimed after the lease |
| Attempts | 3. `api_error`, `truncated` and `invalid_output` retry; `refusal` fails at once. Then `failed` (§2) |
| No `ANTHROPIC_API_KEY` | Exits non-zero; the queue is left untouched |

States (`affidavit_state`): `queued` → `extracting` → `published` | `needs_matching` | `failed`.

### 3.2 Extracted fields

Seven published fields (`AFFIDAVIT_FIELD_KEYS`, `src/lib/affidavit-publish.ts`), plus the ward, which is used for matching:

| Field | Value | Rule |
|---|---|---|
| `full_name` | Name in English letters, as declared | |
| `party` | Party in English, or `Independent` | |
| `gender` | `male`, `female` or `other` | |
| `age` | Whole years, as declared | |
| `education` | MyNeta level (Illiterate … Doctorate, Others) plus the qualification as stated | PUC/10+2 → 12th Pass; SSLC → 10th Pass |
| `assets` | **Movable** and **immovable** totals in whole rupees, each across candidate, spouse, dependents and HUF, gross of liabilities | The total is computed in code, never asked of the model. Use printed totals; the detailed table wins over the summary |
| `cases` | Pending cases and convictions, whole numbers | "Nil" is a value of 0. A convicted case counts only under convictions, even under appeal |
| ward (identity) | Ward number, ward name and corporation, when stated | An Assembly or Parliamentary constituency is not a ward → `not_declared` |
| `confidence` | One whole number 0–100 for the whole affidavit | Orders the transcription queue (§4.2). Not a measured probability |

All values and notes are in English, including from Kannada scans. The instruction treats the affidavit as data and ignores instructions inside it.

### 3.3 Statuses and failures

Every field has a status: `value`, `not_declared` or `unreadable`.

- **`not_declared`**: the affidavit leaves it blank. Published as "Not declared".
- **`unreadable`**: something is there but cannot be read. The model must not guess. Published as "Could not be read from the affidavit", and it puts the candidate in the first tier of the transcription queue (§4.2).
- **A failed extraction is never published as "not declared"** (or anything else). A failure publishes nothing; the affidavit retries, then waits under Failed.

### 3.4 Publication and matching

After a successful extraction (`completeExtraction`, `src/lib/affidavit-queue.ts`):

1. **Ward resolution.** With a number and a corporation, the ward is `corporation index × 1000 + number`. With a number and no corporation, it resolves only if exactly one ward with that number has the same English name.
2. **Auto-publish** when the ward resolves to exactly one ward, name and party were read, and the ward has no candidate of the same normalised name: the candidate is created (status `filed`) and all fields publish as AI-extracted, sourced to the PDF. Kannada translation starts after commit.
3. **Otherwise `needs_matching`**, publishing nothing, with a reason: `ward_unresolved` or `possible_duplicate` (never merged automatically). Matching is §5.2.

A wrong AI-read ward is public until a person reads that affidavit.

### 3.5 Measured results

One evaluation run (Opus 5.5, prompt v3) on the nine fixtures in `tests/fixtures/affidavits/` (Karnataka Assembly 2023 Form 26: four English, five Kannada):

| Measure | Result |
|---|---|
| Scored values | 45 (age, education level, assets total, pending cases, convictions × 9) |
| Correct / wrong / abstained / unscored | 41 / 2 / 1 / 1. Both wrong values are assets totals; the abstention is an education level |
| Assets within 1% | 6 of 8 |
| Failed attempts | 1, succeeded on retry |
| Mean time per successful call | ~19 s (Kannada 23 s, English 14 s) |
| Cost | $1.76 for 9 affidavits, about $0.20 each |

Limits: nine documents, one model, Assembly-format affidavits rather than the KSEC local-body format, identity fields not scored in this run, concurrency and rate limits not exercised.

**Scoring** (`scripts/eval-extraction/grade.ts`), against `tests/fixtures/affidavits/expected.json` (MyNeta values, or Siva's reading with a reason):

| Outcome | Rule |
|---|---|
| correct | Status `value` and equal to the expected value (assets: exact rupees; name and party after normalisation; gender exactly) |
| wrong | Status `value` and different, or `not_declared` where a value is expected |
| abstained | Status `unreadable` |
| unscored | No expected value |

`not_declared` for cases counts as an expected zero and is flagged. Assets also report within-1% as a secondary figure. Notes, the stated qualification and confidence are not scored. A failed call produces no scored values and is counted separately.

**Reproduce:** `npm run eval:extraction -- --pilot` (one affidavit per model, prints a cost projection), `-- --full --out <dir>`, `-- --regrade <dir>` (rescore without API calls); `--model <id>` restricts to one model. Makes paid calls and needs `ANTHROPIC_API_KEY`. Output goes to `eval-runs/` (gitignored): `results.jsonl`, `errors.jsonl`, `summary.md`, `disagreements.md`.

### 3.6 Planning allowance

The allowance is a provision, not a measurement. Keep it separate from §3.5.

| Item | Planning allowance | Measured equivalent (§3.5) |
|---|---|---|
| Elapsed time | **Three days (72 h)** for 4,000 affidavits, from the first usable records | — |
| Per affidavit | 2–5 min, plus 25% overhead for retries | ~19 s per call |
| 4,000 at 10 concurrent jobs | 17–42 h (`4,000 × minutes ÷ 10 ÷ 60 × 1.25`) | ~2 h before retries and rate limits |
| API cost | **₹35,000–₹70,000** reserve, before taxes | ~$800 for 4,000 before retries |

The three days assume continuous running and account rate limits that allow ten concurrent jobs. They exclude scan repair, outages and loading.

**Pilot before the real run:** 50–100 representative KSEC Kannada affidavits, including handwriting and poor scans, at the intended concurrency. Measure errors, abstentions, confidence behaviour, time, retries, tokens and cost, and set the low-confidence threshold (§4.2) from it.

## 4. Transcription

### 4.1 Screens

| Route | What |
|---|---|
| `/transcribe` | One Start control. **No list**, search, filters or ward selector |
| `/transcribe/{assignment-id}` | The scan beside a form pre-filled with the published values |
| `/transcribe/guide` | Onboarding: the rules a transcriber works to |

- Admitted roles: transcriber and admin; a curator gets 403. Every read and write also requires an open, unexpired assignment belonging to the caller, otherwise 404, for an admin too (`src/lib/transcribe.ts`).
- **Desktop only.** The scan and the form must be side by side; there is no phone layout.

### 4.2 Queue order

The draw (`drawAssignment`) is one atomic statement. The queue holds published affidavits with an extraction and a candidate that nobody has transcribed yet. Order:

1. **Missing data**: the candidate has any field marked unreadable.
2. **Low confidence**: affidavit confidence below `low_confidence_threshold` in `app_settings`, or no confidence. Unset or invalid → **70**, a placeholder until the pilot (§3.6) sets it.
3. **The rest.**

**Random within each tier.** City-wide; nobody chooses a ward, party or candidate. A transcriber holds at most one assignment.

### 4.3 The hold and the save

- An assignment is a **10-minute hold** (`ASSIGNMENT_MINUTES`). Once it expires the affidavit goes back to the queue, and a save after expiry writes nothing. The transcriber can also release it.
- For each field the transcriber confirms or corrects the value, or marks it *Not declared* or *Cannot read*. They must not guess.
- **One "I checked this against the affidavit" checkbox for the whole form**, required server-side (`confirmChecked`); without it nothing saves. All fields then validate and publish together.
- The save publishes at once and marks values *checked by a person*. A *Cannot read* value stays unresolved publicly and is not counted as checked.
- Each affidavit is read once (`transcribed_at`); it then leaves the queue.
- **The ward is read-only.** "Wrong ward or wrong document", with a required note, sends the affidavit to `needs_matching` (`reported_by_transcriber`); its published values stay on the candidate's page until it is matched again (§5.2).

**Known weakness:** values are pre-filled, so a confident wrong extraction is more likely to be confirmed than caught.

### 4.4 Budget and sizing

**Five working days** of transcription, in paid shifts that start once enough extracted work is queued.

| Assumption | Value |
|---|---|
| Affidavits | 4,000, all read by a person |
| Pace | 10 min per affidavit (unmeasured) |
| Shift | 8 h × 5 days = 40 paid hours; 33⅓ productive reading hours |
| Per transcriber | 200 affidavits; total workload ~667 person-hours |
| Fee | ₹3,500 per person for the five days |

| Staffing | Transcribers | Capacity | Fees |
|---|---:|---:|---:|
| Minimum at 10 min | 20 | 4,000 | ₹70,000 |
| **Provision** | **23** | **4,600** | **₹80,500** |
| Minimum at 15 min | 30 | 4,000 | ₹1,05,000 |

The worst-first order means a short-handed or slower team leaves the cleanest affidavits unread. Before hiring closes, confirm Kannada reading, a desktop or laptop, shift availability and a staff account for each person (created at `/admin/users`). Staff sign-in is being reworked to per-staff passwords in a separate change.

## 5. Curation

Curators are city-wide (no ward scoping). Their job is two lists, nothing else. Onboarding is `/curator/guide`.

### 5.1 Citizen flags

Citizens flag candidate fields anonymously (CAPTCHA, rate limits, duplicate suppression). Each flag lands in `/curator/queue`. The curator checks it against the affidavit, then either:

| Finding | Action |
|---|---|
| Flag is wrong or unsupported | **Dismiss** with a reason. Nothing publishes |
| Published value is wrong | **Fix** in the structured inputs beside the affidavit (a ward flag is fixed by moving the candidate), ticking `confirmPublish` ("I have checked this against the affidavit"). Publishes immediately |

The same inputs are on the candidate editor, `/curator/candidate/{id}`, for a wrong value a curator happens to find. Routinely checking unflagged values is not part of the role. A candidate with no stored affidavit has nothing to correct against.

### 5.2 Matching

`/curator/matching` lists affidavits waiting for a candidate or ward: `ward_unresolved`, `possible_duplicate` and `reported_by_transcriber`. The curator reads the affidavit, picks the ward, confirms name and party (for a possible duplicate: attach to the existing candidate or create a separate one) and ticks `confirmPublish`. Name and party publish as checked by a person; the other values keep the AI label. Admins can do the same on `/admin/affidavits`.

**Curators do not upload, retry or discard affidavits** (§2). They do not approve transcriber work or monitor transcribers.

### 5.3 Rota and sizing

**Coverage runs from the first published data through election day**, as an ongoing rota rather than a fixed stage.

| Measure | Estimate |
|---|---:|
| Candidates flagged | 5% of 4,000 = 200 |
| Handling | 10 min per flagged candidate ≈ 33⅓ h |
| **Provision** | **2 curators**, 20 productive hours each reserved |
| Fee | ₹5,000 each for the cycle, ₹10,000 total |

Matching volume is not in this estimate. It depends on how often the ward fails to resolve. Review incoming work against capacity daily; a 20-minute average doubles the casework.

## 6. Candidate status and reconciliation

`candidates.status` is `filed`, `contesting`, `rejected` or `withdrawn` (`candidate_status`). Every candidate the pipeline creates starts `filed`.

What reads it:

- The ward page and candidate page show a withdrawn or rejected notice; the row is never hidden.
- Comparison (`Compare.astro`) includes only `filed` and `contesting`.

**Known gap: nothing can set the status today.** `publishCandidateCore` (`src/lib/publish.ts`) updates it but is called only from tests. No admin or curator screen, route, job or script writes it (`scripts/seed-dev.ts` seeds demo data as `contesting`). Before the final contesting list at about N+15 there must be a way to mark rejections and withdrawals, and to reconcile the AI-created candidates against the official list.

## 7. Open questions

| # | Question | Why it matters |
|---|---|---|
| 1 | How are rejections, withdrawals and the official list reconciled (§6)? | No code path exists |
| 2 | What do the pilot (§3.6) and a real KSEC Kannada affidavit show for accuracy, pace and cost? | The threshold (70), the 2–5 min allowance and the 10-min reading pace are unmeasured |
| 3 | Is the ₹35,000–₹70,000 API reserve still right against the measured ~$0.20 per affidavit? | ~$800 for 4,000 sits at or above the reserve's top, depending on the exchange rate |
| 4 | How many affidavits will need matching? | It sets curator load beyond flags (§5.3) |
| 5 | Are the 23 transcribers and 2 curators contracted, and who is the named operations lead? | Lead time, not money, is the constraint |
