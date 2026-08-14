# Go-to-Market Plan Design

**Date:** 2026-07-16
**Status:** Approved
**Scope:** How the platform reaches Bengaluru citizens before the GBA ward elections — launch phasing, distribution, and the citizen comms calendar. This document decides *how we go to market*, not *what we build*. Feature behaviour remains governed by `docs/prd.md` and `docs/information-architecture.md`.

---

## 1. Goal

Grow **registered citizens with a home ward set**, spread across all 369 wards, and convert them into informed voters who reach the right polling booth on election day. The release targets are **300,000 unique visitors** and **25,000 registered users**.

Registration is the chosen metric because it is the only outcome that is both measurable and re-contactable. Anonymous readers are the majority of traffic and remain fully served, but they cannot be told that their electoral roll deadline is a week away. The list is what makes every later message possible.

Distribution is **partner-led and earned**: RWA and community networks, civic organisations, and press. There is no paid acquisition.

---

## 2. Decisions

| Area | Choice | Why |
|---|---|---|
| Operator | The **Oorvani Foundation**, the trust behind `opencity.in` | Named on `/about` and `/privacy`. An election platform whose operator is unclear has no neutrality claim to make. |
| Citizen data use | No sale; shared only with the service providers operating the platform (PRD §5.16). Contacts used for ward election updates and **critical product updates** only | Oorvani's commitment. "Critical product updates" must be drafted narrowly — service-affecting notices, not feature marketing — or it becomes the loophole the DPDP purpose limitation exists to close. |
| Primary metric | Registered citizens with home ward set | Measurable and re-contactable. Ward breadth tracked as a guardrail against central-Bengaluru skew. |
| Phase 1 target | **300,000 unique visitors; ~25,000 registrations, with ≥50 in ≥300 of 369 wards** | Registrations built bottom-up from what a partner cascade can deliver unpaid, not down from a quotable share of the electorate. Ward breadth guards the registration total because a total alone is satisfiable entirely from central Bengaluru. The visitor target sizes the anonymous read audience the registrations convert from. |
| Analytics | **Google Analytics** tracks visitor and event data | Unique-visitor and on-page event measurement needs a client-side tracker; server-side application events remain the source of truth for registrations. Disclosed in `/privacy` (PRD §5.16). |
| Ward readiness | Field completeness **and** curator sign-off; sign-off clears on candidate-set change | Completeness is automatic and honest but cannot tell a thin ward from a finished one. Sign-off adds the human who knows. Clearing on change stops a ward signed off at the notification counting as ready at E−2w against a list that no longer exists. |
| Distribution shape | Partner-led cascade | The only shape that reaches ward breadth without paid spend. Press is an amplifier inside it, not a strategy. |
| Paid acquisition | None | Costs money the project does not have, and paid political-adjacent ads undermine the neutrality claim that the whole platform rests on. |
| Teaser asset | The ward finder itself | The platform's premise is that citizens don't know their new ward. A finder gives a real answer today, earns the forward, and captures ward at registration — which a "notify me" box cannot. |
| Teaser scope | A launch subset of the existing IA | No throwaway product surface, no second launch. IA §3.3 already specifies the pre-nomination empty state. |
| Calendar anchors | Relative to **N** (EC notification) and **E** (election day) | GBA poll dates slip. Absolute dates would break the entire calendar on announcement. |
| Silence period | **Go dark.** Last send is logistics at E−3d; nothing in the final 48h | Representation of the People Act §126 bans electioneering in the 48h before poll close. Rather than test where neutral report cards sit against that line, the campaign simply stops. Costs the election-morning send; buys an unattackable position. The site stays up throughout. |
| Curator + partner recruitment | One motion, with an online front door (`/partner-with-us`) | The RWA and civic-org people who would distribute the teaser *are* the curator candidate pool. Two separate outreach efforts waste the relationship — and a public page scales recruitment past the founders' own network. |
| Partner kit | A platform page, `/partner/{partner-slug}` | Unlisted, anonymous-access. Adds no fifth role and no login wall — consistent with the platform's shareable-URL model. |
| Public metrics | `/data` — coverage/integrity stats plus the city-wide issue roll-up | A platform that holds candidates accountable must be visible about its own coverage. The issue roll-up is citizen signal rather than self-report, which makes it the strongest press asset we own. No open-data downloads or API this release. |
| Press kit | `/press`, shipped in Phase 1 | Journalists arrive at N. A press kit built at N is built too late. |
| Legal pages | `/terms`, `/privacy` — `/privacy` in **Phase 0** | Not launch hygiene: Meta requires a published privacy-policy URL to approve WhatsApp Business API onboarding. `/privacy` therefore gates template approval, which gates the comms plan. |

