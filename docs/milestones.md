# Milestones — GBA Elections Citizen Platform

**Date:** 2026-08-15, updated 2026-08-19
**Status:** Living document
**Source of truth:** the **Milestones** tab of the Bengaluru Votes Project Tracker. This document is that list, read against the codebase, `docs/election-timelines.md` and the dependency register. Where the two disagree, the sheet wins and this document is stale.
**Scope:** The delivery plan, as the sheet's fifteen milestone rows — fourteen numbered milestones, of which M4 is carried as M4a and M4b (§6). What each one puts in front of a user, how you would test it, what it waits on, and how big it is.

**One exception, as of 2026-08-19:** M1's booth-lookup-by-EPIC is built and working (§3), and the sheet has not caught up — tracker 127 is still open and still describes it as a KSEC endpoint, which it is not. Here the sheet is behind the code, not ahead of it. §17 records what to change at the source.

This document replaces the nine-milestone plan of 2026-08-14, which itself replaced the P0–P5 phase structure. **Every milestone number in this document is new.** The old numbers are gone: the Tasks tab was re-mapped on 2026-08-15, the Milestones tab was corrected the same day, and the docs were re-pointed with them. §17 maps old to new and records what each change was.

**This document is self-contained.** Where it states a requirement, a route or a rule, it states it here rather than citing it, and it is the plan of record alongside `docs/architecture.md`.

**A milestone here means one thing:** a slice of user-facing change someone can open in a browser and check. Internal refactors, infrastructure and legal work do not get milestones of their own — they appear as prerequisites of the milestone they gate, which is the only place they matter.

**Milestones carry an order and a size, not dates.** The only real dates are the election's, and they are not ours to move.

---

## 1. The calendar we do not control

**Every date in this plan is an offset from N, the day the State Election Commission announces the schedule.** `docs/election-timelines.md` holds the assumptions and the reasoning; it is deliberately self-contained, so nothing here restates its numbers beyond the six anchors that milestones hang off:

| Anchor | Assumption | Confidence |
|---|---|---|
| Announcement | **N** | the anchor |
| Nominations close — **affidavits exist**, complete | **N+12** | medium |
| Withdrawal closes — **the final contesting list** | **N+15** | medium |
| Campaigning ends; silence | **N+21** | medium |
| **Poll** | **N+23** | medium |
| Results | **N+26** | medium |

Two consequences run through everything below:

- **Nothing about a candidate exists before N+5, and no affidavit before N+12.** M5, M7, M8 and M9 are therefore built against dummy data on purpose — that is not a shortcut, it is the only way they can exist before the announcement.
- **The working window on real candidate data is eight days**, from the final list at N+15 to the poll at N+23, and the last two of those are silence. §16 works out what that does to M11 and M13, and the answer is not comfortable.

**N is not known.** No nomination or poll date has been notified in any verifiable source as of 15 August 2026 (`docs/ksec-data-risk.md` §4). Tracking it is tracker 71, unassigned.

---

## 2. The fourteen, and why M4 is carried as two

| # | Milestone | Ships to | Effort | Waits on | Waits on (external) |
|---|---|---|---|---|---|
| **M1** | Ward Discovery for Anonymous Users | Every visitor | 5d | — | Ward issues data, candidate questions data, donation URL |
| **M2** | GTM Soft Launch Readiness | Partners, press | 5d | — | GTM lead unnamed; Citizen Matters / Open City edits |
| **M3** | GTM Soft Launch | The public | 3d | M1, M2 | **Announcement (N)** |
| **M4a** | Ability to send Email | — (infrastructure) | 2d | — | Twilio/SendGrid account |
| **M4b** | Ability to send WhatsApp | — (infrastructure) | 40d | — | Privacy policy, T&C, WhatsApp for Business, Twilio, Meta verification, template approval |
| **M5** | Candidate pages and comparisons ready | Every visitor | 3d | — | Nothing |
| **M6** | Admin functionality | Admins | 3d | M4a | — (SendGrid arrives via M4a) |
| **M7** | Curator functionality | Curators | 3d | M4a, M6 | Curator cohort |
| **M8** | Transcriber functionality | Transcribers | 3d | M4a, M6 | Transcriber cohort |
| **M9** | Bulk upload readiness | — (pipeline) | 3d | — | Anthropic / OpenRouter account; a Google Cloud Storage bucket (§11) |
| **M10** | Registered User Functionality | Citizens with accounts | 3d | M3, M4a | — |
| **M11** | Real Candidate data available | Every visitor | 2d | — | **Bulk affidavit download from KSEC** |
| **M12** | GTM Hard Launch Readiness | Partners, press | 5d | — | — |
| **M13** | GTM Hard Launch | The public | 7d | M11, M12 | ₹3L WhatsApp budget |
| **M14** | Final election results announced | Every visitor | not estimated | M13 | Declared results |

Efforts and blocking are as set on the sheet. Where this document proposes something the sheet does not say, it is marked *(proposed)*.

**Four things on the sheet changed on 2026-08-15**, and this table reflects them rather than reading around them: **M4 became M4a and M4b** (§6); **M11 no longer blocks on M10** (§13); **M6, M7, M8 and M10 now block on M4a** on the sheet itself, where before this document could only note the dependency as true-in-practice; and **M7 and M8 block on M6**, which they always did. Nothing in this section is a private reading any more.

### The four groups

**M1–M3 are the anonymous platform and its soft launch.** They need no accounts, no candidate data and no vendors. They are the part of the plan most nearly under our own control, and M3 is the first thing the public sees.

**M4 is the messaging spine, and this document splits it in two** (§6). **M4a — email — is two days, queues behind nothing, and gates the entire data operation**: staff sign in by email OTP, so no curator or transcriber can log in until it works. **M4b — WhatsApp — is the forty days**, almost all of it Meta verification and template review, and it gates only the campaign. Nothing blocks either, which means **both start today**, and M4a finishes long before M4b clears.

**M5–M9 are the candidate surfaces and the data operation, built entirely on dummy data.** Candidate pages (M5), admin (M6), curator (M7), transcriber (M8) and the affidavit pipeline (M9) can all be finished, tested and signed off before the announcement. Fifteen days of work, and the largest block of engineering in the plan that waits on no external queue.

**The one internal dependency inside that block is M4a**, and since 2026-08-15 the sheet says so: **M6, M7 and M8 block on M4a**, because staff sign in by email OTP and no operator can reach the platform until email sends. The code can be written first; the milestone cannot be called done. This is a dependency on **our own two days**, not on anybody's queue — which is exactly why it is worth spending first. Two days of M4a buys fifteen days of this block.

**M10–M14 are what the election itself unlocks.** Accounts, real candidate data, the hard launch and results. Every one of them is behind either N or KSEC.

### The kill switch

The sheet says it plainly, against M3:

> *If candidate affidavit data is NOT going to be available to bulk download, then the entire project stops here.*

**Take this seriously, because the answer is currently "no".** KSEC does not publish filled candidate affidavits online for any election, past or upcoming — no repository, no per-candidate PDFs, no equivalent of the ECI's affidavit portal or MyNeta (`docs/ksec-data-risk.md`). The recommended path is an RTI plus volunteers at returning-officer notice boards during the nomination window, which is not a bulk download; it is a collection operation across five corporations inside seven to ten days.

