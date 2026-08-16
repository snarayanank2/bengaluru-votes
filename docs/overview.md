# GBA Elections Citizen Platform — Stakeholder Overview

**Status:** Living document · **Scope:** Election cycle, from ward discovery through declared results · **Owner:** Product · **Domain:** `bengaluruvotes.opencity.in` · **Date:** 2026-08-16

> A high-level view of the platform, its roles, and what each can do — for stakeholder alignment. The plan of work, with per-milestone detail, is `docs/milestones.md`. This document is self-contained: where it states a decision or a constraint, it states it here rather than pointing elsewhere.

---

## 1. Purpose

Bengaluru is heading into its first ward-level (GBA / corporator) elections in roughly a decade. Citizen interviews showed people are willing to vote but blocked by a few specific gaps: they don't know which ward they now belong to, they can't find trustworthy information about local candidates, and existing sources feel biased or unreliable. These gaps are widest for first-time voters — an unusually large group this election: after a decade without ward polls, nearly everyone under thirty, plus anyone who has moved to Bengaluru since, has never voted for a corporator.

The platform makes trustworthy, ward-level election information easy to find, compare, and act on — and gives citizens a voice in which local issues matter.

**Success for this release** is **300,000 unique visitors**, plus **25,000 registered users** if accounts and messaging ship in time — that half is contingent, and §11 says why.

---

## 2. The risk that governs everything

**The Karnataka State Election Commission does not publish filled candidate affidavits online — for any election, past or upcoming.** There is no KSEC equivalent of the national ECI affidavit portal or MyNeta. No repository, no per-candidate PDFs, no structured candidate list.

Sourced candidate report cards are this platform's central promise. Everything distinctive about it — the comparison view, the extraction pipeline, the transcriber operation, half the launch campaign — exists to turn affidavits into something a citizen can read. **The data behind that promise is not confirmed obtainable.**

The realistic routes, in parallel:

- **An RTI to KSEC**, requesting scanned nomination affidavits and separately requesting proactive publication. Authoritative, but on a 30-day statutory clock, and the likely reply is "inspect at the returning officer's office." **It must be filed before the announcement, not after.**
- **Volunteers at returning-officer offices** during the nomination window, where affidavits are displayed on notice boards and copies are provided on request. Timely and exactly the right granularity — and a manual operation across five corporations inside a window of roughly a week.

Neither is a bulk download, and both need to be set up and rehearsed **before** the election is announced. The nomination window closes and does not reopen until an RTI cycle completes — by which time the election is over.

**Asking candidates to supply their own data is not a third route.** It was considered and dropped: with roughly 4,000 candidates it would reach a self-selecting minority, it would put campaign-supplied claims beside sworn affidavit values on the same report card, and it is candidate outreach tooling — which §10 puts out of scope for this release.

**There is a decision point at the soft launch.** The plan states plainly that if affidavit data cannot be obtained in bulk, the project stops there. That decision is not hypothetical and it is not months away — it is answerable now, by asking KSEC directly. **This is the most valuable single task in the programme and it needs an owner.**

If the answer stays no, the choice is between stopping and running a reduced platform: ward discovery, ward issues, questions to ask candidates, voting logistics and results — real value, and a different product from the one described below. **Choosing that deliberately is far better than discovering it in the nomination week.** §9.2 states what that decision costs; full detail on the data itself is in `docs/ksec-data-risk.md`.

---

## 3. What the platform does

At a high level, the platform lets a citizen:

- Find their **new GBA ward**, by typed address or from their device's location.
- Find their **polling booth**, using their voter ID (EPIC) number.
- See the **key issues** in their ward, the **questions worth asking** any candidate, and **vote on the top 3** issues that matter to them.
- Read neutral, **sourced candidate report cards** — track record, criminal cases, assets, education, party — and compare candidates side by side, with every value marked as either AI-extracted or checked by a person.
- Handle the logistics: **check registration**, **issue or update a voter ID**, and learn **how to vote** — presented as an ordered checklist a first-time voter can follow end to end.
- See their **ward's result** once it is declared.
- **Support the platform**, through a link to the Oorvani Foundation's donation flow.
- Use everything in **English or Kannada**.

A small trusted team keeps the data accurate and governs access behind the scenes.

### 3.1 What a report card shows

Nine fields, each carrying a visible marker for where the value came from and whether a person has checked it. **Only four of the nine are read out of the affidavit**, and that distinction drives the whole transcription operation in §11 — the rest arrive already structured or are maintained by hand.

| Field | Where the value comes from | Read by a transcriber? |
|---|---|---|
| Full name | Nomination list | No |
| Ward | Nomination list | No |
| Party | Nomination list | No |
| Gender | Nomination list | No |
| **Age** | Affidavit | **Yes** |
| **Educational qualifications** | Affidavit | **Yes** |
| **Total value of assets** | Affidavit | **Yes** |
| **Criminal cases** — pending, and convictions | Affidavit | **Yes** |
| The EC affidavit itself | The scanned document, linked | No — it is the source |

Two notes that matter more than they look.

**The nomination-list / affidavit split is an assumption until we see both formats.** If any of name, ward, party or gender turns out to be available only from the affidavit, the number of fields needing a human read rises and §11's arithmetic moves with it.

**The affidavit carries more than we display.** The 2026 KSEC format also has liabilities, PAN and income-tax filing status, social media accounts, and a new declaration of disqualification. We show the four above because they are what a citizen comparing candidates acts on; the full document is linked for anyone who wants the rest.

---

## 4. Roles at a glance

| Role | Who they are | Primary job |
|---|---|---|
| **Anonymous citizen** | Any visitor, no account | Find & read information; see (but not cast) flags and issue votes |
| **Registered citizen** | Signs up with email/WhatsApp + ward + language | Get updates; flag candidate misinformation; vote on ward issues |
| **Transcriber** | Hired readers, Kannada-literate; no ward of their own | Check the AI-extracted fields on one candidate affidavit at a time |
| **Data curator** | Trusted, vetted individuals, city-wide | Work the flag queue; correct any candidate field |
| **Admin** | Small internal team | Manage roles, access, users, and oversight |

