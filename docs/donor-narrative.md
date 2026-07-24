# The case for support — a two-year ask

**Date:** 2026-07-24
**Operator:** Oorvani Foundation (FCRA registered)
**Ask:** ₹3.2–3.5 crore over two years
**Status:** Draft — contains `INPUT NEEDED` markers that must be resolved before this goes to any donor

> **How to use this document.** This is the source of truth for the donor deck.
> The slide deck is generated from it. Edit the words here, not on the slides.
> Section numbers map to slide numbers. Design notes for each slide are in
> `docs/superpowers/specs/2026-07-24-donor-deck-design.md`.

---

## The case in one paragraph

Bengaluru votes for its ward corporators this year, for the first time in about
a decade, across 369 wards that were redrawn so recently that most citizens do
not know which one they now live in. We have built a platform that tells them —
and then tells them who is standing, what those candidates have sworn to the
Election Commission, and how to reach their polling booth, in English and
Kannada, with a source on every field. That is the part everyone funds. The part
that matters more comes after: on the day results are declared, the citizen who
used our ward page to choose a candidate keeps the same page, and it starts
showing what their corporator does with the ward's money. We are asking for two
years, because that is how long it takes to turn an election audience into an
accountability habit. Bengaluru first, and a second city in year two.

---

## 2 · The moment

Bengaluru's last ward election was roughly a decade ago. In that time the city
grew past 1.4 crore residents, and its municipal boundaries were redrawn into
**369 new wards** under the Greater Bengaluru Authority. Somewhere between 90
and 100 lakh people are eligible to vote in a ward election most of them have
never voted in.

The first-time cohort is unusually wide. After ten years without ward polls,
nearly everyone in Bengaluru under thirty has never voted for a corporator, and
neither has anyone who moved to the city in the last decade — a group that, in
Bengaluru, is very large.

<!-- INPUT NEEDED: confirm the exact gap since the last BBMP ward election, and
the current registered-voter figure, with a citable source for each. Donors
check both. -->

---

## 3 · What a citizen runs into

We interviewed citizens before designing anything. People were willing to vote.
Three specific things stopped them:

They did not know which ward they now belong to. Delimitation moved the lines,
and no accessible tool tells a resident where they landed.

They could not find trustworthy information about the people standing in it.
Candidate information exists — sworn affidavits are public record — but it sits
in scanned PDFs on a government portal, in English, indexed by nothing.

What they could find felt partisan. Every accessible source on a local candidate
was published by someone with a stake in the outcome.

The platform answers all three: a ward finder, sourced candidate report cards
built from affidavits, and side-by-side comparison, with the logistics — roll
check, voter ID, how to vote, booth locator — presented as a checklist a
first-time voter can follow from start to finish.

---

## 4 · The problem that outlasts the election

Ask a Bengaluru resident what their ward's budget was last year, what works were
sanctioned in it, or who the engineer responsible for their road is, and almost
nobody can answer. The information mostly exists. It is scattered across
tenders, work orders, RTI replies and portals that were not built to be read by
residents.

So the accountability loop never closes. A corporator is elected on local
promises and then becomes invisible for five years, because there is no place a
resident can go to see what happened to the money. The next election arrives and
the same citizen votes on the same absence of information.

Fixing that is the actual goal. The election is how we get the audience to
show up.

---

## 5 · The insight

**Local government is the tier that affects a citizen most and interests them
least — until an election.**

Civic technology has a permanent distribution problem. A ward budget dashboard
launched in an ordinary month has no audience and no way to buy one. But for
roughly eight weeks before a ward poll, ordinary people go looking for
information about their corporator without being prompted. Journalists cover it.
Apartment groups forward links. Attention arrives free.

That window is the cheapest customer acquisition in civic technology, and it
opens on a fixed date that we know in advance.

So we are not building an election website. We are building a ward
accountability platform, and launching it through an election because that is
when citizens will come to it on their own. The election earns the audience. The
accountability layer keeps it.

**And every Indian city has one of these windows coming.** Municipal terms are
five years; ULB elections are routinely due or overdue across the country.
Bengaluru is where we prove the model because it has the sharpest version of the
problem — a decade-long gap, boundaries nobody recognises, 369 wards — but
nothing about the approach is specific to Bengaluru.

