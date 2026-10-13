# Curator functionality (M7) — design

**Date:** 2026-10-13 · **Status:** awaiting review

Builds on `2026-10-13-affidavit-pipeline-design.md` (structured `value_data`, `publishAffidavitFields`) and `2026-10-13-transcriber-design.md` (the reading screen whose inputs this spec shares).

## 1. Purpose

A curator signs in, opens a citizen flag, sees it against the affidavit, and either fixes the published value or dismisses the flag with a reason. Either outcome reaches the submitter at `/account/submissions`. Outside the queue, a curator can find any candidate and correct a value they come across. This closes M7 in `docs/milestones.md` §9, following the flags-only role in `docs/candidate-data.md` §4.

Most of the curator area exists. This spec covers what is missing or stale:

- The queue item does not show the affidavit, and its fix is free text that discards `value_data`.
- The candidate editor edits five legacy free-text fields, two of which the public page no longer shows.
- The editor is reachable only by typing its URL.
- There is no onboarding page.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Fix form | **One structured field**: only the flagged field's inputs, beside the PDF |
| Ward flags | The curator reassigns the candidate to the right ward and the flag is resolved as accepted |
| `ec_affidavit` | **Not flaggable.** Removed from the public flag targets |
| Ward-field and ward-issue flags | **No longer accepted** at the API |
| Candidate editor | The same structured fields as the flag fix; the five legacy forms are removed |
| Finding candidates | Search on the dashboard **and** a candidate list on the ward page |
| Onboarding | A `/curator/guide` page |
| Mark a candidate complete | **Out of scope** for this round |
| Code sharing | Extract the transcriber's field inputs and form parsing and share them (not copy) |

## 3. Data model

**No migration.**

- `flag_target` keeps its `ward_field` and `ward_issue` enum values. Nothing creates them any more; rows that already exist still render and can be dismissed.
- `candidate_fields` rows with the legacy keys `track_record` and `approachability` stay in the table, unrendered and uneditable.
- `PublishActor.role` in `src/lib/affidavit-publish.ts` gains `'curator'`. A curator's publish behaves as a transcriber's does: `checked_by`, `checked_at`, `ai_extracted = false`, `source_type = 'official'`, source URL the stored affidavit.

## 4. Shared pieces

Extracted from the transcriber code, with no change in behaviour. `tests/routes/transcribe.test.ts` must pass unmodified; it is the guard on this refactor.

**`src/lib/affidavit-form.ts`** (new) takes these from `src/lib/transcribe.ts`, which re-imports them:

- `FIELD_INPUTS`, `inputsOf`, `fieldFromInputs`, `errorFor`, `FieldError`, `STATUSES`
- `readFieldForm(form, key)`: one field's status and inputs from a `FormData`. `readForm` in `transcribe.ts` is rebuilt on it.

**`src/components/AffidavitFieldInputs.astro`** (new): the status radios and the inputs for one field key, given the key, status, input values and an optional error. It keeps the `data-inputs` and `data-assets-part` hooks `src/islands/TranscribeForm.ts` relies on. `Reading.astro` renders it inside its existing fieldset, legend and "checked" tick.

**`src/components/AffidavitScan.astro`** (new): the PDF pane (open-in-new-tab link and iframe), from `Reading.astro`.

**`moveCandidateWard(tx, candidateId, wardId, sourceUrl)`** in `src/lib/affidavit-publish.ts` (new): sets `candidates.ward_id`, calls `publishWardLabel` with `aiExtracted: false`, and updates `flag_items.ward_id` for that candidate's pending flags so the queue lists them under the new ward. `confirmMatch` in `src/lib/affidavit-queue.ts` calls it in place of its inline update. The slug is not changed, as today, so the candidate's URL is stable.

**`latestAffidavitOf(candidateId)`** in `src/lib/curator.ts` (new): the candidate's most recent `published` affidavit as `{ pdfUrl, sourceUrl }`, or null.

## 5. Flag intake

- `src/lib/candidate-profile.ts` exports `FLAGGABLE_FIELD_KEYS`: the profile keys without `ec_affidavit` (eight).
- `Candidate.astro` builds its flag targets from that list.
- `/api/flags` accepts only `targetType: 'candidate_field'` and a `targetRef` whose field key is in the list. Anything else is a 400 `invalid flag target`. Today any key string passes.
- `src/lib/flags.ts`: `deriveTargetWardId` loses its ward-field and ward-issue branches; `FlagTargetType` stays as the DB enum type for reading old rows.

## 6. Flag item: `/curator/queue/{id}`

**Layout.** Two panes at desktop width: the affidavit on the left, staying in view; the flag on the right. Below the breakpoint the panes stack and the PDF is offered as a link, not an iframe. Curators answer flags through election day and may be on a phone, so unlike the transcriber screen this one has a mobile layout.

**Right pane, top to bottom:**

1. Candidate name, ward, the flagged field, status badge.
2. Each submission: the citizen's comment, suggested value and source link, as text.
3. The published value, with its provenance label.
4. The fix form (pending items only).
5. The dismiss form (pending items only): a required reason, unchanged.

**Fix form, by target.**

| Flagged field | Form | On save |
|---|---|---|
| One of the seven affidavit fields | `AffidavitFieldInputs` for that field, prefilled from `value_data`; empty when the row has none | `publishAffidavitFields` with `checked: true` |
| `ward` | A select of all wards, the current one chosen | `moveCandidateWard` |
| Anything else (old rows) | None; a line saying this flag can only be dismissed | — |