**One guiding principle:** the two citizen contributions — flagging an error and voting on issues — are **visible to everyone but require registration at the moment of submitting**. Anonymous users see the buttons; tapping one opens a quick sign-up popup, then the action continues.

---

## 5. Roles & key functionalities

### 5.1 Anonymous citizen
*Any visitor, no account — the vast majority of traffic. No login wall; pages are shareable so RWAs and community groups can forward them.*

- Search and browse all published information: find their ward, view candidate report cards, compare candidates, read ward issues, look up their booth.
- Access voting logistics: check registration/eligibility, and read how-to-vote and voter-ID guidance.
- See public issue-vote results for any ward, and see the flag and vote buttons — tapping either prompts them to register.
- On any page for their ward, see a **"Register for updates"** prompt — tapping it opens the same sign-up popup, with that ward carried through as their home ward once they complete it.
- Can donate
- **Out of scope:** no subscriptions, no submitting, no editing. Fully read-only.

### 5.2 Registered citizen
*Signs up with email and/or WhatsApp, their ward, and a language preference. Everything the anonymous user can do, plus:*

- Receive **ward-scoped updates** (election dates and notices, the roll deadline, candidate milestones, booth logistics) by email / WhatsApp, in their preferred language.
- **Flag misinformation** on any ward or candidate — across **any ward**, via a popup.
- **Vote on their top 3 issues**, but only in their **registered home ward**.
- **See what happened to what they submitted** — each flag shown as pending, accepted or rejected, with the curator's reason. Already built, at `/account/submissions`.
- Set a **saved language preference** that also governs the language of their updates.

### 5.3 Transcriber
*A hired reader who checks affidavits. The role exists because the numbers demand it: roughly 4,000 candidates, each with a scanned, notarised, often handwritten Kannada affidavit, all arriving in the days between nominations closing and the poll.*

- **Paid work, not volunteering — five people at the floor, thirty-three for full coverage**, sized in §11 against the candidate count, the three-day window, and how much of the extraction the AI settles on its own. The whole engagement costs between **₹10,000 and ₹66,000**.
- Is handed **one affidavit at a time from a prioritized, city-wide queue** — missing values first, low-confidence values next — and cannot choose the ward, the party, or the candidate.
- Sees the AI-extracted fields beside the affidavit and either **confirms each value or corrects it**.
- **What a transcriber saves goes live immediately.** The report card updates on the spot, and the value's marker changes from AI-extracted to checked by a person. There is no second reading and no approval step — transcribers are invited and vetted, and are trusted on the same basis curators are.
- **Out of scope:** no ward ownership, no editing anything but an affidavit currently assigned to them, no say in what they are given next.

*Why a transcriber cannot choose:* someone who can pick their affidavit can pick their ward, and a reader drawn to the ward or the party they care about is the one reading least neutrally. Removing the choice is what keeps the operation even across 369 wards instead of concentrated where the readers happen to live — and it is what lets the queue hand out the most urgent work first rather than the most interesting.

### 5.4 Data curator
*A trusted, vetted individual responsible for data accuracy. Because curators are trusted, their edits go live immediately — no second approval.*

- Small team of 4, **working city-wide**, paid **₹5,000 each** for the cycle. With four people and 369 wards, assigning wards to curators would be a label rather than a division of work, so there is no ward scope: any curator can act anywhere.
- Review the queue of citizen flags, and accept them (making the correction) or reject them (with a reason the submitter can see).
- **Correct any candidate field, flagged or not.** With one transcriber per affidavit and no second reading, this is the main net under the data — a curator does not need a flag as an excuse to fix something wrong.
- **See how each transcriber is doing** — accuracy against corrected values, volume, time per affidavit — so a poor reader can be found and removed. On a three-day paid engagement, removal is the sanction that exists; there is no time to train anyone up mid-window.

### 5.5 Admin

*A small internal team that governs people and access rather than day-to-day content.*

- Team of 2
- Manage roles and access: invite and vet **transcribers and curators**, and grant or revoke roles.
- **Add and block users**, including deactivating or banning abusive accounts — blocking ends live sessions, not just future logins.
- **Create and revoke staff accounts.** A curator or transcriber gets an account with their email against it; they sign in from `/login` by requesting a code, like anyone else. Revoking ends live sessions, not just future logins.
**There is no audit log and no rollback** (removed 2026-08-15). Admins govern people and access; they cannot see who changed a value, or put a previous value back. A wrong entry is corrected by publishing over it.

**This is worth stating plainly to stakeholders, because it is the platform's largest accepted risk.** One transcriber reads each affidavit, their save goes live immediately, and any of four curators can change any field on any candidate in any ward. Nothing records who did it and nothing can reverse it. If a candidate disputes what we published about their criminal record, **we cannot say who entered it, when, or what it replaced.** The remaining protections are forward-only: curators correct, citizens flag, and a transcriber whose readings are frequently overturned can still be identified and removed.

---

## 6. How citizen contributions become live data

The correction loop connects citizens and curators. Both flagging and voting happen through **popups** that overlay the current page, so citizens never lose their place.

1. **Notice an error / want to vote** — anyone can tap Flag or Vote. Anonymous users see a sign-up popup first; registered users proceed.
2. **Submit** — a flag joins the single city-wide curator queue; an issue vote is recorded for the user's home ward.
3. **Review** — the curator sees the flagged field along with the comment, and either makes the fix or rejects the flag with a reason.
4. **Record** — the change is published immediately, and the outcome appears on the submitter's own submissions page. A citizen who reports an error finds out what came of it.

---

## 7. Language & access highlights

- **Bilingual by default** — the whole platform works in **English and Kannada**; each language has its own shareable URL (Kannada under `/kn/`), with a toggle available to everyone and a saved preference for registered users.
- **One simple login for everyone** — a one-time code, no passwords and no 2FA. Citizens can use email or WhatsApp; **staff always use email**. What differs is how long the session lasts: **24 hours for staff**, so a transcriber signs in once a working day, against a short idle timeout for citizens.
- **No redirects** — registration and flagging are popups, so users stay on the page they were reading.
- **Distinct URLs** — every page has its own shareable link under `bengaluruvotes.opencity.in`.