So the decision the sheet defers to M3 is not hypothetical and it is not months away. **It is answerable now, by asking** (tracker 121), and the acquisition options need starting before N, not after (`ksec-data-risk.md` §5: file the RTI before notification).

If the answer stays "no bulk download", the choice at M3 is between stopping and running the platform without affidavit-derived candidate data — ward discovery, voting logistics, issues and questions to ask candidates, which is most of M1 and all of M3. That reduced platform is worth something. It is a different product, and choosing it deliberately at M3 is much better than discovering it at N+12.

---

## 3. M1 — Ward Discovery for Anonymous Users

**Effort:** 5 days

An unregistered visitor arrives, finds their ward, finds their polling booth, and gets something worth reading — including on the pages where we have no candidate data yet.

**What ships**

- **Ward lookup by typed address and by device location.** Largely built (`src/pages/api/ward-lookup.ts`, `src/islands/WardLookup.ts`); this milestone is about the result being worth arriving at.
- **Polling booth lookup by EPIC number.** A change of approach: the citizen gives their voter ID and the booth comes back, rather than us holding an addressed booth list and resolving to it. **Built and working as of 2026-08-19** against `POST https://electoralapi.bbmpgov.in/searchby-epic`, which answers an EPIC with the voter's name, their polling station and its coordinates, their serial number on that station's roll, and a ward. Note what it is: **BBMP's electoral API, not KSEC's** — tracker 127 and the text this replaces both assumed KSEC, and the endpoint that exists is somebody else's. It serves all five GBA corporations.
- **Ward issues** — the plain-language issue list, reworked from Sahaaya / JAM output and Open City complaints (tracker 63).
- **Questions you should ask your candidates** — editorial content, from the Janaagraha material (tracker 10, 14).
- **A zero state that is an answer, not an apology** *(proposed, carried forward; tracker 89)*. Candidate pages have no data until N+12. The empty state has to say what is known, when candidates appear, and where to go meanwhile — a ward page with a blank candidate list reads as a broken site, and M3 puts real traffic on exactly these pages.
- **The donation page.** `/donate` and `/kn/donate`: what the platform costs to run, what a donation pays for, who Oorvani is, and a link out to Oorvani Foundation's existing donation flow (tracker 95). Linked from the footer, not the app bar — a donation ask competing with the ward finder for attention costs more trust than it raises. **No payment integration:** nothing is collected on our domain, so no payment vendor, no processor agreement, and no card data anywhere near this codebase. Embedded payments would be a separate milestone; the link-out is a day's work and this is why it fits inside M1.

**Testable when** a visitor with no account and no cookies can type an address, land on their ward, see ward facts and a boundary map, read the ward's issues and the questions to ask, enter an EPIC number and get their polling booth, reach Oorvani's donation flow in one click from the footer, and — on the candidates page — read a clear explanation of why it is empty and what happens next.

**Prerequisites**

| | |
|---|---|
| GCP, Maps, Places and Geocoding keys with billing | ✓ done — tracker 52, 87 |
| Google Analytics | ✓ done — tracker 87 |
| Ward boundaries and metadata | ✓ in repo, `data/gba.geojson`, 369 wards |
| **Ward issues data** | tracker 63, not started |
| **Questions to ask candidates** | tracker 10, 14, not started |
| ~~A working KSEC EPIC→booth lookup~~ — **met**, by BBMP's API rather than KSEC's | tracker 127 still reads *To Triage*; the sheet is behind the code as of 2026-08-19 |
| **The Oorvani donation URL, and the 80G / receipt wording** | tracker 94; *not listed on the sheet* |

**Risk — the EPIC path works, and is now a dependency on somebody else's server.** The question this risk used to ask ("does such an endpoint exist, and can it be called from a server?") is answered: yes, and yes. What replaces it is narrower but does not go away.

- **No contract, no SLA, no announcement channel.** It is an undocumented public endpoint on a government host. It can change shape, rate-limit us, or disappear without notice, and we would learn about it from our own error rate. The lookup degrades to an explicit "try again shortly" plus the official EC finder, so the failure is honest — but on poll morning it is still a failure.
- **It is BBMP's, for a GBA election.** The five corporations and all 369 post-delimitation wards are in it today. Whether it stays maintained, and stays current with the final roll, through a transition that abolishes the body whose name is on it, is not something we control or can verify from outside.
- **The roll behind it may lag.** A recent registration or address change that has not propagated reads as "not found". The copy is written to never assert that a citizen is unregistered — see the `findBooth.result.notFound` hint — but the citizen still leaves without their booth.
- **Its TLS chain is incomplete** (it omits its own intermediate), which no browser or `curl` reveals and which stops Node reaching it entirely. Handled in `src/lib/electoral-transport.ts`; recorded here because it is the kind of upstream sloppiness that suggests the service is not closely tended.

What has NOT changed: if that endpoint goes away, the fallback is an addressed polling-station list, whose publication date no precedent tells us (`election-timelines.md` Q3) and which — since the address-based booth rows were deleted on 2026-08-15 — **nothing on the Tasks tab tracks at all.** `project-dependencies.md` §4.7 is the only place it still exists.

**What the data turned out to be, since it bears on more than booth lookup.** Their ward set and ours are the same 369 wards: every (corporation, ward number) pair matches. Only the names differ, in 12 cases — eleven spelling variants, plus East 49, which they call *Doddakannelli Ward* and `data/gba.geojson` calls *Shivanasamudra Ward*. **Their corporation ids are not ours**: they number East 4 / South 3, the GeoJSON numbers East 3 / South 4, and `wards.id` is built from the GeoJSON's. Anything else that ever consumes this API must map by corporation NAME; mapping by id silently relocates 122 wards' voters to the wrong corporation with no error to notice.

**Risk — ward lookup has no fallback.** Google geocoding is the only path from a typed address to a ward, so an exhausted budget or a Google outage takes the headline feature down. The device-location path survives, and only for a visitor with JS who grants permission (`docs/architecture.md` §11).

**M1 is five separate deliverables at the same five days it carried when it was one.** Two are now done: ward lookup, and — as of 2026-08-19 — booth lookup by EPIC, which was the part most likely to fail outright. **The three that remain are the three that wait on content nobody has started**: ward issues (tracker 63), the questions to ask candidates (tracker 10, 14), and the donation page's URL and 80G wording (tracker 94). None of them is hard to build; all of them are blocked on somebody writing or obtaining something. That inverts the earlier reading of this milestone — the engineering risk has largely gone, and what is left is entirely acquisition. Track the five parts separately, and note that no amount of engineering time moves the remaining three.

---

## 4. M2 — GTM Soft Launch Readiness

**Effort:** 5 days

Everything the soft launch needs to exist before it can be fired. Almost none of it is code.

**What ships**

- **The front door for RWAs, colleges and civic organisations who want to help** — `/partner-with-us` and its expression-of-interest form: anonymous, no account required, CAPTCHA-protected, triaged at `/admin/partners`. Plus the unlisted partner kit page `/partner/{partner-slug}`, holding the forwardable copy blocks a partner actually uses.
- **Cross-links from Citizen Matters and Open City**, agreed and implemented on their side (tracker 76 plans it, 104 builds it).
- **Campaign content ready to go** on "know your ward" and "voting guidelines" — LinkedIn, Twitter and Instagram, written and scheduled but not fired (tracker 102).
- *(proposed)* the press kit the release points at, and named spokespeople (tracker 62, 80, 101, 103). `Press.astro` renders honest "coming soon" placeholders today; journalists arrive at N, and a kit assembled at N is assembled too late.