Both keep the required "publishes immediately to /ward/{id}" checkbox, checked again server-side.

**Refusals**, each a 400 that re-renders the form with what was typed:

- The field fails validation (same messages as the transcriber screen).
- The value is the same as the published one (`sameFieldData`), or the same ward: "Nothing changed. If the published value is right, dismiss the flag." Nothing is recorded as accepted without a change.
- The confirmation checkbox is missing.

**No affidavit.** When `latestAffidavitOf` is null (a candidate created by hand), there is no PDF pane and no fix form, only a line linking to the editor to add the affidavit. Dismiss still works. The affidavit is the source every value points to; there is no fix without one.

**Resolution.** `ResolveFlagResolution` in `src/lib/flags.ts` becomes:

```ts
| { accept: true; fix: { kind: 'field'; candidateId: number; data: FieldData; sourceUrl: string } }
| { accept: true; fix: { kind: 'ward'; candidateId: number; wardId: number; sourceUrl: string } }
| { accept: false; reason: string }
```

`resolveFlag` locks the flag row, applies the fix, and marks the item accepted in one transaction, as now. Fields needing translation are handed to `translateFieldSoon` after commit. A second curator resolving the same item gets the existing "already resolved" notice.

## 7. Candidate editor: `/curator/candidate/{id}`

**Layout.** The same two panes: affidavit left, forms right.

**Right pane:**

1. **Core card**: photo, status, Kannada name, Kannada party. English name and party are removed from this form. They are the `full_name` and `party` fields below, which already write `candidates.name_en` and `party_en`; keeping them in both places gives one value two writers.
2. **Eight field cards**: the seven affidavit fields, each `AffidavitFieldInputs` with its own Save, and the ward select. Each saves through the same code as the flag fix (`publishAffidavitFields` / `moveCandidateWard`), without touching any flag. An unchanged save is refused as in §6.
3. **Affidavit card**: upload or EC link, and the history list. Unchanged.

With no published affidavit the field cards are replaced by one line asking for the affidavit first.

`/curator/candidate/new` is unchanged: English name and party are entered there because no field rows exist yet.

**Removed:** `REPORT_CARD_FIELD_KEYS`, `handleCandidateFieldPublish`, the five field forms and their i18n keys. `publishCandidateField` and `publishCandidateFieldTx` in `src/lib/publish.ts` are deleted if nothing else calls them once the flag accept path has moved; `decideTranslationStatus` stays.

## 8. Finding candidates

**`/curator`** gains a search form (`GET ?q=`). `searchCurator(q)` in `src/lib/curator.ts` returns:

- candidates whose `name_en` or `name_kn` contains `q` (`ILIKE`), with party, ward and status, linking to the editor; capped at 50, with a "refine your search" line at the cap;
- wards whose English or Kannada name contains `q`, or whose id equals `q` when it is a number, linking to the ward page.

A query shorter than two characters returns nothing. A few thousand candidates and 369 wards need no index. The "edit coming soon" line is removed.

**`/curator/ward/{id}`** gains the ward's candidates (name, party, status), each linking to the editor, above the existing "add candidate" link.

**`CuratorLayout.astro`**: the bar gains Queue and Guide links.

## 9. Guide: `/curator/guide`

In the pattern of `/transcribe/guide`: an Astro page of i18n strings, English and Kannada, linked from the dashboard and the bar. Content, from `docs/candidate-data.md` §4:

- What a flag is and where it comes from.
- The steps: open the flag, find the value in the affidavit, fix or dismiss.
- The dismissal reason is shown to the citizen; write it for them.
- Never guess. Unreadable is an answer.
- A wrong ward is fixed by moving the candidate.
- What is not the job: re-reading unflagged affidavits, approving transcribers' work, ingestion problems.
- Who to contact for a wrong or missing document.

## 10. Authorization

Unchanged. `src/middleware.ts` admits `curator` and `admin` to `/curator/*` by role, with the existing CSRF, origin and `no-store` rules. The new GET search is under the same guard.

## 11. What this does not protect against

- **There is no history and no rollback.** A wrong fix or ward move overwrites the published value and is public within 60 seconds. The confirmation checkbox and the refusal of unchanged saves are the only brakes.
- A moved candidate keeps the old ward number in its slug.
- A curator can now move any candidate to any ward. Until now only an admin could.

## 12. Tests

- `tests/routes/transcribe.test.ts`: unmodified, passing.
- `tests/unit/affidavit-form.test.ts`: `readFieldForm`, `fieldFromInputs` and `errorFor` per field.
- `tests/routes/curator.test.ts`: structured fix writes `value_data`, `checked_by` and the affidavit source, and accepts the flag; unchanged value refused; invalid input refused with nothing written; ward flag moves the candidate and re-homes its other pending flags; no-affidavit item offers dismiss only; old ward-issue item is dismiss-only; dismiss unchanged.
- `tests/routes/curator-candidate.test.ts`: field cards save structured values; core card no longer changes the English name; no-affidavit state.
- `tests/routes/curator-ward.test.ts`: the candidate list.
- Search: by candidate name, ward name, ward number; short query; the cap.
- `tests/unit/flags.test.ts` and the API route: `ward_field`, `ward_issue` and `candidate:{id}:ec_affidavit` are 400.
- `tests/unit/affidavit-queue.test.ts`: `confirmMatch` still moves a sent-back candidate, through the shared helper.
- `tests/e2e/flag.spec.ts`: flag, structured fix, live value.
- Browser check of the queue item, editor, dashboard, ward page and guide at desktop and mobile widths, per `CLAUDE.md`.