---

## 8. Locked decisions

| Decision | Resolution |
|---|---|
| Curator publish gate | Curators are trusted; edits go live immediately, no second approval. |
| Authentication | **One OTP mechanism for every role.** Citizens by email or WhatsApp; staff — admins, curators, transcribers — by **email only**. No passwords, no 2FA, no sign-in links. The first admin is bootstrapped with `npm run seed:admin`. |
| Registration & flagging | Both are popups — no redirection. |
| Anonymous contribution | Sees flag and vote actions; prompted to register at submit. |
| Issue-vote visibility | Aggregated results are public, visible to anonymous citizens. |
| Issue-vote scope | Registered citizens vote only in their home ward. |
| Flagging scope | Registered citizens can flag across any ward. |
| Issue list ownership | **Derived centrally**, in one editorial pass, from Sahaaya / JAM output and Open City complaints — not defined per ward by a curator. It is already a launch dependency; it needs a named owner. |
| Report card content | **Affidavit-sourced fields and the affidavit itself.** Curator-compiled press coverage is deferred — it has no owner at this headcount. |
| Curator scope | **City-wide.** A team of four across 369 wards is not a scoping problem, and per-ward assignment would be a label rather than a division of work. **Vetting is now the only net** — the audit log that used to share that job was removed on 2026-08-15, so a curator's scope is their unreviewed and unrecorded blast radius. |
| Audit log | **Removed 2026-08-15 — not required.** No change history, no `/admin/audit` viewer, no restore-a-previous-value action. Consequence: published values have no recorded author and cannot be reverted; see Verification nets below. |
| Affidavit verification | **One transcriber reads each affidavit, and what they save goes live immediately.** No second reading, no consensus step, no approval. Values publish from the moment they are extracted, labelled AI-extracted until a person has checked them. |
| Verification nets | Because there is no second reading, the checks are: curators can correct any field at any time, citizens can flag any value, and transcriber accuracy is visible so a poor reader can be found and removed. **All three are forward-only.** With the audit log removed (2026-08-15) there is no record of who changed a value and no way to restore a previous one — the nets catch a wrong value going forward, they do not reconstruct what happened. |
| Transcriber queue | **Prioritized and city-wide** — worst-first: missing values, then low-confidence values, then everything else, randomized within each tier. Nobody chooses the ward, party or candidate they read; self-selection is what would concentrate the operation in the wards the readers already care about, and the priority order is what makes the team size a dial rather than a cliff (§11). |
| Transcriber sourcing | **Hired and paid — roughly ₹2,000 a head for the three days** (changed from an unpaid volunteer cohort on 2026-08-16; anything citing "36 volunteers, targeting 50" predates it). Invited by an admin, not open sign-up, and an offline effort tracked as a dependency. |
| Curator pay | **₹5,000 per curator as their fee for the cycle** — ₹20,000 for the team of four (decided 2026-08-16). Curators are paid for the work, not thanked for it: the role runs across months, carries city-wide authority over every published value, and is compensated accordingly. Vetting still governs who gets in, because the scope is unbounded. Admins are internal and are not paid from this budget. |
| Launch phasing | **Fourteen milestones**, replacing a nine-milestone plan on 2026-08-15 (`docs/milestones.md`), with the messaging one split into an email half and a WhatsApp half. **Two launches, not one:** a soft launch on the ward finder and voting guidance at the announcement, and a hard launch on candidates and booths once real data exists. |
| Staff sessions | **24 hours**, then sign in again. Long enough that nobody re-authenticates mid-shift, short enough that a borrowed laptop or a stale browser stops being a way in by the next day. |
| Staff access | Staff sign in by email OTP, so the data operation **depends on SendGrid** — and on nothing else. It does not depend on Meta verification, the WhatsApp number, or template approval, which is where the messaging milestone's forty days actually go. |
| Registered users | Behind the soft launch, so **registration cannot build a list before the election is announced**. Accounts, updates, issue voting and flagging all sit here. |
| Messaging | **Abandonable.** WhatsApp and email sending is 40 days of vendor approvals nobody can compress. If it does not land, registered-user support is dropped and the platform ships anonymous-only. |
| Hard-launch sends | **Two WhatsApp and two email messages per registered user** — *know your candidates* and *find your polling booth* (decided 2026-08-16). At ₹1.50 a WhatsApp message against the 25,000-registration target: 50,000 messages, **₹75,000**, plus about **₹15,000** of login OTPs metered separately (§9.1). The same 50,000 emails cost about **₹3,000** on SendGrid's volume pricing. Nothing else goes out over WhatsApp in the candidate half of the campaign. |
| Distribution | Partner-led (RWAs, civic orgs, press). **No paid acquisition** — it costs money the project lacks and undercuts the neutrality claim. |
| Election-silence rule | From 48h before poll close, all outbound comms are logistics only — no candidate content. In practice we go further: the last send is booth logistics three days out, then nothing. The site stays up. |
| Partner recruitment | Runs in the same conversations as curator recruitment; the two pools are the same people. `/partner-with-us` opens the same funnel to anyone. |
| Operator | The **Oorvani Foundation** — the trust behind `opencity.in` — runs the platform in production, and is named on the About and Privacy pages. |
| Citizen data use | Oorvani does not sell citizen data, and shares it only with the service providers that operate the platform — under contract, listed in the privacy policy, never for their own purposes. Contacts are used for ward election updates and critical product notices only — service-affecting messages, not feature marketing. |
| Funding disclosure | The About page states who funds the platform. Neutrality is the product; its funding cannot be opaque. |
| Ward readiness | **No gate.** Candidate sends go out on the campaign calendar rather than waiting on a per-ward data check. Consistent with the rest of the model — extraction publishes on arrival and transcriber edits go live immediately — and it means the timing of the sends, not a readiness flag, is what keeps citizens off half-filled report cards. |
| Release targets | **300,000 unique visitors** — unconditional. **~25,000 registrations** — contingent on both the messaging and registered-user milestones landing in time; withdrawn rather than missed if they do not. *(A per-ward floor — at least 50 registrations in at least 300 of the 369 wards — was dropped on 2026-08-15: nothing measures registrations per ward, and a target nobody can verify is not a target.)* |
| Analytics | Visitor and event data is tracked in **Google Analytics**, disclosed in the privacy policy; registration counts come from our own application events. |
| Public metrics | A Data page publishes our own coverage and integrity figures, plus a city-wide issue picture. Figures, not downloadable datasets. |
| Legal sequencing | The privacy policy publishes **before the public launch**. Google Analytics is already live, so launching without it is not an option; and Meta gates WhatsApp onboarding on it, so it also gates the comms plan. |
| Payments | The donation page links out to Oorvani's existing flow. **Nothing is collected on our domain** — no payment vendor, no processor agreement, no card data in this codebase. |

