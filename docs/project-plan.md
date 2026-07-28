# Project Plan — GBA Elections Citizen Platform

**Date:** 2026-07-28
**Status:** Living document
**Scope:** The plan from now to the close of the election programme: timeline, roles and what each one owns, deliverables month by month, and a RACI matrix over every deliverable. Covers Phase 0 through post-election wind-down. Year two — the ward accountability layer and the second city — is out of scope.

No budget figures appear here. This is a plan of work, not a plan of spend.

Related: `docs/project-dependencies.md` (the register of everything outside the codebase), `docs/gtm-plan.md` (phases and the comms calendar), `docs/prd.md` §7 (in-app permissions, a different thing — see §2).

---

## 1. Timeline

### 1.1 Assumptions

Three dates are fixed by assumption. Everything else derives from them.

| Anchor | Date |
|---|---|
| **EC notification (N)** | **Mon 19 Oct 2026** |
| **Final candidate list published** | **Sun 1 Nov 2026** |
| **Election day (E)** | **Tue 1 Dec 2026** |

Derived from the standard sequence — notification → nominations (~7d) → scrutiny → withdrawal (~2d) → final list:

| Beat | Date |
|---|---|
| Nominations open → close | Oct 19 → Oct 26 |
| Scrutiny | ~Oct 27 |
| Withdrawals close | ~Oct 30 |
| Results declared | ~Fri 4 Dec |
| Contact data deleted | ~Mar 2027 (results + 3 months, PRD §17) |

N sits at **E−6w**, wider than the E−4w the GTM plan assumes. That is a gift: curators get a full month against the final list rather than a fortnight.

Two further dates are assumed and must be confirmed. The **electoral roll deadline** is taken to track N, which fixes the R1 send at Oct 12; it moves independently of N and E, and R1 is the one message whose value expires. The **results declaration date** is taken as Dec 4, which fixes the deletion obligation.

### 1.2 Phases

| Phase | Window | Trigger | What it is |
|---|---|---|---|
| **P0 — Network** | Aug → Sep | Now | Recruit partners and curators, publish the legal pages, open the messaging channels. |
| **P1 — Teaser** | Sep → Oct 19 | Ward + logistics data ready | Ward finder live. Build the registered list. |
| **P2 — Launch** | Oct 19 → Nov 10 | At N | Candidate pages open. The press moment. |
| **P3 — Countdown** | Nov 10 → Nov 28 | E−3w | Final list in hand. Report cards completed, issue voting at scale. |
| **P4 — Final 72h** | Nov 28 → Dec 1 | E−3d | One logistics send, then the campaign goes dark. Site stays up. |
| **P5 — Post-election** | Dec 2 → Mar 2027 | After results | Wrap, retro, wind-down, data deletion. |

### 1.3 The shape of it

```
 Aug        Sep        Oct        Nov        Dec        Jan   Feb   Mar
 |----------|----------|----------|----------|----------|-----|-----|-----|
 [== P0 Network ==]
            [====== P1 Teaser ======]
                            N▲ [== P2 ==]
                                   [= P3 =]
                                        [P4]
                                          E▲
                                            [======= P5 Post-election =======]
                            Oct 19     Nov 1      Dec 1              ~Mar
                            notif.   final list    poll            deletion
```

The critical stretch is **Nov 1–17**: the final list exists, and report cards for 369 wards must be complete before the C2 send. Everything in §3 builds toward surviving that fortnight.

### 1.4 Comms calendar

Seven sends, ending three days out (GTM §4).

| Send | Date | Content |
|---|---|---|
| **W1** | on register | Confirms ward, language, what they will receive |
| **R1** | Oct 12 | Electoral roll deadline — the one send whose value expires |
| **L1** | Oct 28 | Candidates have filed in your ward (provisional) |
| **C1** | Nov 10 | Vote on your ward's top 3 issues |
| **C2** | Nov 17 | Final candidate list; report cards complete |
| **C3** | Nov 24 | Your ward's top issues; compare candidates; booth locator |
| **F1** | Nov 28 | Booth, timings, ID to carry |
| — | Nov 29 → Dec 1 | **Dark.** Nothing sent. |

---

## 2. Roles and what they own

Nine roles. Four have people in them today; five do not.

