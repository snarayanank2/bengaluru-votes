# GBA Elections Citizen Platform — Stakeholder Overview

**Status:** Draft v2 (for review) · **Scope:** Pre-election MVP · **Owner:** Product · **Domain:** `bengaluruvotes.opencity.in` · **Date:** July 2026

> A high-level overview of the platform, its user roles, and what each role can do — for stakeholder alignment before detailed design and engineering. Full detail lives in the **PRD** and **Information Architecture** documents.

---

## 1. Purpose

Bengaluru is heading into its first ward-level (GBA / corporator) elections in roughly a decade. Citizen interviews showed people are willing to vote but blocked by a few specific gaps: they don't know which ward they now belong to, they can't find trustworthy information about local candidates, and existing sources feel biased or unreliable. These gaps are widest for first-time voters — an unusually large group this election: after a decade without ward polls, nearly everyone under thirty, plus anyone who has moved to Bengaluru since, has never voted for a corporator.

The platform makes trustworthy, ward-level election information easy to find, compare, and act on — and gives citizens a voice in which local issues matter. Success for this release is measured as **300,000 unique visitors**, plus **25,000 registered users** if registered-user support ships in time — that half is contingent, and `docs/milestones.md` §11 says why. **This release is pre-election only.** Promise tracking, ward budgets, and a live civic-issue directory are deferred to a later phase.

---

## 2. What the platform does

At a high level, the platform lets a citizen:

- Find their **new GBA ward** and see who is standing there.
- Read neutral, **sourced candidate report cards** (track record, cases, assets, education, news coverage) and compare candidates side by side.
- See the **key issues** in their ward and **vote on the top 3** that matter to them.
- Handle the logistics: **check registration**, **issue or update a voter ID**, learn **how to vote**, and **find their polling booth** — presented as an ordered checklist a first-time voter can follow end to end.
- Use everything in **English or Kannada**.

A small trusted team keeps the data accurate and governs access behind the scenes.

---

## 3. Roles at a glance

| Role | Who they are | Primary job |
|---|---|---|
| **Anonymous citizen** | Any visitor, no account | Find & read information; see (but not cast) flags and issue votes |
| **Registered citizen** | Signs up with email/WhatsApp + ward + language | Get updates; flag misinformation; vote on ward issues |
| **Transcriber** | Invited volunteer; reads Kannada; no ward of their own | Check the AI-extracted fields on one candidate affidavit at a time |
| **Data curator** | Trusted, vetted individual (ward/zone-scoped) | Resolve disagreements between transcribers; correct anything; define ward issues; review flags; sign candidates off |
| **Admin** | Small internal team | Manage roles, access, users, and oversight |

**One guiding principle:** the two citizen contributions — flagging an error and voting on issues — are **visible to everyone but require registration at the moment of submitting**. Anonymous users see the buttons; tapping one opens a quick sign-up popup, then the action continues.

---

## 4. Roles & key functionalities

### 4.1 Anonymous citizen
*Any visitor, no account — the vast majority of traffic. No login wall; pages are shareable so RWAs and community groups can forward them.*

- Search and browse all published information: find their new GBA ward, view candidate report cards, compare candidates, and read ward issues.
- Access voting logistics: check registration/eligibility, locate their polling booth, and read how-to-vote and voter-ID guidance.
- See public issue-vote results for any ward, and see the flag and vote buttons — tapping either prompts them to register.
- On any page for their ward, see a **"Register for updates"** prompt — tapping it opens the same sign-up popup, with that ward carried through as their home ward once they complete it.
- **Out of scope:** no subscriptions, no submitting, no editing. Fully read-only.

### 4.2 Registered citizen
*Signs up with email and/or WhatsApp, their ward, and a language preference. Everything the anonymous user can do, plus:*

- Receive **ward-scoped updates** (election dates and notices, the roll deadline, candidate milestones, booth logistics) by email / WhatsApp, in their preferred language.
- **Flag misinformation** on any ward or candidate — across **any ward**, via a popup.
- **Vote on their top 3 issues**, but only in their **registered home ward**.
- **Track the status of their submissions** — each flag shown as pending / accepted / rejected with a reason.
- Set a **saved language preference** that also governs the language of their updates.