---

## 3. Launch phasing

Two anchors: **N** = EC notification, **E** = election day.

The Indian election sequence runs notification → nominations (~7d) → scrutiny → withdrawal (~2d) → campaign → poll. So **N lands around E−4w**, and the *final* candidate list only exists after withdrawals close, around **E−2w**. There are therefore two distinct candidate-data moments, and announcing "here are your candidates" at nomination time risks profiling people who subsequently withdraw.

| Phase | Trigger | Public surface | Purpose |
|---|---|---|---|
| **0 — Network** | Now | `/privacy`, `/terms` | Recruit partners and curators in the same conversations. Publish the privacy policy — it gates WhatsApp onboarding. Submit templates for approval. Exit: partner coverage across target wards, curators assigned, templates submitted. Approval is not a gate — the teaser ships on email if Meta is still reviewing, and WhatsApp joins when approved. |
| **1 — Teaser** | Ward + logistics data ready | `/`, `/ward/{id}`, `/ward/{id}/issues`, `/check-registration`, `/about-election`, `/voting-guide/*`, `/about`, `/partner/{slug}`, `/partner-with-us`, `/press` | Build the list. Ward finder is the forwardable asset. **Exit: ~25,000 registrations, ≥50 in ≥300 wards.** |
| **2 — Launch** | At N | Adds `/ward/{id}/candidates`, `/candidate/{slug}`, `/ward/{id}/compare`, `/data` | Candidates provisional. The press moment. |
| **3 — Countdown** | E−3w → E−1w | `/ward/{id}/issues` results reach scale (the page is live from Phase 1); `/data` issue roll-up becomes meaningful | E−2w is the real content beat: final list, report cards complete. |
| **4 — Final 72h** | E−3d | No change | One logistics send at E−3d, then the campaign goes dark. Site stays fully available. |

**Phases are event-triggered; "exit" figures are progress targets, not gates.** N opens Phase 2 unconditionally — candidates exist at N whether or not the registration target is met — and the Phase 1 exit numbers are what the phase is judged against, not something the next phase waits for. If the target is badly missed when N arrives, the response is in the risk table (the partner cascade underperforming), not a delayed launch.

`docs/overview.md` §8 already establishes that ward and logistics tools can launch before candidate content. Phase 1 is that sentence made operational.

---

## 4. Comms calendar

Seven sends across the whole campaign, ending three days out. The restraint is deliberate: the list lives substantially on WhatsApp, and WhatsApp opt-outs are permanent. Over-sending during the quiet months costs the list precisely when the election beats arrive.

All sends are ward-scoped and in the recipient's saved language preference (PRD §8, §9).

| # | Trigger | Channel | Content |
|---|---|---|---|
| W1 | On register | Email + WA | Confirms ward, language, and what they will receive |
| R1 | Roll close −7d | Email + WA | Last date to join the electoral roll; check registration |
| L1 | Scrutiny complete (≈N+9d) | Email + WA | Candidates have filed in your ward (provisional) |
| C1 | E−3w | Email + WA | Vote on your ward's top 3 issues |
| C2 | E−2w | Email + WA | Final candidate list; report cards complete |
| C3 | E−1w | Email + WA | Your ward's top issues; compare candidates; booth locator |
| F1 | E−3d | Email + WA | Booth, timings, ID to carry |

Four of these carry reasoning that is not obvious from the table:

**L1 waits for scrutiny, not the notification.** Nominations only open at N and run about a week — at N there is nothing filed to announce, and a ward's completeness check (PRD §9.1) would pass vacuously against an empty list. Scrutiny is the first moment the platform can point at a list that is real, though withdrawals may still shrink it, which is why the message stays framed as provisional. The site opens its candidate pages at N and fills as nominations come in; only the send waits.

**R1 is the highest-value message in the plan.** Missing the electoral roll deadline is the one failure in this funnel that is *irreversible* — no quantity of good candidate information helps someone who is not on the roll. R1 is also what justifies the teaser shipping months early. It is anchored to the roll deadline, an absolute date that moves independently of N and E. R1 can only reach citizens who have already registered on the platform, so the site mirrors the same deadline to everyone else — on the Home banner, `/check-registration`, and `/voting-guide/voter-id` until the roll closes (PRD §5.6–5.8).