| Role | Short | Filled today |
|---|---|---|
| Oorvani Board — trustees | **Board** | ✅ Meera K, Ashwin Mahesh, Meenakshi Ramesh, Vikram Rai |
| Programme Director | **ProgDir** | ✅ Satarupa Bhattacharya |
| Product & Engineering | **Siva** | ⚠️ one person |
| Curator Operations | **CurOps** | ❌ vacant |
| Bilingual Content Editor | **Edit** | ❌ vacant |
| Partnerships Lead | **Part** | ❌ vacant |
| Ward Curator Network (~150) | **WardCur** | ❌ none recruited |
| Legal Counsel (external) | **Legal** | ❌ not engaged |
| Finance & Operations | **FinOps** | ✅ Oorvani bench |

The platform's four in-app roles map onto these rather than sitting alongside them. PRD §7's `admin` is CurOps plus ProgDir; `curator` is WardCur; `registered citizen` and `anonymous` are the public. They are permissions, not staffing.

### Board — Oorvani trustees

Owns the commitments the foundation makes in its own name and carries after this programme ends. Not an operational role; accountable on exactly the decisions that should not belong to a programme lead.

- Retention period for citizen contact data — decided, then confirmed by counsel
- The named DPDP grievance officer
- Funding secured — bridge and programme
- Post-election data deletion actually happening
- Programme close and the funder report

### ProgDir — Programme Director

Accountable for delivery across every workstream. The single throat for anything that crosses two workstreams, and the escalation point when a phase gate is at risk.

- Legal counsel engaged and kept moving
- The legal pages published — `/privacy`, `/terms`, `/about`
- Processor agreements in place with every vendor
- The WhatsApp channel chain driven end to end
- The comms engine and the seven sends, as a programme
- The press push at N and its second beat at E−2w
- The silence-period freeze called and enforced
- Programme close — retro and funder report

### Siva — Product & Engineering

Builds and runs the platform. One person covering what the plan scopes as two engineers plus a half-time product lead.

- Phase 1 teaser surfaces — ward finder, logistics, voting guides
- Legal and trust pages built
- Partner surfaces — `/partner-with-us`, `/partner/{slug}`
- `/press`
- Candidate surfaces — candidate pages, report cards, compare
- `/data` public metrics
- The comms engine — seven sends, bilingual, ward-scoped, per-ward gating
- Pincode→ward fallback table
- Affidavit extraction and Kannada translation pipelines
- Hosting, DNS, CI/CD, secrets custody, backups, monitoring
- Election-day readiness — load, cache, on-call, rollback
- Post-election deletion job

### CurOps — Curator Operations

Owns the accuracy of ward data across 369 wards, and the curator network that produces it. The role that saturates through October and November.

- Curator recruitment and vetting to full ward coverage
- Curator onboarding — what the standard is, what counts as a source
- Official calendar and returning-officer contacts tracked
- Nomination list ingested — provisional Oct 26, final Nov 1
- Affidavits collected, extracted, and spot-checked
- Polling booth data, address-accurate
- Ward readiness sign-off across 369 wards
- The flag queue worked through the election period

### Edit — Bilingual Content Editor

Owns everything citizens read, in both languages. The only net under machine-translated Kannada and AI-extracted affidavit fields, both of which publish without prior review.

- 16 WhatsApp templates drafted in English and Kannada
- The seven sends written and scheduled
- Report card editorial standard
- Kannada QA regime — spot-checking what the machine publishes
- Press kit copy and spokesperson quotes
- Results-day and wrap content

### Part — Partnerships Lead

Owns reach. Recruits and services the partner cascade that puts ward links into apartment groups, colleges and employer networks. The longest lead time of any role.

- Partner network — at least one partner in 300 of 369 wards
- Partner kit assets — bilingual forward text, poster, neutrality statement
- Curator recruitment, run as the same conversations as partner recruitment
- Ward coverage dashboard operated as the work queue
- Press relationships, and the push at N

### WardCur — Ward Curator Network

~150 people, each holding one or more wards. The hands that produce the data CurOps is accountable for. Publish-immediately trust, scoped to assigned wards.

- Candidate records compiled for their wards
- Affidavit fields confirmed against the source document
- Sources attached to every field
- Flags on their wards triaged and corrected
- Ward readiness confirmed to CurOps

### Legal — External Counsel

Engaged for DPDP Act 2023 compliance. Not a product question, and out of the specification's competence.

