# GBA Elections Citizen Platform — Information Architecture

**Status:** Draft v3 · **Frame:** Mobile-first · **Domain:** `bengaluruvotes.opencity.in` · **Date:** July 2026

This document defines every page and modal in the pre-election MVP. Each URL is a distinct page (one URL → one screen). Modals overlay the current page and do not have their own URL. Priority tags have been removed — the full scope is in build.

---

## 1. Conventions

- **Base domain:** all paths below are under `https://bengaluruvotes.opencity.in`.
- **Language in the URL:** every public path exists in both languages — English at the path shown, Kannada under a `/kn/` prefix (`/ward/57` ↔ `/kn/ward/57`), cross-linked with `hreflang`. The app-bar toggle navigates to the other language's URL. Each language variant is its own URL and its own screen, so "one URL → one screen" holds per language. (PRD §8; `docs/architecture.md` §4.)
- **Global elements (present on every page):** an **environment banner** above the app bar on deployed environments only (staging and production say which they are — design-system §7.14; nothing renders locally); app bar with logo, **language toggle (EN | ಕನ್ನಡ)**, and a **Sign in / Account** control; footer with links to About, the voting guide, Data, Partner with us, Press, Terms, and Privacy. The footer is the only route to the trust and legal pages — none of them earn app-bar space, but all of them must be one click from anywhere, because the moment a citizen doubts the platform is the moment they need them.
- **Pages vs modals:** a *page* has its own URL and can be deep-linked and shared. A *modal* is a popup that overlays whatever page the user is on, so the user never loses context and the URL does not change.
- **Access levels:** Anonymous (no account) · Registered (OTP account) · **Transcriber (OTP, no ward scope — bounded by the affidavit currently assigned to them, PRD §7)** · Curator (OTP, scoped to assigned wards — PRD §10) · Admin (OTP). Every privileged role uses the **same OTP login** as citizens — no separate password or 2FA. An admin can also generate a sign-in link and deliver it by hand, so staff access does not depend on any messaging vendor (PRD §10).
- **Contribution rule:** flag and issue-vote actions are visible to everyone but gated at submit — an anonymous user is shown the Register/Login popup first, then the action resumes.

---

## 2. Site map

```
bengaluruvotes.opencity.in
│
├─ PUBLIC (anonymous, read-only)
│   ├─ /                                 Home / Landing
│   ├─ /ward/{ward-id}                   Ward result
│   ├─ /ward/{ward-id}/candidates        Candidates in ward
│   ├─ /candidate/{candidate-slug}       Candidate report card
│   ├─ /ward/{ward-id}/compare           Compare candidates
│   ├─ /ward/{ward-id}/issues            Ward issues & voting
│   ├─ /check-registration               Check registration / eligibility
│   ├─ /about-election                   Election info / explainer
│   ├─ /voting-guide                     Voting guide (hub)
│   ├─ /voting-guide/voter-id            Voter-ID issuance & update
│   ├─ /voting-guide/how-to-vote         How to vote
│   ├─ /voting-guide/find-booth          Find polling booth
│   ├─ /about                            About us, funding & how we source data
│   ├─ /data                             Key metrics & city-wide issue picture
│   ├─ /donate                           Support the platform (links out)
│   ├─ /partner-with-us                  Ways to help: awareness / curate / transcribe
│   ├─ /press                            Press kit
│   ├─ /terms                            Terms & conditions
│   ├─ /privacy                          Privacy policy
│   └─ /partner/{partner-slug}           Partner kit (unlisted)
│
├─ REGISTERED CITIZEN (OTP)
│   ├─ /account                          My account (profile & language)
│   ├─ /account/notifications            Notification settings
│   └─ /account/submissions              My submissions (status)
│
├─ TRANSCRIBER (OTP, no ward scope)
│   ├─ /transcribe                       Queue — draw the next affidavit
│   └─ /transcribe/{assignment-id}       Read one affidavit, confirm or correct
│
├─ CURATOR (OTP, scoped)
│   ├─ /curator                          Curator dashboard
│   ├─ /curator/queue                    Citizen flag queue
│   ├─ /curator/queue/{submission-id}    Flag review
│   ├─ /curator/disputes                 Disputed fields (transcriber disagreement)
│   ├─ /curator/disputes/{dispute-id}    Resolve one disputed field
│   ├─ /curator/transcribers             Transcriber performance
│   ├─ /curator/candidate/{id}           Edit candidate
│   ├─ /curator/ward/{id}                Edit ward
│   └─ /curator/ward/{id}/issues         Define ward issue list
│
├─ ADMIN (OTP)
│   ├─ /admin                            Admin console
│   ├─ /admin/roles                      Roles & access
│   ├─ /admin/users                      Manage users
│   ├─ /admin/partners                   Partners & ward coverage
│   └─ /admin/audit                      Audit log
│
└─ MODALS (overlay current page, no dedicated URL)
    ├─ Register / Login          (fallback page: /login)
    ├─ Flag misinformation
    └─ Cast issue vote (top 3)
```

### 2.1 Which milestone opens which route

