# Project Dependencies

**Date:** 2026-07-16
**Status:** Living document
**Scope:** Everything this project needs that **cannot be produced by writing code in this repository** — legal work, external account approvals, official data, people, money, and decisions. If a task can be closed by a pull request, it does not belong here.

This document exists because the binding constraints on this project are almost all outside the codebase. The application could be finished and the platform still could not launch: not without a published privacy policy, not without curators, not without the candidate data the returning officers release on their own timeline. (Ward boundaries — long the emblem of this list — have since landed in the repo; see Path B and §4.1.)

Owners are listed as **unassigned** where nobody has been named. That is the honest state and the first thing to fix — an unowned dependency is not being worked on, whatever its due date says.

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

**Path B — Ward delimitation data. ✓ Resolved.** The teaser *is* the ward finder (GTM spec §2), and the post-delimitation boundaries have landed: **`data/gba.geojson`** holds all **369 wards** as polygons plus their metadata — ward names (EN / KN), corporation / zone, assembly constituency, population, and RO codes. Address lookup and every ward-scoped page are built against real data. `data/gba.geojson` is the **authoritative final delimitation** (confirmed 2026-07-20) — no reconciliation against a later official release is pending. **The pincode hedge this path used to carry is gone, 2026-08-14:** the pincode → ward lookup (§4.2a below) was removed from the codebase — its postal-boundary table never advanced past a 12-row placeholder, so it was deleted rather than shipped as a fallback that could not actually work. Google geocoding is now the **only** path from an address to a ward: no fallback, no browsable ward list. An exhausted geocode budget or a Google outage takes ward lookup down outright rather than degrading it — a trade made knowingly (`docs/architecture.md` §11). The project's single largest technical risk — the boundaries themselves — has retired; the geocode-availability risk this leaves in its place is tracked at §6.4/§6.5, not hedged against.

**Path C — People.** Curators gate ward data readiness, which gates candidate comms (PRD §9.1). Partners gate reach. Both are recruited in the same conversations (GTM spec §2), and both are slower than they look because vetting is a judgement, not a form.

---

## 2. Legal & compliance

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| 2.1 | **Retention period — legal confirmation.** The product proposal is decided (PRD §17, 2026-07-19): contact data deleted or anonymized within 3 months of results being declared. Counsel confirms or amends it | `/privacy`, therefore all of Path A | unassigned |
| 2.2 | **Legal counsel engaged** — to draft `/terms` and `/privacy` | Path A | unassigned |
| 2.3 | **DPDP Act 2023 compliance review** — consent notice, purpose limitation, data-principal rights incl. erasure mechanics (`docs/architecture.md` §7), children's-data position (the 18+ assertion at registration, PRD §10), cross-border transfer position (`docs/architecture.md` §13) | `/privacy` | unassigned |
| 2.4 | **Named grievance officer** — a real person, contactable, published | `/privacy` (DPDP requirement) | unassigned |
| 2.5 | **Contribution licensing** — terms under which citizen flags and issue votes are used | `/terms` | unassigned |
| 2.6 | **Future-use consent — decided** (PRD §14, 2026-07-19): registration carries the optional "tell me about future civic tools" checkbox. Remaining work is the checkbox wording, part of the legal-review input (PRD §10) | The next phase's list | unassigned |
| 2.7 | **Oorvani Foundation entity details** — trust registration, signing authority, registered address for legal pages and Meta verification | `/privacy`, `/about`, Meta verification | unassigned |
| 2.8 | **Data-processing terms with every processor** — Twilio/SendGrid DPAs, Google Cloud terms (Geocoding), Anthropic commercial terms, Sentry DPA; the contractual cover behind the `/privacy` processor inventory (PRD §5.16) and the cross-border position (`docs/architecture.md` §13) | `/privacy` accuracy; the amended "shares only with service providers under contract" commitment | unassigned |
| 2.9 | **DPDP breach-notification readiness** — Data Protection Board notification procedure, bilingual affected-user notice template, decision timeline, named owner (`docs/architecture.md` §13) | Launch responsibly; the Act has no materiality threshold | unassigned |