**Testable when** an RWA secretary who has never heard of the platform can find the partner page, understand what partnering means, submit the form without an account, and have it appear for triage — and when every campaign asset for the soft launch exists in final form, approved, with a scheduled date sitting behind the announcement.

**Prerequisites**

| | |
|---|---|
| **GTM lead identified** | tracker 57, unfilled |
| **Citizen Matters / Open City agreeing to carry the links** | tracker 76 |
| Partner kit assets — bilingual forward text, poster, neutrality statement | tracker 97 |
| reCAPTCHA v3 keys | tracker 98; `project-dependencies.md` §6.13 |
| Janaagraha cross-link agreement, incl. removing candidate details from Bengaluru Wards | tracker 66, 67 |

**Risk.** The page is the easy half. Partner recruitment has the longest lead time of any non-vendor workstream and no owner (tracker 57). Shipping the page does not start the cascade; naming the lead does.

---

## 5. M3 — GTM Soft Launch

**Effort:** 3 days

The public moment. LinkedIn, Twitter and Instagram campaigns around knowing your ward and the voting guidelines.

**What ships**

- The campaigns fire. The cross-links go live. One-to-one outreach to the people who carry it further.
- Nothing new is built. M3 is the execution of what M2 prepared.

**Testable when** a Bengaluru citizen who has not been told about the platform encounters it through a channel we do not own, and arrives on a ward page that works.

**Prerequisites**

| | |
|---|---|
| **M1 and M2 complete** | the sheet's blocking column |
| **The announcement, N** | tracker 71, unassigned |
| `/privacy` and `/terms` published *(proposed as a hard gate)* | tracker 16, 81, 34 |

**Why the announcement gates it.** A civic election platform launching before the election is announced has no news hook and no reason for a citizen to act. N is when "find your ward" becomes urgent rather than interesting. The cost is that **M3 cannot be pulled forward however well M1 and M2 go**, and every milestone downstream of M3 — M10, M11, M13, M14 — inherits that wait.

**Google Analytics is already live on the site** (tracker 87), so launching without a published privacy policy is not a paperwork gap, it is a live obligation. The legal chain — retention decision → counsel engaged → `/privacy` drafted → published — is unowned at its head (tracker 34, in progress) and also gates all of M4. It is the longest non-vendor pole in the project and it is not made of code. The sheet does not list it against M3; treat that as an omission rather than a decision.

**This is the decision point for the kill switch in §2.** By N, the answer on bulk affidavit availability should be known. If it is not, M3 fires into a plan whose second half may not exist.

---

## 6. M4a and M4b — Ability to send Email and WhatsApp, split in two

The sheet carried this as one milestone, M4, at 40 days until 2026-08-15. **It is two pieces of work with almost nothing in common except a vendor bill**, and they are separate because one of them blocks the entire data operation while the other blocks only the campaign:

| | Ships | Gates | Effort |
|---|---|---|---|
| **M4a** | Email sending | **staff login** (M6, M7, M8) and citizen email OTP (M10) | 2d |
| **M4b** | WhatsApp sending | the WhatsApp half of the sends and citizen WhatsApp OTP | 40d, as on the sheet |

They run concurrently and the wall clock is still M4b's forty days, so **the two efforts do not add** — §16 counts M4a's two days as work and M4b's forty as queue.

**The split is real but not clean.** SendGrid sits under the Twilio account (tracker 19: "email and WhatsApp are one vendor and one bill"), so the Twilio account and India billing gate both halves. That is days of paperwork, not the forty — **Meta business verification, the committed sender number and sixteen templates in an approval queue all sit entirely in M4b.** If the shared Twilio account ever looks like it is holding M4a up, a standalone SendGrid account is the escape hatch.

### 6.1 M4a — Email sending

**Effort:** 2 days

The platform can send email: one-time codes today, campaign sends when there is a list to send to.

**What ships**

- **Email OTP delivery**, the thing every role signs in with (§8). Staff are email-only, so this is not a convenience — **no curator or transcriber gets into the platform until it works.**
- SendGrid domain authentication — SPF, DKIM and DMARC on the sending domain — and a sender warm-up plan (tracker 51).
- The email side of the comms engine: the ward-scoped sends in `docs/messages.md`, bilingual.

**Testable when** an invited curator receives a code at their own address, signs in with it, and stays signed in for a working day — and a test send reaches an inbox rather than a spam folder, from an authenticated domain.

**Prerequisites**

| | |
|---|---|
| Twilio account + India billing, with SendGrid under it | tracker 19 — shared with M4b |
| SendGrid domain authentication | tracker 51 |

**Nothing here queues behind a third party.** No Meta review, no template approval, no committed phone number. It is DNS records and an account, and it is the cheapest thing in this document that unblocks the most: **M6, M7 and M8 can all be written without it, and none of them can be proved with a real person until it is done.** Do it first.

**Warm-up is for the campaign, not for login.** Staff OTP is a handful of transactional messages a day, which no reputation system objects to. The warm-up ramp matters when 25,000 recipients get a send — that is M4b's calendar, and it can proceed on its own timeline.

### 6.2 M4b — WhatsApp sending

**Effort:** 40 days

Scripts that can send WhatsApp messages to citizens, from an approved sender against approved templates.

**What ships**

- A registered WhatsApp sender and sixteen approved templates — 7 sends plus the citizen OTP, in English and Kannada (tracker 47, 48).
- The WhatsApp side of the comms engine. **There is no per-ward readiness gate**: the ward sign-off and completeness gate were dropped on 2026-08-15, so candidate sends go out on the campaign calendar to every ward at once. That puts the weight on *when* the candidate sends are scheduled — they have to sit late enough that the transcription queue has drained, because nothing else will hold them back. `scripts/` has no send job at all today (tracker 120).

**Testable when** a script sends a bilingual message to a test list over WhatsApp, from an approved template, and it arrives on a phone.

**Prerequisites**

| | |
|---|---|
| **Privacy policy and T&C published** | tracker 16, 81 — gates Meta verification |
| **Meta business verification** | tracker 45; 1+ month, called the longest pole in the 6-Aug review |
| A clean `+91` WhatsApp number, irreversibly committed | tracker 46 |
| Twilio account + India billing | tracker 19 — shared with M4a |
| **16 templates approved by Meta** | tracker 48; weeks in a queue |
| Native-speaker and legal review of the Kannada templates before submission | tracker 119 |
| Named grievance officer; Oorvani entity details | tracker 36, 38 |

**The 40 days are elapsed time, not effort.** Verification queues, DNS propagation and template review are the bulk of it. Two things follow. **It must start now** — nothing blocks it, and every day it is not started is a day added to the end. And **it cannot be compressed by adding people**; the only lever is starting the legal chain that unblocks Meta verification.

**M4b is the abandonable half, and the split is what makes abandoning it survivable.** The sheet's own note: if WhatsApp cannot be done in time, **drop M10 and drop the WhatsApp messages from M12 and M13**. *(The note read "M11, M12" until 2026-08-15; M11 is real candidate data and carries no sends, so the numbers were off by one against the milestones that actually hold the WhatsApp campaigns. Corrected on the sheet.)* With M4a separated out, dropping M4b costs the WhatsApp channel and the citizen WhatsApp OTP — and costs the data operation nothing at all, because staff sign in by email. What it costs the campaign is §16.