### 4.3 Transcriber
*An invited volunteer who checks affidavits. The role exists because the numbers demand it: roughly 4,000 candidates, each with a scanned EC affidavit, many handwritten in Kannada, arriving in the four weeks before report cards are due.*

- Is handed **one affidavit at a time from a randomized, city-wide queue** — and cannot choose the ward, the party, or the candidate.
- Sees the AI-extracted fields beside the affidavit and either **confirms each value or corrects it**.
- **Every affidavit is read by two transcribers.** If they agree, the value is marked verified. If they disagree, a third reads it; if two of the three agree, that value stands. If all three differ, it goes to a curator.
- **Out of scope:** no ward ownership, no editing anything but an affidavit currently assigned to them, no say in what they are given next.

*Why the queue is randomized:* two people who each chose to read the same ward, for the same reason, are not two independent readings. Removing the choice is what makes the second reading worth having.

### 4.4 Data curator
*A trusted, vetted individual responsible for data accuracy, scoped to a set of wards or a zone. Because curators are trusted, their edits go live immediately — no second approval. Curators no longer transcribe; they exercise judgement over what the transcribers produced.*

- **Resolve disputes** — fields where three transcribers read three different values.
- Correct **any** field, disputed or not. A curator does not need a dispute as an excuse to fix something wrong.
- Create, upload, and correct ward and candidate information, including **links to news articles** about candidates.
- Upload each candidate's **EC affidavit** (or its EC link), which starts the extraction and transcription flow above.
- **Mark a candidate complete** — a coverage signal feeding ward readiness, not a gate on what citizens can see.
- **See how each transcriber is doing** — agreement rate, volume, disputes contributed — so a poor reader can be found and removed.
- **Define the list of votable issues** for each ward (this powers citizen issue voting).
- Review the queue of citizen flags, and accept them (making the correction) or reject them (with a reason the submitter can see).
- Attach a **source** to every record and change, so the public view can show its provenance.
- **Scope note:** with 369 wards, curators are assigned to a set of wards/zone rather than the whole city.

### 4.5 Admin
*A small internal team that governs people and access rather than day-to-day content.*

- Manage roles and access: invite and vet **transcribers and curators**, grant/revoke roles, and set a curator's ward scope.
- **Add and block users**, including deactivating or banning abusive accounts — blocking ends live sessions, not just future logins.
- **Issue a sign-in link by hand** when needed, so staff access never depends on a messaging vendor being live.
- Act as an oversight super-user across all wards, able to correct or roll back any record.
- Access the full audit log of who changed what, when, and from which source.

---

## 5. How citizen contributions become live data

The correction loop connects citizens and curators. Both flagging and voting happen through **popups** that overlay the current page, so citizens never lose their place.

1. **Notice an error / want to vote** — anyone can tap Flag or Vote. Anonymous users see a sign-up popup first; registered users proceed.
2. **Submit** — a flag routes to the curator whose scope covers that ward; an issue vote is recorded for the user's home ward.
3. **Review** — the curator sees the flag, the current value, and the source, and accepts (edit + source) or rejects (with reason).
4. **Publish** — accepted edits go live immediately, because curators are trusted.
5. **Record** — every change is written to an immutable audit log; the submitter sees the outcome as status on their submissions page.

---

## 6. Language & access highlights

- **Bilingual by default** — the whole platform works in **English and Kannada**; each language has its own shareable URL (Kannada under `/kn/`), with a toggle available to everyone and a saved preference for registered users.
- **One simple login** — citizens, transcribers, curators and admins all sign in the same way, via **email / WhatsApp OTP** (no passwords, no 2FA).
- **No redirects** — registration and flagging are popups, so users stay on the page they were reading.
- **Distinct URLs** — every page has its own shareable link under `bengaluruvotes.opencity.in`.

---

## 7. Locked decisions

