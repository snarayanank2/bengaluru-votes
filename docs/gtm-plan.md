# Go-to-Market Plan Design

**Date:** 2026-08-14 *(revised; originally 2026-07-16)*
**Status:** Revised — the comms calendar is now contingent
**Scope:** How the platform reaches Bengaluru citizens before the GBA ward elections — launch sequencing, distribution, and the citizen comms calendar. This document decides *how we go to market*, not *what we build*. Feature behaviour remains governed by `docs/prd.md` and `docs/information-architecture.md`; the build order is `docs/milestones.md`.

> **Revised 2026-08-14.** This plan was written around a registered list: build 25,000 registrations from September, then send seven ward-scoped messages against them. Registered-user support is now **M7 — last in the milestone order, and explicitly abandonable** if its prerequisites (legal pages, Twilio, Meta verification, a `+91` sender, ₹4L) do not land (`docs/milestones.md` §11). A list cannot be built by a feature that does not exist yet, so the plan below no longer assumes one. Reach now rests on the anonymous ward finder and the partner cascade; the seven sends are a **contingent second track** with a stated go/no-go (§3.1).

---

## 1. Goal

**Two tracks, and only one of them is certain.**

**Track A — reach, unconditional.** Get Bengaluru citizens to the ward finder, and from there to their ward's information: candidates when they exist, issues, and voting logistics. The target is **300,000 unique visitors**. Every part of this works for a citizen with no account, and it survives M7 being abandoned in full.

**Track B — the list, contingent on M7.** Grow registered citizens with a home ward set, spread across all 369 wards, and message them through the election. The target remains **25,000 registrations with ≥50 in ≥300 of 369 wards** — but it is now a target *conditional on M7 shipping in time*, not a commitment. If M7 is abandoned, this target is **withdrawn rather than missed**, and §8 measures the platform on Track A alone.

Registration was the original primary metric because it is the only outcome that is both measurable and re-contactable — anonymous readers cannot be told their electoral roll deadline is a week away. That reasoning has not changed and it is why Track B is worth fighting for. What changed is that it is no longer safe to *plan* on.

**The consequence to sit with.** Without the list, the platform is a reference a citizen must remember to visit. Nothing reaches out. The roll-deadline message (R1) — the one failure in this funnel that cannot be undone afterwards — has no channel except the site itself and whatever partners forward. §3.1 mirrors that deadline into the anonymous surfaces precisely because it may be all we have.

Distribution is **partner-led and earned**: RWA and community networks, civic organisations, and press. There is no paid acquisition. That is unchanged, and it now carries more weight than it was designed to.

---

## 2. Decisions