**C1 is issue voting, not candidates.** At E−3w nominations are still churning, so candidate data is the one thing the platform cannot yet stand behind. Issue voting fills the slot with something true, drives the contribution loop, and produces the ward results that make C3 worth opening.

**F1 is the last send, and the campaign then goes dark.** It sits at E−3d so it clears the E−48h silence window with a day to spare, and it carries logistics only — booth, timings, ID to carry. Nothing is sent in the final 48 hours: no candidate push, no election-morning reminder.

Going dark is a deliberate trade. It gives up the election-morning send, which is the highest-converting message in a typical GOTV programme, and it delivers booth details three days before they are used. What it buys is a campaign that cannot be accused of electioneering during the silence period, on a platform whose entire worth is its neutrality. That trade is worth making here in a way it would not be for a partisan campaign. C3 (E−1w) is therefore the last candidate content any citizen receives; the site itself stays fully available throughout, so a citizen who wants their booth on election morning can still get it.

---

## 5. Distribution mechanics

**Ward-tagged partner links.** Each partner receives `/?src={partner-slug}`, persisted through registration onto the user record. Without attribution there is no way to tell which of the three channels works, and no way to tell a partner what their forward actually achieved — which is what earns the second forward.

**The partner kit** (`/partner/{partner-slug}`, unlisted, anonymous-access) carries:

- the partner's tagged link
- pre-written WhatsApp forward text in English and Kannada — a general message and a first-time voter variant linking the `/voting-guide` checklist (PRD §5.17) — because the unit of distribution is a message pasted into an apartment group, not a press release
- a poster image sized for WhatsApp
- a one-paragraph neutrality statement

The neutrality statement is not optional. An RWA secretary forwarding an election link will be accused of campaigning, and a partner who cannot answer that accusation stops forwarding.

**Partner categories beyond RWAs.** The RWA cascade reaches homeowners and long-tenured residents. It largely misses first-time voters — students, PG residents, young renters — who sit in no apartment-owner group and are disproportionately unregistered here or registered in another city. And this election's first-timer cohort is unusually wide: the last ward election was roughly a decade ago, so nearly everyone under thirty has never voted for a corporator. Colleges, large employers, and youth and student organisations are therefore recruited as partners through the same `/partner-with-us` funnel, with the first-time voter forward text as their kit's lead asset.

**Ward coverage as the operating dashboard** (`/admin/partners`, IA §6.4). Partner slug → wards covered, against all 369. The uncovered set is the Phase 0 and Phase 1 work queue, and the early-warning signal for the failure mode where the plan quietly becomes "central Bengaluru only."

---

## 6. Recruitment funnel — `/partner-with-us`

Phase 0 was scoped as an offline motion: the team approaches RWAs and civic orgs directly. That does not scale past the founders' own address book, and the address book is precisely where the central-Bengaluru skew comes from. A public page turns inbound interest — a journalist's reader, an RWA secretary who saw a forward — into the same funnel.

It offers the two ways to help, matching the two roles the platform already has:

| Path | Ask | What they get |
|---|---|---|
| **Spread awareness** | Forward ward links to your network — apartment groups, RWA lists, member mail | A partner kit page, a tagged link, and a report of what their forwarding actually achieved |
| **Curate data** | Own the accuracy of a ward's data: compile report cards, attach sources, review flags | Assigned ward scope, onboarding, and publish-immediately trust |

Both submit one expression-of-interest form. **The form is anonymous — no account required.** Requiring registration before someone can volunteer taxes exactly the people the plan depends on, and an RWA as an institution does not map onto a citizen account with a home ward. It is CAPTCHA-protected (PRD §6.3) and triaged by admins; curator applicants hand off to the existing vetting path at `/admin/roles`.

This does not make partners self-serving. Nobody becomes a live partner or curator without admin review — the page collects applications, it does not grant access.

---

## 7. Public trust surfaces

Three pages carry the neutrality claim that everything else rests on.

**`/data`** — coverage and integrity, plus the city-wide issue roll-up. Coverage: wards with published candidate data against 369, report cards complete, active curators, sources cited. Integrity: flags raised, flags resolved, median time to resolve. A platform that publishes other people's records should publish its own. The issue roll-up — what Bengaluru actually cares about, aggregated across 369 wards — is citizen signal rather than self-report, which is what makes it the strongest press asset the platform owns.