---

## 9. Key dependencies, costs and risks

*Nearly everything that gates this launch sits outside the codebase. The complete register is `docs/project-dependencies.md`; these are the ones stakeholders should know about.*

- **EC affidavits, obtainable at scale** — the hardest item on this list and the subject of §2. Unresolved, answerable now by asking, and in need of an owner.
- **A hired transcription team (offline)** — **5 people to clear the high-priority set, 33 to read every candidate**, each working an eight-hour day for three days in the window between nominations closing and the poll, reading handwritten Kannada. Kannada reading is a hard requirement. **Money is no longer the obstacle here** — a full pass costs about **₹66,000** — so what has to exist in advance is an approved budget, a named hiring owner, and people identified and briefed before the window opens. The window is three days long and cannot be extended. §11 shows the sizing and what moves it.
- **Curator recruitment & vetting (offline)** — four trusted people who can correct anything on the platform, city-wide, paid a **₹5,000 fee each** for the cycle. Vetting matters more than headcount here, because the scope is unbounded and the fee buys the work rather than the trust. **Doubles as partner recruitment.**
- **Partner network (offline)** — reach depends on RWAs and civic orgs forwarding ward links to their networks. A hard dependency, since there is no paid channel to fall back on.
- **The election announcement** — the anchor for every date in the plan. Not yet made; watching for it and propagating it through the calendar needs an owner.
- **A working booth lookup by voter ID** — assumed to exist on the EC's side, not yet verified. Half the hard-launch campaign rests on it.
- **Email delivery (SendGrid)** — account plus SPF/DKIM/DMARC on the domain. Small, fast, and nothing queues behind it — but **it gates staff login, so the data operation cannot start without it**, and it gates citizen registration too. **There is no permanent free tier any more** (it became a 60-day trial in 2025), so this is a paid account from the day staff start signing in: about **$20 a month** at campaign volume, **₹12,000–₹15,000** across the engagement (§11). The lead time is domain warm-up, not the account.
- **WhatsApp delivery** — needs Business API access, business verification, a committed sender number, and approved templates (16, across English and Kannada). **Roughly 40 days of queueing**, and it must start now. Onboarding requires a **published privacy policy**, which puts that page first on the critical path. The traffic itself is a separate, budgeted cost — **₹90,000**, being ₹75,000 for the hard launch's two messages to 25,000 registered users and ₹15,000 for the login OTPs that scale with sessions rather than with the campaign (§9.1).
- **Legal review (external)** — the terms and privacy policy need a lawyer, for DPDP Act 2023 compliance and contribution licensing.
- **Press assets** — logos, screenshots, and named spokespeople with approved quotes, for the press kit.
- **Electoral roll deadline** — the date that anchors the roll-deadline alert, the single most time-critical message we send. It moves independently of the election date, and it may well fall before it — see §11.
- **An off-box backup destination** — not yet chosen. The nightly backup job is written and cannot succeed until it has somewhere to write to; until then, losing the server's disk loses everything.

### 9.1 What it costs

Five kinds of line appear below, and the distinction matters more than any single number. **Decided** figures come from a decision recorded in §8. **Quoted** figures come from the vendor's published pricing, with the date it was checked. **Modelled** figures are arithmetic over assumptions stated in the row — ours, checkable, and not quotes. **Assumed** means a plausible figure was put in as a placeholder so the total is not misleadingly small; it is neither derived nor quoted. **Unquoted** means nobody has asked the vendor yet, and the row exists so the gap is visible rather than absent.

**One-off, across the election cycle**

| Item | Basis | Estimate | Status |
|---|---|---|---|
| **Transcription team** | 33 people × ₹2,000 for three days (5 × ₹2,000 at the floor) — §11 | **₹66,000** (₹10,000 floor) | Decided |
| **WhatsApp sends and login OTPs** | 2 hard-launch messages × 25,000 registered users at ₹1.50 delivered (**₹75,000**), plus roughly 75,000 login OTPs — one per registration and about two repeat logins each — at ~₹0.20 delivered (**₹15,000**) | **₹90,000** | Decided / Modelled |
| **Email sends + SendGrid account** | 2 hard-launch messages plus OTPs; Essentials/Pro across ~4 months | **₹12,000–₹15,000** | Quoted 2026-08-16 |
| **AI affidavit extraction** | 4,000 affidavits × ~10 scanned pages; ~30,000 input and ~500 output tokens each, on the Batches API at half price | **₹17,000–₹35,000** | Modelled |
| **Curator team** | 4 curators × ₹5,000 fee for the cycle | **₹20,000** | Decided |
| **Legal review** | Privacy policy and terms, DPDP Act 2023 | **₹50,000** | **Assumed** |

**Running, while the platform is live**

