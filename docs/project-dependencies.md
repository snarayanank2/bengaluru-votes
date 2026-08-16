# Project Dependencies

**Date:** 2026-08-15
**Status:** Living document
**Scope:** Everything this project needs that **cannot be produced by writing code in this repository** — legal work, external account approvals, official data, people, money, and decisions. If a task can be closed by a pull request, it does not belong here.

This document exists because the binding constraints on this project are almost all outside the codebase. The application could be finished and the platform still could not launch: not without a published privacy policy, not without curators and transcribers, not without the candidate data the returning officers release on their own timeline. (Ward boundaries — long the emblem of this list — have since landed in the repo; see Path B and §4.1.)

Owners are listed as **unassigned** where nobody has been named. That is the honest state and the first thing to fix — an unowned dependency is not being worked on, whatever its due date says.

**Every row carries the milestone it gates** (`docs/milestones.md`). Read a milestone's rows together and you get the real answer to "what is M4b waiting on" — which is legal counsel and a privacy policy, not code. A `✓` marks a dependency already resolved; `—` marks one that gates nothing any more. Where a row shows several milestones, it blocks each independently.

**Re-pointed 2026-08-15.** Every Milestone cell below was re-mapped from the superseded nine-milestone plan to the fourteen of `docs/milestones.md`; **any `M<n>` written in this file before that date meant a different milestone.** In the same pass, citations to `docs/prd.md`, `docs/information-architecture.md`, `docs/gtm-plan.md` and `docs/roles.md` were removed — those four documents were deleted on 2026-08-15 and are being rewritten, so what they used to carry is now **stated inline here** rather than pointed at. Rows describing machinery that no longer exists (two-reading consensus, per-ward curator scope, the ward-readiness gate, candidate news links) were corrected or deleted.

---

## 1. The three critical paths

These run in parallel and are independent. The project is gated by whichever finishes last, so all three must start now.

**Path A — Legal → privacy → WhatsApp.** The longest chain, and the least obvious:

```
retention decision → lawyer drafts /privacy → /privacy published
  → Meta business verification → WhatsApp API onboarding
  → 16 templates submitted (7 sends + OTP, × EN/KN) → Meta approval (weeks)
  → the comms plan can run
```

Every arrow is someone else's queue. The chain is measured in months, and it starts with a retention proposal that still needs legal confirmation (§2.1). This is the one most likely to be mistaken for launch-week paperwork.

**It gates the public launch too, not only WhatsApp.** Google Analytics is already live on the site (§6.12), so launching M3 without a published privacy policy is a live obligation rather than a paperwork gap.

**Path B — Ward delimitation data. ✓ Resolved.** The post-delimitation boundaries have landed: **`data/gba.geojson`** holds all **369 wards** as polygons plus their metadata — ward names (EN / KN), corporation / zone, assembly constituency, population, and RO codes. Address lookup and every ward-scoped page are built against real data. `data/gba.geojson` is the **authoritative final delimitation** (confirmed 2026-07-20) — no reconciliation against a later official release is pending. **The pincode hedge this path used to carry is gone, 2026-08-14:** the pincode → ward lookup (§4.2a below) was removed from the codebase — its postal-boundary table never advanced past a 12-row placeholder, so it was deleted rather than shipped as a fallback that could not actually work. Google geocoding is now the **only** path from a typed address to a ward: no fallback, no browsable ward list. An exhausted geocode budget or a Google outage takes typed-address lookup down outright rather than degrading it — a trade made knowingly (`docs/architecture.md` §11). The device-location input mode survives such an outage, because it calls nothing. The project's single largest technical risk — the boundaries themselves — has retired; the geocode-availability risk this leaves in its place is tracked at §6.4/§6.5, not hedged against.

**Path C — People.** Curators (§5.1) and transcribers (§5.7) gate candidate data existing at all; partners (§5.2) gate reach. Curators and partners are recruited in the same conversations, and both are slower than they look because vetting is a judgement, not a form. **Transcriber recruitment is a different ask and needs different words** — see §5.7.

Note what Path C no longer gates: **there is no ward-readiness sign-off.** It was dropped on 2026-08-15, so candidate sends go out on the campaign calendar to every ward at once (`docs/architecture.md` §10). Curator and transcriber supply now determines how complete report cards are when the sends land, rather than determining *whether* they land.

---

## 2. Legal & compliance