---

## 7. M5 — Candidate pages and comparisons ready

**Effort:** 3 days · **dummy data only**

An unregistered visitor can read a candidate's page and compare candidates side by side, months before a real candidate exists.

**What ships**

- Candidate report card and comparison, on demo data. The compared fields, as set on the sheet: **full name, ward, party, gender, age, educational qualifications, total value of assets, criminal cases, EC affidavit** — nine. Only four of them — age, education, assets, criminal cases — come out of the affidavit; the rest arrive already structured on the nomination list (`docs/overview.md` §3.1), and that split is what sizes the transcription operation.
- **Every field value carries a provenance label** — an AI icon or a green tick. **Two states, not a ladder:** *AI-extracted* on publish, *checked by a person* once a transcriber or curator has touched it (§10.1). No `verified` / `disputed` / `curator-confirmed` tiers.

**Testable when** a visitor can open two demo candidates from the same ward, compare all nine fields side by side, see which values are AI-extracted and which have been checked by a person, and open the affidavit behind any of them.

**Prerequisites** — none. Nothing external, no other milestone.

**Note.** Demo data must stay unmistakably fake (`scripts/seed-dev.ts` — "Demo Party A", "(FICTIONAL)"). A milestone whose entire deliverable is candidate pages full of dummy data is exactly where a plausible-looking fake candidate would get introduced. Don't.

**"Constituency" is the ward, and the sheet now says so.** For a corporator election the constituency *is* the GBA ward, so carrying both would have put the same value on a report card twice under two names. The sheet's M5 row was corrected to "Ward" on 2026-08-15; `docs/overview.md` §3.1 already read that way. **Gender stays in** — it is on the nomination list, costs no transcriber time, and needs no schema change: `candidate_fields.field_key` is free text (`src/db/schema.ts`), so the nine fields are a content decision, not a migration.

---

## 8. M6 — Admin functionality

**Effort:** 3 days

Admins can add and block operators without a shell on the box.

**What ships**

- `/admin/users` — list, search, **add a user with a role** (transcriber, curator, admin), block and unblock. `/admin/users` today has ban, reactivate and erase only (tracker 105). Role assignment at `/admin/roles`; there is no ward scope to set on anyone (§9).
- **A 24-hour staff session.** Operators sign in by email OTP from `/login`, like any citizen, and stay signed in for a working day. Citizens keep the short idle timeout; staff do not re-authenticate mid-shift.
- Blocking ends live sessions, not just future logins (tracker 107 — verify current behaviour first). With 24-hour sessions this matters more, not less: a revoked account must lose access on its next request, not at the end of the day.
- **"Generate a sign-in link" is dropped.** It existed to decouple staff access from messaging vendors; email OTP does that job well enough (see below). Its tracker row (106) was deleted on 2026-08-15.
- Analytics functionality for admins: **TBD on the sheet**, and unscoped here.
- `npm run seed:admin` stays the bootstrap. It remains the only path to the first admin.

**Testable when** an admin can invite a transcriber and a curator, watch each sign in by email OTP, confirm a staff session survives a working day and a citizen's does not, then block one and watch that person lose access on their next request.

**Prerequisites**

| | |
|---|---|
| An admin exists on the target environment | `seed:admin` |
| **M4a — email sending** | the sheet's blocking column; §6.1, tracker 51 |

**One thing gates this milestone, and it is our own work: M4a, email sending** (§6.1) — on the sheet's blocking column since 2026-08-15, where before it was true in practice but unrecorded. Staff sign in by email OTP, so no operator gets into the platform until email works. That is a change from the earlier design, which used issued sign-in links to remove the dependency entirely; email was judged good enough and the links are dropped (§17).

**It is email only, and email is not the forty days.** Meta business verification, the committed WhatsApp sender number and the template queue are M4b, and **none of them touch staff login**. M4a is an account and some DNS records — two days with nothing queued in front of it. That is why the split in §6 matters here more than anywhere else in the plan: **until M4a is done the entire data operation is blocked**, because curators and transcribers cannot log in, so M7 and M8 cannot be tested with a real person however finished the code is.

---

## 9. M7 — Curator functionality

**Effort:** 3 days · **dummy data only**

Curators work the citizen flag queue and correct anything wrong, on demo data, before a real affidavit exists.

**What ships**

- **The citizen flag queue**, city-wide: the flagged field, the citizen's comment, the affidavit page, the published value. The curator makes the fix or rejects the flag with a reason, and either outcome reaches the submitter at `/account/submissions`. Resolution publishes immediately (tracker 112).
- **Edit any candidate field**, flagged or not. With one reading per affidavit and no consensus step, this is the main net under the data — a curator does not need a flag as an excuse to fix something wrong.
- **A transcriber performance view** at `/curator/transcribers` — accuracy against subsequently-corrected values, volume, median time per affidavit (tracker 113). Visible to curators and admins, never to other transcribers: a published ranking optimises for speed, which is the opposite of what is wanted.
- **Mark a candidate complete** — a coverage signal feeding the `/data` figures. It gates nothing; there is no ward readiness check (§6).
- **A curator onboarding page.**

**Testable when** a curator can log in, open a seeded flag, see it against the affidavit page, fix it or reject it with a reason, watch the outcome appear on the submitter's page, edit an unrelated field, mark the candidate complete — and read the onboarding page and know what standard they are working to.

**Prerequisites**

| | |
|---|---|
| M6 for the account, and M4a for the OTP that signs into it | §8, §6.1 |
| CurOps owner named | tracker 57 |
| Four curators enrolled, Kannada-reading | tracker 58 |
| Curator onboarding material | tracker 60 |

**Curators are city-wide, and that is a change.** The model until 2026-08-15 scoped each curator to assigned wards or a zone. At a team of four against 369 wards, per-ward assignment is a label rather than a division of work, so scoping is dropped: **`canEditWard` (`src/lib/authz.ts`) no longer applies to curators.** Combined with §10.2, no privileged role is ward-scoped any more, which removes per-ward authorization from the enforcement model entirely rather than adding a second path to it.

**Curators no longer transcribe.** The earlier model asked one curator to upload and spot-check every affidavit; this one separates reading (M8) from correcting (M7).

**There is no dispute queue.** Consensus between transcribers was removed on 2026-08-15 (§10). "Dispute" now has exactly one meaning — the citizen action the sheet names in M10 — and it is the same thing this document and the codebase call a **flag**. One queue, and the two words should be collapsed to one before either is built (§17).

---

## 10. M8 — Transcriber functionality

**Effort:** 3 days · **dummy data only**

A transcriber reads one affidavit at a time from a prioritized city-wide queue and confirms or corrects the AI-extracted fields.

### 10.1 One reading, published immediately

```
AI extraction ──► published at once, marked AI-extracted
                        │
                        ├─ transcriber confirms ──► marked checked by a person
                        │
                        └─ transcriber corrects ──► new value live, marked checked
                                                    (curator or citizen flag can
                                                     still change it afterwards)
```

**There is no second reading, no consensus step and no approval.** A transcriber's save goes live on the report card the moment it is made. Consensus between two or three readings was specified until 2026-08-15 and removed: it doubled the reading cost of every affidavit against a window (§16) that cannot absorb it, and it protected least where it cost most — two transcribers looking at the same pre-filled AI value tend to confirm the same wrong extraction.