- `/privacy` drafted — consent notice, purpose limitation, data-principal rights, processor inventory
- `/terms` drafted, including contribution licensing for flags and issue votes
- Retention period confirmed or amended
- Processor agreements reviewed
- Google Maps Platform terms position confirmed
- Breach-notification procedure

### FinOps — Finance & Operations

Oorvani's existing bench. Contracts, vendor accounts, and paying people.

- Vendor accounts and billing — messaging, cloud, APIs
- Processor agreements executed
- Curator honoraria disbursement mechanism
- Funder reporting

---

## 3. Deliverables by month

Every deliverable, placed in the month it is due, across all workstreams.

### August — P0 Network

The month that decides whether the rest of the plan is possible. Nothing here is visible to a citizen, and everything downstream waits on it.

| Workstream | Deliverable |
|---|---|
| Legal | **Retention period decided**, and put to counsel |
| Legal | **Legal counsel engaged** |
| Growth | **Named outreach owner** — one person owning partner and curator recruitment as one motion |
| Growth | Owned-channels decision — are Open City and Citizen Matters available for distribution |
| Growth | Partner and curator recruitment begins |
| Data | Official calendar and returning-officer contacts tracked |
| Comms | 16 WhatsApp templates drafted, English and Kannada |
| Comms | Report card editorial standard and curator onboarding material |
| Ops | Hosting, DNS, CI/CD, secrets custody |
| Ops | Metered API accounts opened, with quota alerts |
| Ops | Meta business verification started |
| Product | Phase 1 teaser surfaces built |
| Governance | Bridge funding secured |

### September — P0 exit, P1 teaser ships

| Workstream | Deliverable |
|---|---|
| Legal | **`/privacy` published** — gates Meta verification, which gates everything on WhatsApp |
| Legal | `/terms` published, including contribution licensing |
| Legal | Grievance officer named and published |
| Legal | Processor agreements signed |
| Product | Legal and trust pages shipped — `/privacy`, `/terms`, `/about` |
| Product | Partner surfaces shipped — `/partner-with-us`, `/partner/{slug}` |
| Product | `/press` shipped |
| Data | Pincode→ward fallback table |
| Growth | Partner kit assets — bilingual forward text, poster, neutrality statement |
| Growth | First curators onboarded (~20 active) |
| Comms | 16 templates submitted to Meta |
| Ops | Email channel live — domain authentication, warm-up, suppression |
| Ops | Backups running, restore rehearsed |
| Ops | Monitoring and alerting |

**Phase 1 ships this month.** The ward finder is the forwardable asset and the registration funnel opens behind it.

### October — P1 peak, then N on the 19th

| Workstream | Deliverable |
|---|---|
| Comms | **R1 send, Oct 12** — electoral roll deadline |
| Ops | WhatsApp channel live — sender registered, display name and templates approved |
| Product | Candidate surfaces shipped — candidate pages, report cards, compare |
| Product | `/data` shipped |
| Data | Nomination list ingested — provisional, from Oct 26 |
| Data | Affidavit collection begins |
| Data | Booth data collection begins |
| Growth | Curator network at working coverage (~90 active) |
| Growth | Press push at N |
| Comms | **L1 send, Oct 28** — candidates have filed, provisional |

### November — final list, then the poll run-up

The hardest month. The final list lands on the 1st and report cards for 369 wards must be complete by the 17th.

| Workstream | Deliverable |
|---|---|
| Data | **Final candidate list ingested, Nov 1** |
| Data | **Report cards complete across 369 wards, by Nov 17** |
| Data | Affidavit spot-check complete |
| Data | Ward readiness sign-off across 369 wards |
| Data | Booth data address-accurate |
| Data | Flag queue at peak volume |
| Growth | Curator network at full strength (~150 active) |
| Comms | **C1, Nov 10** — vote on your ward's top 3 issues |
| Comms | **C2, Nov 17** — final list, report cards complete |
| Comms | **C3, Nov 24** — top issues, compare, booth locator |
| Comms | **F1, Nov 28** — booth, timings, ID to carry |
| Comms | **Silence-period freeze from Nov 29** |
| Growth | Press second beat at E−2w |
| Product | Election-day readiness — load tested, cache tuned, on-call rota, rollback rehearsed |

### December — the poll

| Workstream | Deliverable |
|---|---|
| Product | **Election-day on-call, Dec 1** |
| Comms | Results-day and wrap content, from ~Dec 4 |
| Data | Flag queue worked down |
| Growth | Curator network wind-down begins |