---

## 6 · Phase one — the election platform

Built and running. This is not a proposal for software; it is a request to
operate and extend software that exists.

- **Ward finder.** A resident enters an address and gets their new GBA ward. All
  369 wards, with real delimitation boundaries.
- **Candidate report cards.** Criminal cases, assets, education and track
  record, drawn primarily from candidates' sworn EC affidavits. Where a field is
  extracted from a scanned affidavit with AI assistance, it is labelled as such
  until a trained curator confirms it, with the affidavit attached as the source.
- **Comparison.** Candidates in a ward side by side, same fields, same standard
  applied to everyone.
- **Issue voting.** Residents pick the top three issues in their ward. Results
  are public, including to people who did not vote.
- **Voting logistics.** Registration check, voter ID guidance, how to vote, and
  a booth locator, ordered as a checklist.
- **Bilingual throughout.** Every page exists in English and Kannada at its own
  shareable URL.
- **Flag misinformation.** Any resident can flag any field in any ward. The flag
  routes to the curator who owns that ward, who corrects it or explains why not.

<!-- INPUT NEEDED: exact build status as of the date this deck ships — which
pages are live, whether the demo URL is public, and how many wards have real
candidate data. Do not overstate; a donor may open the site during the call. -->

---

## 7 · Phase two — the ward accountability layer

This is what the two years fund. Today it is explicitly out of scope for the
election release.

The same ward page a citizen used to choose a candidate becomes the page that
tracks what that candidate does:

- **Ward budget** — allocation, spend to date, and what it was spent on
- **Works** — projects sanctioned, under way and completed, with cost and status
- **Officials** — who is responsible for what in this ward, and how to reach them
- **Community** — a link to the ward's residents' WhatsApp or community group
- **Ward statistics** — road length, population, area, civic assets
- **Corporator report cards** — the candidate report card, carried forward for
  whoever won

The continuity is the design. We do not launch a second product to a cold
audience. The page a resident already bookmarked changes what it shows.

---

## 8 · The two-year arc

| Period | Bengaluru | Second city |
|---|---|---|
| Months 0–6 | Election platform at full load: teaser, candidate launch, countdown, poll day | — |
| Months 6–12 | Results, corporator report cards, ward budget and works layer ships | Selection criteria applied; city named at month 12 |
| Months 12–18 | Accountability layer in daily operation; first annual ward scorecards | Local partner signed, curators recruited, ward data acquired |
| Months 18–24 | Second annual cycle; playbook published | Platform live in city two |

---

## 9 · What travels, and what does not

The multi-city claim is only worth making if the second city is genuinely
cheaper than the first. It is, and this is why.

**Travels — built once, reused:**
the platform itself, the ward and candidate data model, the affidavit extraction
pipeline, the curator handbook and training, the flag-and-correct workflow, the
audit and rollback machinery, the neutrality standard, the comms templates, the
partner kit format.

**Does not travel — bought fresh in every city:**
ward boundary and delimitation data, local curators, local partner
organisations, translation into the local language, relationships with the local
election office and municipal body.

Software is the expensive half and it is already paid for. What a new city costs
is people and data.

---

## 10 · The second city

We are not naming it in this document, and we will not name it to a donor before
we can name a local partner alongside it. A city announced without a committed
partner organisation is a city a programme officer will correctly price as
likely to fail.

Instead we commit to the criteria and to a date. **The second city is selected
and named by month 12**, against four tests:

1. A ULB election falling inside the grant window
2. Ward-level boundary and budget data that can actually be obtained
3. A local civic organisation that has agreed to be the partner on the ground
4. Existing Oorvani presence, or a credible route to one

<!-- INPUT NEEDED: if a shortlist is defensible by the time this ships — cities
with ULB elections due in the window — name two or three with the timing
rationale. It is stronger than criteria alone, and safe as long as no
partnership is claimed. -->

---

## 11 · Why Oorvani

<!-- INPUT NEEDED: this section carries the credibility of the whole document
and currently contains no numbers. Supply: years Open City has operated, its
usage figures, datasets published, cities covered, any government or press
citations of its data, and whether Citizen Matters is Oorvani-operated (open
question, PRD §17). -->