Build order is `docs/milestones.md`; this table is the route view of it. A route's milestone is when it first becomes reachable, not when its content is finished.

| Milestone | Routes |
|---|---|
| **M1** Ward discovery | `/` · `/ward/{id}` · `/ward/{id}/candidates` · `/candidate/{slug}` · `/ward/{id}/compare` · `/ward/{id}/issues` · `/check-registration` · `/about-election` · `/voting-guide/*` · `/about` |
| **M2** Donation | `/donate` |
| **M3** Partnerships | `/partner-with-us` · `/partner/{slug}` |
| **M4** Launch | `/press` · `/terms` · `/privacy` |
| **M5** Admin | `/admin` · `/admin/roles` · `/admin/users` · `/admin/partners` · `/admin/audit` |
| **M6** Curator & transcriber | `/transcribe/*` · `/curator/*` |
| **M7** Registered users | `/account/*` · `/login` · the Register/Login, Flag and Issue-vote modals |
| **M8** EC affidavits available | No new routes — `/candidate/{slug}` fills, and `/data` opens |
| **M9** Booth information available | No new routes — `/voting-guide/find-booth` starts resolving |

Three things this table makes explicit:

- **The candidate routes open at M1 with nothing in them.** They show the pre-nomination empty state (§3.3) rather than 404ing, because the URLs are shareable and M4 puts launch traffic on them months before a candidate exists. The empty state is an M1 deliverable, not a placeholder.
- **The last two milestones open no routes.** M8 and M9 fill pages that already exist — the candidate report card and the booth locator — because every URL is live and shareable from launch and the data arrives into it. Neither is visible as a new link; the test is whether an existing page starts answering.
- **The three modals and all contribution actions are M7.** Flag and issue-vote controls appear on public pages, but tapping them opens Register/Login — so on an anonymous-only platform they have nothing to open. If M7 is dropped (`docs/gtm-plan.md` §3.1), those controls come out rather than leading to a dead end.

---

## 3. Public pages

### 3.1 Home / Landing
- **URL:** `/`
- **Access:** Anonymous
- **Purpose:** Entry point; get the citizen to their ward and orient them to the election.
- **Key elements:** ward search (**address, with Google Places Autocomplete on the input, plus an optional "use my current location" control that JS injects where the browser supports geolocation** — pincode lookup was removed 2026-08-14; an out-of-GBA address gets an explicit "not in the GBA area" answer, PRD §5.1, an over-broad one gets "be more specific", and an outage gets "try again shortly"); election status + date countdown (the same element reads "notification awaited" before N — one Home page, no distinct pre-notification variant); the **roll deadline** until the roll closes (PRD §5.7); shortcuts to Check registration and the voting guide; **Sign in** in app bar.
- **Links to:** Ward result, Check registration, Voting guide, About-election; Register/Login modal.

### 3.2 Ward result
- **URL:** `/ward/{ward-id}`
- **Access:** Anonymous
- **Purpose:** Show the citizen their post-delimitation GBA ward and act as the hub for that ward.
- **Key elements:** new ward name + number + corporation (N/S/E/W/Central); boundary map; **register-for-updates slot** (opens the Register/Login modal, §7.1): anonymous visitors see "Register for updates," a visitor viewing their own home ward sees "Receiving updates," a visitor viewing any other ward sees nothing here. Home-ward switching lives on `/account` only (§4.1), not here.
- **Links to:** Candidates in ward, Ward issues & voting, Voting guide; opens Register/Login modal (register-for-updates slot).

### 3.3 Candidates in ward
- **URL:** `/ward/{ward-id}/candidates`
- **Access:** Anonymous
- **Purpose:** List all candidates standing in the ward.
- **Key elements:** candidate rows (photo, name, party/independent, lifecycle status — *provisional* marker until withdrawals close; withdrawn and scrutiny-rejected candidates shown with their status, PRD §5.2); Compare entry point; empty-state before nomination window; **register-for-updates slot** (same as §3.2).
- **Links to:** Candidate report card, Compare candidates; opens Register/Login modal (register-for-updates slot).

### 3.4 Candidate report card
- **URL:** `/candidate/{candidate-slug}` (slugs are unique city-wide — the ward is part of the slug so same-name candidates in different wards cannot collide)
- **Access:** Anonymous
- **Purpose:** A structured, neutral, sourced profile of a single candidate — the most-requested feature.
- **Key elements:** name/photo/party; a prominent **status banner** when the candidate is withdrawn or rejected at scrutiny — the URL stays live because the links have been shared (PRD §5.2); ward track record; criminal record / pending cases; declared assets; education; approachability; **links to news articles about the candidate**; source shown on every field (affidavit vs curator-compiled distinguished) — affidavit-sourced fields link to the stored affidavit PDF, and carry an *AI-extracted* marker until curator-confirmed (PRD §5.2); **Flag an error** action.
- **Links to:** Compare candidates, Ward issues; opens Flag modal.

