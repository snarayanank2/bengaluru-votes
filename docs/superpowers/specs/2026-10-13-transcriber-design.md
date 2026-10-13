# Transcriber functionality (M8) — design

**Date:** 2026-10-13 · **Status:** awaiting review · **Spec 3 of 3**

Depends on `2026-10-13-affidavit-pipeline-design.md` (Spec 2), which adds the affidavit queue, `value_data` and the published AI extraction this spec reads.

## 1. Purpose

A transcriber signs in, presses Start, is handed one affidavit they did not choose, compares the scan with the AI-extracted values, confirms or corrects them, and saves. The save publishes immediately and marks the checked fields "checked by a person". This is M8 in `docs/milestones.md` §10.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Readings per affidavit | One. No second reading, no approval. |
| Choice of work | None. One Start control; no list, search, filter or skip that reveals what is next. |
| Queue order | Missing data, then low confidence, then the rest; random within a tier |
| Device | **Desktop only.** Transcribing needs the scan and the form side by side. No mobile layout is built or tested. |
| Ward | Read-only for transcribers. A wrong ward goes back to the admin list. |
| Accuracy tracking | Not built (dropped 2026-10-13) |

## 3. Data model

One migration.

**`transcription_assignments`**

| Column | Notes |
|---|---|
| `id` | serial |
| `affidavit_id` | references `candidate_affidavits` |
| `transcriber_id` | references `users` |
| `state` | enum `open`, `submitted`, `abandoned` |
| `drawn_at`, `expires_at` | `expires_at` is `drawn_at` + 45 minutes |
| `closed_at` | set on submit or abandon |

A partial unique index on `affidavit_id` where `state = 'open'` allows at most one open assignment per affidavit. There is deliberately no unique index on (affidavit, transcriber): a transcriber may pick up an affidavit whose earlier assignment of theirs expired.

**`candidate_fields`** gains `checked_by` (user id, nullable), `checked_at` and `confirmed_ai` (boolean, nullable: true when the person kept the pre-filled value, false when they changed it). All three are written only by the transaction that publishes a checked value.

**`candidate_affidavits`** gains `transcribed_at`, set when an assignment for it is submitted, and `match_note` (text), the transcriber's note when they report a wrong ward or document (§6). An affidavit with `transcribed_at` set is never drawn again.

**`app_settings`** gains the known key `low_confidence_threshold`, default `70`. The figure is a placeholder until the Kannada pilot sets it.

## 4. The draw

`drawAssignment(transcriberId)` in `src/lib/transcribe.ts` is one SQL statement:

1. Expire: assignments that are `open` and past `expires_at` become `abandoned`.
2. If the caller already has an open assignment, return it. A transcriber holds one at a time.
3. Otherwise insert an assignment for the first affidavit, locked with `FOR UPDATE SKIP LOCKED`, that is `published`, has no `transcribed_at` and no open assignment, ordered by tier and then `random()`:
   - **Tier 1, missing data:** any of its candidate's affidavit fields is `unreadable`.
   - **Tier 2, low confidence:** `confidence` is below `low_confidence_threshold`.
   - **Tier 3:** everything else.

Steps 1 to 3 are a single statement with CTEs, so the order cannot differ between callers and two transcribers pressing Start together cannot be given the same affidavit. If nothing is available the function returns null.

Affidavits in `needs_matching`, `failed`, `queued` or `extracting` are not drawable: they have no candidate to publish to.

## 5. Routes and authorization

| Route | What it is |
|---|---|
| `/transcribe` | Start, or Resume when the caller has an open assignment. Shows how many affidavits the caller has submitted today. When the queue is empty, says so. |
| `/transcribe/{assignment-id}` | The reading screen |
| `/transcribe/guide` | The onboarding page: what to compare, what "not declared" and "cannot read" mean, never to guess, and what to do with a wrong document |

- `src/middleware.ts` admits `transcriber` and `admin` to `/transcribe` and adds it to the CSRF and noindex prefix lists. Curators get 403.
- The reading screen additionally requires that the assignment is `open`, unexpired and belongs to the caller. Anything else is 404, for an admin too, so an assignment id never reveals another person's work.
- After login a transcriber lands on `/transcribe`.
- No `/kn` twin. UI strings follow the signed-in user's saved language, as the curator screens do. Values are typed in English.
- A new `TranscriberLayout.astro`, in the pattern of `CuratorLayout.astro`.

## 6. The reading screen

Desktop only, minimum useful width 1024 px. Two columns:

- **Left, about 58%, sticky, full viewport height:** the affidavit PDF in the browser's own viewer (an `iframe` on the stored `/media/…` URL), with an "Open in a new tab" link above it. The CSP for this route allows `frame-src 'self'`.
- **Right, scrolling:** the form.

At the top of the form: the ward (read-only), the AI confidence for the affidavit, the time left on the assignment, and a link to the guide.

One group per field, in affidavit order: name, party, gender, age, education, assets, criminal cases. Each group has:

- **The inputs,** pre-filled from the AI extraction: text for name and party; a select for gender; a number for age; a select of the eleven education levels plus the qualification as stated; movable and immovable rupees with the total shown beside them, recomputed as the transcriber types; pending cases and convictions.
- **A three-way choice:** *Value*, *Not declared*, *Cannot read*. Choosing either of the last two disables the inputs.
- **The AI's note** for assets and cases, as read-only help text.
- **"I checked this against the affidavit"**, a checkbox, unticked by default.
- A marker when the field is already checked by a person.

Actions:

- **Save and continue.** At least one field must be ticked. Ticked fields are validated with the same rules as `checkExtraction`; an error re-renders the form with the transcriber's input kept and the field named.
- **Release this affidavit.** Abandons the assignment and returns to `/transcribe`.
- **Wrong ward or wrong document.** Requires a short note. Sets the affidavit to `needs_matching` with `match_reason = 'reported_by_transcriber'` and the note, and abandons the assignment. The candidate's published values stay as they are until the admin acts.

The pre-filled inputs are the known rubber-stamp risk recorded in `docs/milestones.md` §10. The per-field tick and `confirmed_ai` are what make it visible; nothing here closes it.

## 7. Save

`submitAssignment(actor, assignmentId, form)` runs one transaction:

1. Re-check that the assignment is open, unexpired and the caller's. An expired one saves nothing and returns to `/transcribe` with a message.
2. For each ticked field, publish through `publishAffidavitFields` with the transcriber as actor: `value_data`, the rendered `value_en`, `not_declared` or `unreadable`, `ai_extracted: false`, `checked_by`, `checked_at`, and `confirmed_ai` from comparing the submitted value with the stored AI extraction. Name and party also update the `candidates` row.
3. A ticked field marked *Cannot read* is published as `unreadable: true` and keeps `ai_extracted` as it was: a person looked, but no value was checked.
4. Unticked fields are not touched.
5. Set the assignment to `submitted` and the affidavit's `transcribed_at`.

After commit the response redirects to `/transcribe`, which offers the next affidavit. `publish.ts`'s `Actor` role gains `transcriber`, which clears `ai_extracted` exactly as a curator's publish does.

## 8. Public page

`VerificationLabel` already shows AI-extracted or checked. The only change is an "unresolved: could not be read from the affidavit" state on the candidate page and the comparison page for a field with `unreadable: true`, in English and Kannada.

## 9. Tests

- `tests/unit/transcribe.test.ts`: tier 1 is drawn before tier 2 and tier 2 before tier 3; twenty concurrent draws over twenty affidavits give twenty distinct affidavits; a second draw by the same person returns their open assignment; an expired assignment is abandoned and its affidavit is drawable again, including by the same person; a transcribed affidavit is never drawn; unmatched and failed affidavits are never drawn; an empty queue returns null.
- Submit: ticked fields become checked with `checked_by` set; unticked fields keep the AI label; `confirmed_ai` is true for an unchanged value and false for a changed one; *Not declared* and *Cannot read* publish as specified; an expired assignment saves nothing; invalid input saves nothing.
- `tests/routes/transcribe.test.ts`: anonymous is redirected to login; citizen and curator get 403; another transcriber's assignment is 404; a POST without a CSRF token is 403; Release and the wrong-document report.
- `tests/routes/middleware.test.ts` gains the `/transcribe` cases.

## 10. Live verification and the walkthrough deck

In the local stack, with real Opus 5.5 calls (about $0.60 for three affidavits):

1. Upload three fixtures through `/admin/affidavits`: `h-manjunath` (handwritten Kannada), `satish-reddy` (typed Kannada), `sitaramu` (English).
2. The worker extracts them. Assembly affidavits name no GBA ward, so all three reach the admin matching list.
3. As admin, match each to a ward, with the name suffixed "(TEST 2023 Assembly)" so no real politician appears as a plausible GBA candidate. This is local data only.
4. Add a transcriber account and sign in as that user with the local master password.
5. Press Start. Confirm that an affidavit with an unreadable field is handed out before the others.
6. On each: confirm some values, correct one, mark one *Cannot read*, save.
7. Open the public candidate page and confirm the labels changed.

All of this is driven with `agent-browser` at a desktop viewport (1440 × 900) only. A screenshot is taken at each step.

The screenshots go into a short PowerPoint deck that explains the sequence for the team: upload, extraction, admin matching, transcriber login, the reading screen, a confirmation, a correction, a "cannot read", the save, and the public page before and after. The deck is uploaded to the Google Drive folder Siva named (`1gepUUcdv57v6z3ffnUnGri1geikmZiKi`). Screenshots and deck are not committed to the repository.

## 11. Done when

1. `npm test` and `npm run typecheck` pass.
2. The live verification in §10 has been run and its outcome reported, including anything that failed.
3. The deck is in the Drive folder and its link is reported.
4. `docs/milestones.md` §10 and `docs/architecture.md` §6 match what was built (45-minute expiry, the `unreadable` state, desktop only).

## 12. Out of scope

A mobile layout, a second reading, transcriber accuracy views, blind entry, an in-page PDF renderer with zoom and page thumbnails, editing the ward, and Kannada-language value entry.