| Decision | Resolution |
|---|---|
| Curator publish gate | Curators are trusted; edits go live immediately, no second approval. |
| Authentication | One OTP mechanism for all roles; no passwords, no 2FA. |
| Registration & flagging | Both are popups — no redirection. |
| Anonymous contribution | Sees flag and vote actions; prompted to register at submit. |
| Issue-vote visibility | Aggregated results are public, visible to anonymous citizens. |
| Issue-vote scope | Registered citizens vote only in their home ward. |
| Flagging scope | Registered citizens can flag across any ward. |
| Issue list ownership | Defined by the curator, per ward. |
| Report card content | Includes curator-maintained links to news articles. |
| Curator scope size | No cap on how many wards a curator is assigned — an admin judgement. An owned risk: vetting, the audit log, and rollback are the nets. |
| Affidavit verification | Two transcribers read every affidavit; a third settles a disagreement; three different readings go to a curator. Values publish throughout, labelled with how far they have got. |
| Transcriber queue | Randomized and city-wide. Nobody chooses the ward, party or candidate they read. |
| Transcriber sourcing | Invited by an admin, not open sign-up. Recruiting transcribers **and** curators is an offline effort — tracked as a dependency. |
| Launch phasing | **Seven milestones** replace the earlier phase plan (`docs/milestones.md`). Ward finder and voting logistics launch first; candidate content follows at the EC notification. |
| Registered users | **Last, and abandonable.** Accounts, updates, issue voting and flagging are the final milestone, behind prerequisites that are external and unowned. If they don't land, the platform ships anonymous-only. |
| Distribution | Partner-led (RWAs, civic orgs, press). **No paid acquisition** — it costs money the project lacks and undercuts the neutrality claim. |
| Election-silence rule | From 48h before poll close, all outbound comms are logistics only — no candidate content. In practice we go further: the last send is booth logistics at E−3d, then nothing. The site stays up. |
| Partner recruitment | Runs in the same conversations as curator recruitment; the two pools are the same people. `/partner-with-us` opens the same funnel to anyone. |
| Operator | The **Oorvani Foundation** — the trust behind `opencity.in` — runs the platform in production, and is named on the About and Privacy pages. |
| Citizen data use | Oorvani does not sell citizen data, and shares it only with the service providers that operate the platform — under contract, listed in the privacy policy, never for their own purposes. Contacts are used for ward election updates and critical product notices only — service-affecting messages, not feature marketing. |
| Funding disclosure | The About page states who funds the platform. Neutrality is the product; its funding cannot be opaque. |
| Ward readiness | A ward receives candidate comms only when its data passes a completeness check **and** its curator signs off. Sign-off clears when the candidate list changes. |
| Release targets | **300,000 unique visitors** — unconditional. **~25,000 registrations, with at least 50 in at least 300 of the 369 wards** — contingent on the registered-user milestone landing in time; withdrawn rather than missed if it does not. |
| Analytics | Visitor and event data is tracked in **Google Analytics**, disclosed in the privacy policy; registration counts come from our own application events. |
| Public metrics | A Data page publishes our own coverage and integrity figures, plus a city-wide issue picture. Figures, not downloadable datasets. |
| Legal sequencing | The privacy policy publishes **before the public launch**. Google Analytics is already live, so launching without it is not an option; and Meta gates WhatsApp onboarding on it, so it also gates the comms plan. |

---

## 8. Key dependencies

*The ones stakeholders should know about are below. The complete register — legal, official data, people, commercial accounts, and the decisions blocking each — is `docs/project-dependencies.md`. Nearly everything that gates this launch sits outside the codebase.*

