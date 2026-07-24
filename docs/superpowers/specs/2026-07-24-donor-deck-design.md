# Donor fundraising deck — two-year ask

**Date:** 2026-07-24
**Status:** Approved design — ready for implementation plan
**Operator:** Oorvani Foundation (FCRA registered)

## Goal

Produce a fundraising deck that raises roughly **₹3.2–3.5 Cr (~$370–400k at ₹87/USD) over
two years** for the GBA elections citizen platform and its post-election
successor: a permanent ward accountability layer for Bengaluru, plus a pilot in
a second city in year two.

Two deliverables, in order:

1. `docs/donor-narrative.md` — the full argument in prose, committed to the
   repo, edited and approved by the team.
2. A `.pptx` deck generated from the approved narrative.

The narrative comes first because the words need review before they are cut into
slides, and because facts will change across two years — the narrative stays the
source of truth and the deck is regenerated from it.

## The core argument

> Elections are the cheapest moment in civic tech to acquire an audience for
> local government — and every Indian city has one coming. Bengaluru is where we
> prove the model: 369 redrawn wards, the first ward polls in a decade, the
> sharpest version of the problem in the country. In year two we run it a second
> time in another city at a fraction of the cost, because the second city buys
> curators and data, not software.

Three moves make the argument fundable:

**The election is the acquisition event, not the product.** A three-month
election website is hard to fund. A two-year accountability institution that
uses an election to acquire its audience is a different proposition. The
election platform becomes proof of delivery inside the pitch rather than the
pitch itself.

**Bengaluru first, other cities to follow.** Not an appendix slide. The
portable/non-portable split — platform, data model, curator playbook and
neutrality machinery travel; ward data, curators and partners do not — is what
turns a national claim into a costed one.

**Neutrality is machinery, not a promise.** A source on every field, an
immutable audit log with rollback, no paid acquisition, and funders named
publicly on `/about`. All already designed in (`docs/prd.md` §11, §14), which
means the deck describes a built system rather than an intention.

## Audience

One master deck serving four donor types, with three swappable slides.

| Audience | What they need that others don't |
|---|---|
| Indian philanthropic foundations | Theory of change, outcomes, quarterly reporting |
| Corporate CSR (Indian companies) | Schedule VII eligibility, compliance, employee engagement |
| International / global funders | India and GBA context; FCRA status; independence framing |
| HNIs / individual donors | The people, the city, a short emotional read |

**Swap slides:** 2 (the moment — context depth), 11 (why us — credibility
framing), 20 (the ask — component and amount). Slides 3–19 are identical across
all four, which is what keeps the deck maintainable.

## Slide outline — 21 core

| # | Slide | Job it does |
|---|---|---|
| 1 | Title | Oorvani Foundation · two-year ask |
| 2 | The moment | First ward polls in ~a decade · 369 redrawn wards · 1.4 cr residents, ~90–100 lakh voters |
| 3 | The citizen's problem | Don't know their ward, can't evaluate candidates |
| 4 | The problem that outlasts the election | No one knows the ward budget, the officials, whether the works happened |
| 5 | **The insight** | Cheapest acquisition moment in civic tech — and every city has one coming |
| 6 | Phase 1 — election platform | Ward finder, report cards, compare, issue voting |
| 7 | Phase 2 — ward accountability layer | Budgets, works, officials, WhatsApp groups, ward stats |
| 8 | The two-year arc | Bengaluru election → transition → accountability, city two in the back half |
| 9 | **What travels, what doesn't** | Portable: platform, data model, curator playbook, neutrality machinery. City-specific: ward data, curators, partners |
| 10 | **City two** | Selection criteria; city named at month 12 |
| 11 | Why us | Oorvani + Open City; MVP built before asking |
| 12 | Neutrality by design | Source on every field, audit log, no paid spend, funders named |
| 13 | Distribution | Partner-led cascade — RWAs, colleges, employers, press |
| 14 | Targets | 300k visitors · 25k registered · ≥50 in ≥300 of 369 wards · year-2 and city-two targets |
| 15 | What we report to you | Quarterly metrics, public ward-coverage dashboard |
| 16 | Team | Who is here, who this money hires |
| 17 | Use of funds | Two-year budget |
| 18 | **Marginal cost of a city** | City one vs city two — the number that makes national scale credible |
| 19 | Risks & mitigations | Date slips, data access, neutrality attack, post-election churn, city-two partner risk |
| 20 | The ask | Named components, lead and co-funder structure |
| 21 | Contact | |

**Appendix:** detailed budget, product screenshots, comms calendar, governance
and compliance, IA map, replication playbook contents.

Slide 5 is the slide that has to land. Slide 18 is the one a programme officer
will circle. Slide 19 is where they go first.

## Phase 2 — what the ward accountability layer contains

Currently listed as out of scope for the election release
(`docs/overview.md` §9). This deck is what funds it.

- Ward budget: allocation, spend to date, heads of expenditure
- Ongoing and completed works, with status and cost
- Key officials for the ward, with contact routes
- Link to the ward's WhatsApp or community group
- Ward statistics: road length, population, area, civic assets
- Corporator report cards — the candidate report card, carried forward for the
  person who won

The continuity is the point: the same ward page a citizen used to choose a
candidate becomes the page that tracks what that candidate does.

## Budget model