| # | Dependency | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 2.1 | **Retention period — legal confirmation.** The product proposal is decided (2026-07-19): contact data deleted or anonymized within 3 months of results being declared. Counsel confirms or amends it | M3, M4b, M10 | `/privacy`, therefore all of Path A | unassigned |
| 2.2 | **Legal counsel engaged** — to draft `/terms` and `/privacy` | M3, M4b, M10 | Path A | unassigned |
| 2.3 | **DPDP Act 2023 compliance review** — consent notice, purpose limitation, data-principal rights incl. erasure mechanics (`docs/architecture.md` §7), the 18+ assertion at registration, cross-border transfer position (`docs/architecture.md` §13) | M3, M4b, M10 | `/privacy` | unassigned |
| 2.4 | **Named grievance officer** — a real person, contactable, published | M4b, M10 | `/privacy` (DPDP requirement) | unassigned |
| 2.5 | **Contribution licensing** — terms under which citizen flags and issue votes are used | M10 | `/terms` | unassigned |
| 2.6 | **Future-use consent — decided** (2026-07-19): registration carries the optional "tell me about future civic tools" checkbox. Remaining work is the checkbox wording, part of the legal-review input | M10 | The next phase's list | unassigned |
| 2.7 | **Oorvani Foundation entity details** — trust registration, signing authority, registered address for legal pages and Meta verification | M3, M4b | `/privacy`, `/about`, Meta verification | unassigned |
| 2.8 | **Data-processing terms with every processor** — Twilio/SendGrid DPAs, Google Cloud terms (Geocoding, Maps, Places, Cloud Storage), Anthropic commercial terms, Sentry DPA; the contractual cover behind the `/privacy` processor inventory and the cross-border position (`docs/architecture.md` §13) | M3, M4b, M10 | `/privacy` accuracy; the "shares only with service providers under contract" commitment | unassigned |
| 2.9 | **DPDP breach-notification readiness** — Data Protection Board notification procedure, bilingual affected-user notice template, decision timeline, named owner (`docs/architecture.md` §13) | M3, M10 | Launch responsibly; the Act has no materiality threshold | unassigned |

**2.1 is the first domino.** It is a trust decision before it is a legal one, and it is currently unowned.

**On 2.5:** the platform publishes aggregated issue votes as public data and shows citizen flags to curators. Both need a licence citizens actually granted.

**Not a dependency, deliberately:** a legal opinion on RPA §126 (the election silence period). The decision is to go dark from three days before the poll rather than to test the boundary, which converts a legal question into a scheduling decision (`docs/overview.md` §8, "Election-silence rule"). If anyone later proposes a send inside the final 48 hours, this becomes a dependency again.

---

## 3. Messaging & delivery

Both channels go through **Twilio** — SendGrid is a Twilio product, so email and WhatsApp are one vendor, one bill, one support relationship. This is a decided stack choice.

**The two halves gate very different things**, which is why M4 is carried as M4a and M4b (`docs/milestones.md` §6). **Email (§3b) gates staff login**, and therefore the entire curator and transcriber operation — staff are email-only. **WhatsApp (§3a) gates only the campaign's WhatsApp channel and citizen WhatsApp OTP.** The forty days of queueing are all in §3a.

### 3a. WhatsApp, via Twilio

| # | Dependency | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 3.1 | **Meta Business Manager account + business verification** — Oorvani trust documents, registered address | M4b | WhatsApp entirely | unassigned |
| 3.2 | **Published `/privacy` URL** | M4b | 3.1 — Meta will not verify without it | unassigned |
| 3.3 | **Twilio account** + India billing setup | M4a, M4b | 3.4 onward, and all of §3b | unassigned |
| 3.4 | **Sender number (+91)** — see the walkthrough below | M4b | Any WhatsApp send | unassigned |
| 3.5 | **WhatsApp sender registration** in Twilio, linked to the Meta business | M4b | 3.6 | unassigned |
| 3.6 | **Display name approval** — the name citizens see, reviewed by Meta | M4b | Sending | unassigned |
| 3.7 | **16 templates** submitted via Twilio, approved by Meta — 7 sends + the OTP login message, × EN/KN | M4b | The comms calendar; WhatsApp OTP login | unassigned |
| 3.8 | **Template category classification** — Meta's Marketing / Utility / Authentication split | M4b | 3.7, and the budget in 3.9 | unassigned |
| 3.9 | **Message budget** — Meta's per-message fee **plus Twilio's markup** | M4b, M13 | Whether the plan is affordable | unassigned |
| 3.10 | **Recorded opt-in evidence** — captured at registration: the wording version shown + timestamp, stored, not implied | M10 | Policy compliance | unassigned |

