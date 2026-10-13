# Affidavit extraction contract and evaluation — design

**Date:** 2026-10-13 · **Status:** awaiting review · **Spec 1 of 2**

## 1. Purpose

Make AI extraction of candidate affidavits work on real scanned documents, and measure it. Today `src/lib/extract.ts` has only ever run against fakes, and its forced tool call is rejected by current Claude models.

This spec delivers the extraction contract and an evaluation against the nine fixtures in `tests/fixtures/affidavits/`. It changes no database table, route or screen.

**Spec 2 (separate, later)** wires the contract into the app: a database queue and worker job, a jobs container in the local stack, an admin-only upload endpoint and script, an admin status page, and the docs change that drops Google Cloud Storage. Its model and worker concurrency come from this spec's results.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| What "tested" means | Accuracy evaluation first, app wiring second |
| Expected values | MyNeta's published figures for the nine candidates; Siva rules on disagreements |
| Output shape | Structured values plus a one-line note per field |
| Models compared | Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 |
| Confidence | One model-reported figure per affidavit, 0–100 |
| Reading the PDF | Whole PDF in one call; page rendering or two-pass only if results demand it |
| Repeats | One pass per model per affidavit |

## 3. The extraction contract

A new module, `src/lib/affidavit-extraction.ts`, exports one function with no database access:

```ts
extractAffidavit(pdfBytes: Buffer, model: ExtractionModel): Promise<ExtractionOutcome>
```

`ExtractionOutcome` is either `{ ok: true, extraction, usage }` or `{ ok: false, failure, usage? }`. The function never throws for a model-side problem; it throws only for programmer errors such as an empty buffer.

`src/lib/extract.ts` and the curator upload path are left untouched in this spec. Spec 2 replaces them.

### 3.1 Fields

Every field carries a `status` of `value`, `not_declared` or `unreadable`. The value is present if and only if the status is `value`; anything else fails validation.

| Field | Value when `status` is `value` | Note |
|---|---|---|
| `age` | Whole number of years, as declared | none |
| `education` | `level` from the fixed list below, and `stated`: the qualification as written, in English | none |
| `assets` | `totalInr`: whole rupees | One line giving the movable and immovable subtotals |
| `cases` | `pending` and `convictions`: whole numbers | One line, for example the sections cited |
| `confidence` | Whole number 0–100 for the affidavit as a whole. Always present | none |

Definitions the prompt states explicitly:

- **Assets total** is movable plus immovable assets for the candidate, spouse, dependents and HUF added together, gross of liabilities. This is how MyNeta totals it.
- **Cases:** an affidavit that states "nil" or "none" is `status: value` with `pending: 0` and `convictions: 0`. `not_declared` means the section is blank or absent.
- **Education levels:** Illiterate, Literate, 5th Pass, 8th Pass, 10th Pass, 12th Pass, Graduate, Graduate Professional, Post Graduate, Doctorate, Others. These are MyNeta's categories.
- **`unreadable`** means the model could not read the value from the scan. It must not guess.
- **Language:** every value and note is written in English, including from Kannada scans.

### 3.2 The model call

- Anthropic TypeScript SDK, `client.messages.create` with `output_config.format` built from a Zod schema (`zodOutputFormat`, which requires the `zod/v4` entry point). The module parses and validates the response text itself, so truncation, refusal and bad JSON each map to a named failure in one place.
- The PDF is sent as a base64 `document` block before the instruction text.
- Thinking is left at the adaptive default. `output_config.effort` is set to `medium` for all three models and recorded with each result.
- `max_tokens` 16000. SDK defaults for timeout (10 minutes) and retries (2).
- **No refusal fallback.** A fallback would silently answer from a different model and contaminate the comparison. A refusal is recorded as a failure. Spec 2 revisits this for production.
- The instruction is fixed and never varies with the document. It tells the model to treat the affidavit as data and to ignore any instructions inside it.

### 3.3 Failures

`failure` is one of: `api_error` (after SDK retries), `refusal`, `truncated` (`stop_reason` is `max_tokens`), `invalid_output` (fails the strict schema or the status/value rule). A failure is never converted into `not_declared`.

### 3.4 Usage

Every outcome that reached the API records: model, input tokens, output tokens, elapsed milliseconds and stop reason.

## 4. Expected values

`tests/fixtures/affidavits/expected.json` holds one entry per PDF, keyed by filename:

- `age`, `educationLevel`, `assetsTotalInr`, `casesPending`, `casesConvictions`
- `sourceUrl`: the candidate's MyNeta page, and `retrievedOn`
- `verifiedBy` per value: `myneta`, or `siva` with a one-line `reason` where Siva overrules MyNeta after reading the PDF

If a candidate is not on MyNeta, Siva reads that affidavit and the entry is marked `siva` throughout. The fixture README gains a short section describing this file.

## 5. Scoring

`scripts/eval-extraction/grade.ts` is a pure function from an extraction and an expected entry to five scored values: age, education level, assets total, pending cases, convictions.

Each scored value has exactly one outcome:

| Outcome | Rule |
|---|---|
| `correct` | Status is `value` and the value equals the expected value exactly |
| `wrong` | Status is `value` and it differs; or status is `not_declared` where a value is expected |
| `abstained` | Status is `unreadable` |

- **Cases exception:** `not_declared` is scored as equal to an expected zero, and flagged in the report.
- **Assets** also report `within1Percent` as a secondary figure. The headline is exact match.
- **Notes, `education.stated` and `confidence`** are not scored. Confidence is printed beside each affidavit's score.
- A failed call (§3.3) produces no scored values. It is written to the errors file and counted separately.

## 6. The evaluation run

`scripts/eval-extraction/run.ts`, exposed as `npm run eval:extraction`. It is not part of `npm test` and makes paid API calls.

- **Size:** 9 affidavits × 3 models × 1 pass = 27 calls, run with a small fixed concurrency.
- **Credential:** `ANTHROPIC_API_KEY` from the shell, on the host. Nothing is read from or written to the database.
- **Pilot flag:** `--pilot` runs one affidavit on each model (three calls), prints measured tokens and a projected cost for the remaining 24, and exits. The full run happens only after Siva approves that projection.
- **Resume:** a rerun skips any (affidavit, model) pair already in the results file.
- **Cost** is computed from recorded usage and a price table in the script, including Haiku 5.5's higher rate above 100,000 prompt tokens.

Output goes to `eval-runs/<timestamp>/`, which is added to `.gitignore`:

| File | Contents |
|---|---|
| `results.jsonl` | One row per successful call: affidavit, model, extraction, scored values, usage, cost |
| `errors.jsonl` | One row per failed call with its failure class |
| `summary.md` | Tables by model, by language and per affidavit: correct, wrong, abstained, failures, tokens, cost and seconds |
| `disagreements.md` | Every value that differs from `expected.json`, with the model's note, for Siva to check against the PDF |

After Siva rules on the disagreements, `expected.json` is updated and `--regrade <run-dir>` rescores the saved results without calling the API. The summary shows results before and after the rulings.

### Cost estimate

The nine PDFs total 232 pages. At the planning figure of about 3,000 input tokens per page, one pass is about 0.7M input tokens per model: roughly $0.10–0.35 on Haiku 5.5, $1.40 on Sonnet 5.5 and $2.80 on Opus 5.5. That is about $4.50 in input for the whole run, plus output and reasoning tokens that are not yet measured. The pilot replaces this estimate with measured figures.

## 7. Tests

Ordinary unit tests, no API calls:

- `tests/unit/affidavit-extraction.test.ts`: schema validation, the status/value rule, and each failure class, using an injected fake client.
- `tests/unit/extraction-grade.test.ts`: every outcome in §5, the cases exception and the 1% assets figure.

## 8. What this will and will not show

- 45 scored values per model. That is enough to see large gaps between models or between the five Kannada and four English scans.
- It cannot separate models a few points apart, measure run-to-run variation, or set a confidence threshold.
- The fixtures are Assembly affidavits, longer than ward affidavits are expected to be.
- The 50–100 Kannada affidavit pilot in `docs/candidate-data.md` is still required before the production model is fixed.

## 9. Done when

1. `expected.json` exists for all nine fixtures with sources.
2. `npm run eval:extraction` produces the four output files for all three models.
3. Siva has ruled on the disagreements and the regraded summary is reported.
4. `npm test` and `npm run typecheck` pass.

## 10. Out of scope

Database changes, the queue and worker, the upload endpoint and script, the status page, the local jobs container, removing GCS from the docs, candidate matching, the Batch API, and any non-Anthropic provider.