| Item | Basis | Estimate | Status |
|---|---|---|---|
| **Hosting** | Hostinger VPS, Mumbai, 4 vCPU / 16 GB — already paid for and shared with other Oorvani workloads | **₹0 incremental** | Decided |
| **Google geocoding, Maps and Places** | Metered per call, and the largest unknown here. `GEOCODE_DAILY_BUDGET` caps geocoding at 2,000 calls a day; at Google's list rate that ceiling is roughly **₹25,000 a month if fully consumed**. Real usage depends on how many citizens type an address rather than share their location, and on the cache hit rate. Map loads and Places keystrokes meter on top, uncapped. | **≤ ₹25,000/month at the cap; actual unknown** | **Unquoted** |
| **Affidavit storage and egress** | ~4,000 PDFs, ~20 GB at rest (cents); egress scales with citizens opening affidavits — at 30,000 opens of a 5 MB document, about ₹1,500 | **₹2,000–₹10,000 over the cycle** | Modelled |
| **Kannada machine translation** | UI strings and editorial pages at build time; curator fields at publish. Text-only and small. | **under ₹5,000 total** | Modelled |
| **Off-box backup** | Destination not yet chosen; a few dollars a month at this volume | **~₹500/month** | Unquoted |
| **Monitoring, analytics, reCAPTCHA** | Sentry, healthchecks.io, GA4 — free at the tiers this needs | **₹0** | Decided |
| **Payments** | The donation page links out to Oorvani's existing flow; nothing is collected on our domain | **₹0** | Decided |
| **Paid acquisition** | Ruled out — it costs money the project lacks and undercuts the neutrality claim (§8) | **₹0** | Decided |
| **Admins** | Two people, internal, not paid from this budget | **₹0** | Decided |

**The one-off lines come to roughly ₹2.7 lakh** (₹2.6–2.8 lakh across the ranges above), with press assets the only priceable thing still missing. That is the number to put in front of whoever holds the budget, and it is small enough that the interesting question is not whether it is affordable but whether anyone has been asked. The WhatsApp figures include 18% GST; the USD-billed lines — SendGrid, Anthropic, Google — are quoted before it.

Four things deserve attention more than the total does.

**The largest unquoted line scales with success.** Google metering is the one cost that rises with the 300,000-visitor target: more citizens means more geocodes, more map loads and more autocomplete keystrokes. Geocoding is capped by design — which is also what makes exhausting it take typed-address lookup down — but Maps and Places are not, and no quota alert has been configured. **This is the row to close first**, because it is the only one where the platform working well is what makes the invoice arrive.

**Template category is worth ₹65,000, and nobody has classified the two sends.** Meta's India rate card (checked 2026-08-16) prices a **Marketing** message at ₹0.8631 and a **Utility or Authentication** message at ₹0.115 — a 7.5× difference — with 18% GST and the BSP's markup on top of each. The ₹1.50 planning figure is Marketing plus GST plus a 30–50% markup, and it holds up. But if *find your polling booth* classifies as Utility rather than Marketing, that half of the send drops from about ₹37,500 to about ₹5,000. **Getting both templates classified before submission is the cheapest lever in this budget**, and it has to happen before the forty-day approval queue starts, not after.

**The OTP line scales with sessions, not with the calendar.** Authentication messages are cheap individually — about ₹0.20 delivered — but citizens hold a one-hour sliding session, so every return visit that has gone idle costs another message. The ₹15,000 assumes about three logins per registered user across the campaign. Twice that behaviour doubles the line, and nothing caps it; the send budget does not bound it because it is not part of the campaign calendar at all.

**Legal is a placeholder, and it is first on the critical path.** ₹50,000 is neither a decision nor a calculation — it is a figure chosen so the total is not misleadingly small. It also gates the privacy policy, which gates WhatsApp onboarding, which gates the comms plan (§13). One conversation replaces the softest number in this budget, and it is a conversation that has to happen anyway.

*(The project tracker carries a **₹3,00,000 budget for WhatsApp alone** — more than three times the figure above, and more than this entire one-off budget. It predates the two-send decision and does not reconcile with it; one of the two is wrong, and it is worth knowing which before the total is quoted to anyone.)*

### 9.2 Risks and mitigations

Two risks are worth stating separately from the dependency list, because both are live, both are external, and **they are not the same kind of risk.** One has no mitigation that saves the product. The other has a mitigation that has already been chosen.

| Risk | If it lands | Mitigation | What it costs us |
|---|---|---|---|
| **Candidate affidavits cannot be obtained in bulk** (§2) | The platform's central promise is gone: no report cards, no comparison, no transcription operation | **Stop at M3.** There is no version of this that keeps the promise | **The release.** A reduced platform ships; the project does not succeed |
| **WhatsApp sending is not ready in time** (§11) | No campaign sends, no registered accounts | **Drop M4b and M10 and ship the rest unchanged** | The registration target, the seven sends, and the two citizen contributions |

**Risk 1 — affidavit availability. This one ends the project, and it has no owner.**

If KSEC will not release filled affidavits in bulk and the returning-officer collection does not work, then M5, M7, M8, M9, M11, M12 and M13 lose their purpose — the report cards, the comparison view, the transcriber operation, the affidavit pipeline, the real candidate data and both hard-launch campaigns. **The plan's own answer is to stop at M3**, shipping what the soft launch already covers: ward discovery, booth lookup, ward issues, questions to ask candidates, voting logistics and results.

That reduced platform is worth something, and it should not be dressed up as a fallback that preserves the release. **It does not.** The distinctive thing this project set out to build — neutral, sourced, comparable candidate information for 369 wards — either exists or it does not, and there is no partial version of it. Stopping at M3 is the right decision if the data is not there; it is not a success.

Worth naming precisely because it will be tempting: **the 300,000-visitor target could still be met by the ward finder alone.** The target is unconditional (§8) and does not depend on candidate data, so it is entirely possible to hit the headline number while failing at the thing the platform is for. If M3 is where this ends, say so plainly rather than reporting the traffic.

**The mitigation is entirely about timing, and all of it has to happen before the announcement.** Ask KSEC directly, file the RTI on its 30-day clock, and set up and rehearse the returning-officer collection across five corporations. None of these is engineering, all three are unstarted, and the nomination window does not reopen. **The go/no-go belongs at the soft launch**, decided deliberately, not discovered at N+12.

**Risk 2 — WhatsApp readiness. This one is survivable, and the decision is already made.**

WhatsApp is forty days of Meta business verification, a committed sender number, domain warm-up and sixteen templates in an approval queue, and it is gated behind a published privacy policy. If it does not land in time, **the platform ships anonymous-only**: drop M4b (WhatsApp sending) and M10 (registered users), and change nothing else.