**Twilio does not shorten Path A.** Meta business verification and per-template Meta approval are unchanged; Twilio forwards templates to the same queue. It removes plumbing, not waiting. Nothing about the launch date improves by having chosen it.

**The sender number is the fiddly part.** A `+91` number is a trust requirement, not an aesthetic one — Bengaluru citizens receiving election information from a US `+1` sender have every reason to distrust it.

1. **Bring your own number (BYON)** is the practical route. Twilio-provisioned Indian numbers require a **regulatory bundle** — local entity proof and address — which Oorvani can satisfy as an Indian trust, but it is more paperwork than using a number already held.
2. **The number must be clean.** It cannot be active on consumer WhatsApp or the WhatsApp Business app. If Oorvani already uses it there, it must be deleted from WhatsApp first — and that is irreversible.
3. **It becomes one-way.** Once a number is a WhatsApp Business API sender, nobody can use it in the normal WhatsApp app again. Do not use a number the office depends on.
4. **Landlines are legitimate.** Verification is by voice call, so an existing landline works.
5. Verification code → sender registered → display name submitted for Meta review.

**Recipients (`+91` "to") are unremarkable** — messaging Indian numbers works normally at India rates. Two consequences that do bite: all seven sends are proactive, i.e. outside WhatsApp's 24-hour service window, so **every one requires an approved template** (3.7); and **opt-in must be recorded as evidence** at registration (3.10).

**DLT registration does not apply.** India's TRAI DLT regime governs **SMS, not WhatsApp**, so it is off the critical path — *unless* someone later adds SMS as an OTP fallback, at which point it becomes a weeks-long dependency that arrives as a surprise. The stack uses email and WhatsApp only — no SMS.

**3.8 and 3.9 are the costs nobody has written down.** Meta classifies templates as Utility (transactional, cheaper) or Marketing (announcements, dearer, and separately blockable by the recipient). Of the seven sends, only W1 is unambiguously Utility; *candidates have filed*, *vote on your issues*, *report cards are complete* all read as Marketing under Meta's definitions however civic the intent. The OTP login message is a third class again — **Authentication category**, with its own per-message rate.

At the (now contingent — `docs/overview.md` §11) target of 25,000 citizens × 7 sends ≈ **175,000 messages**, billed at Meta's India rate **plus Twilio's markup** (roughly 30–50% on top). On top of that, WhatsApp OTP logins are metered per attempt at the Authentication rate — that line scales with *sessions*, not with the calendar, and is unbounded by the seven-send budget. It scales linearly with the success of the registration drive — hitting the target makes the bill bigger, not smaller. Get real quotes rather than estimates: Meta moved from conversation-based to per-message pricing during 2025, so any rate figure repeated from memory is suspect. If the number is bad, the channel mix is the lever — email has no per-message fee.

### 3b. Email, via SendGrid

| # | Dependency | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 3.11 | **Twilio SendGrid account** + a plan sized for ~175k sends | M4a | Email at all — therefore **all staff login** | unassigned |
| 3.12 | **Domain authentication** — SPF, DKIM, DMARC on the sending domain | M4a | Deliverability; not landing in spam | unassigned |
| 3.13 | **Sender identity verification** | M4a | Sending | unassigned |
| 3.14 | **Sender reputation warm-up** — volume ramped, not dumped | M13 | The first real *campaign* send arriving; not login (see below) | unassigned |
| 3.15 | **Bounce and complaint handling** — webhooks wired to suppression | M4a | List health; reputation | unassigned |
| 3.16 | **Unsubscribe mechanism** — one-click, honoured | M10 | DPDP consent withdrawal (§2.3) | unassigned |

**Email is not the fallback — it is the floor the data operation stands on.** Staff (admin, curator, transcriber) sign in by email OTP and have no second channel, so **until 3.11–3.13 are done, no curator or transcriber can log in**, however finished M6, M7 and M8 are. That is two days of work with no third-party queue in front of it, gating fifteen days of otherwise-unblocked engineering. It should be the first thing finished in the project.