| Area | Choice | Why |
|---|---|---|
| Operator | The **Oorvani Foundation**, the trust behind `opencity.in` | Named on `/about` and `/privacy`. An election platform whose operator is unclear has no neutrality claim to make. |
| Citizen data use | No sale; shared only with the service providers operating the platform (PRD §5.16). Contacts used for ward election updates and **critical product updates** only | Oorvani's commitment. "Critical product updates" must be drafted narrowly — service-affecting notices, not feature marketing — or it becomes the loophole the DPDP purpose limitation exists to close. |
| Primary metric | **Unique visitors** (Track A). Registered citizens with home ward set is the Track B metric, contingent on M7 | Revised 2026-08-14. The list metric is better — measurable and re-contactable — but it cannot be the primary measure of a platform that may ship without accounts. Ward breadth remains the guardrail on Track B against central-Bengaluru skew. |
| Release targets | **300,000 unique visitors**, unconditional. **~25,000 registrations, ≥50 in ≥300 of 369 wards** — contingent on M7 | Registrations were built bottom-up from what a partner cascade can deliver unpaid, not down from a quotable share of the electorate. That arithmetic is unchanged; what changed is that the feature it depends on is last in the build order and abandonable. |
| **Comms calendar** | **Contingent.** The seven sends run only if M7's prerequisites clear by the go/no-go date; otherwise the calendar is dropped, not compressed | Revised 2026-08-14. Compressing seven sends into the final fortnight would put the heaviest messaging into the silence-period run-up, against a list built too late to be broad. Dropping is the better failure. §3.1. |
| Analytics | **Google Analytics** tracks visitor and event data | Unique-visitor and on-page event measurement needs a client-side tracker; server-side application events remain the source of truth for registrations. Disclosed in `/privacy` (PRD §5.16). |
| Ward readiness | Field completeness **and** curator sign-off; sign-off clears on candidate-set change | Completeness is automatic and honest but cannot tell a thin ward from a finished one. Sign-off adds the human who knows. Clearing on change stops a ward signed off at the notification counting as ready at E−2w against a list that no longer exists. |
| Distribution shape | Partner-led cascade | The only shape that reaches ward breadth without paid spend. Press is an amplifier inside it, not a strategy. |
| Paid acquisition | None | Costs money the project does not have, and paid political-adjacent ads undermine the neutrality claim that the whole platform rests on. |
| Teaser asset | The ward finder itself | The platform's premise is that citizens don't know their new ward. A finder gives a real answer today, earns the forward, and captures ward at registration — which a "notify me" box cannot. |
| Teaser scope | A launch subset of the existing IA | No throwaway product surface, no second launch. IA §3.3 already specifies the pre-nomination empty state. |
| Calendar anchors | Relative to **N** (EC notification) and **E** (election day) | GBA poll dates slip. Absolute dates would break the entire calendar on announcement. |
| Silence period | **Go dark.** Last send is logistics at E−3d; nothing in the final 48h | Representation of the People Act §126 bans electioneering in the 48h before poll close. Rather than test where neutral report cards sit against that line, the campaign simply stops. Costs the election-morning send; buys an unattackable position. The site stays up throughout. |
| Curator + partner recruitment | One motion, with an online front door (`/partner-with-us`) | The RWA and civic-org people who would distribute the teaser *are* the curator candidate pool. Two separate outreach efforts waste the relationship — and a public page scales recruitment past the founders' own network. |
| Partner kit | A platform page, `/partner/{partner-slug}` | Unlisted, anonymous-access. Partners are not a role and get no login wall — consistent with the platform's shareable-URL model. |
| Public metrics | `/data` — coverage/integrity stats plus the city-wide issue roll-up | A platform that holds candidates accountable must be visible about its own coverage. The issue roll-up is citizen signal rather than self-report, which makes it the strongest press asset we own. No open-data downloads or API this release. |
| Press kit | `/press`, shipped with **M4** | Journalists arrive at N. A press kit built at N is built too late. |
| Legal pages | `/terms`, `/privacy` — **both gate M4** | Not launch hygiene, twice over: Google Analytics is already live, so launching without a published privacy policy is not an option; and Meta requires a published privacy-policy URL to approve WhatsApp Business API onboarding, so `/privacy` also gates templates and therefore all of Track B. |

---

## 3. Sequencing

Two anchors: **N** = EC notification, **E** = election day. The build order is `docs/milestones.md`; what follows is what each milestone means for going to market.

The Indian election sequence runs notification → nominations (~7d) → scrutiny → withdrawal (~2d) → campaign → poll. So **N lands around E−4w** — this cycle, E−6w — and the *final* candidate list only exists after withdrawals close. There are therefore two distinct candidate-data moments, and announcing "here are your candidates" at nomination time risks profiling people who subsequently withdraw.

| Milestone | Public surface | Go-to-market purpose |
|---|---|---|
| **M1** Ward discovery | `/`, `/ward/{id}`, `/ward/{id}/issues`, `/check-registration`, `/about-election`, `/voting-guide/*`, `/about` | The forwardable asset exists and answers a real question for a citizen with no account. Candidate routes reachable, showing the pre-nomination empty state. |
| **M2** Donation | `/donate` | The funding ask, available from launch rather than retrofitted. |
| **M3** Partnerships | `/partner-with-us`, `/partner/{slug}` | The cascade's front door and its kit. Recruitment stops depending on the founders' address book. |
| **M4** Launch | `/press`, `/privacy`, `/terms` | The press moment and the campaigns. **Gated on the legal pages**, not accompanied by them. |
| **M5 / M6** Back office | `/admin/*`, `/transcribe/*`, `/curator/*` | Nothing public. What makes candidate data exist in time for the report cards the campaign promises. |
| **M7** Registered users | `/account/*`, `/login`, the two contribution modals | **Track B in full**: registration, issue voting, flagging, and the seven sends. Contingent — see §3.1. |
| **M8** EC affidavits | No new pages — `/candidate/{slug}` fills; `/data` opens | The report cards the whole campaign promises. Gated by the EC, not by us: nothing to ingest before nominations open on 19 Oct. |
| **M9** Booth information | No new pages — `/voting-guide/find-booth` starts resolving | The last-week utility that has nothing to do with candidates. **No assumed publication date and no owner.** |
| **At N** | The candidate routes fill | Not a milestone — an external event. The pages exist from M1; candidates arrive into them as nominations come in. |

