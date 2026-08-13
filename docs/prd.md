# GBA Elections Citizen Platform — Product Requirements (PRD)

**Status:** Draft (for review) · **Scope:** Pre-election MVP · **Owner:** Product · **Domain:** `bengaluruvotes.opencity.in` · **Date:** July 2026

> The authoritative product requirements for the pre-election MVP. When a requirement is ambiguous, this document wins. Page-level detail lives in the Information Architecture document; the stakeholder summary is `docs/overview.md`.

---

## 1. Background

Bengaluru is heading into its first ward-level (GBA / corporator) elections in roughly a decade. Citizen interviews showed people are willing to vote but blocked by a few specific gaps: they don't know which ward they now belong to, they can't find trustworthy information about local candidates, and existing sources (mainstream media, WhatsApp, party workers) are seen as biased or unreliable.

This platform makes trustworthy, ward-level election information easy to find, compare, and act on. Those gaps are widest for first-time voters, and this election's first-timer cohort is unusually wide: the last ward election was roughly a decade ago, so nearly everyone under thirty — plus everyone who has moved to Bengaluru since — has never voted for a corporator, whatever their experience of assembly or general elections. **This release is pre-election only.** Post-election capabilities (promise/accountability tracking, ward budgets, a live civic-issue officer directory) are deferred to a later phase.

---

## 2. Goals & non-goals

**Goals**

- Let any citizen identify their new GBA ward in seconds and see who is standing there.
- Present neutral, sourced candidate information that citizens can trust and compare side by side.
- Reduce logistical friction: registration/eligibility check, booth location, voter-ID issuance and updates, and how to vote.
- Give citizens a voice in which local issues matter, and surface that signal publicly.
- Work fully in English and Kannada.

**Success metrics (this release)**

- **300,000 unique visitors** to the platform.
- **25,000 registered users** — with the ward-breadth guardrail (≥50 registrations in ≥300 of 369 wards) defined in `docs/gtm-plan.md` §8.

**Non-goals (this release)**

- Tracking whether elected corporators keep their promises; ward budget transparency; a live officer/"who to contact" directory.
- Online/remote voting or any interaction with the official voting process itself.
- Editorial or opinion content — the platform presents facts and citizen signal, not endorsements.

---

## 3. Scope summary

| In scope (MVP) | Deferred (future phase) |
|---|---|
| Ward lookup; candidate report cards (with news links) & comparison; ward issues & citizen issue-voting; registration/eligibility check; election awareness; voter-ID issuance & update; how-to-vote; booth locator; English/Kannada; registration & notifications; flag/correction workflow; curator & admin tooling | Promise/accountability tracking; ward budgets; civic-issue officer directory; remote voting; candidate outreach tooling |

---

## 4. Users & roles

Four roles: a large, mostly read-only public, and a small, trusted group that maintains data and governs access.

| Role | Who | Primary job |
|---|---|---|
| **Anonymous citizen** | Any visitor, no account | Find & read information; see (but not cast) flags and issue votes |
| **Registered citizen** | Signs up: email/WhatsApp + ward + language | Get updates; flag misinformation (any ward); vote on issues (home ward) |
| **Data curator** | Trusted, vetted individual (scoped to assigned wards, §10) | Upload & correct ward and candidate data; define ward issue list; review flags |
| **Admin** | Small internal team | Manage roles, access, scope, users, and oversight |

**Contribution principle.** Both citizen actions — flagging an error and voting on issues — are **visible to everyone but gated at the point of submission by registration**. Anonymous users see the buttons; tapping to act opens the Register/Login popup, after which the action resumes in place.

---

## 5. Feature requirements

Each feature notes its primary page(s); full page-level detail is in the IA document.

### 5.1 Ward identity lookup
*Pages: `/`, `/ward/{ward-id}`*

- Look up ward by **address or pincode** (no voter-ID lookup); return new GBA ward name + number and corporation (N/S/E/W/Central).
- A pincode spans multiple wards, so pincode lookup returns a shortlist to pick from; address lookup returns a single ward. Pincode lookup needs no boundary data, so it remains the fallback when geocoding fails or is ambiguous (`docs/architecture.md` §11). (It was also the Path B hedge against slipping delimitation boundaries; those boundaries have since landed at `data/gba.geojson` — see `docs/project-dependencies.md` §4.1 — so the hedge is no longer load-bearing for launch.)
- **Out-of-coverage is an answer, not an error.** An address that resolves outside GBA limits, or a pincode with no GBA wards, returns an explicit "this doesn't appear to be in the GBA area" result. Geocoding failure or an ambiguous address degrades to the pincode path with a clear message (`docs/architecture.md` §11).
- Show the ward boundary on a map. (Old-ward → new-ward mapping was considered and dropped — the finder answers the question that matters, "what is my ward *now*", without needing pre-delimitation boundary data.)
- The ward result is the anchor for candidate, issue, and logistics views, and is reused to set a registered user's home ward.
- **Register-for-updates prompt.** The ward result page and its candidates/compare/issues subpages carry a state-dependent slot: an anonymous visitor sees a **"Register for updates"** control that opens the Register/Login popup (§10) with this ward pre-filled as home ward; a registered visitor viewing their own home ward sees a plain **"Receiving updates"** status; a registered visitor viewing any other ward sees nothing there — switching home ward remains an `/account` action only.

### 5.2 Candidate report card
*Page: `/candidate/{candidate-slug}`*

A structured, neutral, sourced profile for each candidate in a ward — the single most-requested feature.

- One page per candidate, with every field carrying a visible source.
- Standard fields:

  | Field | Primary source | Notes |
  |---|---|---|
  | Name, photo, party / independent | EC nomination | Party is secondary at ward level but shown |
  | Past track record for this ward | Curator-compiled, sourced | Highest-value field; ward-specific work |
  | Criminal record / pending cases | EC affidavit | Often the first thing citizens look for |
  | Declared assets | EC affidavit | Trusted primary disclosure |
  | Education / qualifications | EC affidavit | Shown with the caveat it isn't the whole picture |
  | Approachability | Curator-compiled | Lives in ward? public office? contactable? |
  | **News & coverage** | Curator-compiled links | Links to news articles about the candidate |