**3.14 is separated deliberately.** Warm-up is a *campaign* prerequisite, not a login one: staff OTP is a handful of transactional messages a day, which no reputation system objects to. The ramp matters when 25,000 recipients get a send. Do not let a warm-up schedule appear to block M4a.

---

## 4. Official data sources

| # | Dependency | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 4.1 | ✓ **Post-delimitation GBA ward boundaries** — **in repo: `data/gba.geojson`, 369 wards** as polygons; confirmed the authoritative final delimitation (2026-07-20) | M1 ✓ | Path B — M1 (now unblocked) | ✓ committed |
| 4.2 | ✓ **Ward metadata** — names (EN / KN), numbers, corporation / zone, assembly constituency, population, RO codes — **all carried in `data/gba.geojson`** | M1 ✓ | Ward pages | ✓ committed |
| 4.2a | ~~Pincode → ward postal-boundary data~~ — **moot, 2026-08-14.** The pincode lookup this would have fed was removed from the codebase — its table never advanced past a 12-row placeholder, so it was deleted rather than finished. Nothing in the app needs postal-boundary data any more | — | Nothing — closed | resolved |
| 4.3 | **EC notification** — official date and schedule | M3 | Anchor **N**; the whole calendar | unassigned |
| 4.4 | **Electoral roll deadline date** | M10 | The R1 send, the highest-value message we send | unassigned |
| 4.5 | **Candidate nomination list** — from EC / returning officers, provisional then final. Carries name, ward, party and gender already structured (`docs/overview.md` §3.1) | M11 | Candidate pages filling; the C2 send | unassigned |
| 4.6 | **Candidate affidavits** (Form 26) — cases, assets, education, age | M11 | Report cards — the platform's central promise | unassigned |
| 4.7 | **Polling booth lookup by EPIC**, or failing that an address-accurate polling-station list | M1, M13 | `/voting-guide/find-booth`; the F1 send; half the hard-launch campaign | unassigned |
| 4.8 | **Registration-check link target** — the correct official EC / CEO Karnataka roll-lookup URL for GBA, verified, and monitored for changes (a guided link-out, not an integration) | M1 | `/check-registration` | unassigned |

**4.1 was the single largest technical risk in the project — now retired.** The post-delimitation boundaries and ward metadata are committed at `data/gba.geojson` (369 wards). Geocoding quality was already a solved problem (Google geocoding, decided — §6.3); with the boundaries in hand, address→ward lookup and every ward-scoped page are buildable today. **The pincode fallback this section used to describe is gone, 2026-08-14** (§4.2a). Geocoding is now the **only** path from a typed address to a ward, with no fallback and no browsable ward list (`docs/architecture.md` §11).

**4.3 and 4.4 move independently.** The roll deadline is not derived from the election date and must be tracked separately. It is anchored to R1, the one message whose failure cannot be undone — and with registration now sitting behind the soft launch (M10 blocks on M3), **the roll deadline may well fall before registration opens at all**, in which case that send is not late, it is impossible (`docs/overview.md` §11).

**4.6 is the dependency the whole project turns on, and it is not confirmed to be satisfiable.** KSEC publishes no filled candidate affidavits online for any election, past or upcoming — no repository, no per-candidate PDFs, no equivalent of the ECI portal or MyNeta. The realistic routes are an RTI on a 30-day statutory clock and volunteers at returning-officer notice boards across five corporations inside a seven-to-ten-day window; **neither is a bulk download**, and both must be set up before the announcement. `docs/ksec-data-risk.md` is the full analysis. `docs/milestones.md` §2 records the consequence: the plan contains an explicit kill switch at M3.

**4.6's shape drives the operation.** Affidavits arrive as scanned PDFs, per candidate, often handwritten and notarised in Kannada. The pipeline routes them through AI extraction (M9): the document is ingested, the Anthropic API (§6.6) extracts the fields, and they publish immediately marked *AI-extracted*. A transcriber then reads one affidavit at a time and confirms or corrects (§5.7); a curator can correct anything afterwards. Scanned-image quality is therefore an extraction-accuracy risk as well as a reading one, and it is what makes the 85% extraction assumption behind §5.7's cohort sizing worth measuring early.

**4.7 changed shape on 2026-08-15.** The plan is now booth lookup **by EPIC number** — the citizen supplies their voter ID and the booth comes back — rather than the platform holding an addressed booth list. That is a smaller data dependency if KSEC exposes such an endpoint, and a larger one if it does not, because the fallback is the addressed list nobody is currently tracking. **It is unverified**, and `docs/milestones.md` §3 calls it the single largest unknown inside M1.