**M8 and M9 are the two milestones the Election Commission controls.** Every other one could ship tomorrow given its prerequisites; these two cannot exist before the EC publishes, and no effort moves them. They are also the two that make the campaign's promises true — report cards and booth details are what the sends and the partner forwards are *for*. Working out how the EC actually publishes both, and chasing it, is the highest-leverage unowned job in this plan (`docs/roles.md` §4).

**N is an event, not a gate we control.** Candidates exist at N whether or not any target has been met. Missing a target is answered in the risk table (§9), never by delaying the launch.

`docs/overview.md` §8 already establishes that ward and logistics tools can launch before candidate content. M1 is that sentence made operational.

### 3.1 The Track B go/no-go

The seven sends need a list, and a list needs registration live long enough before the first send to have grown broad. R1 — the roll-deadline message, the one whose value expires — is anchored to the electoral roll deadline, assumed to track N and therefore to sit around **12 October**.

Working backwards: a list worth sending to needs roughly four weeks of partner-driven registration behind it, which puts registration live by **mid-September**. Meta template approval alone runs to weeks and cannot start until `/privacy` is published.

**Proposed decision point: 15 September 2026.** If, on that date, M7's prerequisites have not landed — legal pages published, Twilio and SendGrid live, Meta verification through, a `+91` sender committed, templates submitted, budget confirmed — the comms calendar is **dropped and the registration target withdrawn**, and the programme runs on Track A alone.

*This date is a proposal, not yet a decision.* It needs an owner and confirmation (`docs/roles.md` §3 — ProgDir). What it exists to prevent is the failure where nobody ever decides: registration ships in late October, R1 goes out to four hundred people, and the seven-send calendar is technically executed and practically pointless.

**Drop, do not compress.** If the decision is no, the sends do not get squeezed into the final fortnight. That would concentrate the heaviest messaging into the silence-period run-up, against a thin and central-Bengaluru-skewed list, at exactly the moment scrutiny is highest. A calendar not run is recoverable; a calendar run badly is not.

**What survives a no.** The roll deadline is mirrored on the anonymous surfaces regardless — the Home banner, `/check-registration`, and `/voting-guide/voter-id` — until the roll closes (PRD §5.6–5.8). That mirroring was designed as a supplement to R1 for citizens who had not registered. On Track A it is the whole of the roll-deadline campaign, and the partner cascade is the only thing that carries it.

---

## 4. Comms calendar — **contingent on M7**

> **Everything in this section runs only if the §3.1 go/no-go is a yes.** It is kept intact rather than hedged sentence by sentence, because if the answer is yes this is still the right calendar and it should not have to be rebuilt. If the answer is no, the whole section is dropped, along with the send copy in `docs/messages.md`.

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

**Ward coverage as the operating dashboard** (`/admin/partners`, IA §6.4). Partner slug → wards covered, against all 369. The uncovered set is the recruitment work queue from M3 onward, and the early-warning signal for the failure mode where the plan quietly becomes "central Bengaluru only."

---

## 6. Recruitment funnel — `/partner-with-us`

Partner and curator recruitment was scoped as an offline motion: the team approaches RWAs and civic orgs directly. That does not scale past the founders' own address book, and the address book is precisely where the central-Bengaluru skew comes from. A public page turns inbound interest — a journalist's reader, an RWA secretary who saw a forward — into the same funnel.

It offers the two ways to help, matching the two roles the platform already has:

| Path | Ask | What they get |
|---|---|---|
| **Spread awareness** | Forward ward links to your network — apartment groups, RWA lists, member mail | A partner kit page, a tagged link, and a report of what their forwarding actually achieved |
| **Curate data** | Own the accuracy of a ward's data: resolve disputes, correct fields, attach sources, review flags, sign wards off | Assigned ward scope, onboarding, and publish-immediately trust |
| **Transcribe affidavits** | Read one candidate affidavit at a time and check the extracted fields. No ward ownership, no ongoing commitment | Onboarding, and a queue that can be worked in whatever time they have |

**The transcriber path is the volume ask, and it is a different pitch** (PRD §5.2). Curating a ward is stewardship — it wants someone who will hold it for months. Transcribing is piecework that wants Kannada reading and an hour: roughly 8,000 readings in a three-week window (`docs/roles.md` §2). Recruiting for both through one form is right, but the two asks should not be described in the same words, or the heavier one will absorb people the lighter one needed.

Both submit one expression-of-interest form. **The form is anonymous — no account required.** Requiring registration before someone can volunteer taxes exactly the people the plan depends on, and an RWA as an institution does not map onto a citizen account with a home ward. It is CAPTCHA-protected (PRD §6.3) and triaged by admins; curator applicants hand off to the existing vetting path at `/admin/roles`.