What goes with them: the seven-send campaign calendar, the ~25,000 registration target — withdrawn rather than missed (§8) — and, because both require an account, **the two citizen contributions: flagging misinformation and voting on ward issues.** That last consequence is the one most easily overlooked. The correction loop in §6 does not disappear, but its citizen half does; curators keep correcting, and nothing arrives from the public to prompt them.

What stays is most of the platform: ward discovery, booth lookup, ward issues and questions to ask candidates, report cards, comparison, voting logistics, results, donations, and both languages. Every one of those works without an account, which is why the loss is bounded.

**Email is not dropped with it, and conflating the two would be expensive.** M4a is a separate two-day milestone with no vendor queue in front of it, and **staff sign in by email OTP — so SendGrid gates the entire curator and transcriber operation whatever happens to WhatsApp.** Dropping WhatsApp saves the ₹90,000 send-and-OTP line and shrinks the email line toward its staff-only floor; it does not remove the email dependency.

Reach then rests where §11 already puts it: the anonymous ward finder and the partner cascade — a forwardable link into apartment and college WhatsApp groups, needing no account on either side. **This risk needs a stated go/no-go date**, after which the comms calendar is dropped rather than compressed into the final fortnight.

---

## 10. Out of scope

Promise / accountability tracking, ward budget transparency, a live civic-issue officer directory, remote voting, and candidate outreach tooling.

---

## 11. Milestones & citizen comms

The platform does not launch in one moment. Candidate data cannot exist until the Election Commission acts, but the ward finder and voting logistics are useful months earlier — and useful early is what earns the audience we need later.

**Fourteen milestones** — fifteen rows below, since messaging splits in two — each a slice of change a citizen can see and someone can test. Full detail, including what each one waits on: `docs/milestones.md`.

| # | Milestone | What it puts in front of someone | Size |
|---|---|---|---|
| **M1** | Ward discovery | Ward finder, booth lookup by voter ID, ward issues, questions to ask candidates, and the donation page | 5d |
| **M2** | Soft launch readiness | The partner front door, cross-links, and campaign content written and scheduled | 5d |
| **M3** | Soft launch | The campaigns fire: know your ward, know how to vote | 3d |
| **M4a** | Email sending | The ability to send email at all — including the codes every operator signs in with | 2d |
| **M4b** | WhatsApp sending | The ability to send WhatsApp at all | 40d |
| **M5** | Candidate pages | Report cards and comparison, on demo data | 3d |
| **M6** | Admin | Adding and blocking operators without a shell on the server | 3d |
| **M7** | Curator tools | The flag queue, corrections to any field, and transcriber oversight | 3d |
| **M8** | Transcriber tools | The randomized queue and the affidavit checking surface | 3d |
| **M9** | Affidavit pipeline | Bulk ingestion, storage and AI extraction, on stand-in documents | 3d |
| **M10** | Registered users | Accounts, updates, issue voting, flagging | 3d |
| **M11** | Real candidate data | The demo data is replaced by the people actually contesting | 2d |
| **M12** | Hard launch readiness | Know-your-candidates and find-your-booth campaigns, prepared | 5d |
| **M13** | Hard launch | Those campaigns fire | 7d |
| **M14** | Results | Citizens see their ward's result | — |

Four things stakeholders should take from this list rather than from the sizes.

**Most of the work is unblocked, today.** Nine of the fifteen — email sending, the ward finder, launch readiness, candidate pages, admin, curator and transcriber tools, the affidavit pipeline, and hard-launch prep — wait on no external queue. That is roughly six and a half working weeks that can be finished before the election is announced, and every week of it not started now is a week borrowed from a much tighter period later. The one qualification: the three staff-facing tools cannot be proved with a real curator or transcriber until email works, because that is how they sign in.

**Messaging is forty days of waiting, and it starts now.** Meta business verification, a committed sender number, domain warm-up and sixteen templates in an approval queue. Almost none of it is engineering, none of it can be compressed by adding people, and the only lever on it is publishing the privacy policy that unblocks the verification.

**It is split in two, and the halves are nothing alike.** M4a — email — is about two days: a SendGrid account and DNS records, with no third-party queue in front of it. Until it is done no curator or transcriber can sign in, so the whole data operation waits on it. M4b — WhatsApp — is where the forty days actually go, and it gates the campaign rather than the work. `docs/milestones.md` §6 has both.

**The window on real candidate data is eight days.** Affidavits do not exist until nominations close, the final list of who is actually contesting comes three days later, and campaigning stops two days before the poll — so the period in which the list being worked from is the right one runs from N+15 to N+23, and the last two of those are silence. Everything that depends on candidate records — acquisition, extraction, roughly 4,000 affidavits' worth of checking, curator review — has to fit in there. `docs/election-timelines.md` holds the assumptions behind that figure; none of them is confirmed.

### Sizing the transcription team

Seven working assumptions, all revisable:

| Assumption | Value |
|---|---|
| Candidates | 4,000 |
| Fields read from the affidavit | 4 (§3.1) |
| One candidate takes a transcriber | 10 minutes |
| AI extraction correct at high confidence | 85% of candidates |
| A transcriber works | an 8-hour day, for 3 days |
| Productive hours per transcriber across the window | 20 |
| Pay | about ₹2,000 per transcriber for the engagement |

At ten minutes each, **one transcriber-hour is six candidates**, and one transcriber gives 20 productive hours across the three days — twenty-four hours of engagement, less about four for briefing, breaks and handover. **One transcriber therefore reads 120 candidates.**

**A full pass over every candidate is 666 transcriber-hours.** 4,000 × 10 minutes.

**The high-priority set is 600 candidates, or 100 transcriber-hours.** At 85% of candidates settled by the AI at high confidence, the other 15% come back with a value missing or a value the extraction is not sure of. Those are the ones a person has to read.

**So the floor is 5 transcribers and the ceiling is 33.** 100 ÷ 20 = 5 to clear everything the AI could not settle; 666 ÷ 20 = 33.3 to read every candidate on every field. At ₹2,000 a head, that is **₹10,000 at the floor and ₹66,000 at the ceiling.**

### The queue is ordered so the headcount does not have to be guessed right

Work is handed out in priority order, not at random within the whole set:

1. **Candidates with missing values** — a blank field on a report card is the worst thing a citizen can meet, and it is the one case where the AI has told us plainly that it has nothing.
2. **Candidates with low-confidence values** — a value is present and published, but the extraction is not sure of it. A wrong number that looks confident is more damaging than a gap.
3. **Everything else** — high-confidence across all four fields, spot-checked if there is capacity and left AI-marked if there is not.

This is what makes the team size a dial rather than a cliff. Whatever headcount is hired, the queue drains worst-first, and the work that does not get done is the work least likely to be wrong:

| Transcribers | Productive hours | Candidates read | What that clears | Cost |
|---|---|---|---|---|
| **5** | 100 | 600 | **The high-priority set** — every candidate the AI left missing or unsure | **₹10,000** |
| 10 | 200 | 1,200 | The above, and a spot-check pass over as many again | ₹20,000 |
| 20 | 400 | 2,400 | Three candidates in five, read by a person | ₹40,000 |
| **33** | 660 | 3,960 | **Every candidate, every field**, bar a tail of about forty | **₹66,000** |

**₹56,000 is what separates the floor from full coverage, and that is the number to put in front of whoever holds the budget.** It is small against the cost of publishing a wrong criminal-case entry about a real person, and it is the only lever in this plan that converts money directly into data quality. What it does not buy is time: five people or thirty-three, they have to be identified, briefed and available on three named days that cannot be scheduled until the election is announced.

**The 85% is a stated hope, not a measured rate — and it can be measured now**, by running extraction over the Karnataka Assembly and Lok Sabha affidavits that are already public, months before the real ones arrive. It is the input with the most leverage on everything above:

| If the AI settles… | Needs a human read | Hours | Transcribers | Cost |
|---|---|---|---|---|
| 85% of candidates | 600 | 100 | 5 | ₹10,000 |
| 70% of candidates | 1,200 | 200 | 10 | ₹20,000 |
| 85% *per field*, not per candidate | 1,912 | 319 | 16 | ₹32,000 |

**That last row is the assumption to check first.** The figures above read the 85% as a per-*candidate* rate: 85 candidates in 100 come back clean on all four affidavit fields. If it is instead 85% *per field*, four fields compound to 0.85⁴ = 52% clean, and the set needing a human read is 48% of candidates rather than 15% — three times the headcount. It is still under ₹35,000, which is the point: at these prices the sizing question is about lead time and briefing, not money.

Two smaller assumptions carry the rest. Ten minutes assumes the transcriber is confirming rather than typing, on a notarised, often handwritten Kannada scan. And twenty productive hours assumes about four hours across the three days go to briefing, breaks and handover.

**On current sequencing, the hard launch finishes after the election.** Chaining the plan's own dependencies and estimates, the candidate campaign ends past the silence period. It is fixable — run it against the provisional candidate list, shorten it, or split the booth half (which needs no candidate data) from the candidate half — but it has to be chosen now rather than discovered in the final week. `docs/milestones.md` §16 works it through.

### The comms plan is contingent

**Citizen comms** are seven ward-scoped sends over the campaign, by email and WhatsApp in the citizen's saved language. Deliberately few: WhatsApp opt-outs are permanent, and over-sending in the quiet months would cost us the list exactly when the election beats arrive. The sequence runs welcome → **electoral roll deadline** → candidates filed → issue voting → final report cards → compare → booth logistics three days out.

**The hard launch carries two WhatsApp sends per registered user, and that is the whole WhatsApp campaign.** *Know your candidates* and *find your polling booth* — nothing else goes out over WhatsApp once the campaign turns to candidates. At **₹1.50 a message** against the 25,000-registration target, that is **50,000 messages and ₹75,000**. The figure scales with the list rather than the calendar: half the registrations halve it, and if the messaging milestone does not land it is zero along with everything else it carries. **Login OTPs are a separate ₹15,000 on top** — not campaign traffic, and metered per sign-in rather than per send (§9.1).

**The same two messages go by email, and that half costs almost nothing.** Another 50,000 sends. SendGrid prices by volume rather than by contact: **Essentials covers 50,000–100,000 emails a month from about $20**, **Pro covers 100,000–2.5M from about $90**, and exceeding a tier is charged per message (~$0.001) rather than refused. Assume a campaign-month peak of **75,000–125,000** — the two hard-launch sends, plus registration and login OTPs, plus whatever else fires in the same month — and the whole engagement is **₹12,000–₹15,000 across four months** at ₹85 to the dollar. *(Prices checked 2026-08-16; confirm before committing. Note the permanent free tier became a 60-day trial in 2025, so the account is paid from the day staff start signing in.)*

**Per message, email is a rounding error beside WhatsApp — roughly ₹0.03–₹0.06 against ₹1.50.** That is the number to weigh when deciding what becomes of the sends this decision displaces: moving them to email costs about two per cent of sending them on WhatsApp.

**What email costs instead is reputation, and that is bought with time.** Fifty thousand messages from a domain with no sending history will be throttled and spam-foldered whatever the plan says. It needs SPF, DKIM and DMARC (§9) *and* a volume ramp over weeks — not a switch thrown on the day. It also argues against Pro's dedicated IP at this scale: a dedicated IP needs steady volume to stay warm, and this campaign is three bursts. **Shared IP, warmed early.**

**This bounds the post-nomination half of the sequence above.** Candidates filed, final report cards and compare cannot each be its own WhatsApp push if the hard launch is two messages — they collapse into *know your candidates*, move to email, or are dropped. The seven-send sequence and the sixteen templates queued for Meta approval were both written before this decision and should be re-counted against it **before submission**, because templates are the item with forty days of queue in front of them: getting the count wrong there costs time, not money.

**All of it depends on two milestones that are late in the plan and external in their blockers** — the messaging capability, which is abandonable, and registered users, which sits behind the soft launch. A list cannot be built by a feature that does not exist yet. The decision is to plan for reach through the anonymous ward finder and the partner cascade — a forwardable link into apartment and college WhatsApp groups, which needs no account on either side — and to treat the seven sends as a second track with a stated go/no-go date. If the prerequisites have not landed by then, the calendar is **dropped rather than compressed** into the final fortnight.