### 3.5 Compare candidates
- **URL:** `/ward/{ward-id}/compare`
- **Access:** Anonymous
- **Purpose:** Compare candidates side by side.
- **Key elements:** column layout (not a feed); same field rows as the report card so they line up; only filed/contesting candidates — withdrawn and scrutiny-rejected candidates are excluded (PRD §5.2); 2-up on mobile with horizontal scroll through **all** candidates (no hard cap) and the field-label column pinned; more columns on wider screens; **register-for-updates slot** (same as §3.2).
- **Links to:** Candidate report card; opens Register/Login modal (register-for-updates slot).

### 3.6 Ward issues & voting
- **URL:** `/ward/{ward-id}/issues`
- **Access:** Anonymous (view results) · Registered (vote, home ward only)
- **Purpose:** Show the ward’s key issues, candidate stances, and citizen issue-voting results.
- **Key elements:** curator-defined issue list; candidate stance per issue (where available); **public results — ranked order with percentage shares** (no raw counts on this page; the total-votes figure lives on `/data`, PRD §5.5); “Vote your top 3” action; **register-for-updates slot** (same as §3.2).
- **Links to:** Candidate report card; opens Cast issue vote modal (and Register/Login modal if anonymous); opens Register/Login modal (register-for-updates slot).
- **Notes:** voting is limited to the user’s **registered home ward**. The page ships with **M1**; the **Vote your top 3** action is **M7** and contingent with it (PRD §13.1). A ward with no curator-defined issues yet shows an empty state, and candidate-stance rows appear once candidates exist.

### 3.7 Check registration / eligibility
- **URL:** `/check-registration`
- **Access:** Anonymous
- **Purpose:** Single authoritative place to confirm the citizen is on the GBA electoral roll.
- **Key elements:** eligibility basics stated before the link-out — 18 or older on the qualifying date (now quarterly), enrolment in one place only, documents needed (PRD §5.6); plain-language, bilingual explainer of how to check; prominent link out to the official EC / CEO Karnataka roll lookup (a guided link-out — no on-platform lookup, PRD §5.6); **roll-deadline countdown** until the roll closes; what to do if you're not on the roll (→ voter-ID guide).
- **Notes:** available early, before candidate data is populated.

### 3.8 Election info / explainer
- **URL:** `/about-election`
- **Access:** Anonymous
- **Purpose:** Explain the election to the “didn’t know this existed” segment.
- **Key elements:** election status + official-notice countdown; plain-language explainer of what a GBA corporator does and why the local vote matters.

### 3.9 Voting guide (hub)
- **URL:** `/voting-guide`
- **Access:** Anonymous
- **Purpose:** Walk a first-time voter through the logistics in order, and index the three guides.
- **Key elements:** an **ordered checklist** — check you're on the roll → enrol or transfer before the deadline → find your ward → read the candidates → find your booth → vote — each step deep-linking to the page that does the work (PRD §5.17); the roll deadline on the steps that expire; cards linking to Voter-ID, How to vote, Find polling booth.
- **Links to:** the three pages below; Check registration; Ward result.
- **Notes:** *This URL is the forwardable first-time voter link carried in partner kits (§3.19). The checklist assumes no prior knowledge — the last ward election was roughly a decade ago, so nearly everyone under thirty has never voted in one.*

### 3.10 Voter-ID issuance & update
- **URL:** `/voting-guide/voter-id`
- **Access:** Anonymous
- **Purpose:** Guide new enrolment and updating/transferring details when a citizen moves.
- **Key elements:** step-by-step for new voter (Form 6) and for address change/transfer; a named **"I'm registered in another city" path** — the vote does not follow you: Form 8 transfer before the roll closes, with proof-of-address guidance for renters and PG residents (PRD §5.8); roll-deadline countdown until the roll closes; deep links into official EC processes.

### 3.11 How to vote
- **URL:** `/voting-guide/how-to-vote`
- **Access:** Anonymous
- **Purpose:** Step-by-step guide to the voting-day process.
- **Key elements:** simple numbered steps; a first-timer FAQ — accepted documents when the EPIC hasn't arrived, voter slips, NOTA, what the ballot or machine looks like, what can't be taken inside (PRD §5.9); a "what's different about a ward election" block — one corporator per ward, the five-corporation GBA structure; bilingual; aimed at first-time and less-digital voters.

### 3.12 Find polling booth
- **URL:** `/voting-guide/find-booth`
- **Access:** Anonymous
- **Purpose:** Return the citizen’s correct, address-accurate polling booth.
- **Key elements:** lookup by **address** (no voter-ID entry — no voter details are entered or stored on the platform, PRD §5.10); booth location + map (not just a name); until booth-level data lands, the page says so and links out to the official EC booth lookup (PRD §5.10).
- **Notes:** *The page ships in **M1**, the data in **M9** — and the gap between them is expected to be months, so the empty state is what most visitors see for most of the campaign. Treat it as a real screen, not a placeholder: it has to say plainly that booth locations are published closer to the election, hand off to the official EC lookup, and be worth arriving at. M9 is the only milestone with **no assumed date at all** — nothing estimates when the EC publishes booth data, and nobody is tracking it (`docs/project-dependencies.md` §4.7).*