---

## 5. People & organisation

| # | Dependency | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 5.1 | **Curator recruitment & vetting** — **four** trusted people, working city-wide | M7 | The correction net under all candidate data | unassigned |
| 5.2 | **Partner recruitment** — RWAs, civic organisations | M2 | Reach; the visitor target | unassigned |
| 5.3 | **A named outreach owner** — one person owning 5.1 and 5.2 as one motion | M2, M7 | Both of the above | unassigned |
| 5.4 | **Curator *and transcriber* onboarding material** — two different jobs, two sets of words | M7, M8 | Data quality | unassigned |
| 5.5 | **Named spokespeople** with approved quotes | M2 | `/press` | unassigned |
| 5.6 | **Moderation capacity** — someone works the flag queue near the election | M7 | The correction loop | unassigned |
| 5.7 | **Transcriber cohort** — **36 Kannada readers, targeting 50** | M8, M11 | Candidate data being checked at all | unassigned |
| 5.8 | **Oorvani donation URL + 80G/receipt wording** — the destination `/donate` sends people to, and what a donor gets back | M1 | `/donate` | unassigned |

**5.7 is the binding constraint on candidate data, and it is not software.** The arithmetic, in full at `docs/overview.md` §11: roughly **4,000 affidavits**, of which about **1,900 need a human read** once AI extraction has settled the high-confidence ones. At ten minutes each and three hours a day across the three-day window, that is **36 volunteers** — or **75** if every affidavit is read rather than only the ones the AI could not settle.

Three things about that number:

- **It is one reading per affidavit, not two.** The two-reading consensus model this row used to be sized against was removed on 2026-08-15 — it doubled the reading cost against a window that cannot absorb it, and protected least where it cost most. The figure here is halved accordingly; anyone quoting ~8,000 transcriptions is quoting the superseded model.
- **The queue is prioritized worst-first**, so the cohort size is a dial rather than a cliff: whatever headcount turns up, the work left undone is the work least likely to be wrong.
- **Every assumption behind it is optimistic in the same direction.** Three hours a day for three consecutive days is a real commitment. Ten minutes assumes confirming rather than typing, on a handwritten Kannada scan. And the 85% extraction accuracy is a stated hope — **it is measurable now**, against the Karnataka Assembly 2023 and Lok Sabha 2024 affidavits already in the public domain. At 70% the cohort needed rises from 36 to 57.

**The software is three days** (`docs/milestones.md` §10, M8). **The cohort is months, and recruitment has not started.** No estimate on the tooling says anything about whether enough people are available to use it.

The transcriber pitch is also genuinely different from the curator pitch, and running them through one conversation will quietly cost the lighter one its people: curating is stewardship over months, transcribing is piecework that wants Kannada and an hour. 5.3's single outreach owner still holds — one relationship, asked once — but the two asks need separate words, and 5.4 is now two pieces of onboarding material rather than one.

**5.3 is the cheapest item here and the one most likely to sink the plan.** Curator and partner recruitment are the same conversations with the same people. Split across two owners, the relationship gets asked twice and gives once. Unowned, it happens in whatever time is left over, which near an election is none.

**Kannada is machine-generated with no human review — a decided trade.** The stack translates curator content via the Anthropic API (§6.6) and publishes it directly; the citizen flag flow is the correction path. The same trade now covers **affidavit extraction**: AI-extracted fields publish without prior review, marked *AI-extracted* until a person has checked them. The residual risk is owned rather than mitigated: a bad machine translation — or a misread affidavit entry — on a candidate's criminal record would be ours, published at scale. That makes moderation capacity (5.6) and the curator correction path matter more, since flags and curator edits are now the only nets under this — the audit log was removed on 2026-08-15.

**One exception, and it is deliberate:** the 16 WhatsApp templates (§3.7) get native-speaker and legal review before submission. Unlike site content, a mistranslated template costs a re-submission cycle worth weeks.