- **Affidavit ingestion is AI-assisted, not manual transcription.** As affidavits arrive during the nomination window, the curator uploads the candidate's EC affidavit (Form 26) PDF — or pastes its EC link, which the platform fetches and stores. AI extraction (the same Anthropic API dependency as machine translation — `docs/project-dependencies.md` §6.6) populates the affidavit-sourced fields above — cases, assets, education — including marking a field *not declared* where the affidavit says so (a valid, complete answer per §9.1).
- **Extracted fields publish immediately, mirroring the machine-translation trade (§8).** Each carries a visible *AI-extracted* marker until the curator confirms or edits it, which clears the marker. The citizen flag flow (§6) is the correction net, and extraction is audit-logged as a system entry.
- **The stored affidavit is the public source.** Affidavit-sourced fields link to the platform's hosted copy of the PDF, so provenance is a clickable original rather than an EC URL that can move or rot.
- **News links are auto-suggested, curator-approved.** The platform surfaces candidate news links as suggestions in the curator UI (mechanism: a jobs-driven news search per candidate over an allowlist of news domains — `docs/architecture.md` §7); suggestions are visible **only to curators**, and nothing publishes until a curator approves it, so accountability for what appears stays with the curator. Approved links publish like any curator edit — live immediately, audit-logged. Curators can also add links directly.
- **Candidate status tracks the nomination lifecycle.** Every candidate record is **filed** (provisional — from nomination until scrutiny and withdrawals resolve), **contesting** (on the final list), **rejected** (failed scrutiny), or **withdrawn**; the curator sets it, like any other field. Rejected and withdrawn candidates keep their report-card URL — the links have already been shared — with a prominent status banner, and are excluded from the comparison view (§5.3), from issue-stance rows (§5.4), and from the §9.1 completeness check. Until withdrawals close, candidate lists and report cards carry a *provisional* marker, matching the L1 send's framing (§9.3).
- Clearly distinguish official/affidavit data from curator-compiled context.
- Carries the **Flag an error** action (opens the flag popup; see §6).

### 5.3 Candidate comparison view
*Page: `/ward/{ward-id}/compare`*

- Compare all candidates in a ward side by side in a column layout (not a scrolling feed).
- Comparison spans the same fields as the report card so rows line up cleanly.
- 2-up on mobile, with horizontal scroll through **all** candidates — no hard cap on how many can be compared — and the field-label column pinned so rows stay readable mid-scroll; more columns on wider screens.

### 5.4 Ward issues & candidate stance
*Page: `/ward/{ward-id}/issues`*

- The curator maintains a list of key issues per ward (roads, water, waste, safety, etc.).
- Where available, map each issue to what each candidate says they will do about it. Stances are curator-compiled and carry a source like any other field (§11); withdrawn and rejected candidates drop out of the stance rows (§5.2).
- Showing candidate stated positions is in scope; tracking delivery after election is deferred.

### 5.5 Citizen issue voting
*Page: `/ward/{ward-id}/issues` + Cast issue vote popup*

Let citizens signal which local issues matter most, and show that signal publicly per ward.

- The **curator defines** the list of votable issues in each ward (same source as 5.4).
- **Registered citizens vote for up to three issues** (their top 3 — one, two, or three selections), and only in their **registered home ward**.
- Aggregated results are **public** — anonymous citizens can see the ranked top issues for a ward. Results display as **ranked order with percentage shares**; no raw counts on the ward page — early counts are thin and quotable against the platform. The total-votes figure is published on `/data` only (§5.14).
- The vote action opens as a **popup**; anonymous users are shown the Register/Login popup first.
- **One active vote-set per registered user** — in their current home ward; changeable at any time, and **re-casting replaces the whole set** (there is no per-issue toggle); de-duplicated by account.
- **Curator edits to the issue list never discard a citizen's vote wholesale.** Renaming or rewording an issue keeps its votes attached; **deleting an issue removes it from every vote-set that included it** — the citizen's remaining selections stand, and they can re-vote at any time. Results are always computed against the current list.
- **Changing home ward is allowed** (people move; lookups mis-assign) **and retires the previous ward's vote-set** — retired sets are excluded from the public aggregates. A citizen's voice counts where they live, once — so ward-hopping gains nothing and no change limit is needed.

### 5.6 Check registration / eligibility
*Page: `/check-registration`*

- A **guided link-out, not an on-platform lookup**: the page explains the check in plain language (both languages) and hands off to the official EC / CEO Karnataka roll lookup, with the correct GBA roll link surfaced prominently.
- No voter details are entered or stored on the platform. A wrong answer about someone's franchise is the worst error this platform could make, so the official source gives the answer; this page's job is getting the citizen there with no confusion.
- Make roll tools available early (citizens check months out) even before candidate data is populated.
- **State the eligibility basics before the link-out:** 18 or older on the qualifying date (qualifying dates now fall quarterly — many first-time voters assume they must wait a full year), enrolment in one place only, and the documents enrolment requires. The check is useless to someone who doesn't yet know whether they qualify.
- **Show the roll deadline until the roll closes.** The R1 alert (§9) reaches only registered users; this page is where everyone else learns the one date in the funnel that cannot be recovered. The same element appears on `/` (§5.7) and `/voting-guide/voter-id` (§5.8).

### 5.7 Election awareness
*Page: `/about-election` (+ Home banner)*

- Prominent election status + date / official-notice countdown.
- Until the electoral roll closes, the Home banner also carries the roll deadline (§5.6) — the site-side counterpart of the R1 alert, which reaches only registered users.
- Plain-language explainer: what a GBA corporator does and why this local vote matters.

### 5.8 Voter-ID issuance & update / transfer
*Page: `/voting-guide/voter-id`*

- Guided flows for new enrolment (Form 6) and for updating / transferring details when a citizen moves.
- **A named "I'm registered in another city" path.** Bengaluru's first-time-local voters are disproportionately migrants and renters, and their first question is whether a vote registered elsewhere counts here. The page answers it plainly: it does not — transfer (Form 8) before the roll closes, with proof-of-address guidance for renters and PG residents.
- Shows the roll deadline until the roll closes (same element as §5.6).
- Direct links into the official EC processes; clear step-by-step guidance.