**2.1 is the first domino.** It is a trust decision before it is a legal one, and it is currently unowned.

**On 2.5:** the platform publishes aggregated issue votes as public data and shows citizen flags to curators. Both need a licence citizens actually granted.

**Not a dependency, deliberately:** a legal opinion on RPA §126 (the election silence period). The GTM plan resolves this by going dark from E−3d rather than by testing the boundary (GTM spec §4), which converts a legal question into a scheduling decision. If anyone later proposes a send inside the final 48 hours, this becomes a dependency again.

---

## 3. Messaging & delivery

Both channels go through **Twilio** — SendGrid is a Twilio product, so email and WhatsApp are one vendor, one bill, one support relationship. This is a decided stack choice.

### 3a. WhatsApp, via Twilio

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| 3.1 | **Meta Business Manager account + business verification** — Oorvani trust documents, registered address | WhatsApp entirely | unassigned |
| 3.2 | **Published `/privacy` URL** | 3.1 — Meta will not verify without it | unassigned |
| 3.3 | **Twilio account** + India billing setup | 3.4 onward | unassigned |
| 3.4 | **Sender number (+91)** — see the walkthrough below | Any WhatsApp send | unassigned |
| 3.5 | **WhatsApp sender registration** in Twilio, linked to the Meta business | 3.6 | unassigned |
| 3.6 | **Display name approval** — the name citizens see, reviewed by Meta | Sending | unassigned |
| 3.7 | **16 templates** submitted via Twilio, approved by Meta — 7 sends + the OTP login message, × EN/KN | The comms calendar; WhatsApp OTP login | unassigned |
| 3.8 | **Template category classification** — Meta's Marketing / Utility / Authentication split | 3.7, and the budget in 3.9 | unassigned |
| 3.9 | **Message budget** — Meta's per-message fee **plus Twilio's markup** | Whether the plan is affordable | unassigned |
| 3.10 | **Recorded opt-in evidence** — captured at registration (IA §7.1): the wording version shown + timestamp, stored, not implied | Policy compliance | unassigned |

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

At the Phase 1 target of 25,000 citizens × 7 sends ≈ **175,000 messages**, billed at Meta's India rate **plus Twilio's markup** (roughly 30–50% on top). On top of that, WhatsApp OTP logins (PRD §10) are metered per attempt at the Authentication rate — that line scales with *sessions*, not with the calendar, and is unbounded by the seven-send budget. It scales linearly with the success of the registration drive — hitting the target makes the bill bigger, not smaller. Get real quotes rather than estimates: Meta moved from conversation-based to per-message pricing during 2025, so any rate figure repeated from memory is suspect. If the number is bad, the channel mix is the lever — email has no per-message fee.

### 3b. Email, via SendGrid

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| 3.11 | **Twilio SendGrid account** + a plan sized for ~175k sends | Email at all | unassigned |
| 3.12 | **Domain authentication** — SPF, DKIM, DMARC on the sending domain | Deliverability; not landing in spam | unassigned |
| 3.13 | **Sender identity verification** | Sending | unassigned |
| 3.14 | **Sender reputation warm-up** — volume ramped, not dumped | The first real send actually arriving | unassigned |
| 3.15 | **Bounce and complaint handling** — webhooks wired to suppression | List health; reputation | unassigned |
| 3.16 | **Unsubscribe mechanism** — one-click, honoured | DPDP consent withdrawal (§2.3) | unassigned |

**Email is the baseline, not the fallback.** It is what works while Path A sits in Meta's queue, and it carries no per-message fee. It deserves to be set up first and properly rather than treated as the consolation prize — 3.12 and 3.14 in particular, because a cold domain sending 25,000 messages on day one is how a campaign discovers spam filters.

---