Three points deserve stakeholder attention:

- **The roll-deadline alert is the highest-value message we send, and it is the first thing we lose.** Missing the roll is the only failure in this funnel that cannot be undone — no amount of good candidate information helps someone who isn't registered to vote. Registration now opens at the soft launch, which is at the announcement; **the roll deadline may fall before that**, in which case the send is not late, it is impossible. The deadline is carried on the site itself and by whatever partners forward, which is a weaker instrument and is not claimed to be otherwise.
- **Send timing is the only thing standing between a citizen and a half-filled report card.** There is no per-ward readiness gate: candidate sends go out on the calendar, to every ward at once. That keeps the operation simple and puts the weight on scheduling — the candidate sends must sit late enough that the transcription queue has drained, because nothing will hold them back if it has not. Worth watching in the days after nominations close, when coverage will be uneven across 369 wards.
- **We go quiet for the last 48 hours.** The Representation of the People Act bans electioneering in that window. Rather than argue that neutral report cards aren't electioneering, we simply stop — the last send is booth logistics three days out. This gives up the election-morning reminder, the single highest-converting message in a normal campaign. It buys a platform nobody can accuse of campaigning, which is the only asset we actually have. The site stays fully available throughout.

---

## 12. Trust surfaces & recruitment

Three public pages carry the neutrality claim. **About** names the operator — the **Oorvani Foundation**, the trust behind `opencity.in` — says how we source data, and **who funds us**, because that is the first question a skeptical journalist asks. It also states Oorvani's commitments in plain words: we do not sell citizen data, we share it only with the services that deliver the platform's own messages, and we use contact details for ward election updates and critical service notices only. Saying that on the page citizens actually read, rather than only in the privacy policy, is what earns a phone number. **Data** publishes our own coverage and integrity figures alongside a city-wide picture of what Bengaluru's wards say matters; a platform that publishes other people's records should publish its own. **Press kit** ships early, since journalists arrive at the announcement and a kit assembled then is assembled too late.

**Partner with us** turns recruitment from a private motion into a public one, offering the three ways to help — *spread awareness*, *curate data*, or *transcribe affidavits* — and taking applications from anyone. Two of the three are paid, and the page should say so plainly: transcribing is a three-day engagement at ₹2,000 with a Kannada-reading requirement, and curating carries a ₹5,000 fee for the cycle. Describing either as volunteering would misdescribe the ask and draw the wrong applicants. The team's own address book does not stretch to 369 wards, and it is precisely where a central-Bengaluru skew would come from.

One sequencing point worth stakeholder attention: the **privacy policy is the first thing we must publish**, before the public launch. Meta will not approve WhatsApp onboarding without a live privacy-policy URL, so it gates the templates, which gate the entire comms plan. It also needs a lawyer — India's DPDP Act applies squarely to what we collect. The retention proposal is decided product-side — citizen contact data deleted or anonymized within **3 months of results being declared** — and the privacy policy waits only on the lawyer confirming or amending that period.

One related decision is cheap now and expensive later. Citizens will register for *election* updates. If the deferred promise-tracking phase ever ships, that list cannot simply be reused — it was gathered for a different purpose, and "critical product updates" does not stretch to a new product. An optional "tell me about future civic tools" consent at registration costs one checkbox today; without it, the next phase starts from a cold list. That checkbox is part of registration.

---

## 13. Next steps

Ordered by how much they cost to start and how much they cost to delay.

1. **Ask KSEC how it will publish candidate affidavits, and file the RTI.** §2. One conversation decides whether the central half of this platform is buildable, and the RTI clock is 30 days. Needs an owner before anything else on this list.
2. **Engage a lawyer for the privacy policy and terms.** The first item on the critical path, not the last: the privacy policy gates WhatsApp onboarding, which gates the templates, which gate the comms plan. Confirm the three-month retention period in the same conversation.
3. **Name owners for the three workstreams that do not yet have one** — affidavit acquisition, partnerships, and the curator/transcriber operation. Every one of them has a longer lead time than the software it feeds, so naming the owner is the step that starts the clock.
4. **Split the vendor chain and start both halves now.** SendGrid with domain authentication is days and unblocks staff login — do it first, because the curator and transcriber tooling cannot be proved without it. Meta business verification, the sender number and template submission are the forty days; they queue whatever else happens.
5. **Approve the budget, and start curator and partner recruitment.** The whole one-off cost is **about ₹2.7 lakh**, itemised in §9.1: ₹90,000 for WhatsApp sends and login OTPs, ₹66,000 for the transcription team, ₹50,000 assumed for legal, ₹17,000–₹35,000 for AI extraction, ₹20,000 for the curators and ₹15,000 for email. Approving the larger transcription figure now costs nothing until the window opens while removing the sizing question entirely. Two things move this total more than anything else: classifying the WhatsApp templates before they enter the approval queue, and quoting Google's metering — §9.1 has both. Curator and partner recruitment remain one motion with one named owner, and hiring transcribers is a separate, larger job that needs a budget holder rather than a network.
6. **Measure the extraction accuracy now**, against the Karnataka Assembly and Lok Sabha affidavits already in the public domain. The 85% assumption sets the team size and the budget, and it is the one input in §11 that can be replaced with a real number months before the real affidavits arrive.
7. **Track the election announcement.** Every date in the plan is an offset from it, so watching for it and updating the calendar when it lands needs an owner.
8. **Verify the booth lookup by voter ID actually works** before building a campaign around it.
9. **Decide the hard-launch sequencing** described in §11, while it is still a choice.
10. **Choose an off-box backup destination.** The nightly job is written and waiting on a target to write to; until one is chosen it cannot succeed.
11. **Build the nine unblocked milestones** — email sending, the ward finder, soft-launch readiness, candidate pages, admin, curator and transcriber tools, the affidavit pipeline, and hard-launch readiness (§11). The one part of this list that is entirely ours.

Open questions: `docs/milestones.md` §17 (what the plan and the tracker still disagree about), `docs/election-timelines.md` §5 (what is not yet confirmed about the calendar), `docs/ksec-data-risk.md` §6 (whether the candidate data can be got at all).