**What replaces it.** Curators can correct any field at any time (§9), citizens can flag any value, and transcriber accuracy is visible so a poor reader can be removed. These are the same nets already sitting under machine-translated Kannada, which also publishes with no human review.

**All three are forward-only, and since 2026-08-15 that is all there is.** The audit log was removed as not required, taking with it the record of who published a value and the ability to restore a previous one (`docs/architecture.md` §6, §7, §13). A wrong value gets corrected; it does not get traced. The one thing kept is a `corrected_after_check` marker on the field row, so a transcriber whose readings are frequently overturned is still findable — that is what the accuracy view in §9 now runs on.

**Two states, not four.** A value is *AI-extracted* or *checked by a person*. There is no `verified` / `disputed` / `curator-confirmed` ladder, which removes the state machine, the `transcription_readings` table, the `field_disputes` table and the value-normalization comparison logic from the build.

### 10.2 The queue is prioritized, and nobody chooses

A transcriber is handed the next affidavit and **cannot choose a ward, a party or a candidate**. `/transcribe` has a single Start control and no list — no search, no filters, no ward selector, no revealing skip. The reading surface itself is `/transcribe/{assignment-id}` (tracker 110).

**Work comes out worst-first** (`docs/overview.md` §11): candidates with missing values, then candidates with low-confidence values, then everything else. This is what makes the team size a dial rather than a cliff — whatever headcount is hired, the work left undone is the work least likely to be wrong.

Someone who can pick their affidavit can pick their ward, and a reader drawn to the ward or party they care about is the one reading least neutrally. Removing the choice keeps coverage even across 369 wards and keeps the priority ordering meaningful.

Three database-level invariants (`docs/architecture.md` §6, tracker 109): the draw is one atomic statement, so two people are never handed the same document; assignments expire back into the queue, so a half-read affidavit is never stranded; and the priority ordering is computed in the draw rather than in application code, so it cannot drift between callers.

**No privileged role is ward-scoped.** Transcribers never were, and curators stopped being on 2026-08-15 (§9). Authorization for a transcriber is "does an open assignment for this affidavit belong to this caller"; for a curator and admin it is the role alone. **`canEditWard` (`src/lib/authz.ts`) has no remaining callers** — that is a simplification of the enforcement model in `src/middleware.ts`, not an addition to it (tracker 115).

### 10.3 What else ships

- The `transcriber` role and its tables. `roleEnum` is `citizen | curator | admin` today; this adds the role, `transcription_assignments`, and a two-state check marker plus an extraction-confidence field on `candidate_fields` (tracker 108).
- A transcriber onboarding page.

**Testable when** an invited transcriber can log in, be handed an affidavit they did not choose, confirm and correct fields, see the change on the public report card immediately with its marker changed, and be handed the next one — and when the queue hands out a missing-value candidate before a low-confidence one, and a low-confidence one before a clean one.

**Prerequisites**

| | |
|---|---|
| M6 for the account, and M4a for the OTP that signs into it | §8, §6.1 |
| A hired transcription team — 5 at the floor, 33 for full coverage | tracker 58; `docs/overview.md` §11 |
| **An approved transcription budget — ₹10,000 to ₹66,000** | `docs/overview.md` §11; no tracker row yet (§17) |
| Transcriber onboarding material | tracker 60 |

**The known hole, owned rather than solved.** Transcribers see the AI's value pre-filled, so a confident wrong extraction is likely to be confirmed rather than caught. Blind entry would close it and roughly double the reading cost. The trade is made knowingly, and it is the same one made for machine-translated Kannada.

**The arithmetic is no longer the risk it was, because the reading is now paid for.** Roughly 4,000 candidates, of which about 600 need a human read once AI extraction has settled the rest at 85%, most of them handwritten notarised Kannada scans (`ksec-data-risk.md` §2). At ten minutes each that is **100 transcriber-hours for the high-priority set and 666 for a full pass**; against 20 productive hours per person across the three-day window, **5 hired transcribers to clear everything the AI could not settle, 33 to read every candidate** — ₹10,000 and ₹66,000 at ₹2,000 a head (`docs/overview.md` §11, changed 2026-08-16 from an unpaid cohort of 36). The software is still three days, and **none of that effort estimate covers the reading**.

**What remains is lead time, not headcount.** The money is small enough that full coverage is affordable; what cannot be bought is three named days inside a window that opens when nominations close, with people already identified, briefed and Kannada-literate. **Tracker 58 still describes a volunteer cohort and needs re-scoping, and there is no budget row at all** (§17). The 85% assumption behind all of it is measurable now, against affidavits already in the public domain — and if it proves to be a per-field rather than a per-candidate rate, the set needing a read triples (`docs/overview.md` §11).

---

## 11. M9 — Bulk upload readiness

**Effort:** 3 days · **dummy data only**

The affidavit pipeline, end to end, running on stand-in documents.

**What ships**

- **Bulk download and upload of EC affidavits into Google Cloud Storage.**
- **The affidavit shown on the candidate page**, linked from the report card.
- **AI extraction enqueued** per affidavit, populating cases, assets and education, including *not declared* where the affidavit says so.
- *(proposed)* **matching** — each affidavit tied to the right candidate record, which is its own problem when the nomination list and the affidavit set arrive separately and spell names differently (tracker 122). Not named on the sheet; it does not happen by itself.

**Testable when** a batch of stand-in affidavits can be ingested end to end and a visitor on a demo candidate's page sees affidavit-sourced fields with the *AI-extracted* marker and a link to the stored document.

**Prerequisites**

| | |
|---|---|
| Anthropic or OpenRouter account with credits — reconcile which | tracker 20; `project-dependencies.md` §6.6 |
| **A Google Cloud Storage bucket in `asia-south1`, and its credentials** | `project-dependencies.md` §6.19 |
| Test affidavits to run the pipeline against | `ksec-data-risk.md` §5 Option D |

**Google Cloud Storage was a change of architecture, and it has now been made deliberately.** The sheet's M9 said "google cloud storage" while `docs/architecture.md` stored all media as `bytea` in Postgres — a real contradiction, resolved on 2026-08-15 **in favour of GCS**, with `architecture.md` §2/§6/§7/§10/§13 rewritten to match rather than left to be discovered.

What that decision actually commits to, so M9 is not estimated as if it were a config change:

- **Only affidavit PDFs move.** Candidate photos stay `bytea`; the platform now has two media stores, and that split is the design, not an oversight.
- **The bucket is the backup.** Affidavits leave the `pg_dump` umbrella, so their durability is bucket object versioning plus a lifecycle policy — not a second restic repository. The consequence to hold: a database restore no longer restores the affidavits with it, because `candidate_affidavits` rows hold object keys. **Never lifecycle-delete an object a live row points at.**
- **`asia-south1` (Mumbai), for the same DPDP reason** the off-box database backup carries (`architecture.md` §13).
- **Public read, content-hashed keys.** An affidavit is the public source behind a published claim, so a signed-URL scheme would break the "open the affidavit behind any value" promise to buy secrecy the data does not need.
- **A new metered service that public traffic reaches.** Egress scales with citizens opening affidavits, which is the point of the platform. No quote has been taken, and `project-dependencies.md` §6.11's running-cost total was written before this existed.