### 3.13 About us, funding & how we source data
- **URL:** `/about`
- **Access:** Anonymous
- **Purpose:** Establish trust — explain **who runs the platform**, who funds it, how data is sourced and verified, and the neutrality stance.
- **Key elements:** the operator — the **Oorvani Foundation**, the trust behind `opencity.in` — named plainly; team and mission; **funding disclosure**; the data commitments in citizen-readable terms (no sale; shared only with the service providers that run the platform; contacts used for election updates and critical product notices only); sourcing/verification explanation; contact; links to primary sources; link to `/partner-with-us`.
- **Notes:** *Added from the PRD cross-check (trust & provenance, PRD §11) — see Section 8. Funding disclosure added by the GTM plan: for a platform whose value is its neutrality, who pays for it is the first question a skeptical journalist asks, and the answer should not have to be requested. This page is the "about us" page — deliberately not split, since a citizen doubting the platform wants who-runs-it and how-it-sources-data in one place.*

### 3.14 Data & key metrics
- **URL:** `/data`
- **Access:** Anonymous
- **Purpose:** Hold the platform to its own standard, and show what Bengaluru cares about.
- **Key elements:**
  - **Coverage:** wards with published candidate data (against 369) — counting published data even where a ward is comms-held, with a separate **wards signed off for candidate comms** figure (PRD §5.14); report cards complete; active curators; sources cited.
  - **Integrity:** flags raised; flags resolved; median time to resolve.
  - **Citizen signal:** city-wide issue roll-up aggregated across all wards; total issue votes cast; registered citizens.
  - An **"as of" timestamp** on every figure.
- **Notes:** *Added by the GTM plan. **Opens with M8**, not with the early ward pages — before then it would honestly read "14 of 369 wards", which is damaging and hands critics a number. The issue roll-up says nothing until issue voting has volume, which needs M7. No dataset downloads or API this release — this page publishes figures, not data.*