**Curator scope is city-wide and unbounded — an owned risk.** Curators can correct any field on any candidate in any ward; there is no ward or zone scope, because a team of four against 369 wards would make per-ward assignment a label rather than a division of work. Combined with publish-immediately trust and OTP-only login, **a curator's scope is their unreviewed blast radius** — one compromised login away from broad edits to candidate records mid-election. **Vetting (5.1) is the only net.** The append-only audit log and admin rollback that used to share that job were removed on 2026-08-15 as not required, so a curator's edits are unreviewed, unattributed and irreversible (`docs/architecture.md` §13). What the unbounded scope buys: coverage follows curator supply rather than an arbitrary boundary, in a project where covering 369 wards is the constraint. *(This replaces the earlier "uncapped zone assignment" framing — per-ward curator scope was removed from the enforcement model entirely on 2026-08-15; `canEditWard` has no remaining callers. `docs/architecture.md` §7.)*

---

## 6. Commercial accounts & infrastructure

| # | Dependency | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 6.1 | **Cloud hosting account + billing** — decided: a Hostinger VPS in Mumbai (4 vCPU / 16 GB) running Docker Compose, staging and production on the one box; revised 2026-08-13 from a DigitalOcean Droplet that was never provisioned (`docs/architecture.md` §14) | M1 | Any deployment | unassigned |
| 6.2 | **Google Cloud project + billing account** (card on file) | M1 ✓ | 6.3, 6.4, 6.19 | unassigned |
| 6.3 | **Geocoding API enabled + key**, restricted to the server | M1 ✓ | Address→ward lookup | unassigned |
| 6.4 | **Google Maps Platform terms review** — **resolved 2026-08-14**, see below | — | Was: whether the geocoding architecture was licensed at all. Now: nothing — closed | resolved |
| 6.5 | **Geocoding budget + quota alerts** — outside the app's own spend cap | M1 | A surprise invoice — and, since the pincode fallback was removed (§4.2a), exhausting the cap now also takes typed-address lookup down outright, not just the bill up | unassigned |
| 6.6 | **Anthropic API key + billing** — or OpenRouter; reconcile which | M1, M9 | Kannada auto-translation (fully automatic); affidavit field extraction | unassigned |
| 6.7 | **CDN account** — added in front of the VM post-launch for extra headroom; launch itself runs on the nginx micro-cache on the VM (`docs/architecture.md` §5) | — | Nothing at launch; election-day headroom | unassigned |
| 6.8 | **DNS for `bengaluruvotes.opencity.in`** — delegated under Oorvani's `opencity.in` | M1 ✓ | Everything public | unassigned |
| 6.9 | **Off-box backup storage** — **UNRESOLVED as of 2026-08-13.** Was a DO Spaces bucket in BLR1; the move to Hostinger left it with no home. Requirements on the replacement are unchanged: India-resident, S3-compatible, encrypted at rest via restic (the dump holds DPDP-regulated personal data), plus a rehearsed restore. **Until this lands the platform has no off-box backup and the 24-hour RPO is unbounded.** | M3 | Launch — this is a blocker, not a nice-to-have | unassigned |
| 6.10 | **Secrets custody** — who holds the API keys, session signing key, Twilio credentials, and the GCS service-account credential | M1 | Deployment; continuity | unassigned |
| 6.11 | **Total running budget** — 6.1–6.7 and 6.19, plus messaging (§3.9) | M3, M13 | Whether any of this is affordable | unassigned |
| 6.12 | **Google Analytics property** — created, access shared, and the tracker disclosed in `/privacy` before it ships | M1 ✓ | The 300,000-unique-visitor target and funnel measurement | unassigned |
| 6.13 | **reCAPTCHA v3 keys** — site key + secret for the anonymous EOI form (`docs/architecture.md` §7); disclosed in `/privacy` alongside GA | M2 | `/partner-with-us` | unassigned |
| 6.14 | **Monitoring accounts** — **partially unresolved as of 2026-08-13.** DigitalOcean Uptime (external liveness + the SSL-expiry alert) went away with the provider move and has no replacement: a silently failed certbot renewal now surfaces as an outage rather than a warning. Still wanted: a Sentry project (free tier, server-side only) and a healthchecks.io check for the backup dead-man's-switch (`docs/architecture.md` §10) | M3 | Knowing the site is down; budget alarms landing somewhere; backup failure being loud | unassigned |
| 6.16 | **GitHub — repository hosting** — the org/repo holding the code, which the box clones and builds from (`docs/architecture.md` §14.3) | M1 ✓ | Any deployment — the box builds from a checkout of this repo | unassigned |
| 6.17 | **`GOOGLE_MAPS_BROWSER_KEY`** — referrer-restricted browser key(s) for the ward-boundary map, one per environment (Keys B/C, `docs/gcp.md` §3) | M1 ✓ | Ward map rendering (`deploy/runbook.md` "Required environment variables") | unassigned |
| 6.18 | **`GOOGLE_MAPS_MAP_ID`** — cloud-managed map style (`docs/gcp.md` §4) | M1 ✓ | Styled basemap; unset renders an unstyled one, per `deploy/runbook.md` | unassigned |
| 6.19 | **Google Cloud Storage bucket for affidavit PDFs** — **new 2026-08-15.** `asia-south1` (Mumbai), uniform bucket-level access, public read, object versioning on, a lifecycle policy, and a service-account credential for the app. See below | M9 | The affidavit pipeline; the affidavit link on every report card | unassigned |