This does not fix the off-box backup hole. There is still no destination for the nightly database dump (tracker 55, `project-dependencies.md` §6.9); moving affidavits out of it makes the dump smaller, not safer.

**Use the ECI/MyNeta corpus to build against now.** Karnataka Assembly 2023 and Lok Sabha 2024 affidavits are structured and available today (`ksec-data-risk.md` §5, Option D). They are the wrong election type and English rather than Kannada, so they will flatter the extraction accuracy — but they let M9 be genuinely finished months before N, which is the whole point of a dummy-data milestone.

---

## 12. M10 — Registered User Functionality

**Effort:** 3 days · **blocked on M3**

Accounts, and the three things an account is for.

**What ships**

- **Register for updates** — email / WhatsApp OTP and a profile at `/account`: home ward, language, notification settings. Staff use the same OTP mechanism (email only, §8); what this milestone adds is the WhatsApp channel, the citizen sign-up flow and the profile.
- Issue voting has moved to the anonymous ward-page experience: exactly three choices, one ward per browser receipt, with results revealed only after voting. Accounts are not required for it.
- **Dispute candidate information** — the citizen-facing error report. Everywhere else this is called **flagging**, and it works across any ward rather than only the citizen's own; see the terminology collision in §9.

**Testable when** a citizen can register from a ward page, receive a one-time code, set their home ward and language, and report an error on any ward.

**Prerequisites**

| | |
|---|---|
| **M3 and M4a** | the sheet's blocking column |
| A citizen cannot register without receiving a code — that is M4a | §6.1 |
| Privacy policy and terms published | tracker 16, 81 |
| Named grievance officer | tracker 36; DPDP requirement |
| Contribution licensing for flags and issue votes | `project-dependencies.md` §2.5 |

**The sheet blocks M10 on M4a, not on M4b, and the distinction is the whole point** (added 2026-08-15). Citizens cannot register without a code, so **M4a has to land first — two days, not forty** (§6.1). What M4b adds here is the WhatsApp channel; email registration works without it. The sheet's own note goes further in the other direction: **if WhatsApp cannot be done in time, drop M10.** Email OTP alone through SendGrid is the middle option between those two, and it is now recorded on the sheet rather than left implied.

**Blocking M10 on M3 means registration cannot build a list before the announcement.** `docs/messages.md` is written around a registered list of 25,000 and a send calendar starting well before the poll. That calendar does not survive this ordering; §16 is what it costs.

---

## 13. M11 — Real Candidate data available

**Effort:** 2 days · **nothing blocks it but the election calendar**

The demo data is replaced by real candidates, and the report cards stop being a rehearsal.

**What ships**

- Real affidavits ingested through M9's pipeline, extracted, and put in front of M8's transcribers and M7's curators.
- Real candidates on the pages M5 built, comparable, with provenance markers that now mean something.

**Testable when** a citizen can look up their ward, see the people actually contesting it, compare them on all nine fields, and open the affidavit behind any claim.

**Prerequisites**

| | |
|---|---|
| **Ability to download affidavit data from KSEC or another portal in bulk** | the whole milestone — `ksec-data-risk.md`, tracker 121 |
| Candidate nomination list and the returning-officer timeline | tracker 72 |
| Affidavits existing at all — **N+12** | `election-timelines.md` §4 |
| Candidate lifecycle status — filed / contesting / rejected / withdrawn | tracker 124 |

**This is the milestone the whole project is for, and it is the one with the weakest foundation.** Its two-day estimate assumes the affidavits arrive in a form that can be poured into a pipeline. Today there is no such form: KSEC publishes no filled affidavits, and the realistic acquisition routes are an RTI on a 30-day clock and volunteers at returning-officer notice boards across five corporations inside a seven-to-ten-day window (`ksec-data-risk.md` §5). **If it is a collection operation rather than a download, two days buys the tooling for work that is mostly not engineering** — and the collection has to be staffed and rehearsed *before* N, because the window closes and does not reopen.

**It used to block on M10, and that dependency was deleted on 2026-08-15.** Real candidate data does not technically need accounts, and blocking it on M10 put the project's central deliverable behind a milestone the sheet elsewhere contemplates dropping outright (§6, §12). The sheet's Blocked-on cell for M11 is now empty and this document follows it. **Note what does not change:** M11 still cannot start before the affidavits exist at N+12 and is not worth running before the final list at N+15, so the earliest M11 can finish is unmoved at N+17 (§16). Deleting the blocker removes a way the plan could have failed for no reason; it does not buy a single day.

**Blind spot: candidate status.** Between N+12 and N+15 the candidate set is a superset — it includes people who will be rejected at scrutiny and people who will withdraw. Report cards must carry filed / contesting / rejected / withdrawn, keep their URL with a status banner, and drop out of compare and readiness when they stop contesting (tracker 124). Nothing on the sheet covers this.

---

## 14. M12 and M13 — GTM Hard Launch

**M12 — Hard Launch Readiness · 5 days · nothing blocks it**
**M13 — Hard Launch · 7 days · blocked on M11 and M12**

Twitter, LinkedIn, Instagram and WhatsApp campaigns around **"Know your candidates"** and **"Find your polling booth"** — prepared in M12, fired in M13.

**Testable when** a citizen who has never seen the platform encounters the candidate campaign in the last fortnight before the poll and lands on a working report card for their own ward.

**Prerequisites**

| | |
|---|---|
| **M11 — real candidates to know about** | the sheet's blocking column |
| **M12** | the sheet's blocking column |
| **₹3L budget for WhatsApp** | as given on the sheet |
| Booth lookup actually working | §3 — the campaign's second half |
| WhatsApp sends, if the campaign uses them | M4b; dropped with it |

**M12 has no blocker, so build it early.** Everything except the candidate names can be written before N: the creative, the schedule, the partner forwards, the booth-finder copy. Treat M12 as belonging to the unblocked block in §2, not to the end of the plan.

**"Find your polling booth" works, and the campaign can be built on it.** The mechanism was untested when this was written; it shipped on 2026-08-19 (§3). The residual risk is no longer "does it exist" but "is that government endpoint up on poll morning" — so the campaign copy should still degrade gracefully to ward-level guidance rather than promising a booth, and the official EC finder stays on the page beside our own answer.

**M13's seven days do not fit; see §16.**

---

## 15. M14 — Final election results announced

**Effort:** not estimated · **blocked on M13**

Citizens can see the result in each ward.

**What ships:** ward-wise results — who won, by what margin — against the candidate pages already built.

**Prerequisites:** declared results, at **N+26** (`election-timelines.md` §3). KSEC does publish results per body type, which makes this the one candidate-adjacent milestone whose data source is confirmed to exist (`ksec-data-risk.md` §1).

**This is new scope.** No previous version of the plan included results, and no effort is set. It also extends the platform's life past the poll, which changes the retention story: contact data is to be deleted at **results + 3 months**, and that clock now starts inside the platform's active life rather than after it.

---

## 16. The arithmetic, and where it breaks

**The efforts sum to 87 days** across M1–M13, of which **40 are M4b's approval queues** and 47 are actual work. M14 is not estimated. M4a's five days and M4b's forty run concurrently, so the wall clock is still bounded by M4b.