The honest caveat: this page reads "14 of 369 wards" in Phase 1, and the roll-up says nothing until C1 has driven issue-vote volume. It therefore ships in Phase 2 and only becomes good in Phase 3. Every figure carries an "as of" timestamp.

**`/press`** — boilerplate at three lengths, current key stats, logos, screenshots, spokesperson bios and quotes, contact with a stated response time, and the neutrality statement. Ships in Phase 1 even though it is a Phase 2 asset, because journalists arrive at N and a kit assembled at N is assembled too late.

**`/about`** — extended rather than duplicated; the existing page (IA §3.13) already covers who runs the platform. It now names the operator — the **Oorvani Foundation**, the trust behind `opencity.in` — and gains an explicit **funding disclosure**. For a platform whose whole value is neutrality, who runs and pays for it is the first question a skeptical journalist asks, and the answer should not have to be requested.

It also carries Oorvani's **data commitments** in citizen-readable terms: the data is never sold, is shared only with the service providers that deliver the platform's own messages, and contact details are used for ward election updates and critical product notices only. These are the same commitments `/privacy` makes in legal language. Saying them in plain words on the page citizens actually read is what converts a compliance document into a reason to trust the platform enough to hand over a phone number — which is the entire funnel.

---

## 8. Measurement

North star: registered citizens with a home ward set. **Phase 1 targets: 300,000 unique visitors, and ~25,000 registrations with ≥50 registrations in ≥300 of 369 wards.**

The registration target is deliberately two numbers. A single city-wide total is satisfiable entirely out of a dozen affluent central wards — it would be met, and the plan would have failed. The breadth number is the one that encodes the actual mission, and it is the one to look at first when the two disagree. The visitor target sits above both: it sizes the anonymous read audience — the majority of traffic — that the registration funnel converts from.

Both are built bottom-up from what the cascade can plausibly deliver without paid spend, not down from a quotable fraction of the electorate. 1% of Bengaluru's roughly 90–100 lakh voters would be ~90,000 — a better number to say out loud and a worse one to steer by, because everyone would know it was fiction by week three.

- **Funnel:** `/` visit → ward found → register → OTP confirmed. Ward-found-but-didn't-register is the diagnostic for whether the teaser's promise lands; if citizens take their answer and leave, the "we'll tell you who's standing here" line is too weak.
- **Ward coverage:** wards with ≥1 registration, and wards with ≥1 partner, both against 369.
- **Attribution:** registrations per `src`, per channel.
- **Recruitment funnel:** expressions of interest per path (awareness vs curation), and how many convert to live partners or curators. If the awareness path dwarfs the curation path, ward data readiness becomes the binding constraint and Phase 2 gating starts holding sends.
- **List health:** WhatsApp opt-out rate and email bounce rate. Treat opt-out rate as a brake — if it climbs, cut sends. The list does not grow back.

**Measurement runs on Google Analytics plus server-side events.** Visitor and event data — unique visitors (the 300,000 target), page views, ward-finder usage, language toggles, funnel-step events — is tracked client-side in **Google Analytics**. Funnel steps that are already server actions — ward lookup, registration, OTP confirmation — are additionally counted as application events, and those server-side counts remain the source of truth for registration and contribution numbers. Google Analytics and its cookies must be disclosed in `/privacy` (PRD §5.16) before the tracker ships — for a platform whose product is trust, undeclared analytics is its own risk.