This does not make partners self-serving. Nobody becomes a live partner or curator without admin review — the page collects applications, it does not grant access.

---

## 7. Public trust surfaces

Three pages carry the neutrality claim that everything else rests on.

**`/data`** — coverage and integrity, plus the city-wide issue roll-up. Coverage: wards with published candidate data against 369, report cards complete, active curators, sources cited. Integrity: flags raised, flags resolved, median time to resolve. A platform that publishes other people's records should publish its own. The issue roll-up — what Bengaluru actually cares about, aggregated across 369 wards — is citizen signal rather than self-report, which is what makes it the strongest press asset the platform owns.

The honest caveat: this page reads "14 of 369 wards" before candidate data lands, and the roll-up says nothing until issue voting has volume — which needs M7. It therefore opens at N, and only becomes good once report cards are filling. Every figure carries an "as of" timestamp.

**`/press`** — boilerplate at three lengths, current key stats, logos, screenshots, spokesperson bios and quotes, contact with a stated response time, and the neutrality statement. Ships with M4 even though it is really a notification-week asset, because journalists arrive at N and a kit assembled at N is assembled too late.

**`/about`** — extended rather than duplicated; the existing page (IA §3.13) already covers who runs the platform. It now names the operator — the **Oorvani Foundation**, the trust behind `opencity.in` — and gains an explicit **funding disclosure**. For a platform whose whole value is neutrality, who runs and pays for it is the first question a skeptical journalist asks, and the answer should not have to be requested.

It also carries Oorvani's **data commitments** in citizen-readable terms: the data is never sold, is shared only with the service providers that deliver the platform's own messages, and contact details are used for ward election updates and critical product notices only. These are the same commitments `/privacy` makes in legal language. Saying them in plain words on the page citizens actually read is what converts a compliance document into a reason to trust the platform enough to hand over a phone number — which is the entire funnel.

---

## 8. Measurement

**Track A north star: unique visitors — 300,000, unconditional.** Every Track A measure below works with no accounts in the product.

**Track B north star: registered citizens with a home ward set — ~25,000, with ≥50 in ≥300 of 369 wards.** Contingent on M7 (§3.1). If the go/no-go is a no, these are withdrawn, and the platform is measured on Track A plus the qualitative question of whether citizens found their ward and their candidates.

The registration target is deliberately two numbers. A single city-wide total is satisfiable entirely out of a dozen affluent central wards — it would be met, and the plan would have failed. The breadth number is the one that encodes the actual mission, and it is the one to look at first when the two disagree. The visitor target sits above both: it sizes the anonymous read audience — the majority of traffic — that the registration funnel converts from.

Both are built bottom-up from what the cascade can plausibly deliver without paid spend, not down from a quotable fraction of the electorate. 1% of Bengaluru's roughly 90–100 lakh voters would be ~90,000 — a better number to say out loud and a worse one to steer by, because everyone would know it was fiction by week three.

- **Funnel:** `/` visit → ward found → register → OTP confirmed. Ward-found-but-didn't-register is the diagnostic for whether the teaser's promise lands; if citizens take their answer and leave, the "we'll tell you who's standing here" line is too weak.
- **Ward coverage:** wards with ≥1 registration, and wards with ≥1 partner, both against 369.
- **Attribution:** registrations per `src`, per channel.
- **Recruitment funnel:** expressions of interest per path (awareness vs curation), and how many convert to live partners or curators. If the awareness path dwarfs the curation path, ward data readiness becomes the binding constraint and per-ward gating starts holding sends.
- **List health:** WhatsApp opt-out rate and email bounce rate. Treat opt-out rate as a brake — if it climbs, cut sends. The list does not grow back.

**Measurement runs on Google Analytics plus server-side events.** Visitor and event data — unique visitors (the 300,000 target), page views, ward-finder usage, language toggles, funnel-step events — is tracked client-side in **Google Analytics**. Funnel steps that are already server actions — ward lookup, registration, OTP confirmation — are additionally counted as application events, and those server-side counts remain the source of truth for registration and contribution numbers. Google Analytics and its cookies must be disclosed in `/privacy` (PRD §5.16) before the tracker ships — for a platform whose product is trust, undeclared analytics is its own risk.