**Before N there are 32 days of work with nothing external blocking them:** M4a (2) + M1 (5) + M2 (5) + M5 (3) + M6 (3) + M7 (3) + M8 (3) + M9 (3) + M12 (5), with M4b's clock running alongside. **Do M4a's two days first** — they are what lets the fourteen days of M6, M7 and M8 be finished rather than merely written. Starting 15 August, that is roughly six and a half working weeks — done by **early October** if nothing slips. Whether that is comfortable depends entirely on when N falls, which nobody knows.

**After N, the plan does not fit.** Taking the sheet's blocking and efforts against `election-timelines.md`:

| Beat | Earliest | Why |
|---|---|---|
| M3 fires | N | needs the announcement |
| M10 done | N+6 | M3 (3d) → M10 (3d) |
| Affidavits exist | **N+12** | nominations close |
| Final contesting list | **N+15** | withdrawals close |
| M11 done | **N+17** | 2 days on the final list, at best |
| M13 done | **N+24** | 7 days from M11 |
| **Silence begins** | **N+21** | campaigning ends |
| **Poll** | **N+23** | — |

**Dropping M11's blocker on M10 does not move this table** (§13). M11 was never actually waiting on M10 — it waits on the withdrawal deadline at N+15, which is three days later than M10's earliest completion at N+6. The dependency was slack the whole time, which is exactly why deleting it is cheap and why deleting it fixes nothing below.

**The hard launch finishes after the election.** Even with every prerequisite met, every estimate honoured and no slippage anywhere, M13's seven days start after M11 and end past the silence period. To land before N+21, M13 must begin by N+14 — **before the final candidate list exists.**

Three ways out, and they should be chosen deliberately rather than discovered at N+15:

1. **Run M13 against the provisional list from N+12**, accepting that some candidates promoted in the campaign will be rejected at scrutiny or withdraw. This is what candidate status (tracker 124) exists for.
2. **Shorten M13.** Seven days of campaign push compressed into six is a smaller change than everything else here.
3. **Decouple the booth half from the candidate half.** "Find your polling booth" needs no candidate data and can run from N+7; only "Know your candidates" waits on M11.

**Two of these three cost nothing to prepare now.** All three cost a great deal to invent in the last week of an election.

**What ordering M10 after M3 costs.** The comms plan is built around a registered list assembled in advance: seven sends, a 25,000-registration target, and a first message carrying the electoral-roll deadline — the one send whose value expires if it is late (`docs/messages.md`). With M10 behind M3, registration cannot start before the announcement, and the roll deadline may well precede it. Reach rests instead on the anonymous ward finder and the partner cascade — a forwardable link into apartment and college WhatsApp groups, which needs no account on either side. The sends become **contingent**, not planned: they exist if M4 clears, and the go-to-market plan needs a stated go/no-go date after which the calendar is dropped rather than compressed. That is a real reduction in ambition, and it should be written down as a decision rather than discovered.

---

## 17. What changed, and what now points at the wrong thing

The nine-milestone plan of 2026-08-14 is superseded. **No number survived unchanged in meaning except M1.**