### January — P5 close

| Workstream | Deliverable |
|---|---|
| Governance | Programme close — funder report and retro |
| Governance | Curator honoraria settled |
| Product | `/data` final figures published |
| Growth | Curator and partner network wound down |

### February — quiet

Retention clock running. Archive the programme record. No deliverables.

### March — the obligation

| Workstream | Deliverable |
|---|---|
| Legal | **Post-election data deletion executed** — contact data deleted or anonymised, ~3 months after results |

---

## 4. RACI matrix

44 deliverables across seven workstreams.

| Letter | Meaning |
|---|---|
| **R** | **Responsible** — does the work |
| **A** | **Accountable** — final decision authority, carries the outcome. **Exactly one per row.** |
| **C** | **Consulted** — asked before the decision |
| **I** | **Informed** — told after it |
| **A/R** | Accountable and doing the work. Still one A. |
| – | No involvement |

A row with two A's is a row nobody owns.

### 4.1 Legal & Compliance

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| Retention period decided + confirmed | Aug | **A** | C | C | – | – | – | – | **R** | I |
| Legal counsel engaged | Aug | **A** | **R** | I | – | – | – | – | – | C |
| `/privacy` published | Sep | I | **A** | **R** | – | C | – | – | **R** | C |
| `/terms` published, incl. contribution licensing | Sep | I | **A** | **R** | – | C | – | – | **R** | – |
| Grievance officer named + published | Sep | **A** | **R** | I | – | – | – | – | C | I |
| Processor agreements signed | Sep | I | **A** | C | – | – | – | – | **R** | **R** |
| Post-election data deletion executed | Mar | **A** | C | **R** | I | – | – | – | C | – |

The Board holds A on the retention period and the grievance officer. Both are commitments the foundation carries after this programme ends.

### 4.2 Data & Curation

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| Pincode→ward fallback table | Sep | – | I | **A/R** | C | – | – | – | – | – |
| Official calendar + RO contacts tracked | Aug→ | – | I | I | **A/R** | – | C | – | – | – |
| Nomination list ingested — provisional, then final | Oct–Nov | I | I | **R** | **A** | C | – | **R** | – | – |
| Affidavits collected, extracted, spot-checked | Oct–Nov | – | I | **R** | **A** | C | – | **R** | – | – |
| Booth data, address-accurate | Oct–Nov | – | I | **R** | **A** | – | – | C | – | – |
| Ward readiness sign-off × 369 | Nov | I | I | C | **A** | C | – | **R** | – | – |
| Flag queue worked | Oct–Dec | – | I | C | **A/R** | C | – | **R** | – | – |

Every row here is accountable to a role with nobody in it.

### 4.3 Product & Engineering

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| Phase 1 teaser surfaces | Aug–Sep | I | C | **A/R** | C | C | I | – | – | – |
| Legal + trust pages | Sep | I | **A** | **R** | – | C | – | – | **R** | – |
| Partner surfaces | Sep | – | I | **A/R** | – | C | C | – | – | – |
| `/press` | Sep | I | **A** | **R** | – | **R** | C | – | – | – |
| Candidate surfaces — candidates, report card, compare | Oct | I | C | **A/R** | C | C | – | – | – | – |
| `/data` | Oct–Nov | I | C | **A/R** | C | I | C | – | – | – |
| Comms engine — 7 sends, bilingual, ward-gated | Sep–Nov | – | **A** | **R** | C | **R** | – | – | – | – |
| Election-day readiness | Nov | I | I | **A/R** | I | – | – | – | – | – |

### 4.4 Growth & Partnerships

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| Named outreach owner | Aug | **A** | **R** | I | – | – | – | – | – | I |
| Owned-channels decision | Aug | **A** | **R** | I | – | C | C | – | – | – |
| Partner network — ≥1 partner in ≥300 wards | Aug–Nov | I | C | I | C | – | **A/R** | – | – | – |
| Curator network — ~150 recruited + vetted | Aug–Oct | I | C | I | **A/R** | – | **R** | – | – | C |
| Partner kit assets | Sep | – | C | C | – | **R** | **A** | – | – | – |
| Press push at N + E−2w | Oct–Nov | C | **A** | I | – | **R** | **R** | – | – | – |