The public-facing subset of these figures is what `/data` publishes (§7).

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **M7 slips without anyone deciding it has** | Registration ships in late October, R1 goes to a few hundred people, and the seven-send calendar is technically executed and practically pointless — while the effort that built it came out of the partner cascade, which is the thing that actually still works | The §3.1 go/no-go on a named date, with a named owner. Drop, do not compress. The decision costs nothing if taken early and cannot be taken late. |
| **The platform ships anonymous-only and nothing reaches out** | The roll deadline passes for citizens who visited once in September. No message, no reminder, no second contact — the irreversible failure in the funnel, and Track A has no mechanism against it | Mirror the roll deadline on every anonymous surface until the roll closes (Home banner, `/check-registration`, `/voting-guide/voter-id` — PRD §5.6–5.8), and make the deadline the partner cascade's lead forward asset in the weeks before it. This is a weaker instrument than R1 and is not claimed otherwise. |
| **Comms promise data curators haven't filled in** | L1/C2 sent ward-scoped to a ward with no curator lands on an empty page — converting the best message into the worst impression, exactly as press attention peaks | **Per-ward send gating**: a ward receives L1/C2/C3 only after its data passes a readiness check. Unready wards are held, not sent a broken promise. Now a PRD requirement (§9.1). |
| WhatsApp Business API approval slips | Half the channel plan disappears | Submit all templates as early as the legal pages allow (16: seven sends plus the OTP authentication template, × EN/KN), and publish `/privacy` first — Meta will not onboard without it. Email is the baseline; WhatsApp is the fast-follow. |
| **`/privacy` treated as launch hygiene** | It gates WhatsApp onboarding, which gates templates, which gates the comms plan. Deferring it silently defers everything | Publish before M4 — it gates the launch itself, since GA is already live, as well as all of Track B. Sequenced explicitly in §3. |
| DPDP Act 2023 non-compliance | Legal exposure; the platform collects phone, email, and address→ward at scale | Consent notice, data-principal rights, and a named grievance officer in `/privacy`. Needs a lawyer — out of this spec's competence. |
| **"Critical product updates" drafted broadly** | It becomes the loophole that swallows the purpose limitation — every future announcement is arguably critical, and the election list quietly turns into a general marketing list | Draft it narrowly in `/privacy` (§5.16 of the PRD): service-affecting notices only. The deferred promise-tracking phase needs fresh consent, not this clause. |
| Curator sign-off becomes a rubber stamp | The readiness gate passes wards it should hold, restoring the failure it was built to prevent | Show the completeness gaps next to the control, so signing off is a judgement about a specific list rather than a reflex. Track sign-offs in the audit log. |
| `/data` published too early | "14 of 369 wards" is honest and damaging, and hands critics a number | Hold `/data` until candidate data is real. Every figure timestamped. |
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
- **WhatsApp Business API.** Template approval has weeks of lead time; 16 templates across EN/KN (seven sends plus OTP). Cannot start before `/privacy` is published. Contingent on the §3.1 go/no-go.
- **Electoral roll deadline date.** R1's anchor. Must be tracked independently of N and E.
- **Booth-level data.** Required for C3 and F1 to be worth sending.
- **Ward + delimitation data. ✓ In hand** (`data/gba.geojson`, 369 wards with boundaries + metadata). This gated M1 entirely — the teaser *is* the ward finder — and is now resolved: `data/gba.geojson` is the authoritative final delimitation. The pincode-hedge postal data is no longer a remainder to track: pincode lookup was removed outright, 2026-08-14 (PRD §5.1) — the boundary data it hedged against arrived, and Places Autocomplete now covers ambiguous addresses instead.
- **Press assets.** Logos, screenshots, and named spokespeople with quotes, for `/press` in M4.
- **Google Analytics property.** Backs the visitor target and funnel/attribution measurement; must be live (and disclosed in `/privacy`) from M1, or the unique-visitor baseline is lost. It is already live, which is why `/privacy` gates M4.

---

## 11. Out of scope

Paid acquisition. Candidate outreach or engagement of any kind. Post-election comms, including results coverage and turnout reporting. Open data downloads and a public API (`/data` publishes figures, not datasets). Self-service partner or curator activation — `/partner-with-us` collects applications; admins grant access.

---

## 12. Open questions

Open questions are tracked in one place: **`docs/prd.md` §17**. Most of the GTM-raised subset was **resolved on 2026-07-19** — partner surfaces bilingual, press push at N with an E−2w second beat, retention proposed at 3 months post-results (pending legal confirmation), the future-tools re-consent checkbox added, `/data` counting published data with a separate signed-off figure, funders named — with resolutions recorded in the PRD (§14). Still open there: legal confirmation of the retention period, and whether Citizen Matters is an owned channel. The blocking subset also appears in `docs/project-dependencies.md` §7 with owners.