| Old | Old name | Now |
|---|---|---|
| M1 | Ward Discovery | **M1**, expanded — adds booth-by-EPIC, ward issues, candidate questions, and the donation page |
| M2 | Donation page | folded into **M1** |
| M3 | Partnerships page | folded into **M2** (GTM Soft Launch Readiness) |
| M4 | Launch | split into **M2** + **M3**, with the candidate-facing half at **M12** + **M13** |
| M5 | Admin functionality | **M6** |
| M6 | Curator and Transcriber | split into **M7** (curator) + **M8** (transcriber) |
| M7 | Registered User Support | split into **M4a**/**M4b** (send capability) + **M10** (accounts and contributions) |
| M8 | Candidate EC affidavits | split into **M9** (pipeline, dummy data) + **M11** (real data) |
| M9 | Polling booth information | absorbed into **M1** (EPIC lookup) and the **M12/M13** campaigns |
| — | — | **M5** (candidate pages on dummy data) is new |
| — | — | **M14** (election results) is new scope |

### Documents still carrying old milestone numbers

| File | Where | What it says now, and what it should mean |
|---|---|---|
| `docs/project-dependencies.md` | — | **Re-pointed 2026-08-15.** Every row's Milestone column was re-mapped from the nine-milestone plan to the fourteen; the ~30 citations to the four deleted documents were replaced with the requirement stated inline; and the rows describing removed machinery (two-reading consensus, curator ward scope, the ward-readiness gate, candidate news links) were corrected. Nothing outstanding. |
| `docs/messages.md` | line 7 | The contingency note names M7; the send capability is M4a (email) and M4b (WhatsApp), and the audience is M10. Its E-relative send codes are structurally fine — they float with the poll date. |
| `docs/architecture.md` | — | **Brought in line on 2026-08-15**, in two passes: transcription redesigned to one reading, curator scoping removed, auth split by session length; then affidavit storage moved to Google Cloud Storage (§11), the last news-link and `information-architecture.md` citations removed, the middleware's "curator ward scope" claim deleted where it contradicted §7's own text, and a dead deployment-spec link replaced with the reasoning inline. Nothing outstanding. |
| `CLAUDE.md` | "The docs" section | **Rewritten 2026-08-15** and now matching what is on disk, including the four deleted documents and their recovery path. It correctly records that there is no tiebreaker document at present. |

`src/` contains no milestone references — the `M12`/`M18` strings in `Footer.astro`, `ExternalLinkOut.astro` and `Candidate.astro` are SVG path data. Source comments citing "Task NN" are historical provenance, not affected.

### What this document does not cover

Several things this plan depends on have no home on disk right now and are not restated here in full: the complete product requirements, the canonical route and access-level map, the go-to-market calendar, and the staffing register of who owns what. Where a milestone above needs one of them, it states the specific requirement inline rather than pointing anywhere. **Anything not stated above is not written down.**

### Tracker inconsistencies worth fixing at the source

- **The M4 split is now on the sheet.** M4a (email, 2d) and M4b (WhatsApp, 40d) replaced the single 40-day M4 row on 2026-08-15, so this is no longer a private reading. Tracker rows behind it split accordingly: **19 and 51 are M4a**; 45, 46, 47, 48 and 119 are M4b; **120 (the comms engine) was split into two rows on 2026-08-15** — 120 is now the email send engine (M4a) and 128 the WhatsApp send engine (M4b), because a 2-day half and a 40-day half cannot share a row that anyone can close.
- **The Tasks tab was re-mapped to the fourteen on 2026-08-15.** All 90 rows' Milestone column previously referred to the nine-milestone plan; 69 of them changed. The mapping was made row by row rather than by a blanket old→new rule, because the old milestones split: rows 105–107 (admin) M5→**M6**; rows 108–115 (curator + transcriber) M6→**M7** or **M8**; rows 19/45–51/119/120 (vendors, templates, comms engine) M2 or M7→**M4a** or **M4b**; the donation rows M2→**M1**; the booth rows M9 or untagged→**M1**. Where a row cites a `project-dependencies.md` row in its Source column, it now carries that row's milestone, so the two documents answer the same question the same way. **"What is M6 waiting on" now returns the right answer.**
- **Rows describing removed machinery were deleted from the Tasks tab on 2026-08-15**, including 106 (admin-issued sign-in link) and 111 (consensus resolution). Deleting them rather than closing them means the tab no longer carries a record that they were considered — `docs/architecture.md` §13 and §10.1 here are where that reasoning now lives.
- **M12, M13 and M14 had no task rows at all** — 12 estimated days plus unestimated results work with nothing under it. Rows **138–141** now cover the two hard-launch campaigns, the ₹3L WhatsApp budget and ward results. **There is still no results route in `src/pages`**, which is what row 141 is for.
- **Row 127 (booth by EPIC) is now tagged M1** — it had no milestone at all despite being named scope in M1. **It is still open on the sheet and the work is done** (2026-08-19, §3): close it, and correct its description while doing so, because it says KSEC and the endpoint that exists is BBMP's. This is the one place the sheet is currently behind the code rather than ahead of it.
- **Nineteen rows were added on 2026-08-15** to cover requirements that `docs/overview.md` states but nothing tracked: the RTI and the returning-officer collection operation (129, 132), owners for affidavit acquisition and the data operation (133, 134), measuring the 85% extraction assumption (130), the GCS bucket (135), the comms go/no-go date and hard-launch sequencing decisions (136, 137), the M12–M14 rows above, the transcriber path on `/partner-with-us` (142), the future-civic-tools consent checkbox (143), the retention-enforcement job (144), the About page's funding disclosure (145), and the nine-field report card reconciliation (146). Row **35** was created because row 16 cited "the retention decision (ID 35)" and no such row existed.
- **Task ID 87 was used twice** — "Enable billing in GCP" and "Link to Google Analytics". The second was renumbered **131** on 2026-08-15.
- **The donation-page rows were tagged M2** from the old plan and belong to M1. Row 94 — the Oorvani URL and the 80G wording — **was** the one M1 prerequisite the Milestones tab did not list; it was added to M1's External Dependencies on 2026-08-15 and the rows were re-tagged to M1 the same day. The two tabs and `project-dependencies.md` §5.8 now agree.
- **The address-based booth rows were deleted on 2026-08-15**, leaving row 127 (booth by EPIC) as the only booth row. That is a decision, not a tidy-up, and it was the right one: the EPIC path shipped on 2026-08-19 (§3) and the address path never had data behind it — nothing seeded the `booths` table outside `scripts/seed-dev.ts`, so the address lookup answered every real visitor with "we don't have booth data yet". It has since been removed from the endpoint and the page. **The gap the deletion left is still open**: if that government endpoint goes away, the fallback those rows described — an addressed polling-station list — is tracked nowhere on the Tasks tab. `project-dependencies.md` §4.7 is the only place it survives.
- **"Dispute" and "flag" were the same thing, and the vocabulary is now collapsed to "flag".** The transcriber consensus failure that "dispute" used to name no longer exists (§10.1), so the sheet's "dispute candidate information" in M10 and the codebase's *flag* were one action and one queue under two names. The sheet's M7 and M10 descriptions were changed to "flag" on 2026-08-15. The word "dispute" should not reappear in a task description, a schema name or a route.
- **The transcription rows were re-scoped on 2026-08-15.** They had specified `transcription_readings`, `field_disputes`, consensus resolution, a `/curator/disputes` screen, and a unique index enforcing "one transcriber never reads the same affidavit twice" — roughly half a build that no longer exists. 108 now names only `transcription_assignments`, a two-state marker and `corrected_after_check`; 109 is retitled *prioritized* and records that there is deliberately **no** unique index; 112 is the one city-wide flag queue; 113 measures accuracy rather than agreement, derived from the field row now that there is no change log; 115 records that `canEditWard` has no callers left at all. Rows 111 and 114 were deleted.
- **Rows 58 and 60 were re-sized on 2026-08-15.** Row 58 is now "enroll 4 curators and 36 transcribers (target 50)", against the old "curator lead and 15–20 transcribers". Row 60 records that there is no sign-off step to document and that the two jobs need different words.
- **Row 58 needs re-scoping again, and a budget row does not exist.** Transcription became paid work on 2026-08-16 (`docs/overview.md` §8, §11): 5 transcribers clear the high-priority set and 33 read every candidate, at about ₹2,000 a head. Row 58's "36 transcribers (target 50)" is now wrong in both number and kind — it enrols volunteers for a job that is hired — and curator recruitment (4, unpaid, vetted) should split off it, since the two roles no longer move together or answer to the same owner. **Nothing tracks the ₹10,000–₹66,000.** The only budget row on the sheet is 140 (the ₹3L WhatsApp spend); this needs its own beside it, and it gates M8 having anyone to use it.
- **"Mark candidate complete" fed a ward readiness gate that no longer exists**, and its row (114) was deleted on 2026-08-15. If the `/data` page is still to publish coverage figures (`docs/overview.md` §8, "Public metrics"), something has to compute them — that is now untracked.
- **M11's blocker on M10 was deleted on 2026-08-15**, on the sheet and here (§13). It had put the project's central deliverable behind a milestone the sheet elsewhere contemplates dropping. It was slack rather than a real constraint, so nothing in §16's arithmetic moves.
- **The sheet's M9 said Google Cloud Storage while `architecture.md` said Postgres `bytea`.** Resolved 2026-08-15 in favour of GCS; `architecture.md` was rewritten to match and §11 records what that commits to. **Tracker 123 was re-scoped on 2026-08-15** from Postgres dump size to bucket throughput and egress cost, and row **135** was added to provision the bucket itself (`project-dependencies.md` §6.19).
- **Row 106 ("generate a sign-in link") contradicted a locked decision** and the sheet's M6 description carried it. The description was corrected on 2026-08-15 — staff sign in by email OTP, and there are no sign-in links (§8, `docs/overview.md` §8) — and the row was deleted from the Tasks tab rather than built.

---

## 18. How to use this document

1. **The sheet is the source; this is the reading.** Structure, effort and blocking come from the Milestones tab. Analysis, risks and anything marked *(proposed)* are this document's, and are contestable.
2. **The unblocked block is the agenda.** M4a, M1, M2, M5, M6, M7, M8, M9 and M12 wait on no external queue — 32 of the 47 non-M4b days. Three of them (M6, M7, M8) need M4a done before a real operator can sign in and prove them; and every one of them can be finished before the announcement.
3. **Both halves of M4 start today, for opposite reasons.** M4b is forty days of queues nobody can compress. M4a is two days that nothing queues behind and that three other milestones are waiting on — it should be the first thing finished, not the fourth.
4. **Do not read the order as a schedule.** M4a and M4b run alongside everything. M5–M9 and M12 can run in any order. M3, M10, M11, M13 and M14 cannot start delivering before the EC acts, whatever we do.
5. **The effort column measures software and campaign work, and nothing else.** M8 at three days is the tooling; the 600 high-priority affidavit readings it exists to support are not in that number — nor the 4,000 of a full pass, nor the ₹10,000–₹66,000 of hiring the people to do them (§10). M11 at two days assumes a bulk download that does not currently exist.
6. **Two questions are worth more than the rest of the plan combined:** when is N (tracker 71), and can affidavits be obtained in bulk (tracker 121). Both are answerable by asking. Both are unassigned.

Related: `docs/election-timelines.md` (what the calendar allows), `docs/ksec-data-risk.md` (whether the candidate data exists at all), `docs/architecture.md` (the technical design), `docs/project-dependencies.md` (everything outside the codebase), `docs/messages.md` (the send copy), `docs/design-system.md`, `docs/gcp.md`.