**6.15 was deleted on 2026-08-15.** It provisioned a Google Programmable Search Engine and Custom Search JSON API key for **candidate news-link suggestions** — a feature dropped from the plan on the same date. Nothing in the codebase or the milestones needs it, `docs/gcp.md`'s Custom Search section is dead alongside it, and the row is removed rather than left looking like outstanding work. The number is retired, not reused.

**6.19 is a new metered service and a change of architecture.** The sheet's M9 always said "google cloud storage" while `docs/architecture.md` stored all media as `bytea` in Postgres; the contradiction was resolved on 2026-08-15 in favour of GCS, and `architecture.md` §6 now records what that commits to. What this register cares about is the account work it creates: a bucket in the right region, a service-account credential to add to secrets custody (6.10), a lifecycle policy that must never delete an object a live `candidate_affidavits` row points at, and **a cost line nobody has quoted.** Storage at rest is trivial — a few GB. **Egress is not bounded the way the other services are**: affidavits are publicly readable and every citizen opening one is billed traffic, which is precisely the behaviour the platform exists to encourage. It belongs in 6.11's total and is not in it.

Note also what 6.19 does *not* do: it makes the nightly database dump smaller, not safer. **6.9 is still unresolved**, and affidavits surviving in a bucket while the database that indexes them has no off-box copy is not a backup story.

**6.4 is closed as of 2026-08-14.** Google Maps Platform's terms restrict using Google Maps content — **geocoding results included** — in an application that displays a **non-Google map**. The decision this row tracked was *Google geocodes, MapLibre renders*, precisely the pattern that restriction targets. The `google-maps-migration` branch (`f772103`–`cf5e792`) replaced the MapLibre island with the Google Maps JavaScript API for the ward-boundary map, so the question is **resolved rather than merely complied with**: there is no non-Google map left for Google-sourced geocoding to be incompatible with.

Kept here for the record, now that it is moot rather than load-bearing: geocoding ran server-side and returned **a ward, not a position**; coordinates were never cached for display; and the two things actually drawn on the map — ward boundaries and booth pins — come from official delimitation (`data/gba.geojson`) and EC data rather than from Google. Nothing Google-derived reached the browser. The ward-lookup cache (`docs/architecture.md` §13) keeps to the same line: it stores **normalized address → ward ID** — the platform's own derived conclusion — never Google's coordinates or response content.

**`src/lib/geocode.ts`'s no-coordinates rule is kept anyway, on privacy grounds — it was never only a licensing defense.** `geocode_cache` stores normalized address → ward ID and has never held a citizen's location, which is a DPDP-relevant property independent of Google's terms. §6.4 no longer compels the rule, but removing it would be a separate decision with its own privacy argument, not a cleanup this migration performs.

**Rendering is Google now, and it brings its own metering — a key reaches the browser for the first time** (`GOOGLE_MAPS_BROWSER_KEY`, 6.17; `GOOGLE_MAPS_MAP_ID`, 6.18; provisioning in `docs/gcp.md`). **Places Autocomplete on the ward lookup shipped 2026-08-14** (`google.maps.places.PlaceAutocompleteElement`, `src/islands/WardLookup.ts`): the legacy `google.maps.places.Autocomplete` widget has been unavailable to new customers since 2025-03-01, and legacy Places services are unavailable in new Cloud projects — which this migration creates (`docs/gcp.md` §1) — so `PlaceAutocompleteElement` was the only viable option. `docs/gcp.md` §2's choice of **Places API (New)** was correct all along, and that provisioning now has a second incurred cost sitting on it: **Places metering is actually incurred, not merely anticipated** — every keystroke in the ward-lookup box that returns a prediction is a billed call, on top of the geocoding and Maps JS load metering this row already tracked.