## 4. Official data sources

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| 4.1 | ✓ **Post-delimitation GBA ward boundaries** — **in repo: `data/gba.geojson`, 369 wards** as polygons; confirmed the authoritative final delimitation (2026-07-20) | Path B — Phase 1 (now unblocked) | ✓ committed |
| 4.2 | ✓ **Ward metadata** — names (EN / KN), numbers, corporation / zone, assembly constituency, population, RO codes — **all carried in `data/gba.geojson`** | Ward pages | ✓ committed |
| 4.2a | ~~Pincode → ward postal-boundary data~~ — **moot, 2026-08-14.** The pincode lookup this would have fed (PRD §5.1's fallback) was removed from the codebase — its table never advanced past a 12-row placeholder, so it was deleted rather than finished. Nothing in the app needs postal-boundary data any more | Nothing — closed | resolved |
| 4.3 | **EC notification** — official date and schedule | Anchor **N**; the whole calendar | unassigned |
| 4.4 | **Electoral roll deadline date** | R1, the highest-value send | unassigned |
| 4.5 | **Candidate nomination list** — from EC / returning officers, provisional then final | Phase 2, and C2 at E−2w | unassigned |
| 4.6 | **Candidate affidavits** (Form 26) — cases, assets, education | Report cards; the ward-readiness check (PRD §9.1) | unassigned |
| 4.7 | **Polling booth data** — address-accurate, with locations | `/voting-guide/find-booth`; the F1 send | unassigned |
| 4.8 | **Registration-check link target** — the correct official EC / CEO Karnataka roll-lookup URL for GBA, verified, and monitored for changes (it is a guided link-out, not an integration — PRD §5.6) | `/check-registration` | unassigned |

**4.1 was the single largest technical risk in the project — now retired.** The post-delimitation boundaries and ward metadata are committed at `data/gba.geojson` (369 wards). Geocoding quality was already a solved problem (Google geocoding, decided — §6.3); with the boundaries in hand, address→ward lookup and every ward-scoped page are buildable today. **The pincode fallback this section used to describe is gone, 2026-08-14** (§4.2a): it was removed from the codebase rather than finished, because its postal-boundary table never advanced past a 12-row placeholder — telling citizens to "try your pincode" pointed them at something that could not work. Geocoding is now the **only** path from an address to a ward, with no fallback and no browsable ward list (`docs/architecture.md` §11); exhausting the geocode budget or a Google outage takes ward lookup down rather than degrading it, a trade made knowingly. `data/gba.geojson` is confirmed the authoritative final delimitation (2026-07-20), so nothing on this path waits on a later official release.

**4.3 and 4.4 move independently.** The roll deadline is not derived from the election date and must be tracked separately — R1 is anchored to it, and R1 is the one message whose failure cannot be undone (GTM spec §4).

**4.6 has a shape problem worth knowing early.** Affidavits arrive as scanned PDFs, per candidate, on a returning officer's timeline. Across 369 wards that was heading for a transcription operation with a deadline, not a data feed. The PRD now routes it through AI extraction (§5.2): the curator uploads the PDF (or its EC link), the Anthropic API (§6.6) extracts the fields, and they publish immediately marked *AI-extracted*. Curator capacity (§5.1) shifts from transcription to upload and spot-check — but the returning-officer timeline and per-candidate chase remain, and scanned-image quality is now an extraction-accuracy risk as well as a reading one.

---

## 5. People & organisation

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| 5.1 | **Curator recruitment & vetting** — enough, with ward coverage across 369 | Ward readiness → all candidate comms | unassigned |
| 5.2 | **Partner recruitment** — RWAs, civic organisations | Reach; the Phase 1 target | unassigned |
| 5.3 | **A named outreach owner** — one person owning 5.1 and 5.2 as one motion | Both of the above | unassigned |
| 5.4 | **Curator onboarding material** — what the standard is, what a source is, how to sign off | Data quality; the sign-off being real | unassigned |
| 5.5 | **Named spokespeople** with approved quotes | `/press` | unassigned |
| 5.6 | **Moderation capacity** — someone works the flag queue near the election | The correction loop (PRD §6) | unassigned |

**5.3 is the cheapest item here and the one most likely to sink the plan.** Curator and partner recruitment are the same conversations with the same people (GTM spec §2). Split across two owners, the relationship gets asked twice and gives once. Unowned, it happens in whatever time is left over, which near an election is none.

**Kannada is machine-generated with no human review — a decided trade (PRD §8).** The stack translates curator content via the Anthropic API (§6.6) and publishes it directly; the citizen flag flow is the correction path. The same trade now covers **affidavit extraction** (PRD §5.2): AI-extracted fields publish without prior review, marked *AI-extracted* until the curator confirms them. The residual risk is owned rather than mitigated: a bad machine translation — or a misread affidavit entry — on a candidate's criminal record would be ours, published at scale. That makes moderation capacity (5.6) and curator spot-checking matter more, since flags and the curator's confirm pass are the only nets under this.

**Curator scope is uncapped — a second owned risk of the same shape (PRD §14).** How many wards a curator holds is an admin judgement; a zone assignment can already mean ~74 wards, and nothing technical prevents more. Combined with publish-immediately trust and OTP-only login, a curator's scope is their unreviewed blast radius — one compromised login away from broad edits to candidate records mid-election. Vetting (5.1), the audit log, and rollback are the nets. What uncapped scope buys: coverage can follow curator supply rather than an arbitrary ceiling, in a project where covering 369 wards is the binding constraint.

---

## 6. Commercial accounts & infrastructure

| # | Dependency | Blocks | Owner |
|---|---|---|---|
| 6.1 | **Cloud hosting account + billing** — decided: a Hostinger VPS in Mumbai (4 vCPU / 16 GB) running Docker Compose, staging and production on the one box; revised 2026-08-13 from a DigitalOcean Droplet that was never provisioned (`docs/architecture.md` §14) | Any deployment | unassigned |
| 6.2 | **Google Cloud project + billing account** (card on file) | 6.3, 6.4 | unassigned |
| 6.3 | **Geocoding API enabled + key**, restricted to the server | Address→ward lookup | unassigned |
| 6.4 | **Google Maps Platform terms review** — **resolved 2026-08-14**, see below | Was: whether the geocoding architecture was licensed at all. Now: nothing — closed | resolved |
| 6.5 | **Geocoding budget + quota alerts** — outside the app's own spend cap | A surprise invoice — and, since the pincode fallback was removed 2026-08-14 (§4.2a), exhausting the cap or a quota problem now also takes ward lookup down outright, not just the bill up | unassigned |
| 6.6 | **Anthropic API key + billing** | Kannada auto-translation (fully automatic — PRD §8); affidavit field extraction (PRD §5.2) | unassigned |
| 6.7 | **CDN account** — added in front of the VM post-launch for extra headroom; launch itself runs on the nginx micro-cache on the VM (`docs/architecture.md` §5) | Nothing at launch; election-day headroom | unassigned |
| 6.8 | **DNS for `bengaluruvotes.opencity.in`** — delegated under Oorvani's `opencity.in` | Everything public | unassigned |
| 6.9 | **Off-box backup storage** — **UNRESOLVED as of 2026-08-13.** Was a DO Spaces bucket in BLR1; the move to Hostinger (`docs/architecture.md` §14) left it with no home. Requirements on the replacement are unchanged: India-resident, S3-compatible, encrypted at rest via restic (the dump holds DPDP-regulated personal data; §10), plus a rehearsed restore. **Until this lands the platform has no off-box backup and the 24-hour RPO is unbounded.** | Launch — this is a blocker, not a nice-to-have | unassigned |
| 6.10 | **Secrets custody** — who holds the API keys, session signing key, Twilio credentials | Deployment; continuity | unassigned |
| 6.11 | **Total running budget** — 6.1–6.7 plus messaging (§3.9) | Whether any of this is affordable | unassigned |
| 6.12 | **Google Analytics property** — created, access shared, and the tracker disclosed in `/privacy` before it ships | The 300,000-unique-visitor target and funnel/attribution measurement (GTM §8) | unassigned |
| 6.13 | **reCAPTCHA v3 keys** — site key + secret for the anonymous EOI form (`docs/architecture.md` §7); disclosed in `/privacy` alongside GA | `/partner-with-us` | unassigned |
| 6.14 | **Monitoring accounts** — **partially unresolved as of 2026-08-13.** DigitalOcean Uptime (external liveness + the SSL-expiry alert) went away with the provider move and has no replacement: a silently failed certbot renewal now surfaces as an outage rather than a warning. Still wanted: a Sentry project (free tier, server-side only) and a healthchecks.io check for the backup dead-man's-switch (`docs/architecture.md` §10) | Knowing the site is down; budget alarms landing somewhere; backup failure being loud | unassigned |
| 6.15 | **Google Programmable Search Engine + Custom Search JSON API key** — for candidate news-link suggestions (PRD §5.2; `docs/architecture.md` §7), configured against the repo's news-domain allowlist, with a daily query budget + alert | News-link suggestions only — degrades gracefully to curator-added links | unassigned |
| 6.16 | **GitHub — repository hosting** — the org/repo holding the code, which the box clones and builds from (`docs/architecture.md` §14.3) | Any deployment — the box builds from a checkout of this repo | unassigned |
| 6.17 | **`GOOGLE_MAPS_BROWSER_KEY`** — referrer-restricted browser key(s) for the ward-boundary map, one per environment (Keys B/C, `docs/gcp.md` §3) | Ward map rendering (`deploy/runbook.md` "Required environment variables") | unassigned |
| 6.18 | **`GOOGLE_MAPS_MAP_ID`** — cloud-managed map style (`docs/gcp.md` §4) | Styled basemap; unset renders an unstyled one, per `deploy/runbook.md` | unassigned |

**6.4 is closed as of 2026-08-14.** Google Maps Platform's terms restrict using Google Maps content — **geocoding results included** — in an application that displays a **non-Google map**. The decision this row tracked was *Google geocodes, MapLibre renders*, precisely the pattern that restriction targets. The `google-maps-migration` branch (`f772103`–`cf5e792`) replaced the MapLibre island with the Google Maps JavaScript API for the ward-boundary map, so the question is **resolved rather than merely complied with**: there is no non-Google map left for Google-sourced geocoding to be incompatible with.

Kept here for the record, now that it is moot rather than load-bearing: geocoding ran server-side and returned **a ward, not a position**; coordinates were never cached for display; and the two things actually drawn on the map — ward boundaries and booth pins — come from official delimitation (`data/gba.geojson`) and EC data rather than from Google. Nothing Google-derived reached the browser. The ward-lookup cache (`docs/architecture.md` §13) keeps to the same line: it stores **normalized address → ward ID** — the platform's own derived conclusion — never Google's coordinates or response content.

**`src/lib/geocode.ts`'s no-coordinates rule is kept anyway, on privacy grounds — it was never only a licensing defense.** `geocode_cache` stores normalized address → ward ID and has never held a citizen's location, which is a DPDP-relevant property independent of Google's terms. §6.4 no longer compels the rule, but removing it would be a separate decision with its own privacy argument, not a cleanup this migration performs.

**Rendering is Google now, and it brings its own metering — a key reaches the browser for the first time** (`GOOGLE_MAPS_BROWSER_KEY`, 6.17; `GOOGLE_MAPS_MAP_ID`, 6.18; provisioning in `docs/gcp.md`). **Places Autocomplete on the ward lookup shipped 2026-08-14** (`google.maps.places.PlaceAutocompleteElement`, `src/islands/WardLookup.ts`): the legacy `google.maps.places.Autocomplete` widget has been unavailable to new customers since 2025-03-01, and legacy Places services are unavailable in new Cloud projects — which this migration creates (`docs/gcp.md` §1) — so `PlaceAutocompleteElement` was the only viable option. `docs/gcp.md` §2's choice of **Places API (New)** was correct all along, and that provisioning now has a second incurred cost sitting on it: **Places metering is actually incurred, not merely anticipated** — every keystroke in the ward-lookup box that returns a prediction is a billed call, on top of the geocoding and Maps JS load metering this row already tracked.

**6.11 is the gap.** Seven metered services now — geocoding, Maps JS map loads, Places Autocomplete (shipped 2026-08-14, above), Anthropic, news search (§6.15, the smallest and bounded by design), CDN, and Twilio messaging — plus hosting, and the largest scale directly with success: more citizens means more sends, more geocodes, more map loads, and more autocomplete keystrokes. Geocoding spend is capped by design (§6.5); a client-side kill switch (`MAPS_ENABLED`, `deploy/runbook.md`) gates both the map and the autocomplete input (`Home.astro`'s `data-maps-key`), so it sheds both spend lines together without a rebuild; nothing caps the rest, and no total has been put on paper. This connects to the funding disclosure question (§7.3) — you cannot publish who pays for the platform without knowing what it costs.

**6.9 deserves its own line.** "An unrehearsed backup is not a backup" is a task with a date, not a principle. As of 2026-08-13 there is no backup to rehearse, which is strictly worse than an unrehearsed one. It is the kind of thing that is genuinely fine until the one day it is not, which for this project is a day that cannot be rescheduled.

**6.16 is free but not incidental.** Repository hosting carries no bill, but the box builds what it runs from a clone of this repo (`docs/architecture.md` §14.3), so whatever is on the deployed ref is what ships. The dependency is the account and its access control, not money.

*Revised 2026-08-13.* This row previously also covered GitHub Actions and GHCR, and CI was the *only* path onto the box — the deploy key lived in an Environment secret that fired on every push to `main`, putting the GitHub account squarely inside the production trust boundary. CI has been removed (§14.4) and deploys are manual, which narrows this dependency to source hosting and moves the deploy key into ordinary human custody (§6.10). Note the trade: nothing automated now tests or gates what reaches production.

---

## 7. Decisions blocking work

Not external dependencies, but non-code, unowned, and blocking. Listed so they are not mistaken for engineering tasks waiting on engineering. The question text lives in **PRD §17**, the single home for open questions; these rows exist because this register carries owners.

The 2026-07-19 review resolved most of this table (PRD §14): future-use consent is a yes (= 2.6), funding disclosure names each funder, the press push goes at N with an E−2w second beat, and the legal pages ship EN-controlling with a Kannada courtesy translation. What remains:

| # | Decision | Blocks | Owner |
|---|---|---|---|
| 7.1 | Retention period — legal confirmation of the 3-months-post-results proposal (= 2.1, repeated because it blocks the most) | Path A | unassigned |
| 7.4 | **Owned channels** — are Open City and Citizen Matters available for launch distribution? | Phase 0 and 1 planning | unassigned |

**7.4 may be the highest-leverage open question in the project.** The GTM plan is written against a cold start: no list, no paid spend, everything earned through partners. If Oorvani's existing properties carry a Bengaluru civic readership, that assumption is wrong in the project's favour, and Phase 1 should be planned differently. It costs one conversation to find out and it is worth having before Phase 0 hardens.

---

## 8. How to use this document

Three things make it useful rather than decorative:

1. **Name an owner for every row.** The single highest-value edit anyone can make to this file. Every row currently says *unassigned*, which means every row is currently nobody's problem.
2. **Start Paths A, B and C now**, in parallel. They do not queue behind each other and they do not queue behind the code.
3. **Resolve §3.9 and §6.11 before Phase 0 exits.** They are the two places where a number nobody has written down could change the plan rather than just the invoice.

Related: `docs/gtm-plan.md` (§10 dependencies), `docs/prd.md` (§15), `docs/overview.md` (§8).

*The production architecture is recorded in `docs/architecture.md`. The stack decisions this register relies on — Twilio/SendGrid as the single messaging vendor, Google geocoding with Google Maps JS rendering (migrated from MapLibre 2026-08-13, §6.4), machine-translated Kannada with **no** human review (PRD §8; an earlier version of this note said otherwise), and single-VM Compose hosting with an nginx micro-cache (CDN optional, post-launch) — are stated inline above, where they matter.*