### 5.9 How to vote
*Page: `/voting-guide/how-to-vote`*

- Simple step-by-step guide to the voting-day process, in both languages.
- Primary value is first-time voters and the less-digital / Kannada-first audience.
- **A first-timer FAQ beyond the steps:** which documents are accepted at the booth when the EPIC card hasn't arrived (the EC alternative-document list), what a voter slip is, NOTA, what the ballot or machine looks like (drafted for **EVMs** — Karnataka's urban local-body practice — to be confirmed with the State Election Commission before this content publishes, §17), and what can't be taken inside (phones).
- **What's different about a ward election:** one corporator per ward, the new five-corporation GBA structure, and a ward that may not match the citizen's assembly constituency. Every voter is a first-timer for this format — the last ward election was roughly a decade ago.

### 5.10 Polling-booth locator
*Page: `/voting-guide/find-booth`*

- Return an address-accurate booth location with a map, not just a booth name.
- **Lookup is by address** — the same address mechanism as the ward finder (§5.1), with the same out-of-coverage handling. No voter-ID entry: §5.6's rule that no voter details are entered or stored on the platform applies here too.
- **Until booth-level data lands** (a tracked dependency, §15), the page says so plainly and hands off to the official EC booth lookup — the same guided link-out pattern as §5.6 — rather than guessing or 404ing.

### 5.11 About us, funding & data sourcing (trust page)
*Page: `/about`*

- **Name the operator.** The platform is run in production by the **Oorvani Foundation**, the trust that operates `opencity.in`. This is stated plainly, not buried.
- Explain how data is sourced and verified, and the neutrality stance.
- **Disclose funding.** For a platform whose value rests entirely on neutrality, who pays for it is the first question a skeptical reader asks; the answer should not have to be requested. **Funders are named** (amounts optional) — categories alone invite exactly the question the disclosure exists to close.
- **State the data commitments** in citizen-readable terms, mirroring `/privacy` (§5.16): Oorvani does not sell citizen data, shares it only with the service providers that run the platform, and uses contact details for ward election updates and critical product updates only.
- Supports the trust requirement in §11; links to primary sources.
- This is also the "about us" page — team and mission live here rather than on a separate URL, because a citizen who doubts the platform wants who-runs-it and how-it-sources-data in one place.

### 5.12 Partner attribution & partner kit
*Page: `/partner/{partner-slug}`*

Distribution is partner-led and unpaid (§14), so the platform must equip partners to forward links and must measure what that forwarding achieves.

- **Attribution.** Any page accepts a `?src={partner-slug}` parameter. The value survives the visit and is **persisted onto the user record at registration**, so a signup can be attributed to the partner who sent it. Attribution is for measurement only — it grants no permissions and changes nothing the citizen sees.
- **Partner kit page.** An unlisted, anonymous-access page per partner carrying: their tagged link; ready-to-paste WhatsApp forward text in English and Kannada — a general message and a **first-time voter variant** linking the `/voting-guide` checklist (§5.17); a poster image sized for WhatsApp; and a short neutrality statement. Unlisted means not indexed and not linked from navigation — but not access-controlled, since it holds nothing sensitive and a login wall would defeat its purpose. The kit page itself is **bilingual** like every public path (EN and `/kn/`), as are `/press` and `/partner-with-us` — the forward texts inside were always in both languages.
- **No new role.** Partners are not a role. The kit is a public page; partner records are managed by admins (§7).
- **Why the neutrality statement.** An RWA secretary forwarding an election link *will* be accused of campaigning. A partner who cannot answer that stops forwarding — so the answer ships with the kit.
- **Coverage view.** Admins can see partner → ward coverage against all 369 wards. The uncovered set is a work queue and the early warning for reach skewing to central Bengaluru.

### 5.13 Partner with us (recruitment funnel)
*Page: `/partner-with-us`*

Recruiting partners and curators is otherwise an offline motion (§15), which does not scale past the team's own network — and that network is where the central-Bengaluru skew originates. This page is its public front door.

- **Two paths**, matching the two roles the platform already has:
  - **Spread awareness** — forward ward links to your network. In return: a partner kit page (§5.12), a tagged link, and a report of what the forwarding achieved.
  - **Curate data** — own the accuracy of a ward's data. In return: assigned ward scope, onboarding, and publish-immediately trust (§14).
- Each path states its **time commitment** and the **vetting and neutrality expectation** up front.
- **One expression-of-interest form** covers both paths. The form is **anonymous — no account required.** Requiring registration before someone can volunteer taxes exactly the people the plan depends on, and an RWA as an institution does not map onto a citizen account with a home ward.
- CAPTCHA-protected (Google reCAPTCHA v3) as an anonymous write path (§6.3).
- **Applications are not access.** Submissions land in an admin queue (§7); accepting an awareness applicant provisions a partner slug and kit, while a curation applicant hands off to the existing curator vetting path. Nobody self-activates.

### 5.14 Public data & key metrics
*Page: `/data`*

A platform that publishes other people's records should publish its own.

- **Coverage:** wards with published candidate data (against 369); report cards complete; active curators; sources cited. Coverage counts **published data** — a ward held from comms by the §9.1 readiness check still counts, because published data and comms readiness are different facts; a separate **"wards signed off for candidate comms"** figure keeps that distinction visible rather than hidden.
- **Integrity:** flags raised; flags resolved; median time to resolve.
- **Citizen signal:** the city-wide issue roll-up aggregated across all wards; total issue votes cast; registered citizens.
- Every figure carries an **"as of" timestamp**.
- **Ships in Phase 2, not Phase 1** (§13.1). During the teaser this page honestly reads "14 of 369 wards" — damaging, and it hands critics a number. The issue roll-up says nothing until issue voting has volume.
- **Figures, not datasets.** Downloadable data and a public API are out of scope this release (§16).

### 5.15 Press kit
*Page: `/press`*

Press is an amplifier for the partner-led distribution model (§14), and journalists arrive at the EC notification whether or not anything is ready for them.