### 3.15 Partner with us
- **URL:** `/partner-with-us`
- **Access:** Anonymous
- **Purpose:** Convert inbound interest into partners and curators — the online front door to what was otherwise a purely offline recruitment motion.
- **Key elements:** the two paths — **spread awareness** (forward ward links to your network; you get a kit, a tagged link, and a report of what it achieved) and **curate data** (own a ward's accuracy; you get scope, onboarding, and publish-immediately trust); time commitment for each; the vetting and neutrality expectation; a single **expression-of-interest form** covering both paths; links to `/about` and `/data`.
- **Notes:** *Added by the GTM plan. The EOI form is **anonymous — no account required**: requiring registration before someone can volunteer taxes exactly the people the plan depends on, and an RWA as an institution does not map onto a citizen account with a home ward. CAPTCHA-protected (PRD §6.3). Submissions are triaged at `/admin/partners`; curator applicants hand off to the existing vetting path at `/admin/roles`. Collecting an application is not granting access — no self-service activation.*

### 3.16 Press kit
- **URL:** `/press`
- **Access:** Anonymous
- **Purpose:** Let a journalist file an accurate story without needing to reach anyone.
- **Key elements:** boilerplate at three lengths (50/100/200 words); current key stats (drawn from `/data`); logos and screenshots for download; spokesperson bios and quotes; contact with a stated response time; the neutrality statement; link to sourcing methodology on `/about`.
- **Notes:** *Added by the GTM plan. Ships with **M4** even though it is really a notification-week asset — journalists arrive at the notification, and a press kit assembled then is assembled too late. The launch press push goes out at N, with a second beat at E−2w (PRD §5.15).*

### 3.17 Terms & conditions
- **URL:** `/terms`
- **Access:** Anonymous
- **Purpose:** Terms of use for the platform.
- **Key elements:** acceptable use; contribution licensing (flags, issue votes); liability and accuracy disclaimers; account termination grounds, consistent with the admin ban capability (PRD §7).
- **Notes:** *Added by the GTM plan. Needs legal review — the content is out of a product spec's competence.*

### 3.18 Privacy policy
- **URL:** `/privacy`
- **Access:** Anonymous
- **Purpose:** Disclose what personal data is collected, why, and what rights the citizen has over it.
- **Key elements:** the operator (**Oorvani Foundation**); what is collected (email, phone, address→ward, language, `src` attribution, standard server logs, and **Google Analytics** usage data and cookies) and why — visitor and event measurement uses Google Analytics, alongside server-side application events; the **data commitments** — no sale, sharing only with the service providers operating the platform (the processor inventory, PRD §5.16), contacts used only for ward election updates and critical product notices; WhatsApp/email consent and withdrawal; **DPDP Act 2023** notice, data-principal rights, and a named **grievance officer**; retention period; the fact that issue votes are published in aggregate.
- **Notes:** *Added by the GTM plan. **Gates M4 — the earliest page on the critical path.** Google Analytics is already live on the site, so the launch cannot happen without it. It separately gates WhatsApp Business API onboarding, since Meta requires a published privacy-policy URL, and therefore template approval and the entire comms plan. Needs legal review. "Critical product updates" must be drafted narrowly — service-affecting notices, not feature marketing — or it silently becomes the loophole the purpose limitation was meant to close. Still blocked on the retention period — see Section 9.*

### 3.19 Partner kit
- **URL:** `/partner/{partner-slug}`
- **Access:** Anonymous, **unlisted** (not indexed, not linked from navigation; no login wall — it holds nothing sensitive, and gating it would defeat its purpose). Bilingual like every public path (EN and `/kn/`), as are `/press` and `/partner-with-us` (PRD §5.12).
- **Purpose:** Give a distribution partner — an RWA, a civic org — everything needed to forward the platform to their network, and an answer ready when someone accuses them of campaigning.
- **Key elements:** the partner's tagged link (`/?src={partner-slug}`); ready-to-paste WhatsApp forward text in English and Kannada — a general message and a first-time voter variant linking the `/voting-guide` checklist (§3.9); a poster image sized for WhatsApp; a short neutrality statement.
- **Notes:** *Added from the GTM plan (PRD §5.12). Partners are **not a role** — this is a public page, and partner records are managed at `/admin/partners`. The unit of distribution is a message pasted into an apartment WhatsApp group, so the copy blocks matter more than the page design. Distinct from `/partner-with-us` (§3.15): that page recruits partners, this one equips an existing one.*

### 3.20 Donate
- **URL:** `/donate`
- **Access:** Anonymous. Bilingual like every public path.
- **Purpose:** Make the case for supporting the platform, and hand the citizen to Oorvani Foundation's existing donation flow.
- **Key elements:** what the platform costs to run and what a donation pays for; who the Oorvani Foundation is and its link to `/about`; the 80G position and what a donor receives; a single outbound **Donate** control to Oorvani's own donation page.
- **Notes:** *Added by the milestone plan (**M2**). **No payment is taken on this domain** — no payment vendor, no processor to add to the `/privacy` inventory, no card data in this codebase. That is what makes the page two days of work rather than a project of its own; embedded payments would be a separate scoped piece. Linked from the footer, not the app bar: a donation ask competing with the ward finder for attention on a civic platform costs more trust than it raises.*

---

## 4. Registered citizen pages

*All of §4 ships in **M7** and is contingent with it (`docs/gtm-plan.md` §3.1).*

### 4.1 My account (profile & language)
- **URL:** `/account`
- **Access:** Registered
- **Purpose:** Manage identity and language.
- **Key elements:** **saved language preference** (persists across sessions and sets the language of updates); home ward — changeable, and changing it retires any issue votes cast in the previous ward (PRD §5.5); contact details — email and/or WhatsApp number, where adding or changing one is verified by an OTP sent to the new contact (PRD §10); **sign out**.
- **Links to:** Notification settings, My submissions.

### 4.2 Notification settings
- **URL:** `/account/notifications`
- **Access:** Registered
- **Purpose:** Control what updates the user receives and how.
- **Key elements:** channel toggles (email / WhatsApp). No per-topic subscriptions — the campaign is a small fixed calendar of ward-scoped sends (PRD §9.3), so the only choice is how to receive it (or not at all).
- **Notes:** *Split out from the old combined account screen so each URL is one page.*

### 4.3 My submissions
- **URL:** `/account/submissions`
- **Access:** Registered
- **Purpose:** Let the user track everything they’ve submitted.
- **Key elements:** list of the user’s flags with **status — pending / accepted / rejected + reason**.

---

## 5. Curator & transcriber pages

*All **curator** pages are scoped to the curator’s assigned wards. The ward is the permission unit; “assign a zone” is an admin shortcut that expands to that zone’s wards (PRD §10).*

***Transcriber** pages (§5.7–5.8) are the exception: they carry no ward scope at all, because the queue is randomized city-wide (PRD §5.2). A transcriber's write access is bounded by the assignment they currently hold, not by a ward.*

*All of §5 ships in **M6**.*

### 5.1 Curator dashboard
- **URL:** `/curator`
- **Access:** Curator
- **Purpose:** Home for a curator’s work.
- **Key elements:** flag-queue count, **disputed-field count**, recent activity, quick entry to edit candidates/wards and define issues; **wards in the curator's scope awaiting readiness sign-off**, with those whose sign-off was cleared by a candidate-set change called out first.
- **Links to:** Flag queue, Disputed fields, Transcriber performance, Edit candidate, Edit ward, Define ward issue list.
- **Notes:** *The awaiting-sign-off list added by the GTM plan. A curator who does not know a ward is held will not sign it off, and the ward simply goes silent — the failure is invisible from the curator's side unless the dashboard says so.*

### 5.2 Flag queue
- **URL:** `/curator/queue`
- **Access:** Curator
- **Purpose:** Work through **citizen-submitted flags**. Distinct from the dispute queue (§5.9) — see PRD §6.4; the two are never merged.
- **Key elements:** queue items (deduped, with counts) for the curator’s wards; filter/sort. Queues are per-ward: where curator scopes overlap, the same item appears to every covering curator, and whoever acts first resolves it (PRD §6.1).
- **Links to:** Submission review.

### 5.3 Submission review
- **URL:** `/curator/queue/{submission-id}`
- **Access:** Curator
- **Purpose:** Review one submission and act on it.
- **Key elements:** the flag (with any suggested value and source it carries), current value, source; **accept** (make the correction + attach source) or **reject** (with reason); on accept, change publishes immediately and is audit-logged; the outcome appears as status on the submitter's `/account/submissions` (no outbound message is sent).
- **Notes:** *Added from the PRD cross-check (contribution/moderation, §6).*

### 5.4 Edit candidate
- **URL:** `/curator/candidate/{id}`
- **Access:** Curator
- **Purpose:** Create/correct a candidate record.
- **Key elements:** all report-card fields; **affidavit upload** — the EC affidavit PDF, or its EC link fetched and stored; AI extraction populates the affidavit fields (cases, assets, education, including *not declared*), which publish immediately marked *AI-extracted* until confirmed or edited here, with the stored PDF attached as their source (PRD §5.2); **news-article links** — review and approve the platform's auto-suggested links (visible only here until approved) or add links directly (PRD §5.2); **candidate lifecycle status** (filed / contesting / rejected / withdrawn, PRD §5.2); **source required per field**; edits publish immediately.

### 5.5 Edit ward
- **URL:** `/curator/ward/{id}`
- **Access:** Curator
- **Purpose:** Maintain ward-level information, and declare the ward ready for citizen comms.
- **Key elements:** ward metadata, boundary/mapping data, ward issues content; source per field; **readiness panel** — the mechanical completeness check for this ward shown as a pass/fail with the specific gaps listed, plus a **Mark ward ready** control (PRD §9.1).
- **Links to:** Define ward issue list.
- **Notes:** *Readiness panel added by the GTM plan. A ward receives candidate-related comms only when completeness passes **and** the curator signs off — the mechanical check cannot tell a thin ward from a finished one. Sign-off **clears automatically** when the ward's candidate set changes (nomination or withdrawal), so the curator re-signs after withdrawals close; showing the gaps rather than a bare fail is what makes the re-sign a minute's work rather than an investigation.*

### 5.6 Define ward issue list
- **URL:** `/curator/ward/{id}/issues`
- **Access:** Curator
- **Purpose:** Set the list of issues that citizens vote on for this ward.
- **Key elements:** add/edit/remove issues; this list powers the public Ward issues & voting page. Renaming an issue keeps existing votes attached; deleting one removes it from every vote-set that included it (PRD §5.5).

### 5.7 Transcription queue
- **URL:** `/transcribe`
- **Access:** **Transcriber** (also curator, admin)
- **Purpose:** Draw the next affidavit to read. There is nothing to browse and nothing to choose.
- **Key elements:** a single **Start the next affidavit** control; the transcriber's own counts (read today, read in total, current agreement rate); no list of candidates, wards or parties.
- **Notes:** *The absence of a list is the design, not an unfinished screen (PRD §5.2). A transcriber who can pick their next affidavit can pick their own ward or a candidate they have views about, and two such readings are not two independent readings. Anything that would let a transcriber steer what they are given — search, filters, a ward selector, even a skip button that reveals the next item — breaks the consensus guarantee this whole surface exists to produce.*
- **Links to:** Read affidavit.

### 5.8 Read affidavit
- **URL:** `/transcribe/{assignment-id}`
- **Access:** **Transcriber**, and only for an assignment currently held by them
- **Purpose:** Check the AI-extracted fields against the affidavit and confirm or correct each one.
- **Key elements:** the stored affidavit PDF beside the extracted key/value pairs; per field, **confirm** or **edit the value**; a **not legible** option, which is a real answer and not a skip; the candidate's name and ward shown as context but not editable here; submit commits the whole reading at once.
- **Notes:** *Keys are confirmed, not edited — the field set comes from Form 26 and a transcriber inventing a key would make two readings incomparable. Values are pre-filled with the AI's extraction, which is a known weakness: two transcribers confirming the same wrong value reach consensus on it (PRD §5.2). An assignment is held, not owned — if abandoned it returns to the queue for someone else, since a half-read affidavit that nobody can be given is a hole in the coverage.*

### 5.9 Disputed fields
- **URL:** `/curator/disputes`
- **Access:** Curator (scoped), Admin (all)
- **Purpose:** Work through fields where three transcribers read three different values (PRD §5.2).
- **Key elements:** one row per disputed field — candidate, ward, field name, and the three readings side by side; sorted by ward and by how long the dispute has been open.
- **Notes:** *A dispute has no submitter waiting for an outcome, which is exactly why it needs its own queue rather than being mixed into the flag queue (§5.2, PRD §6.4). A flag left unworked disappoints a citizen; a dispute left unworked leaves a candidate's record standing on an AI extraction nobody could confirm — quieter, and worse.*
- **Links to:** Resolve disputed field.

### 5.10 Resolve disputed field
- **URL:** `/curator/disputes/{dispute-id}`
- **Access:** Curator (scoped), Admin
- **Purpose:** Settle one disputed field against the source document.
- **Key elements:** the affidavit page in question; the three readings, each attributable; the currently published value; **accept one reading** or **enter a different value**; resolution publishes immediately and is audit-logged, and the field becomes *curator-confirmed*.

### 5.11 Transcriber performance
- **URL:** `/curator/transcribers`
- **Access:** Curator, Admin
- **Purpose:** Find the transcribers whose readings cannot be trusted.
- **Key elements:** per transcriber — agreement rate against accepted values, volume, share of disputes contributed, median time per affidavit; sortable; a link to an admin to block the account (§6.3).
- **Notes:** *Visible to curators and admins, never to other transcribers (PRD §7). In a volunteer cohort the only real sanction is removal, and removal needs evidence — an agreement rate well below the cohort's is that evidence. Read it as a screening tool, not a leaderboard: publishing a ranking to the cohort would optimise for speed, and speed is not what the second reading is for.*

---

## 6. Admin pages

### 6.1 Admin console
- **URL:** `/admin`
- **Access:** Admin
- **Purpose:** Governance home.
- **Links to:** Roles & access, Manage users, Partners & ward coverage, Audit log.

### 6.2 Roles & access
- **URL:** `/admin/roles`
- **Access:** Admin
- **Purpose:** Manage the transcriber/curator/admin roster and scope.
- **Key elements:** invite/vet curators **and transcribers**; grant/revoke roles; assign/adjust curator ward scope — per-ward, with a zone shortcut that expands to the zone’s wards (PRD §10). **Transcribers take no scope** — the field does not appear for them, because their queue is randomized city-wide (PRD §5.2).
- **Notes:** *Transcriber invitation is deliberately here rather than self-serve. The consensus mechanism is a data-quality net, not a substitute for knowing who is reading candidates' affidavits (PRD §14).*

### 6.3 Manage users
- **URL:** `/admin/users`
- **Access:** Admin
- **Purpose:** Add, block and unblock accounts across every role, and manage abuse.
- **Key elements:** search users; **add a user with a role** (transcriber / curator / admin) and, for curators, a ward or zone scope; **generate a sign-in link** for an admin to deliver by hand; block and unblock accounts, where **blocking ends live sessions rather than only future logins**; view submission history.
- **Notes:** *Ships in **M5**. The sign-in link is what makes staff access independent of every messaging vendor — no SendGrid, no Twilio, no Meta verification (PRD §10) — so admins, curators and transcribers can work even if M7 is abandoned outright. It is a floor rather than a plan: at a transcriber cohort's scale, issuing links by hand every day is somebody's job, so email OTP should be provisioned before the cohort arrives. `npm run seed:admin` remains the only way the first admin exists.*

### 6.4 Partners & ward coverage
- **URL:** `/admin/partners`
- **Access:** Admin
- **Purpose:** Manage the distribution partner roster and watch reach across the city.
- **Key elements:** add/edit partners and their slugs; registrations attributed per partner; **partner → ward coverage against all 369 wards**, with the uncovered set surfaced as a work queue; wards currently **held** from candidate comms for failing the data-readiness check (PRD §9.1), with an override; the **expression-of-interest queue** from `/partner-with-us`, split by path (spread awareness / curate data / transcribe affidavits), with accept/decline.
- **Notes:** *Added from the GTM plan. Coverage is the early warning for reach skewing to affluent central wards; the held-wards list is the early warning for curator gaps. Accepting an awareness applicant provisions a partner slug and kit page; accepting a curation applicant hands off to `/admin/roles`, which already owns curator vetting and ward scope — the two queues stay separate because granting a role is a different act from listing a partner.*

### 6.5 Audit log
- **URL:** `/admin/audit`
- **Access:** Admin
- **Purpose:** Immutable record of all changes.
- **Key elements:** who changed what, when, and from which source; across all wards; supports rollback.

---

## 7. Modals

Modals overlay the current page and never change the URL, so the citizen never loses their place.

*All three modals ship in **M7** and are contingent with it. The flag and issue-vote controls that open them appear on public pages from M1, but have nothing to open until M7 exists — if M7 is dropped, the controls come out rather than leading nowhere (§2.1).*

### 7.1 Register / Login
- **Trigger:** the **Sign in** control (available to any unregistered visitor), any gated action (flag / vote), or the **register-for-updates slot** on a ward page (§3.2/3.3/3.5/3.6).
- **Fallback page:** `/login` (for deep links / no-JS); on success it returns the user to the page they came from, or `/` when there is none.
- **Key elements:** email or WhatsApp entry → **OTP** → confirm ward + language. No passwords, no 2FA. WhatsApp-first users are nudged to also add an email address — email is the baseline delivery channel (PRD §9).
- **Consent:** the confirm step carries links to `/terms` and `/privacy` plus one plain sentence stating what registering signs you up for (ward election updates by the chosen channels), and one optional, unchecked **"tell me about future civic tools"** checkbox recorded with the same event (PRD §10). Completing registration is the affirmative act; the system stores the event — timestamp plus the wording version shown — as the opt-in evidence WhatsApp policy requires (PRD §10; `docs/project-dependencies.md` §3.10). The exact wording is legal-review input.
- **Behaviour:** on success, **resumes the exact action** the user attempted, in place. When opened from a ward page's register-for-updates slot, the confirm step shows that ward pre-filled and read-only instead of asking the visitor to pick one — language selection is unchanged.

### 7.2 Flag misinformation
- **Trigger:** the Flag action, present wherever curator-maintained data is shown — the candidate report card, the ward result page, and the ward issues page — **on any ward** (not just the home ward) (PRD §6.1).
- **Key elements:** pick the field/claim that’s wrong; free-text detail + optional source; submit.
- **Behaviour:** if anonymous, the Register/Login modal shows first, then this reopens; on submit the flag lands in that ward's review queue — visible to every curator whose scope covers the ward, and to admins — and is audit-logged (PRD §6.1).

### 7.3 Cast issue vote (top 3)
- **Trigger:** the “Vote your top 3” action on the Ward issues page.
- **Key elements:** select one to three issues from the curator-defined list; submit — submitting replaces any previous set (PRD §5.5); changeable later.
- **Behaviour:** if anonymous, Register/Login modal shows first; voting is restricted to the user’s **registered home ward**; one active vote-set per user — changing home ward retires the previous ward’s votes (PRD §5.5).

---

## 8. PRD coverage cross-check

Confirms every PRD capability maps to a page/modal, and highlights the four pages/modals added while doing this check.

| PRD reference | Covered by |
|---|---|
| 5.1 Ward identity lookup | `/`, `/ward/{id}` |
| 5.2 Candidate report card (incl. news links) | `/candidate/{slug}` |
| 5.3 Candidate comparison | `/ward/{id}/compare` |
| 5.4 Ward issues & candidate stance | `/ward/{id}/issues` |
| 5.5 Citizen issue voting | `/ward/{id}/issues` + Cast issue vote modal |
| 5.6 Roll / eligibility check | `/check-registration` |
| 5.7 Election awareness | `/about-election` (+ Home banner) |
| 5.8 Voter-ID issuance & update/transfer | `/voting-guide/voter-id` |
| 5.9 How to vote | `/voting-guide/how-to-vote` |
| 5.10 Polling-booth locator | `/voting-guide/find-booth` |
| §6 Contribution & moderation | Flag modal, `/curator/queue`, `/curator/queue/{id}` |
| §7 Roles & permissions | Auth across all curator/admin pages |
| §8 Language toggle & saved preference | Global toggle + `/account` |
| §9 Notifications & delivery | `/account/notifications` |
| 5.12 Partner attribution & kit | `/partner/{slug}`, `?src=` on any page, `/admin/partners` |
| 5.13 Recruitment funnel | `/partner-with-us` + EOI queue on `/admin/partners`, handing off to `/admin/roles` |
| 5.14 Public data & metrics | `/data` |
| 5.15 Press kit | `/press` |
| 5.16 Legal pages | `/terms`, `/privacy` |
| 5.17 First-time voter checklist | `/voting-guide` (hub checklist) + roll deadline / eligibility / transfer-path / FAQ elements on `/`, `/check-registration`, `/voting-guide/voter-id`, `/voting-guide/how-to-vote` |
| §9.1 Ward data-readiness gating | `/curator/ward/{id}` (readiness panel + sign-off), `/curator` (awaiting sign-off), `/admin/partners` (held-wards view + override) |
| §13.1 Phased launch | Candidate routes show the §3.3 empty state before notification |
| §11 Trust, neutrality & provenance | Sources on report card; `/about` (incl. funding disclosure); `/admin/audit` |
| Registration | Register/Login modal (`/login` fallback) |
| Curator: define issues | `/curator/ward/{id}/issues` |
| Admin: roles & scope | `/admin/roles` |
| Admin: deactivate/ban | `/admin/users` |
| Admin: audit | `/admin/audit` |

**Gaps found and added this revision:** `/about` (trust/sourcing page), `/account/notifications` (split from account), `/curator/queue/{submission-id}` (submission review), `/admin/users` (account moderation).

**Added by the GTM plan:** `/partner/{partner-slug}` (partner kit, unlisted public), `/admin/partners` (partner roster, ward coverage, held-wards view, EOI queue), `/partner-with-us` (recruitment), `/data` (metrics), `/press` (press kit), `/terms` and `/privacy` (legal). The last two are not hygiene: `/privacy` gates WhatsApp onboarding and therefore the whole comms plan.

---

## 9. Open questions

Open questions are tracked in one place: **`docs/prd.md` §17**. The IA-raised subset — issue-vote display format, curator scoping unit, the mobile compare limit, news-link sourcing, the `/login` fallback, kit/press/partner-with-us localisation, the home page's pre-notification state, and the readiness panel's placement — was **resolved on 2026-07-19**; the resolutions are recorded in the PRD (§14 and the sections §17 points to) and reflected on the pages above. What remains open is listed in PRD §17.