The Oorvani Foundation runs [Open City](https://opencity.in), an open urban data
platform for Bengaluru. It is the operator named on the platform's About and
Privacy pages, and it is a trust with the compliance posture — FCRA
registration, audited accounts, an existing team — to take institutional money
and report on it properly.

Three things about how we have worked so far are worth a donor's attention:

**We built before we asked.** The election platform exists. The specification,
architecture, information architecture and go-to-market plan are written,
reviewed and public in our repository. This request funds operation and
extension, not discovery.

**We run cheap.** The platform is a single application and a database on one
virtual machine. Infrastructure costs a few lakh a year, not tens. Almost every
rupee in this budget is people and data.

**We wrote down the hard decisions before they were convenient.** We committed
to no paid acquisition, to naming our funders publicly, to going dark for the
legally mandated silence period before the poll, and to deleting citizen contact
data within three months of results. Each of those costs us something. They are
in the plan because a neutrality platform that decides these questions under
pressure has already lost.

---

## 12 · Neutrality is machinery, not a promise

Every platform in this space claims to be neutral. Here is what enforces it.

**A source on every field.** Each piece of candidate data displays where it came
from, and distinguishes official affidavit data from curator-compiled context. A
reader can always get to the original document.

**An immutable audit log.** Every published change records who made it, when,
and from what source, and can be rolled back. Curators publish immediately
because they are vetted up front — the audit log, not an approval queue, is what
makes that safe.

**Anyone can flag anything.** Flagging works across every ward, not just the
flagger's own, and the submitter sees whether their flag was accepted or
rejected and why.

**No paid acquisition, ever.** Partly because we cannot afford it, and mostly
because buying political-adjacent advertising would destroy the only asset the
platform has. Distribution is earned or it does not happen.

**Our funders are named publicly.** The About page lists who pays for this. For
a platform whose entire value is neutrality, the funding cannot be opaque — and
it is the first question a sceptical journalist asks.

**We go dark before the poll.** The Representation of the People Act bans
electioneering in the 48 hours before polls close. Rather than argue that neutral
report cards are not electioneering, we stop. Our last message goes out three
days before the election and carries booth logistics only. This costs us the
election-morning reminder, the highest-converting message in any voter campaign.
It buys a platform nobody can credibly accuse of campaigning.

---

## 13 · How citizens find us

There is no advertising budget in this proposal. Distribution runs through
people who already have the audience:

**Resident welfare associations and apartment groups.** The unit of distribution
is a message pasted into a building's WhatsApp group. Every partner gets a kit —
pre-written forward text in English and Kannada, a poster sized for WhatsApp, a
tagged link so their forwards are counted, and a one-paragraph neutrality
statement they can point to when someone accuses them of campaigning. That last
item is not decorative; a partner who cannot answer the accusation stops
forwarding.

**Colleges, employers and youth organisations.** The RWA cascade reaches
homeowners and long-tenured residents. It misses students, paying guests and
young renters almost entirely — who are, this election, both the largest
first-time cohort in a decade and the least likely to be on the roll. They are
recruited as a separate partner category with first-time-voter material as the
lead asset.

**Press.** Journalists arrive when the Election Commission issues its
notification, so the press kit ships months before that.

**Ward coverage is the operating dashboard.** We track partners and
registrations per ward against all 369. The uncovered set is the work queue, and
it is the early warning for the failure mode where a Bengaluru civic project
quietly becomes a central-Bengaluru civic project.

---

## 14 · What we are targeting

**Election phase (months 0–6):**

- **300,000 unique visitors**
- **25,000 registered citizens** with a home ward set
- **At least 50 registrations in at least 300 of the 369 wards**

The registration target is deliberately two numbers. A city-wide total is
satisfiable entirely out of a dozen affluent central wards — we would hit the
number and have failed the mission. The breadth figure is the one that encodes
what we are actually trying to do, and it is the one to look at first when the
two disagree.

These are built bottom-up from what an unpaid partner cascade can plausibly
deliver. One percent of Bengaluru's electorate would be about 90,000, which is a
better number to say out loud and a worse one to steer by.

**Accountability phase (months 6–24):**

<!-- INPUT NEEDED: year-two targets. Suggested shape, for the team to set:
wards with published budget and works data (of 369); returning visitors in a
non-election month; corporator report cards maintained; annual ward scorecards
published. -->

**Second city (months 12–24):**

<!-- INPUT NEEDED: a modest, explicit target for city two — wards covered and
registrations. Without one, the pilot reads as unmeasured. -->

---

## 15 · What we will report to you

Quarterly, in writing:

- Unique visitors, registrations, and registrations by ward against all 369
- Wards with published candidate data, and later, wards with published budget
  and works data
- Active curators, sources cited, flags raised, flags resolved, and median time
  to resolve a flag
- Partner organisations recruited and what each one's forwarding achieved
- Spend against budget

Most of these are already published continuously on a public `/data` page. A
platform that publishes other people's records should publish its own. Funders
receive the same figures with spend attached.

---

## 16 · The team

<!-- INPUT NEEDED: named people with roles and one-line bios — current Oorvani
staff on this project, and the roles funded by this grant. HNI and CSR donors
in particular fund people, and this section is currently empty. -->

This grant funds, incrementally to Oorvani's existing team: two engineers, a
half-time product and programme lead, two curator operations managers, a
bilingual content editor, a partnerships lead, contract design, and honoraria
for the ward curator network.

---

## 17 · Use of funds

All figures below are indicative pending final confirmation of Oorvani's pay
bands and overhead rate.

<!-- INPUT NEEDED: replace every figure in this section with Oorvani's actual
salary bands and overhead rate before this document goes to a donor. -->

**Year one — the election, and the foundations of the accountability layer**

| Line | What it buys | ₹ |
|---|---|---|
| Engineering (2 FTE) | Election platform, then the ward accountability layer | 36L |
| Product / programme lead (0.5 FTE) | | 12L |
| Curator operations (2 FTE) | Recruiting, training and quality across 369 wards | 20L |
| Bilingual content editor | English and Kannada, every page and every message | 9L |
| Partnerships lead | RWAs, colleges, employers, press | 12L |
| Design (contract) | | 6L |
| Curator honoraria | ~150 curators, active months | 30L |
| Infrastructure, WhatsApp API, AI extraction | Hosting, 25,000 users × 7 messages, affidavit parsing | 12L |
| Legal | Data protection compliance, terms, privacy | 6L |
| Ward data acquisition | RTI, digitisation, geodata | 8L |
| Field, training, travel, press assets | | 11L |
| **Year one total** | | **~1.6 Cr** |

**Year two — accountability in operation, plus the second city**

About **₹1.8 crore**: the Bengaluru programme continues at roughly ₹1.25 crore,
with engineering tapering and data work rising, plus about ₹55 lakh for the
second city.

**Two-year total: ₹3.2–3.5 crore** (~$370–400k at ₹87 to the dollar), plus
Oorvani's overhead rate.

**On curator honoraria.** We originally planned an all-volunteer curator
network. We are asking you to fund it instead. Data accuracy across 369 wards is
what every other claim in this document rests on, and goodwill is a weak
guarantee under election-week load. Paying curators also lets us direct effort
where it is hardest to recruit — the outer and under-served zones — which is the
single best defence against this becoming a central-Bengaluru project.

---

## 18 · What a second city costs

**City one: ₹1.6 crore. City two: ₹55 lakh.**

To be precise about what that second number is: it is the **incremental** cost
of adding a city to a platform and a core team already funded by this grant. It
is not the standalone cost of running a city from zero. Stated plainly, because
a number that quietly omits its shared costs is a number designed to flatter —
and the comparison holds anyway.

The ratio holds because a new city buys curators, ward data, translation and
local partnerships. It does not buy software, a data model, an extraction
pipeline, a curator handbook or a neutrality standard. Those were paid for in
Bengaluru.

This is the argument for funding Bengaluru at full cost. The expensive city is
the first one.

---

## 19 · What could go wrong

| Risk | What we do about it |
|---|---|
| **The election date slips.** GBA poll dates have moved before. | Our entire calendar is anchored to relative dates, not absolute ones. The ward finder and the accountability layer are useful whenever the poll lands. A delay costs us timing, not the programme. |
| **Ward budget and works data proves hard to obtain.** | Delimitation data is already in hand — all 369 wards with boundaries. Budget and works data is pursued through RTI, with digitisation funded as an explicit line rather than assumed to be free. Where a ward's data cannot be obtained, we publish that fact. |
| **We are accused of partisanship.** | A source on every field, an audit log on every change, no paid advertising, funders named publicly, and a total blackout during the legal silence period. The defence is built into the product rather than issued as a statement. |
| **The election audience does not stay for accountability.** | The consent to contact people about civic tools beyond this election is collected at registration, today, because gathering an election list and reusing it for a different purpose later is both bad practice and unlawful. The corporator report card also gives returning citizens a reason to come back that they already understand. |
| **The second city's local partner does not materialise.** | The second city is gated on a signed local partner, and named only at month 12. If no city passes the test, Bengaluru's outcomes stand on their own and the replication playbook still ships. Those funds are ring-fenced and can be returned or redeployed by agreement. |
| **Curator coverage skews to central Bengaluru.** | Honoraria weighted toward under-served zones, and a public ward-coverage dashboard that makes the skew visible in week three rather than month six. |
| **Data protection exposure.** | We collect phone numbers, emails and address-to-ward at scale. The privacy policy is lawyer-reviewed for DPDP Act compliance and ships before any citizen data is collected. Citizen contact data is deleted or anonymised within three months of results. |

---

## 20 · The ask

**₹3.2–3.5 crore over two years.**

We are not asking every donor for the whole amount. The programme is built from
components, each of which stands alone, has a price, and produces an outcome you
can point to:

| Component | What it delivers | ₹ (2 years) |
|---|---|---|
| **The ward accountability layer** | Budgets, works, officials and corporator report cards across 369 wards | <!-- INPUT NEEDED --> |
| **Curator honoraria** | A paid, trained curator network holding data accurate in all 369 wards | <!-- INPUT NEEDED --> |
| **The bilingual comms programme** | Every page and message in English and Kannada; the electoral roll deadline alert | <!-- INPUT NEEDED --> |
| **The second-city pilot** | The model proven outside Bengaluru, and a published replication playbook | <!-- INPUT NEEDED --> |

<!-- INPUT NEEDED: split the two-year budget across these four components so
each has a price. They must sum to the total. -->

We are looking for one lead funder and two or three co-funders. A lead
commitment is what makes the rest of the conversation possible, and we will say
so plainly to whoever moves first.

**What we need beyond money.** Introductions to resident welfare federations,
colleges and large employers in Bengaluru — distribution is our binding
constraint, not engineering. Introductions to civic organisations in cities with
ULB elections due, for the second-city selection. And a lawyer, if you have one
who knows the Digital Personal Data Protection Act.

---

## 21 · Contact

<!-- INPUT NEEDED: named spokesperson, role, email, phone. -->

Oorvani Foundation · [opencity.in](https://opencity.in)

---

## Appendix A · Audience variants

The narrative above is the master. Three sections change by audience; everything
between §3 and §19 stays identical.

| Section | Indian foundations | Corporate CSR | International funders | HNIs |
|---|---|---|---|---|
| **§2 The moment** | As written | As written | Add one line on what a corporator is and what a ULB election is | Lead with the city, not the institution |
| **§11 Why Oorvani** | Track record and theory of change | Schedule VII eligibility, compliance, audited accounts, employee-engagement options | FCRA status stated up front; independence from government and party | The people, and why they are doing this |
| **§20 The ask** | Lead-funder framing, full programme | A single named component sized to a CSR budget | Full programme or the second-city pilot | A single named component |

## Appendix B · Facts still needed

This document does not go to a donor until every one is resolved. Every claim in
it has to survive a diligence call, and for a platform whose product is
neutrality, an invented number is the one mistake we cannot make.

- [ ] Years since the last BBMP ward election, and current registered-voter figure, each with a citable source
- [ ] Build status as of the ship date: pages live, public demo URL, wards with real candidate data
- [ ] Open City track record: years operating, usage, datasets, cities, citations
- [ ] Whether Citizen Matters is Oorvani-operated (open question, PRD §17)
- [ ] Named team members, roles and bios
- [ ] Oorvani's actual pay bands and overhead rate
- [ ] Year-two and second-city targets
- [ ] The four component prices in §20, summing to the total
- [ ] Current funders, for the public funding disclosure
- [ ] Named spokesperson and contact details
- [ ] Optional: a defensible two-or-three-city shortlist for §10