Naming the outreach owner costs nothing and is the highest-leverage row in this table. Curator and partner recruitment are the same conversations with the same people; split across two owners, the relationship gets asked twice and gives once.

### 4.5 Comms & Content

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| 16 WhatsApp templates drafted + submitted | Aug–Sep | – | C | **R** | – | **A/R** | – | – | C | – |
| Seven sends written + scheduled | Sep–Nov | – | C | **R** | C | **A/R** | I | – | – | – |
| Report card standard + curator onboarding | Aug–Sep | – | C | I | **R** | **A** | – | C | – | – |
| Kannada QA regime | Sep–Nov | – | I | C | **R** | **A/R** | – | **R** | – | – |
| Silence-period freeze — Nov 29 → Dec 1 | Nov | I | **A** | **R** | **R** | **R** | **R** | I | C | – |
| Results-day + wrap content | Dec | I | **A** | C | C | **R** | I | – | – | – |

Kannada is machine-generated and published without human review (PRD §8); affidavit fields are AI-extracted on the same terms (PRD §5.2). The QA regime and the flag queue are the only nets under both.

The silence-period freeze is the one row where every operational column is **R**. It is a coordinated stop, not a task, and anyone still sending is the failure.

### 4.6 Ops & Infrastructure

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| Hosting, DNS, CI/CD, secrets custody | Aug | I | I | **A/R** | – | – | – | – | – | C |
| Metered API accounts + quota alerts | Aug–Sep | – | I | **A/R** | – | – | – | – | C | **R** |
| Email channel live | Aug–Sep | – | I | **A/R** | – | C | – | – | – | C |
| WhatsApp channel live — verification → sender → templates | Aug–Oct | C | **A** | **R** | – | C | – | – | C | **R** |
| Backups + rehearsed restore | Sep | – | I | **A/R** | – | – | – | – | – | – |
| Monitoring + alerting | Sep | – | I | **A/R** | – | – | – | – | – | I |

The WhatsApp row is a chain, not a task: Meta verification needs a published `/privacy` URL, sender registration needs a clean `+91` number, and template approval takes weeks in Meta's queue. Every arrow is someone else's schedule.

### 4.7 Governance & Funding

| Deliverable | Month | Board | ProgDir | Siva | CurOps | Edit | Part | WardCur | Legal | FinOps |
|---|---|---|---|---|---|---|---|---|---|---|
| Bridge funding secured | Aug | **A/R** | **R** | C | – | – | C | – | – | **R** |
| Programme funding secured | Aug–Mar | **A/R** | **R** | I | – | – | C | – | – | **R** |
| Curator honoraria disbursement mechanism | Sep–Dec | I | C | – | **R** | – | – | I | – | **A/R** |
| Programme close — funder report + retro | Jan | **A** | **R** | C | C | C | C | I | – | **R** |

---

## 5. Where the plan is unstaffed

**Twenty-four of the forty-four deliverables have no one to deliver them.** Thirteen have an **A** in a role with nobody in it; eleven more have a vacant **R**. They concentrate in the three workstreams that carry the election: Data & Curation (all seven rows), Comms & Content (all six), and Growth & Partnerships (four of six).

Working backwards from when each role has to be *effective* rather than when the work first appears:

| Role | Must start | Why that month |
|---|---|---|
| **Partnerships Lead** | **August** | The partner cascade must exist before the teaser ships in September, or Phase 1 lands nowhere. Longest lead time of any role. |
| **Curator Operations** | **August** | Recruitment, vetting and training all precede October activation. |
| **Legal Counsel** | **August** | Gates `/privacy` → Meta verification → templates → the entire comms plan. |
| **Second engineer** | **September** | Onboard in September to be useful in October. A November start spends November onboarding. |
| **Content Editor** | **September** | 16 bilingual templates due September; sends run from October. |
| **Ward curators** | **September** | Ramps ~20 → 90 → 150 across September to November. |

Three roles must start in August. It is currently late July.

---

## 6. How to use this document

1. **Fill the "filled today" column in §2.** Until five roles have names, twenty-four deliverables in §4 are nobody's work.
2. **Treat the August start dates in §5 as deadlines.**
3. **Confirm the two assumed dates in §1.1** — the electoral roll deadline and the results declaration.
4. **Re-read §3's November block before agreeing to anything else.** 369 wards of report cards in seventeen days is the constraint the whole plan bends around.