Two years, structured by what each year does. Every figure below is
**indicative** and marked `INPUT NEEDED` in the narrative until the team
supplies Oorvani's actual pay bands and overhead rate. Figures are incremental
to Oorvani's existing staff and funding.

**Year 1 — Bengaluru election, and foundations of the accountability layer**

| Line | Driver | Indicative |
|---|---|---|
| Engineering (2 FTE) | Election platform → ward layer | ₹36L |
| Product / programme lead (0.5 FTE) | | ₹12L |
| Curator ops (2 FTE) | Recruit, train, QA across 369 wards | ₹20L |
| Bilingual content editor | EN/KN across every page and send | ₹9L |
| Partnerships lead | RWAs, colleges, employers, press | ₹12L |
| Design (contract) | | ₹6L |
| Curator honoraria | ~150 curators × ~₹2,500/month, active months | ₹30L |
| Infra, WhatsApp API, AI extraction | 25k users × 7 sends; affidavit parsing | ₹12L |
| Legal | DPDP, privacy, terms — first on the critical path | ₹6L |
| Ward data acquisition | RTI, digitisation, geodata | ₹8L |
| Field, training, travel, press assets | | ₹11L |
| **Subtotal** | | **~₹1.6 Cr** |

**Year 2 — Bengaluru accountability at work, plus city two**

About ₹1.8 Cr: the Bengaluru programme continues at roughly ₹1.25 Cr with
engineering tapering and data work rising, plus a city-two block of about ₹55L
covering local curator ops, partnerships, data acquisition, a third language,
curator honoraria and travel.

**Two-year total ≈ ₹3.2–3.5 Cr (~$370–400k at ₹87/USD)**, plus Oorvani's overhead rate.

**Curator honoraria are funded, not volunteered.** The docs describe curators as
trusted volunteers; this deck funds them. Data accuracy across 369 wards is what
the platform's entire credibility rests on, and goodwill is a weak guarantee
under election-time load. The line also directly mitigates the
central-Bengaluru-skew risk named in `docs/gtm-plan.md` §9, because honoraria
can be weighted toward under-served zones.

### The marginal-cost argument (slide 18)

City one costs ~₹1.6 Cr. City two costs ~₹55L, because city two buys curators,
data and partners — not software. That ratio is the whole national-scale claim,
and it is why the multi-city framing survives contact with a sceptical
programme officer.

State the basis of the ₹55L explicitly on the slide: it is the **incremental**
cost of adding a city to a platform and team already funded, not the standalone
cost of running a city from zero. A programme officer will ask, and a number
that quietly omits the shared engineering and product cost behind it reads as a
number designed to flatter. Said plainly, the comparison still holds.

## City two

The deck does **not** name the pilot city. It states selection criteria and
commits to naming the city by **month 12**:

- An upcoming ULB election inside the grant window
- Ward-level data availability
- A committed local civic partner organisation
- An existing Oorvani or Citizen Matters presence

Naming a city without a signed local partner would be priced as failure risk.
Publishing the criteria and a decision date shows discipline instead.

## The ask — named components, not tiers

A foundation may lead at ₹1.5 Cr; a CSR desk writes ₹25L; an HNI writes ₹10L.
One number cannot serve all four audiences, and a tier table makes the smallest
donor feel smallest.

Slide 20 therefore presents the total as **named, separable components**, each
with its own price and its own outcome:

- The ward accountability layer
- Curator honoraria across 369 wards
- The bilingual comms programme
- The city-two pilot

A donor picks a component and knows exactly what their money bought. This also
gives a clean lead-funder / co-funder structure without printing a tier ladder.

## Risks the deck must address (slide 19)

| Risk | Mitigation stated in the deck |
|---|---|
| Election date slips | Ward finder and the accountability layer are useful regardless of poll date; calendar anchors are relative (`docs/gtm-plan.md` §3) |
| GBA ward data unavailable | Final delimitation already in hand (`data/gba.geojson`, 369 wards); budget and works data pursued via RTI with a digitisation line funded |
| Neutrality attack | Source on every field, audit log, no paid acquisition, funders named publicly |
| Post-election audience churn | The re-consent checkbox already shipped at registration (PRD §14) gives a lawful list for the accountability phase — foresight the deck should show, not hide |
| City-two partner does not materialise | Bengaluru outcomes stand alone; the replication playbook ships regardless; city-two funds are ring-fenced and returnable or redeployed by agreement |
| Curator coverage skews to central Bengaluru | Honoraria weighted to under-served zones; public ward-coverage dashboard makes the skew visible early |

## Facts the team must supply

Marked `INPUT NEEDED` in the narrative, following the convention already used in
`content/pages/en/about.md`:

- Oorvani's actual pay bands and overhead rate
- Open City track-record figures (users, cities, datasets, years running)
- Named team members, roles and bios
- Current funders, for the funding-disclosure slide
- Whether Citizen Matters is Oorvani-operated (still open — PRD §17)
- Contact details and the named spokesperson for the deck's closing slide

The deck must not ship to any donor with these unresolved. Every claim in it has
to survive a programme officer's diligence call, and an invented number is the
one failure a neutrality-first platform cannot afford.

## Out of scope

Individual donor-specific customisation beyond the three swap slides. A public
web version of the deck. Grant application forms, budget spreadsheets in funder
templates, and MOU or contract drafting. Any commitment to a specific second
city.