- Boilerplate at three lengths (50 / 100 / 200 words); current key stats drawn from §5.14; logos and screenshots for download; spokesperson bios and quotes; contact with a **stated response time**; the neutrality statement; a link to sourcing methodology (§5.11).
- **Ships in Phase 1**, though it is a Phase 2 asset — a press kit assembled at the notification is assembled too late.
- **The launch press push goes out at N** — journalists arrive at the notification whether or not they are invited — with a planned **second beat at E−2w**, when the final candidate list and complete report cards give the stronger story.

### 5.16 Legal pages
*Pages: `/terms`, `/privacy`*

- **`/terms`** — acceptable use; contribution licensing (flags, issue votes); accuracy and liability disclaimers; account termination grounds, consistent with the admin ban capability (§7).
- **`/privacy`** — the operator is the **Oorvani Foundation**; what personal data is collected (email, phone, address→ward, language, `src` attribution, standard server logs, and **Google Analytics** usage data and cookies) and why; that visitor and event measurement uses **Google Analytics**, alongside server-side application events; that the `/partner-with-us` form is protected by **Google reCAPTCHA v3**, which sets its own cookies and sends usage data to Google (`docs/architecture.md` §7); the **processor inventory** — every service provider that touches personal data, what it receives, and why: **SendGrid and Twilio** (contact details, to deliver OTPs and the updates consented to; choosing WhatsApp additionally involves **Meta's** WhatsApp Business terms), **Google Geocoding** (ward-lookup addresses, sent server-side; cached only as normalized address → ward, never linked to an account), **Anthropic** (candidate report-card text for translation and affidavit extraction — candidate data, not citizen contacts), and **Sentry** (server-side error reports, scrubbed of contacts and addresses — `docs/architecture.md` §13), each under executed data-processing terms (`docs/project-dependencies.md` §2.8); email/WhatsApp consent and withdrawal; **DPDP Act 2023** notice, data-principal rights — including the **erasure mechanism** (`docs/architecture.md` §7) and the fact that erased data persists in encrypted backups until retention expiry; a named **grievance officer**; retention policy (proposed: citizen contact data deleted or anonymized within **3 months of results being declared**, with backups aging out on rotation — pending legal confirmation, §17); the fact that issue votes are published in aggregate.
- **Data commitments (locked, §14).** Oorvani **does not sell citizen data, and shares it with no one except the service providers that operate the platform** — under contract, on Oorvani's behalf, never for their own purposes, enumerated in the processor inventory above. (Reworded 2026-07-19: the earlier unqualified "does not share with third parties" was a claim the design itself cannot keep — contacts necessarily transit Twilio/SendGrid and Meta to deliver the very updates consented to, and an absolute statement that is technically false is what an opposing campaign screenshots.) Contact details are used for two purposes only: ward-scoped election updates (§9), and **critical product updates**.
- **"Critical product updates" is a narrow purpose, and must be written narrowly.** It means service-affecting notices — a breach, a material change to these terms, the platform shutting down. It is not a channel for announcing new features. This matters because the DPDP Act limits use to the purpose consented to, and because the deferred promise-tracking phase (§16) would be marketing a new product to a list gathered for an election. Using these contacts for it needs fresh consent, not this clause — the optional "future civic tools" checkbox at registration (§10) collects exactly that consent.
- **Languages.** Both pages ship in English **and** Kannada; the English text is legally controlling, and the Kannada version carries a note saying so (a courtesy translation — standard practice that keeps the bilingual promise without doubling the legal-verification cost). The note's wording is legal-review input.
- **`/privacy` ships in Phase 0 — the earliest page on the critical path.** Meta requires a published privacy-policy URL to approve WhatsApp Business API onboarding, so this page gates template approval, which gates the comms plan (§9). It is not launch-week hygiene.
- Both need **legal review**; their content is outside a product spec's competence. `/privacy` is additionally blocked on legal confirmation of the proposed retention period (§17).

### 5.17 First-time voter checklist
*Page: `/voting-guide`*

The logistics pages (§5.6–§5.10) each answer one question; a first-time voter needs them in order.

- The voting-guide hub presents the guides as an **ordered checklist**, not an index: check you're on the roll → enrol or transfer before the deadline → find your ward → read the candidates → find your booth → vote. Each step deep-links to the page that does the work; no content is duplicated.
- Steps that expire (enrol / transfer) carry the roll deadline (§5.6).
- The hub URL is the forwardable **first-time voter link** carried in partner kits (§5.12).
- The first-timer depth itself lives on the pages: eligibility basics (§5.6), the registered-elsewhere path (§5.8), and the voting-day FAQ and ward-election differences (§5.9).

---

## 6. Contribution & moderation

### 6.1 Flag → correction → live

Flagging is done via a **popup** that overlays the current page (no redirect) and works across **any ward**. The **Flag an error** action appears wherever curator-maintained data is shown: the candidate report card, the ward result page, and the ward issues page.

| Step | Role | What happens |
|---|---|---|
| 1. Notice an error | Anonymous / Registered | Anyone can tap Flag. Anonymous is shown the Register/Login popup first; registered proceeds. |
| 2. Submit | Registered citizen | The flag popup captures the field/claim + detail + optional source, and lands in that ward's review queue — visible to **every** curator whose scope covers the ward (scopes may overlap) and to admins (§7). A ward no curator covers holds its flags in the queue and surfaces to admins as a coverage gap, not a dropped flag. |
| 3. Review | Data curator | On `/curator/queue/{submission-id}`: sees flag, current value, and source. Accepts (edit + attach source) or rejects (with reason). |
| 4. Publish | Data curator | Accepted edits go live immediately — no second approval, because curators are trusted. |
| 5. Record | System | Immutable audit-log entry; the outcome appears as status on the submitter's `/account/submissions` (§6.2). No email or WhatsApp is sent — the campaign calendar (§9.3) and OTP are the only outbound messages. |

### 6.2 Submission visibility

Registered citizens can see the **status of every flag they have submitted** on `/account/submissions`, each marked pending / accepted / rejected + reason. (Citizen submissions are always *flags* — a flag may carry a suggested value and source; the *correction* is what the curator makes in response.)

### 6.3 Anti-abuse

- Registration-gating gives every flag and every issue vote an identity, enabling de-duplication and rate-limiting.
- Multiple flags on the same field collapse into one queue item with a count (a strong signal to the curator). Resolving the queue item resolves every collapsed flag at once — each submitter sees the same outcome and reason on `/account/submissions` (§6.2).
- The `/partner-with-us` expression-of-interest form (§5.13) is the **one anonymous write path**. It has no identity to rate-limit, so it is protected by a **CAPTCHA** (Google reCAPTCHA v3 — vendor decision recorded in `docs/architecture.md` §7), with admin triage (§7) as the backstop — a spammed queue wastes admin time but touches no published data.

---

## 7. Roles & permissions matrix

| Capability | Anonymous | Registered | Curator | Admin |
|---|:--:|:--:|:--:|:--:|
| Search / read published info | ✅ | ✅ | ✅ | ✅ |
| View public issue-vote results | ✅ | ✅ | ✅ | ✅ |
| View a partner kit page | ✅ | ✅ | ✅ | ✅ |
| View public metrics, press kit, legal pages | ✅ | ✅ | ✅ | ✅ |
| Submit a partner/curator expression of interest | ✅ | ✅ | ✅ | ✅ |
| Switch language (session) | ✅ | ✅ | ✅ | ✅ |
| Save language preference | – | ✅ | ✅ | ✅ |
| Subscribe to ward updates | – | ✅ | ✅ | ✅ |
| Flag / submit correction (any ward) | – | ✅ | ✅ | ✅ |
| Vote on top-3 ward issues (home ward) | – | ✅ | ✅ | ✅ |
| View status of own submissions | – | ✅ | ✅ | ✅ |
| Define ward issue list | – | – | ✅ | ✅ |
| Mark a ward ready for candidate comms | – | – | Scope | All |
| Create / edit ward & candidate data | – | – | Scope | All |
| Publish live | – | – | ✅ | ✅ |
| Review submissions | – | – | Scope | All |
| Manage roles, scope & users | – | – | – | ✅ |
| Manage partners & view ward coverage | – | – | – | ✅ |
| Review expressions of interest | – | – | – | ✅ |
| Override ward comms hold | – | – | – | ✅ |
| View audit log | – | – | – | ✅ |

---

## 8. Language & localization

- **Bilingual by default.** The entire interface and content are available in English and Kannada.
- **Each language is its own URL.** English pages live at the root (`/ward/57`); Kannada pages live under a `/kn/` prefix (`/kn/ward/57`), cross-linked with `hreflang`. This makes Kannada content indexable, shareable, and forwardable on its own — an RWA can forward the Kannada link directly. (Supersedes the earlier same-URL session toggle; see `docs/architecture.md` §4.)
- **Toggle for everyone.** Any user — anonymous or registered — can switch language from the app bar; the toggle navigates to the same page in the other language, and a cookie remembers the choice for the session.
- **Saved preference for registered users.** Registered users can set a preferred language (on `/account`) that persists across sessions and also governs the language of their email / WhatsApp updates.
- **Curator content.** Curators author in one language; the Kannada version is **machine-generated** (Anthropic API — see `docs/project-dependencies.md` §6.6), with **no human review step** — a decided trade. The citizen flag flow (§6) is the correction path for translation errors. A field whose translation is not yet available displays in the authored language with a subtle indicator.

---

## 9. Notifications & delivery
*Page: `/account/notifications`*

- Registered users receive ward-scoped updates from the fixed campaign calendar (§9.3): election dates and official notices, the electoral-roll deadline, candidate milestones (filed — sent once scrutiny completes, not at the notification; final after withdrawals), issue voting, and booth logistics. There is no ongoing candidate-change alert stream — candidate news arrives only at those milestones.
- Channels: email and/or WhatsApp, per the user's contact details and language preference.
- **Email is the baseline channel.** WhatsApp delivery depends on external template approval (§15), so registration nudges WhatsApp-first users to also provide an email address; no send waits on WhatsApp.
- Ward is the routing key; it is set via the address→ward lookup (not free text) so updates route correctly. Each send resolves its audience **at send time**: a user who changes home ward receives subsequent sends for the new ward, with no catch-up of sends the new ward has already received.

### 9.1 Ward data-readiness gating

- A ward-scoped send that references candidate data **must not go out to a ward whose data is not ready**. Each such send is gated per ward on a readiness check; unready wards are **held**, not sent.
- Rationale: sends are ward-scoped across 369 wards, and curator coverage will be uneven. Telling a citizen "your ward's report cards are complete" and landing them on an empty page is worse than sending nothing — and it would happen exactly when press attention peaks.

**A ward is ready when both of the following hold:**

1. **Completeness.** Every candidate standing in the ward (status *filed* or *contesting* — withdrawn and rejected candidates are excluded, §5.2) has a report card record; each carries name and party/independent; cases, assets, and education are either populated or explicitly marked *not declared*; and every field has a source (§11). "Not declared" is a valid, complete answer — it is a fact about the affidavit, not a gap.
2. **Curator sign-off.** A curator whose scope covers the ward has explicitly marked it ready (§7) — where scopes overlap, any covering curator's sign-off counts. The mechanical check alone cannot tell a thin ward from a finished one; a person who knows the ward can.

**Sign-off is cleared automatically when the ward's candidate set materially changes** — a new nomination or a withdrawal. Otherwise a ward signed off at the notification would still count as ready at E−2w, when the list it was signed off against no longer exists. In practice this means C2 requires a fresh sign-off after withdrawals close. The nomination-window churn this creates is **accepted, not deferred** (decided 2026-07-19): only L1 and C2 actually depend on sign-off, and the gap list on the readiness panel (IA §5.5) keeps a re-sign to a minute's work.

- Held wards must be visible to admins (`/admin/partners`), since a held ward is a curator-coverage gap that needs fixing, not a silent skip. Admins can override a hold and release the send — consistent with their oversight role (§7).
- Sign-off and override are both published changes and are therefore written to the audit log (§11).

### 9.2 Election-silence content freeze

- From **48 hours before poll close** until polls close, outbound comms are restricted to logistics only: booth location, poll timings, ID to carry, and how to vote.
- **No candidate content, comparisons, or issue-vote results** may be sent in this window. Representation of the People Act §126 bans electioneering during it; neutral sourced report cards are not worth testing against that line.
- **The campaign in fact goes further and sends nothing at all in the final 48 hours** — the last send is logistics at E−3d. This costs the election-morning reminder, the highest-converting send in a typical get-out-the-vote programme, and delivers booth details three days before they are used. It buys a campaign that cannot be accused of electioneering, on a platform whose entire worth is its neutrality.
- The freeze above therefore remains as a **guardrail**, not a description of the calendar: any send added later must satisfy it.
- The freeze applies to outbound messaging only. **The site itself remains fully available**, so a citizen who wants their booth on election morning can still get it.

### 9.3 Send cadence

- The campaign is a small, fixed set of ward-scoped sends (defined in the GTM spec), not an open-ended stream. WhatsApp opt-outs are permanent, so send volume is a budget to spend, not a dial to turn up.
- **Send codes used across this document** name the calendar's entries (`docs/gtm-plan.md` §4): **W1** welcome on registration · **R1** roll deadline (roll close −7d) · **L1** candidates filed (scrutiny complete) · **C1–C3** countdown sends (issue voting, final list, compare + booth) · **F1** final logistics at E−3d.
- Every send honours the user's saved language preference (§8) and their channel toggles on `/account/notifications`.

*Calendar, triggers, and per-message content: `docs/gtm-plan.md`.*

---

## 10. Authentication & access

- **One OTP mechanism for all roles.** Citizens, curators, and admins all authenticate via lightweight **email / WhatsApp OTP** — no passwords and **no 2FA**.
- **Email OTP is the baseline; WhatsApp OTP arrives with the Business API.** Sending an OTP over WhatsApp requires completed Meta onboarding and an approved Authentication-category template (`docs/project-dependencies.md` §3), so until that path completes — including all of Phase 0/1 curator and admin work — login is email-OTP only.
- **Registration/login is a popup.** It overlays the current page with no redirection, is openable directly from the **Sign in** control (available to unregistered visitors), from a **"Register for updates" prompt on ward pages** (§5.1), or auto-triggered by a gated action, and **resumes the exact action** after auth. A `/login` fallback page exists for deep links / no-JS.
- **The ward-page entry point pre-fills the home ward.** When registration is opened from a ward page's "Register for updates" prompt, the ward the citizen is already viewing is carried into the confirm step as their home ward — read-only, not re-asked — while language selection is unchanged. Registering via the **Sign in** control or a gated action still asks the citizen to pick their ward as today.
- **Registration is the consent act.** The confirm step links to `/terms` and `/privacy` and states plainly that registering signs the user up for ward election updates on their chosen channels; completing it is the affirmative opt-in, and the event (timestamp + wording version shown) is stored as the recorded opt-in evidence WhatsApp policy requires (`docs/project-dependencies.md` §3.10). The stated wording includes an **"I am 18 or older" assertion** — DPDP §9 makes consent from a minor invalid without verifiable parental consent, which this platform does not collect — recorded as part of the same consent event. No separate checkbox for consent itself. One optional checkbox does exist: **"tell me about future civic tools"** — unchecked by default, never required, recorded as part of the same consent event — so a deferred phase (§16) has a lawful list without stretching the election-updates consent (§5.16). The wording itself is legal-review input (§5.16).
- **One account per contact.** An email address or WhatsApp number belongs to at most one account. The Register/Login popup is a single flow, not two: an OTP verified against a known contact signs into that contact's account; a new contact creates one. An account may carry both an email and a WhatsApp number (§9) — either verified contact logs in. Contacts are added or changed on `/account`, each verified by an OTP sent to the new contact — this is the follow-up path for the WhatsApp-first email nudge (§9).
- **Role-based access control.** Curator edit/review rights are scoped to an assigned **set of wards** — the ward is the permission unit; "assign a zone" is an admin UI shortcut that expands to that zone's wards (so a zone-wide curator and a one-ward curator are the same mechanism). Admins have city-wide access.
- **Sessions.** Sliding 1-hour idle timeout for all roles; re-auth via OTP (`docs/architecture.md` §7).

---

## 11. Trust, neutrality & data provenance

- Every data point shows its source; official/affidavit data is visibly distinguished from curator-compiled context. Affidavit-sourced fields link to the stored affidavit PDF itself (§5.2).
- No editorial voice or endorsements; the platform presents facts and citizen signal only.
- Immutable audit trail on every published change supports both credibility and rollback.
- A public `/about` page explains sourcing and verification.

---

## 12. Non-functional requirements

- **Scale.** Must handle 369 wards and city-wide read traffic that spikes near the election date; anonymous read paths must stay fast with no login wall.
- **Authentication.** Single OTP mechanism (email / WhatsApp) across all roles; no passwords, no 2FA.
- **Security & integrity.** Role-based access control; curator edits scoped to assigned wards; full audit logging; rate-limiting on all contribution actions. Per the security architecture (`docs/architecture.md` §13): CSRF protection on all state-changing requests; security headers and a nonce-based CSP on every page; OTP verify caps and per-destination request cooldowns; encrypted off-box backups (the dump contains DPDP-regulated personal data); 1-hour idle session timeout across roles.
- **Reach.** Shareable, deep-linkable ward/candidate pages (for RWA forwarding); mobile-first; readable for a low-digital-literacy, bilingual audience.
- **Measurement.** Visitor and event data is tracked in **Google Analytics** across all public pages (page views, ward-finder usage, registration funnel events, language toggles), measured against the release targets of 300,000 unique visitors and 25,000 registered users (§2). Server-side application events remain the source of truth for registration and contribution counts. Google Analytics and its cookies are disclosed in `/privacy` (§5.16).
- **SEO / AEO.** Public pages render complete HTML server-side and carry structured data (JSON-LD), per-language sitemaps, `hreflang`, and Open Graph tags (the WhatsApp link preview is the first impression). Unlisted and private routes are `noindex`. Pre-notification candidate routes return 200 with their empty state so shared URLs accumulate search authority early.
- **Accessibility.** No formal conformance target (WCAG or otherwise) is committed this release — a deliberate scope decision, recorded here so the gap is visible rather than mislabelled.

---

## 13. Information architecture summary

Full detail is in the IA document. Each URL is a distinct page (one URL → one screen); modals overlay the current page with no URL change.

**Public:** `/` · `/ward/{id}` · `/ward/{id}/candidates` · `/candidate/{slug}` · `/ward/{id}/compare` · `/ward/{id}/issues` · `/check-registration` · `/about-election` · `/voting-guide` · `/voting-guide/voter-id` · `/voting-guide/how-to-vote` · `/voting-guide/find-booth` · `/about` · `/data` · `/partner-with-us` · `/press` · `/terms` · `/privacy` · `/partner/{partner-slug}` (unlisted)

The trust and legal pages (`/about`, `/data`, `/partner-with-us`, `/press`, `/terms`, `/privacy`) are reached from the **global footer**, not the app bar. None of them earn top-level space, but all must be one click from anywhere — the moment a citizen doubts the platform is the moment they go looking.

**Registered:** `/account` · `/account/notifications` · `/account/submissions`

**Curator:** `/curator` · `/curator/queue` · `/curator/queue/{submission-id}` · `/curator/candidate/{id}` · `/curator/ward/{id}` · `/curator/ward/{id}/issues`

**Admin:** `/admin` · `/admin/roles` · `/admin/users` · `/admin/audit` · `/admin/partners`

**Modals:** Register / Login (fallback `/login`) · Flag misinformation · Cast issue vote (top 3)

### 13.1 Phased launch

Pages do not all ship at once, because candidate data cannot exist before the EC notification (**N**).

- **Phase 0 (before the teaser).** `/privacy`, `/terms`. `/privacy` is the earliest page on the critical path — it gates WhatsApp onboarding, which gates the comms plan (§5.16). Internal tooling ships here too: the `/admin/*` suite (curator vetting and the EOI queue precede everything public) and the `/curator/*` suite (curators enter the ward data the teaser runs on).
- **Phase 1 (teaser).** `/`, `/ward/{id}`, `/ward/{id}/issues`, `/check-registration`, `/about-election`, `/voting-guide/*`, `/about`, `/partner/{slug}`, `/partner-with-us`, `/press` — plus, with registration open, `/account/*` and the `/login` fallback. The ward finder is the public entry point and the thing partners forward. **Issue voting opens with the teaser**: issue lists don't depend on candidates, the teaser gains a participation loop beyond "register and wait", and the city-wide roll-up starts accumulating months before C1. A ward whose curator has not yet defined issues shows an empty state; candidate-stance rows appear once candidates exist.
- **Phase 2 (at N).** `/ward/{id}/candidates`, `/candidate/{slug}`, `/ward/{id}/compare`, `/data` open up.

Before N, the candidate routes show the pre-nomination empty state already specified in IA §3.3 rather than 404ing — the URLs are shareable and will be shared early.

`/data` is held to Phase 2 for a different reason: it would be accurate in Phase 1 and still damaging, reading "14 of 369 wards" to anyone who looked.

---

## 14. Locked decisions

| Decision | Resolution |
|---|---|
| Curator publish gate | Curators are trusted; edits go live immediately, no second-person approval. |
| Authentication | Single OTP mechanism for all roles (citizen, curator, admin); no passwords, no 2FA. |
| Registration & flagging UX | Both are popups that overlay the current page — no redirection. The `/login` fallback page stays, for no-JS and deep links. |
| Anonymous contribution | Anonymous users see flag and issue-vote actions but are prompted to register at submit. |
| Issue-vote visibility | Aggregated issue-vote results are public and visible to anonymous citizens. |
| Issue-vote display | Ranked order with percentage shares on ward pages; no raw counts there — the total-votes figure lives on `/data` (§5.5). |
| Issue-vote scope | Registered citizens can vote only in their registered home ward. |
| Flagging scope | Registered citizens can flag misinformation across any ward. |
| Issue list ownership | The per-ward list of votable issues is defined by the curator. |
| Report card content | Includes links to news articles about the candidate — auto-suggested by the platform, visible only to curators until approved; nothing publishes unapproved (§5.2). |
| Comparison layout | 2-up with horizontal scroll through all candidates on mobile — no hard cap — with pinned field labels; more columns on wider screens (§5.3). |
| Affidavit ingestion | Curator uploads the EC affidavit (file or EC link); AI extracts the affidavit fields, which publish immediately marked *AI-extracted* until the curator confirms or edits them; the stored PDF is the public source link (§5.2). |
| Curator scope size | **Uncapped — an owned risk.** How many wards a curator is assigned is an admin judgement; nothing technical prevents a broad or city-wide scope. With publish-immediately trust and OTP-only login, scope is a curator's unreviewed blast radius; vetting, the audit log, and rollback are the nets. Uncapped scope lets coverage follow curator supply — the binding constraint across 369 wards. |
| Curator scoping unit | **Per-ward.** A curator's scope is a set of wards; "assign a zone" is an admin UI shortcut that expands to that zone's wards (§10). |
| Curator sourcing | Recruiting/vetting curators is an offline process, out of scope here — tracked as a dependency. |
| URLs | Every page has a distinct URL under `bengaluruvotes.opencity.in`. |
| Language URLs | English at the root, Kannada under `/kn/`, `hreflang`-linked; the app-bar toggle navigates between them (§8). |
| Production stack | Astro SSR monolith (TypeScript) + Postgres + nginx micro-cache, on the single-VM Docker Compose host; a CDN can be added in front later unchanged. Full design: `docs/architecture.md`. |
| Launch phasing | Ward + logistics pages ship first; candidate pages open at the EC notification (§13.1). |
| Distribution | Partner-led and unpaid — RWAs, civic orgs, press. No paid acquisition, on both cost and neutrality grounds. |
| Teaser asset | The ward finder itself, not a standalone "notify me" page. Citizens don't know their new ward; the finder answers that and captures ward at registration. |
| Election-silence rule | Outbound comms are logistics-only from 48h before poll close (§9.2) — and the campaign goes dark entirely after a final logistics send at E−3d. The site stays up. |
| Public metrics | `/data` publishes coverage, integrity, and the city-wide issue roll-up (§5.14). Figures only — no dataset downloads or API this release. Coverage counts published data (comms-held wards included), with a separate wards-signed-off-for-comms figure (§5.14). |
| Recruitment funnel | `/partner-with-us` collects anonymous expressions of interest for both paths; admins grant access. No self-service activation (§5.13). |
| Funding disclosure | `/about` **names each funder** (amounts optional) (§5.11). Neutrality is the product; its funding cannot be opaque, and categories alone invite the question the disclosure exists to close. |
| Legal page sequencing | `/privacy` ships in **Phase 0**, before the teaser — it gates WhatsApp onboarding and therefore the comms plan (§5.16). |
| Legal page languages | `/terms` and `/privacy` ship in English **and** Kannada; English is the legally controlling text, the Kannada version a marked courtesy translation (§5.16). |
| Press timing | The launch press push goes out **at N**, with a planned second beat at E−2w when the final list and complete report cards land (§5.15). |
| Future-phase consent | Registration carries an optional, unchecked **"tell me about future civic tools"** checkbox, recorded with the consent event — the lawful list for any deferred phase (§10, §5.16). |
| Ward send gating | Candidate-referencing sends are gated per ward on data readiness; unready wards are held (§9.1). |
| Ward readiness test | Field completeness **and** explicit curator sign-off. Sign-off clears when the ward's candidate set changes (§9.1); the nomination-window churn this creates is accepted — only L1 and C2 depend on sign-off. |
| Operator | The **Oorvani Foundation** runs the platform in production; named on `/about` and `/privacy`. |
| Citizen data use | Oorvani does not sell citizen data and shares it only with the service providers operating the platform — under contract, listed in `/privacy`, never for their own purposes (§5.16). Contacts are used for ward election updates and critical product updates only — the latter meaning service-affecting notices, not feature marketing. |
| Partner model | Partners are not a role. Attribution is a `?src=` parameter; the kit is an unlisted public page (§5.12). The kit, `/press`, and `/partner-with-us` are bilingual like every public path (§5.12). |
| Success metrics | **300,000 unique visitors** and **25,000 registered users** this release, with the ward-breadth guardrail (≥50 registrations in ≥300 of 369 wards) from the GTM plan (§2). |
| Analytics | Visitor and event data is tracked in **Google Analytics**; server-side application events remain the source of truth for registration and contribution counts; disclosed in `/privacy` (§5.16, §12). |

---

## 15. Dependencies & assumptions

*Summarised here; the full register — with owners, and every non-code dependency including commercial accounts and infrastructure — is `docs/project-dependencies.md`.*

- **Curator recruitment & vetting (offline).** Data quality depends on enough trusted curators with the right ward coverage. Hard dependency for launch. Also the source of the partner network below — the same people, recruited in the same conversations.
- **Partner network (offline).** Reach depends on RWAs and civic orgs forwarding ward links. Hard dependency for launch: with no paid channel, there is no fallback if this doesn't materialise.
- **Authoritative data sources.** Reliable access to EC affidavits, official notifications, and ward-delimitation data.
- **WhatsApp delivery.** Requires Business API access, approved templates, and explicit opt-in; email is the baseline, WhatsApp a fast-follow. Template approval runs to **weeks of lead time** (16 templates: seven sends plus the OTP login message, × EN/KN) and submission must start before the teaser ships. Approval does not gate the teaser — email carries every send until WhatsApp is approved. Onboarding additionally requires a **published `/privacy` URL** (§5.16), which makes the privacy policy the first item on the critical path.
- **Legal review.** `/terms` and `/privacy` need a lawyer, for DPDP Act 2023 compliance and contribution licensing. Not a product-spec deliverable, and it blocks Phase 0.
- **Press assets.** Logos, screenshots, and named spokespeople with approved quotes, for `/press` in Phase 1.
- **Electoral roll deadline.** Anchors the roll-deadline alert, the most time-critical send in the campaign. Moves independently of the notification and election dates, so it must be tracked separately.
- **Booth-level data.** The E−3d logistics send is only worth making if booth location resolves per citizen (§5.10). Without it, it and the E−1w send degrade to ward-level.
- **Election timeline.** Candidate content can only be populated near the official notification; ward and logistics tools can launch earlier.

---

## 16. Out of scope (future phases)

Promise / accountability tracking against elected corporators, ward budget transparency, a live civic-issue officer / "who to contact" directory, remote voting, and candidate outreach tooling.

Also out of scope this release: **open data downloads and a public API** — `/data` publishes figures, not datasets — and **self-service partner or curator activation**, since `/partner-with-us` collects applications that admins act on.

---

## 17. Open questions

*This section is the single home for open questions across all project documents — the IA and GTM plan point here rather than keeping their own lists. The subset that blocks work is also tracked in `docs/project-dependencies.md` §7, which exists to carry owners.*

*The 2026-07-19 review resolved fourteen formerly open questions; the resolutions live in §14 and the feature sections they affect (issue-vote display §5.5 · curator scoping unit §10 · compare layout §5.3 · news-link sourcing §5.2 · `/login` kept §10 · sign-off churn accepted §9.1 · no distinct pre-N Home state, IA §3.1 · readiness panel stays on the ward edit page, IA §5.5 · partner surfaces bilingual §5.12 · press timing §5.15 · `/data` held-ward counting §5.14 · future-tools consent checkbox §10 · funders named §5.11 · legal-page languages §5.16).*

**What remains open is external confirmation, not product decisions:**

- **Retention period — legal confirmation** (§5.16): the product proposal is decided — citizen contact data deleted or anonymized within **3 months of results being declared**, backups aging out on rotation. `/privacy` cannot ship until the lawyer confirms (or amends) the period, so this stays the Phase 0 blocker.
- **EVMs or paper ballots** — the `/voting-guide/how-to-vote` walkthrough is drafted for **EVMs** (Karnataka urban local-body practice, §5.9); confirm with the State Election Commission before that content publishes.
- **Is Citizen Matters an owned channel?** Likely — Oorvani publishes Citizen Matters alongside Open City — but unconfirmed. If confirmed, the GTM plan's cold-start assumption is wrong in the project's favour and Phase 1 distribution should be re-planned around it. *(= `docs/project-dependencies.md` 7.4)*

