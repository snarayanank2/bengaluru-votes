# Todos

## Found during the flag → curator-fix walkthrough (production, 2026-11-04)

Walkthrough: anonymous flag on `Test Candidate 1001-1 (FICTIONAL)` (Age), curator reviewed it at `/curator/queue/5` and published 45 (was 41). The flow worked end to end. Issues noticed along the way, and what became of each:

- [x] **Flag button stretched across the page.** On the candidate page "Flag an error" is a flex item of a column container, so it stretched to full width with centred text. Now `align-self: flex-start` (`src/features/pages/Candidate.astro`). Checked at 1440 px and 390 px: 114 × 44 px, no horizontal overflow.
- [x] **Raw ISO timestamps in curator UI.** `/curator/queue` and the flag detail printed `2026-11-04T13:16:41.954Z`. Now "4 Nov 2026, 6:54 pm" in India time, in the page's language (`src/lib/format-datetime.ts`).
- [x] **Reject form copy contradicted the privacy model.** It said "Reason (shown to the submitter)". Reporters are anonymous and only get a confirmation, so it now reads "Reason (internal note; reporters are anonymous and are not told)", English and Kannada.
- [x] **No confirmation after Fix and publish / Reject.** The curator landed on an empty queue. The redirect now carries `?resolved=accepted|rejected` and the queue shows a banner; the accepted one says public pages can take a few minutes to show the fix (nginx micro-cache).
- [x] **Post-login landing.** A curator or admin signing in with nowhere particular to go landed on `/`. Now `/curator` and `/admin` (transcribers already went to `/transcribe`). A hostile `next` still collapses to the staff default, never off-site.
- [ ] **Production demo affidavit is a stub, not a PDF.** The candidate page's viewer shows "Failed to load PDF document" on production because the demo media row holds the early placeholder bytes (`LEGACY_FICTIONAL_PDF` in `scripts/seed-dev.ts`), which no browser can render. `seed:dev` refuses to run under `NODE_ENV=production`, so production never got the upgrade that local databases get. Not a code defect (real affidavits are real PDFs; a locally seeded database renders it). Needs a data fix on production if the demo candidates are meant to stay visible; ask before touching production data.
- [x] ~~Flag success toast is easy to miss.~~ Not a bug: the toast shows for 5 seconds (`src/islands/FlagModal.ts`); my screenshot was taken later.