The public-facing subset of these figures is what `/data` publishes (§7).

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Comms promise data curators haven't filled in** | L1/C2 sent ward-scoped to a ward with no curator lands on an empty page — converting the best message into the worst impression, exactly as press attention peaks | **Per-ward send gating**: a ward receives L1/C2/C3 only after its data passes a readiness check. Unready wards are held, not sent a broken promise. Now a PRD requirement (§9.1). |
| WhatsApp Business API approval slips | Half the channel plan disappears | Submit all templates in Phase 0 (16: seven sends plus the OTP authentication template, × EN/KN), and publish `/privacy` first — Meta will not onboard without it. Email is the baseline; WhatsApp is the fast-follow. |
| **`/privacy` treated as launch hygiene** | It gates WhatsApp onboarding, which gates templates, which gates the comms plan. Deferring it silently defers everything | Publish in Phase 0, before the teaser. Sequenced explicitly in §3. |
| DPDP Act 2023 non-compliance | Legal exposure; the platform collects phone, email, and address→ward at scale | Consent notice, data-principal rights, and a named grievance officer in `/privacy`. Needs a lawyer — out of this spec's competence. |
| **"Critical product updates" drafted broadly** | It becomes the loophole that swallows the purpose limitation — every future announcement is arguably critical, and the election list quietly turns into a general marketing list | Draft it narrowly in `/privacy` (§5.16 of the PRD): service-affecting notices only. The deferred promise-tracking phase needs fresh consent, not this clause. |
| Curator sign-off becomes a rubber stamp | The readiness gate passes wards it should hold, restoring the failure it was built to prevent | Show the completeness gaps next to the control, so signing off is a judgement about a specific list rather than a reflex. Track sign-offs in the audit log. |
| `/data` published too early | "14 of 369 wards" is honest and damaging, and hands critics a number | Ship `/data` in Phase 2, not Phase 1. Every figure timestamped. |
| Election date moves | Calendar invalid | Relative anchors absorb it. Note R1 is anchored to the roll deadline, which moves independently. |
| Partner network doesn't materialise | Ward coverage skews to affluent central wards | Coverage dashboard surfaces it early; press is the fallback amplifier. |
| Partner mix skews to RWAs | First-time voters — the largest under-served cohort in a first ward election in a decade — never see the platform | Recruit colleges, employers, and youth orgs as partner categories (§5); first-time voter forward asset in every kit. |
| Neutrality attack | Loss of the trust the platform rests on | Source on every field (PRD §11); partner neutrality statement; no paid spend, as evidence. |
| Booth data doesn't land | C3 and F1 lose most of their value | Degrade to ward-level messaging. IA §3.12 commits to address-accurate booth data; treat as a launch dependency. |
| Silence-period violation | Legal exposure under RPA §126 | The campaign goes dark from E−3d, well clear of the window. The PRD §9.2 content freeze remains as a guardrail against any send added later. |

---

## 10. Dependencies

*GTM-specific dependencies are listed here. The project-wide register, including infrastructure and commercial accounts, is `docs/project-dependencies.md`.*

- **Partner network (offline).** Now a hard launch dependency alongside curator recruitment, and recruited in the same conversations. `/partner-with-us` supplements this motion; it does not replace it.
- **`/privacy` published.** Blocks WhatsApp Business API onboarding, which blocks templates, which blocks the comms plan. The earliest item on the critical path.
- **Legal review.** `/terms` and `/privacy` need a lawyer for DPDP Act 2023 compliance, not a product spec.
- **WhatsApp Business API.** Template approval has weeks of lead time; 16 templates across EN/KN (seven sends plus OTP). Belongs in Phase 0.
- **Electoral roll deadline date.** R1's anchor. Must be tracked independently of N and E.
- **Booth-level data.** Required for C3 and F1 to be worth sending.
- **Ward + delimitation data. ✓ In hand** (`data/gba.geojson`, 369 wards with boundaries + metadata). This gated Phase 1 entirely — the teaser *is* the ward finder — and is now resolved: `data/gba.geojson` is the authoritative final delimitation. The pincode-hedge postal data is no longer a remainder to track: pincode lookup was removed outright, 2026-08-14 (PRD §5.1) — the boundary data it hedged against arrived, and Places Autocomplete now covers ambiguous addresses instead.
- **Press assets.** Logos, screenshots, and named spokespeople with quotes, for `/press` in Phase 1.
- **Google Analytics property.** Backs the visitor target and funnel/attribution measurement; must be live (and disclosed in `/privacy`) from the Phase 1 teaser, or the unique-visitor baseline is lost.

---

## 11. Out of scope

Paid acquisition. Candidate outreach or engagement of any kind. Post-election comms, including results coverage and turnout reporting. Open data downloads and a public API (`/data` publishes figures, not datasets). Self-service partner or curator activation — `/partner-with-us` collects applications; admins grant access.

---

## 12. Open questions

Open questions are tracked in one place: **`docs/prd.md` §17**. Most of the GTM-raised subset was **resolved on 2026-07-19** — partner surfaces bilingual, press push at N with an E−2w second beat, retention proposed at 3 months post-results (pending legal confirmation), the future-tools re-consent checkbox added, `/data` counting published data with a separate signed-off figure, funders named — with resolutions recorded in the PRD (§14). Still open there: legal confirmation of the retention period, and whether Citizen Matters is an owned channel. The blocking subset also appears in `docs/project-dependencies.md` §7 with owners.