**6.11 is the gap.** Seven metered services — geocoding, Maps JS map loads, Places Autocomplete, Anthropic, **Cloud Storage egress (§6.19, new)**, CDN, and Twilio messaging — plus hosting, and the largest scale directly with success: more citizens means more sends, more geocodes, more map loads, more autocomplete keystrokes, and more affidavits opened. Geocoding spend is capped by design (§6.5); a client-side kill switch (`MAPS_ENABLED`, `deploy/runbook.md`) gates both the map and the autocomplete input, so it sheds both spend lines together without a rebuild; nothing caps the rest, and no total has been put on paper. This connects to the funding disclosure commitment — you cannot publish who pays for the platform without knowing what it costs.

**6.9 deserves its own line.** "An unrehearsed backup is not a backup" is a task with a date, not a principle. As of 2026-08-13 there is no backup to rehearse, which is strictly worse than an unrehearsed one. It is the kind of thing that is genuinely fine until the one day it is not, which for this project is a day that cannot be rescheduled.

**6.16 is free but not incidental.** Repository hosting carries no bill, but the box builds what it runs from a clone of this repo (`docs/architecture.md` §14.3), so whatever is on the deployed ref is what ships. The dependency is the account and its access control, not money.

*Revised 2026-08-13.* This row previously also covered GitHub Actions and GHCR, and CI was the *only* path onto the box — the deploy key lived in an Environment secret that fired on every push to `main`, putting the GitHub account squarely inside the production trust boundary. CI has been removed (`docs/architecture.md` §14.4) and deploys are manual, which narrows this dependency to source hosting and moves the deploy key into ordinary human custody (§6.10). Note the trade: nothing automated now tests or gates what reaches production.

---

## 7. Decisions blocking work

Not external dependencies, but non-code, unowned, and blocking. Listed so they are not mistaken for engineering tasks waiting on engineering.

The 2026-07-19 review resolved most of this table: future-use consent is a yes (= 2.6), funding disclosure names each funder, the press push goes at N with a second beat two weeks before the poll, and the legal pages ship EN-controlling with a Kannada courtesy translation. Rows 7.2 and 7.3 were closed by that review and their numbers are retired rather than reused. What remains:

| # | Decision | Milestone | Blocks | Owner |
|---|---|---|---|---|
| 7.1 | Retention period — legal confirmation of the 3-months-post-results proposal (= 2.1, repeated because it blocks the most) | M3, M4b, M10 | Path A | unassigned |
| 7.4 | **Owned channels** — are Open City and Citizen Matters available for launch distribution? | M2, M3 | Launch distribution planning | unassigned |

**7.4 may be the highest-leverage open question in the project.** The go-to-market plan is written against a cold start: no list, no paid spend, everything earned through partners. If Oorvani's existing properties carry a Bengaluru civic readership, that assumption is wrong in the project's favour, and launch distribution should be planned differently. It costs one conversation to find out, and it matters more now that reach carries the programme alone — with M10 behind M3, the seven-send comms calendar is contingent rather than planned (`docs/overview.md` §11).

---

## 8. How to use this document

Three things make it useful rather than decorative:

1. **Name an owner for every row.** The single highest-value edit anyone can make to this file. Every row currently says *unassigned*, which means every row is currently nobody's problem.
2. **Start Paths A, B and C now**, in parallel. They do not queue behind each other and they do not queue behind the code.
3. **Resolve §3.9, §6.11 and §6.19 before committing to M13.** They are the three places where a number nobody has written down could change the plan rather than just the invoice.

Related: `docs/milestones.md` (the plan of work, and what each milestone waits on), `docs/overview.md` §9 (the stakeholder-facing subset of this list), `docs/ksec-data-risk.md` (the analysis behind §4.6), `docs/election-timelines.md` (what the calendar allows).

*The production architecture is recorded in `docs/architecture.md`. The stack decisions this register relies on — Twilio/SendGrid as the single messaging vendor, Google geocoding with Google Maps JS rendering (migrated from MapLibre 2026-08-13, §6.4), Google Cloud Storage for affidavit PDFs (2026-08-15, §6.19), machine-translated Kannada with **no** human review, and single-VM Compose hosting with an nginx micro-cache (CDN optional, post-launch) — are stated inline above, where they matter.*