- **Curator recruitment & vetting (offline)** — data quality depends on enough trusted curators with the right ward coverage. A hard dependency for launch. **Doubles as partner recruitment** (see below).
- **A transcriber cohort (offline)** — new, and the dependency nobody has sized against people: about **8,000 affidavit readings**, most of them handwritten Kannada, in the four weeks between nominations closing and report cards being due. Kannada reading is a hard requirement. This is the binding constraint on candidate data, not the software.
- **Partner network (offline)** — reach depends on RWAs and civic orgs forwarding ward links to their networks. A hard dependency for launch, since there is no paid channel to fall back on.
- **Authoritative data sources** — reliable access to EC affidavits, official notifications, and ward-delimitation data.
- **WhatsApp delivery** — needs Business API access, approved templates, and opt-in; email is the baseline. Template approval carries **weeks of lead time** (16 templates across English and Kannada — seven sends plus the OTP login message) and must start as soon as the privacy policy is published. Onboarding also requires a **published privacy policy**, which puts that page first on the critical path.
- **Legal review (external)** — the terms and privacy policy need a lawyer, for DPDP Act 2023 compliance and contribution licensing. Blocks the network phase, not launch week.
- **Press assets** — logos, screenshots, and named spokespeople with approved quotes, for the press kit.
- **Electoral roll deadline** — the date that anchors the roll-deadline alert, the single most time-critical message we send. Moves independently of the election date.
- **Election timeline** — candidate content can only be populated near the official notification; ward and logistics tools can launch earlier.

---

## 9. Out of scope (future phases)

Promise / accountability tracking, ward budget transparency, a live civic-issue officer directory, remote voting, and candidate outreach tooling.

---

## 10. Milestones & citizen comms

The platform does not launch in one moment. Candidate data cannot exist until the Election Commission's notification, but the ward finder and voting logistics are useful months earlier — and useful early is what earns the audience we need later.

**Nine milestones**, each a slice of change a citizen can see and someone can test. Full detail: `docs/milestones.md`.

| # | Milestone | What it puts in front of someone | Size |
|---|---|---|---|
| **M1** | Ward discovery | An unregistered visitor finds their ward and gets a page worth reading — including where we have no candidate data yet | 1w |
| **M2** | Donation page | The case for supporting the platform, linking to Oorvani's donation flow | 1d |
| **M3** | Partnerships page | The front door for RWAs, colleges and civic orgs who want to help | 2d |
| **M4** | Launch | The public moment: press, cross-links, social campaigns, direct outreach | 5d |
| **M5** | Admin | Adding and blocking users without a shell on the server | 3d |
| **M6** | Curator & transcriber | The machinery that turns 4,000 scanned affidavits into checked report cards | 5d |
| **M7** | Registered users | Accounts, updates, issue voting, flagging | 5d |
| **M8** | Candidate EC affidavits are available | Bulk affidavit ingestion and AI extraction — the milestone that makes report cards exist at all | 5d |
| **M9** | Polling booth information available | Booth data loaded, and the booth locator starts answering | 2d |

Two things stakeholders should take from this list rather than from the sizes.

**M1–M4 are almost entirely blocked by things that are not code.** The Janaagraha cross-link agreement, a donation URL, a named partnerships lead, and — decisively — a published privacy policy and terms. The engineering in the first four milestones is about two and a half weeks. Whether they ship on that timescale is not an engineering question.

**M6 is the largest piece of work and the one whose deadline we do not set.** Nominations close around 26 October and report cards are due around 17 November. Two readings of roughly 4,000 affidavits is about 8,000 transcriptions, most of them handwritten Kannada, inside that window. The software is three weeks; the cohort of people to do the reading does not yet exist.

### The comms plan is now contingent

**Citizen comms** are seven ward-scoped sends over the campaign, by email and WhatsApp in the citizen's saved language. Deliberately few: WhatsApp opt-outs are permanent, and over-sending in the quiet months would cost us the list exactly when the election beats arrive. The sequence runs welcome → **electoral roll deadline** → candidates filed → issue voting → final report cards → compare → booth logistics at E−3d.

**All of it depends on M7, which is last and abandonable.** A list cannot be built by a feature that does not exist yet. The decision taken on 2026-08-14 is to plan for reach through the anonymous ward finder and the partner cascade, and to treat the seven sends as a second track with a go/no-go date — if the prerequisites have not landed by then, the calendar is **dropped rather than compressed** into the final fortnight. `docs/gtm-plan.md` §3.1 carries the reasoning and the proposed date.

Three points deserve stakeholder attention:

- **The roll-deadline alert is the highest-value message we send, and it is the first thing we lose.** Missing the roll is the only failure in this funnel that cannot be undone — no amount of good candidate information helps someone who isn't registered to vote. Without M7 there is no send; the deadline is carried on the site itself and by whatever partners forward, which is a weaker instrument and is not claimed to be otherwise.
- **We never send a promise our data can't keep.** A ward only receives candidate-related comms once its data passes a completeness check *and* its curator has signed the ward off. A ward that fails either is held back rather than sent to an empty page, and the sign-off clears whenever the candidate list changes — so nobody is vouching for a list that has since moved.
- **We go quiet for the last 48 hours.** The Representation of the People Act bans electioneering in that window. Rather than argue that neutral report cards aren't electioneering, we simply stop — the last send is booth logistics three days out. This gives up the election-morning reminder, the single highest-converting message in a normal campaign. It buys a platform nobody can accuse of campaigning, which is the only asset we actually have. The site stays fully available throughout.

---

## 11. Trust surfaces & recruitment

Three public pages carry the neutrality claim. **About** names the operator — the **Oorvani Foundation**, the trust behind `opencity.in` — says how we source data, and, added here, **who funds us**, because that is the first question a skeptical journalist asks. It also states Oorvani's commitments in plain words: we do not sell citizen data, we share it only with the services that deliver the platform's own messages, and we use contact details for ward election updates and critical service notices only. Saying that on the page citizens actually read, rather than only in the privacy policy, is what earns a phone number. **Data** publishes our own coverage and integrity figures alongside a city-wide picture of what Bengaluru's wards say matters; a platform that publishes other people's records should publish its own. **Press kit** ships early, since journalists arrive at the notification and a kit assembled then is assembled too late.

**Partner with us** turns recruitment from a private motion into a public one, offering the three ways to help — *spread awareness*, *curate data*, or *transcribe affidavits* — and taking applications from anyone. The team's own address book does not stretch to 369 wards, and it is precisely where a central-Bengaluru skew would come from.

One sequencing point worth stakeholder attention: the **privacy policy is the first thing we must publish**, before the public launch. Meta will not approve WhatsApp onboarding without a live privacy-policy URL, so it gates the templates, which gate the entire comms plan. It also needs a lawyer — India's DPDP Act applies squarely to what we collect. The retention proposal is now decided product-side — citizen contact data deleted or anonymized within **3 months of results being declared** — and the privacy policy waits only on the lawyer confirming or amending that period.

One related decision is cheap now and expensive later. Citizens will register for *election* updates. If the deferred promise-tracking phase ever ships, that list cannot simply be reused — it was gathered for a different purpose, and "critical product updates" does not stretch to a new product. An optional "tell me about future civic tools" consent at registration costs one checkbox today; without it, the next phase starts from a cold list. That checkbox is now part of registration (PRD §14).

Full detail: `docs/gtm-plan.md`.

---

## 12. Next steps

- Review and sign off on this overview, the PRD, the IA, and `docs/milestones.md` with stakeholders.
- Resolve remaining open questions (see the PRD).
- Kick off offline curator, **transcriber** and **partner** recruitment in parallel — one motion, one named owner. The transcriber cohort is the newest and least-sized of the three.
- **Engage a lawyer for the privacy policy and terms.** This is the first item on the critical path, not the last: the privacy policy gates WhatsApp onboarding, which gates the templates, which gate the comms plan.
- **Confirm the retention proposal with the lawyer** — citizen contact data deleted or anonymized within 3 months of results being declared (PRD §17). It blocks the privacy policy, and the privacy policy blocks everything else.
- Registration carries an optional "tell me about future civic tools" consent checkbox (decided — PRD §14), so a later phase has a lawful list to talk to.
- Start WhatsApp template approval as soon as the privacy policy is live. Approval does not gate the public launch — email is the baseline channel and WhatsApp joins when Meta approves — but every week of delay is a week of WhatsApp-first registrants the campaign cannot reach.
- Funding disclosure is decided — `/about` names each funder (PRD §14); collect funder sign-off on the wording.
- Confirm whether Oorvani's existing channels (Open City, and Citizen Matters if that is also Oorvani) are available as launch distribution — the plan is currently written as though starting from no audience at all.
- Proceed to wireframe → hi-fi design and technical design.