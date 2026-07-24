# The case for support — a two-year ask

**Date:** 2026-07-24
**Operator:** Oorvani Foundation — charitable trust, 12A and 80G current
**Audience:** Indian philanthropic foundations, corporate CSR, and individual donors *(CSR-1 registered; no FCRA, so international funders are out of scope)*
**Ask:** ₹2.2–2.4 crore over two years
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

**Bengaluru last elected its ward corporators in August 2015.** The council's
term expired on **10 September 2020**, and the city has had no elected municipal
representatives since — the longest such gap in its history. Nearly eleven years
without a fresh municipal mandate, in a city of more than 1.4 crore people.

In that time the BBMP itself was dissolved. The **Greater Bengaluru Authority**
replaced it on 2 September 2025, and final delimitation was notified on 19
November 2025: **369 wards across five corporations** — Bengaluru West (112),
North (72), South (72), Central (63) and East (50).

**88,95,361 citizens are registered to vote** across those 369 wards, at 8,023
polling stations — per the GBA's final electoral roll published on 18 April
2026. Almost nine million people, most of whom have never voted in a ward
election.

**The Supreme Court has now set a hard deadline of 31 December 2026.** The
extension granted in July 2026 was the third; deadlines of 30 June and 31 August
2026 were both missed, and the Chief Justice warned that no further extension
will be granted. Bengaluru is going to vote, and it is going to vote soon.

<!-- Date-stamp the voter figure wherever it appears. An ECI Special Intensive
Revision of Karnataka's rolls is running now, with the final roll due 7 October
2026 — the revision the Court extended the poll deadline to accommodate. The
88.95 lakh figure will likely be superseded before the election. A dated,
sourced number survives that; an undated one becomes wrong.

Do NOT use "over 1 crore voters" — that is Bengaluru Urban district (1,02,64,714
in 2025), a materially larger geography than the GBA's 712 km². And do not state
voters as a percentage of population; the population estimates use a different
boundary and the ratio would be an artefact. -->

Eleven years does something specific to the electorate. Nearly everyone in
Bengaluru under thirty has never voted for a corporator. Neither has anyone who
moved to the city in the last eleven years — which, in Bengaluru, is an enormous
number of people. This is not an election with a first-time-voter segment. It is
an election where first-time ward voters may be the majority.

<!-- INPUT NEEDED: confirm the current registered-voter figure with a citable
source — donors check it. Also decide whether to state that the council's term
expired in 2020 and the city has been run by administrators since; it is a
strong fact if we can cite it. -->

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

Anchored to **E**, the Bengaluru poll — which the Supreme Court has ordered to
happen by 31 December 2026.

| Period | Bengaluru | Second city |
|---|---|---|
| **Now → E** (months) | Election platform at full load: ward finder, candidate report cards, issue voting, booth logistics, poll day | — |
| **E → E+6** | Results. Candidate report cards become corporator report cards. Ward budget and works layer ships | Election calendar assessed; city named by month 12 |
| **E+6 → E+12** | Accountability layer in daily operation; first annual ward scorecards | Newsroom briefed, curators recruited, ward data acquired |
| **E+12 → E+18** | Second annual cycle | Platform live in city two, through its own election |
| **E+18 → E+24** | Replication playbook published | Handover to steady-state operation |

**The election phase is already under way, and it is short.** That is the
timing problem this proposal has to be honest about, and §20 addresses it
directly: a small part of this money is needed within weeks, and the large part
funds everything after the poll.

---

## 9 · What travels, and what does not

The multi-city claim is only worth making if the second city is genuinely
cheaper than the first. It is, and this is why.

**Travels — built once, reused:**
the platform itself, the ward and candidate data model, the affidavit extraction
pipeline, the curator handbook and training, the flag-and-correct workflow, the
audit and rollback machinery, the neutrality standard, the comms templates, the
partner kit format — and, in four other cities, a Citizen Matters newsroom that
already has readers and civic relationships there.

**Does not travel — bought fresh in every city:**
ward boundary and delimitation data, local curators, local partner
organisations, translation into the local language, relationships with the local
election office and municipal body.

Software is the expensive half and it is already paid for. What a new city costs
is people and data.

---

## 10 · The second city

**We are not starting from scratch in the second city, because Citizen Matters
is already there.**

Oorvani's civic newsroom operates in **Bengaluru, Chennai, Mumbai, Delhi/NCR and
Hyderabad**. In each of those cities it already has reporters, an audience, and
working relationships with resident associations and civic groups. The hardest
input for a new city — a local organisation that citizens already trust to write
about their municipality — is one we own rather than one we have to go and find.

So the constraint is not partnership. It is the municipal election calendar,
which we do not control. Here is what it currently looks like across our four
other cities:

| City | Wards | Position as of July 2026 |
|---|---|---|
| **Chennai** (GCC) | 200 | Council term runs to March 2027; statewide Tamil Nadu local body polls expected February–March 2027. No date announced. |
| **Delhi** (MCD) | 250 | Elected December 2022; next general election due 2027. No date announced. |
| **Hyderabad** (GHMC) | 150 + 76 + 74 | Term expired February 2026; GHMC since split into three corporations. Government indicates November–December 2026, but delimitation is under High Court challenge. |
| **Mumbai** (BMC) | 227 | Polled January 2026. Out of scope until 2031. |

**Chennai is the strongest candidate** — its poll falls inside the grant window,
its newsroom is Oorvani's second-strongest, and Tamil Nadu conducts its local
body elections statewide, which means one engagement reaches far beyond one
city. Delhi is the fallback if Chennai's timing moves. Hyderabad's poll may
arrive before we have finished Bengaluru, and its ward boundaries are in
litigation. Mumbai has just voted and is out.

We are still not naming the city in this document. Every one of these dates is
an expectation rather than a notified schedule, and Bengaluru's own experience —
three missed Supreme Court deadlines — is the argument against committing to a
municipal election date in writing. **The second city is confirmed and named by
month 12.**

<!-- INPUT NEEDED: confirm whether Citizen Matters' city operations have the
capacity to take on an election programme, or whether the ₹39L second-city
budget needs to fund newsroom time explicitly. -->

---

## 11 · Why Oorvani

**We have been doing this since 2008.** Citizen Matters began that year, founded
by Subramaniam Vincent and Meera K; the Oorvani Foundation was constituted as a
trust in 2013; Open City launched in 2016. Eighteen years of civic journalism
and a decade of urban data sit behind this proposal.

The foundation exists to *empower citizens to make better cities*. It runs four
programmes, and this platform sits at the intersection of the first two:

- **[Citizen Matters](https://citizenmatters.in)** — a civic newsroom operating
  in Bengaluru, Chennai, Mumbai, Delhi/NCR and Hyderabad, covering governance,
  mobility, environment, water, waste and health at the level where citizens
  actually experience them.
- **[Open City](https://opencity.in)** — India's leading urban data commons,
  launched 2016. Over 400 datasets and 3,500 resources across eleven themes,
  including a masterplan viewer covering 27 cities, published under open
  licences (CC BY-NC-SA 4.0 and ODbL). Citizens use it to file RTIs and to check
  the claims officials make to them. **It already publishes the GBA's 2026
  electoral roll data** — this election is not a new subject for us.
- **Civic Learning Hub** — courses and workshops for citizens who want to act on
  what they have read.
- **India Civic Summit** — an annual convening; the 2026 theme is *Citizens and
  Urban Governance*.

**In FY 2024-25 alone:** 505 articles published across **9 Indian cities**, 134
of them written by citizens; **3.4 million page views** across articles and
datasets; 15 events with 1,281 participants; 5 datajams with 212 participants;
32,000 social followers reaching an average of 41,738 unique accounts. The
second India Civic Summit drew over 150 participants across 8 sessions led by 14
experts.

**We have already done this at parliamentary scale.** In 2024 Oorvani ran
election projects across **21 constituencies in Chennai, Bengaluru, Mumbai and
Delhi** — candidate profiles, constituency maps, past election results, polling
booth lookup and the key issues in each seat — plus 15 sitting-MP profiles, 18
voter resource guides, 13 ground reports and 9 candidate interviews, followed by
Maharashtra assembly coverage in partnership with **Mumbai Votes** and **Praja
Foundation**.

That matters more than any other fact in this document. **The GBA platform is
not our first election project. It is the ward-level version of something we
have already built four times, in four cities.** What is new here is depth —
369 wards instead of 21 constituencies, structured affidavit data instead of
profiles, and a platform that keeps working after the result is declared.

**And the reporting changes things.** Four months after our series on domestic
violence in Chennai's resettlement areas, the government established a One Stop
Centre at Perumbakkam — the specific demand the series had surfaced. After our
reporting on construction dust, BMRCL published a plan to address air pollution
and waste at Namma Metro sites, and citizens documented debris being cleared.
Our associate editor Shobana Radhakrishnan was shortlisted for the Kamla
Mankekar Award for Journalism on Gender, 2024.

**Recognition.** Meera K received the **Gene Burd Award for Urban Journalism**
in 2025 and an **Ashoka Changemaker Fellowship** in 2016. Citizen Matters was
selected for the **International Press Institute's Local News Accelerator** in
2023, won two **Manthan Awards** from the Digital Empowerment Foundation in
2014, and a **Namma Bengaluru Award** in the media category in 2013. The BBC
profiled the organisation as early as 2009.

**Existing funders.** Oorvani's work is supported by **Rohini Nilekani
Philanthropies** (part-funding the "Revival of cities" reporting), the
**Rainmatter Foundation** (Zerodha — a three-year grant to Citizen Matters'
Urban Environment Practice), **Unboxing BLR** and the **Bengaluru Sustainability
Forum**. Past and recent supporters include the **A.T.E. Chandra Foundation**,
**Wipro Foundation** and **Climate Trends**, alongside a group of individual
donors.

**Civic network.** Collaborators include the **Bangalore Apartments'
Federation**, **ADDA**, **BPAC**, **Janaagraha**, **Praja**, **WRI India**,
**WELL Labs**, **NCBS**, **Socratus**, **CivicDataLab**, **Mongabay India**, the
**Vidhi Centre for Legal Policy** and **Bangalore International Centre**. For an
election platform that has no advertising budget and depends entirely on
partner-led distribution, that network is not a credential. It is the
distribution channel.

Oorvani is a charitable trust registered on **6 August 2013**
(BNG-BMH244/2013-14), with **12A** and **80G** exemptions current, accounts
audited by P N R & Co., and **twelve consecutive annual reports published**
going back to FY 2013-14.

Oorvani is **CSR-1 registered**, so Indian companies can route CSR funds to it,
and **80G** exemption makes individual giving tax-deductible. The foundation
does not hold FCRA, so foreign contributions are out of scope for this raise.

Its board carries people who have built exactly
this kind of thing before: **Meera K**, co-founder and Managing Trustee, an
Ashoka Fellow and former Knight Fellow at the International Center for
Journalists; **Ashwin Mahesh**, urbanist and social technologist, formerly a
NASA climate scientist, co-founder of India Together and Mapunity; **Meenakshi
Ramesh**, IIM-Ahmedabad, formerly Executive Director of United Way Chennai and a
finance lead at CRISIL and Pratham; and **Vikram Rai**, co-founder of the impact
consulting firm Sattva.

<!-- INPUT NEEDED: Oorvani's founding year, 80G status, and any awards or
government/press citations of Open City data. The awards page exists but lists
nothing specific — supply the two or three worth naming. -->

Three things about how we have worked on this project are worth a donor's
attention:

**We built before we asked.** The election platform exists. The specification,
architecture, information architecture and go-to-market plan are written,
reviewed and public in our repository. This request funds operation and
extension, not discovery.

**We run cheap, and we can prove it.** Oorvani delivered 505 articles across
nine cities, 3.4 million page views, 15 events and 5 datajams on a total FY
2024-25 spend of **₹1.07 crore**. The election platform itself is a single
application and a database on one virtual machine; infrastructure costs a few
lakh a year, not tens. Almost every rupee in this budget is people and data.

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

**Resident welfare associations and apartment groups.** We are not starting cold
here either: the **Bangalore Apartments' Federation** and **ADDA**, the
apartment-management platform, are existing Oorvani collaborators, and between
them they reach a very large share of Bengaluru's apartment residents. The unit
of distribution is a message pasted into a building's WhatsApp group. Every
partner gets a kit —
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

**Leading this work**

- **Meera K** — Co-founder and Managing Trustee, Oorvani Foundation. Ashoka
  Fellow; former Knight Fellow at the International Center for Journalists.
  Works on cities, community media, urban governance and civic technology.
- **Satarupa Bhattacharya** — Programme Director. Twenty years in editorial and
  content; oversees programmes and editorial policy at Citizen Matters.

<!-- INPUT NEEDED: name the specific people from Oorvani's existing team who
will work on this platform and what share of their time it takes. The team page
lists a strong editorial bench — Sahana Charan, Bhanu Sridharan, Archita Raghu,
Rahul Vinay and others — and the curator and content roles here draw directly on
that capacity. Say who, concretely. -->

**Behind them, an existing organisation.** Oorvani works with roughly fourteen
people across editorial, programmes, design and operations — engaged on a
consultancy basis, which is how the foundation has always run — with trustees
and advisors listed publicly at [oorvani.org/team](https://oorvani.org/team).
This grant does not stand up a new organisation. It adds capacity to one that
has been running civic media and open data since 2013.

**What this grant hires,** incrementally: two engineers, a half-time product and
programme lead, two curator operations managers, a bilingual content editor, a
partnerships lead, contract design, and honoraria for the ward curator network.

One thing worth naming rather than hiding: Oorvani's existing bench is strongest
in journalism, editorial and urban data, and thinner in software engineering.
That is precisely why engineering is the largest line in this budget. The
counterweight is that Open City is a working civic-tech platform Oorvani already
operates, so this is a team extending a competence it has, not acquiring one it
lacks.

---

## 17 · Use of funds

Costed at Oorvani's actual engagement rates, which are consultancy-based rather
than salaried. The foundation's audited FY 2024-25 expenditure was ₹1.07 crore
across roughly fourteen people; these figures are built on that basis, not on
commercial market salaries.

<!-- INPUT NEEDED: confirm each rate below against what Oorvani actually pays.
Engineering is the least certain line — the foundation has not previously
contracted full-time engineers, and civic-tech developer rates run above the
editorial rates the rest of the budget is built on. -->

**Year one — the election, and the foundations of the accountability layer**

| Line | What it buys | ₹ |
|---|---|---|
| Engineering (2) | Election platform, then the ward accountability layer | 24L |
| Product / programme lead (half-time) | | 6L |
| Curator operations (2) | Recruiting, training and quality across 369 wards | 14L |
| Bilingual content editor | English and Kannada, every page and every message | 6L |
| Partnerships lead | RWAs, colleges, employers, press | 7L |
| Design (contract) | | 4L |
| Curator honoraria | ~150 curators across the active election months | 18L |
| Infrastructure, WhatsApp API, AI extraction | Hosting, 25,000 users × 7 messages, affidavit parsing | 8L |
| Legal | Data protection compliance, terms, privacy | 5L |
| Ward data acquisition | RTI, digitisation, geodata | 6L |
| Field, training, travel, press assets | | 8L |
| **Year one total** | | **~1.06 Cr** |

**Year two — accountability in operation, plus the second city**

About **₹1.2 crore**. Bengaluru continues at roughly ₹81 lakh, with engineering
tapering and ward budget and works data acquisition rising as the accountability
layer becomes the main product. The second city costs about **₹39 lakh**.

**Two-year total: ₹2.2–2.4 crore** (~$255–275k at ₹87 to the dollar), plus
Oorvani's overhead rate.

**What this does to the organisation, stated plainly.** Oorvani spent ₹1.07
crore in FY 2024-25. This grant roughly doubles the foundation's annual budget
for two years. We are not pretending otherwise, and we would rather discuss it
now than in diligence.

Three things make the growth absorbable. The work is a **programme**, not
general expansion — it has a defined scope, a defined end, and a team hired
against named roles. Most of the added cost is **curator honoraria and data
acquisition** rather than permanent institutional headcount, so the organisation
does not have to sustain this size afterwards. And Oorvani has run a five-city
newsroom and a national data platform on ₹1.07 crore, which is the relevant
evidence about whether it can manage ₹1.13 crore a year.

<!-- INPUT NEEDED: FY 2024-25 and FY 2023-24 both closed in small deficit, with
₹2.01 lakh in the bank at 31.03.2025. A careful funder will notice. Decide
whether to address working capital directly — e.g. asking for the first tranche
up front — and whether Oorvani wants that in the deck or held for diligence. -->

**On curator honoraria.** We originally planned an all-volunteer curator
network. We are asking you to fund it instead. Data accuracy across 369 wards is
what every other claim in this document rests on, and goodwill is a weak
guarantee under election-week load. Paying curators also lets us direct effort
where it is hardest to recruit — the outer and under-served zones — which is the
single best defence against this becoming a central-Bengaluru project.

---

## 18 · What a second city costs

**Bengaluru over two years: ₹1.87 crore. The second city: ₹39 lakh.**

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
| **The election date slips again.** Three Supreme Court deadlines have already passed unmet, and the electoral roll revision is still running. | Our entire calendar is anchored to relative dates, not absolute ones — nothing in the plan breaks if the poll moves. The ward finder and the accountability layer are useful whenever it lands, and a delay lengthens the accountability phase rather than cancelling it. The Court has ruled out further extension, but we have not built a plan that requires it to hold. |
| **Ward budget and works data proves hard to obtain.** | Delimitation data is already in hand — all 369 wards with boundaries. Budget and works data is pursued through RTI, with digitisation funded as an explicit line rather than assumed to be free. Where a ward's data cannot be obtained, we publish that fact. |
| **We are accused of partisanship.** | A source on every field, an audit log on every change, no paid advertising, funders named publicly, and a total blackout during the legal silence period. The defence is built into the product rather than issued as a statement. |
| **The election audience does not stay for accountability.** | The consent to contact people about civic tools beyond this election is collected at registration, today, because gathering an election list and reusing it for a different purpose later is both bad practice and unlawful. The corporator report card also gives returning citizens a reason to come back that they already understand. |
| **No second city has an election in the window.** | The binding constraint is a calendar, not a partnership — Citizen Matters already operates in four other candidate cities. If no ULB poll falls inside the window, the funds are ring-fenced and either returned or redeployed by agreement, and the ward accountability layer ships in a Citizen Matters city without an election attached. Bengaluru's outcomes stand on their own. |
| **The grant doubles Oorvani's budget, and the foundation is running lean.** FY 2024-25 closed at ₹1.07 crore with a small deficit and ₹2 lakh in the bank. | The work is a scoped programme with named roles and a defined end, not general institutional expansion, and most of the added cost is honoraria and data acquisition rather than permanent headcount. We would rather structure the first tranche to land before hiring starts than discover a working-capital gap in month two. |
| **Curator coverage skews to central Bengaluru.** | Honoraria weighted toward under-served zones, and a public ward-coverage dashboard that makes the skew visible in week three rather than month six. |
| **Data protection exposure.** | We collect phone numbers, emails and address-to-ward at scale. The privacy policy is lawyer-reviewed for DPDP Act compliance and ships before any citizen data is collected. Citizen contact data is deleted or anonymised within three months of results. |

---

## 20 · The ask

**₹2.3 crore over two years — of which ₹25 lakh is needed within weeks.**

We are going to be direct about the timing, because you will work it out anyway.
Bengaluru votes by 31 December 2026. A philanthropic grant of this size takes
three to six months from first conversation to disbursement. **Most of this
money will therefore arrive at or after the election, not before it.**

That is not a flaw in the plan. It is the plan: the election platform is built
and Oorvani is already operating it, and this proposal has argued from the start
that the election is the acquisition event and accountability is the product.
The grant funds the product.

But there is a part that cannot wait.

### The bridge — ₹25 lakh, needed now

Drawn forward from the total, not added to it. It funds the things that only
work before the poll:

- **Curator honoraria through the election months** — the ward data has to be
  right when the traffic arrives, and it will not be right on goodwill alone
- **The comms programme at election scale** — WhatsApp and email to registered
  citizens, including the electoral roll deadline alert, the one message in this
  funnel whose value expires
- **Final engineering and legal** — the privacy policy that gates WhatsApp
  onboarding, and the last of the candidate-data pipeline

A single donor can write this quickly, and it is the highest-leverage ₹25 lakh
in the proposal, because it is the only part with a deadline set by a court.

### The programme — ₹2.05 crore over two years

The remainder, disbursed on a normal grant timeline. We are not asking every
donor for the whole amount. The programme is built from components, each of
which stands alone, has a price, and produces an outcome you can point to:

| Component | What it delivers | ₹ (2 years) |
|---|---|---|
| **The ward accountability layer** | Budgets, works, officials and corporator report cards across 369 wards | 70L |
| **The curator network** | A paid, trained curator in every ward, holding the data accurate | 55L |
| **Bilingual reach** | Every page and message in English and Kannada; the partner cascade | 41L |
| **The second-city pilot** | The model proven outside Bengaluru, and a published replication playbook | 39L |
| **Total programme** | | **2.05 Cr** |
| *plus the bridge* | *Election-phase work that cannot wait* | *25L* |
| **Total ask** | | **2.30 Cr** |

<!-- INPUT NEEDED: confirm this split reflects how Oorvani wants to package the
work. The four components sum to the total, but the boundaries are a judgement
call — particularly whether engineering sits inside the accountability layer or
is broken out as its own fundable component. -->

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

**Meera K**
Co-founder and Managing Trustee, Oorvani Foundation

<!-- INPUT NEEDED: Meera K's email and phone for the deck's contact slide. -->

Oorvani Foundation · [oorvani.org](https://oorvani.org) ·
[citizenmatters.in](https://citizenmatters.in) ·
[opencity.in](https://opencity.in)

---

## Appendix A · Audience variants

The narrative above is the master. Three sections change by audience; everything
between §3 and §19 stays identical.

**International funders are out of scope.** Oorvani does not hold FCRA, so
foreign contributions cannot lawfully reach the foundation. It is **CSR-1
registered** and **80G** exempt, so Indian corporate CSR and individual giving
both work.

| Section | Indian philanthropic foundations | Corporate CSR | Individual donors / HNIs |
|---|---|---|---|
| **§2 The moment** | As written | As written | Lead with the city, not the institution — this is their ward too |
| **§11 Why Oorvani** | Track record, theory of change, the 2024 election projects, audited discipline | CSR-1 registration, audited accounts, twelve years of published annual reports, defined deliverables and reporting | Lead with Meera K, the Gene Burd Award and the trustees; the people, and why they are doing this |
| **§20 The ask** | Lead-funder framing, full programme | One named component sized to a CSR budget, with the Schedule VII head stated | A single named component, with 80G stated plainly |

<!-- INPUT NEEDED: confirm with Oorvani's CA which Schedule VII head this
programme is booked under. CSR-1 registration makes the *organisation* eligible;
the *activity* must still fall within Schedule VII, and a voter-information and
municipal-accountability platform does not map onto an obvious entry. Voter and
civic education under "promoting education" is the likely route, but a corporate
CSR committee will ask for the head by name and will not take our word for it.
This is the single thing that decides whether the CSR audience is real. -->

## Appendix B · Facts still needed

This document does not go to a donor until every one is resolved. Every claim in
it has to survive a diligence call, and for a platform whose product is
neutrality, an invented number is the one mistake we cannot make.

**Resolved 2026-07-24**

- [x] Last BBMP ward election: **2015** — eleven years
- [x] Citizen Matters is Oorvani-operated, in five cities *(also resolves the open question in PRD §17 and the `INPUT NEEDED` in `content/pages/en/about.md`)*
- [x] Oorvani track record and FY 2024-25 reach figures
- [x] Prior election projects: 21 constituencies across four cities, 2024
- [x] Registration: trust BNG-BMH244/2013-14 (6 Aug 2013), 12A and 80G current, twelve annual reports published
- [x] Audited financials: FY25 income ₹1,05,35,516, expenditure ₹1,06,58,444
- [x] Existing funders: Rohini Nilekani Philanthropies, Rainmatter Foundation, Unboxing BLR, Bengaluru Sustainability Forum
- [x] Documented impact: Perumbakkam One Stop Centre, BMRCL response, Kamla Mankekar shortlisting
- [x] Trustees and board credentials
- [x] Named spokesperson: **Meera K**, Co-founder and Managing Trustee
- [x] Budget rebuilt on Oorvani's consultancy cost base; component prices set
- [x] Founding dates: Citizen Matters 2008, trust 2013, Open City 2016
- [x] Election timing: BBMP term expired 10 Sep 2020; GBA replaced BBMP 2 Sep 2025; 369 wards across five corporations notified 19 Nov 2025; Supreme Court deadline 31 Dec 2026
- [x] Second-city calendar: Chennai Feb–Mar 2027 (best fit), Delhi 2027, Hyderabad Nov–Dec 2026 (contested), Mumbai out until 2031
- [x] Awards: Gene Burd 2025, Ashoka 2016, IPI Local News Accelerator 2023, Manthan 2014, Namma Bengaluru 2013
- [x] Full funder and collaborator list, including BPAC, Janaagraha and Praja

**Still needed**

- [x] Registrations (confirmed 2026-07-24): **CSR-1 held**, **FCRA not held**. International funders out of scope; audience is Indian philanthropic foundations, corporate CSR, and individual donors
- [ ] **Which Schedule VII head this programme is booked under** — decides whether the corporate CSR audience is actually reachable (see Appendix A)
- [ ] Confirm every rate in §17, especially engineering, which Oorvani has not contracted before
- [ ] Decide how to handle working capital: FY24 and FY25 both closed in deficit, ₹2.01 lakh in the bank at 31.03.2025
- [ ] Re-check the voter figure after the SIR final roll on 7 October 2026 — 88,95,361 is likely to be superseded
- [ ] Build status as of the ship date: pages live, public demo URL, wards with real candidate data
- [x] Registered voters: **88,95,361** across 369 wards, 8,023 polling stations (GBA final roll, 18 Apr 2026)
- [x] Arc re-timed against the court deadline; ask split into a ₹25L bridge and a ₹2.05 Cr programme
- [ ] Confirm the ₹25L bridge scope and amount with the team — it is my sizing, not Oorvani's
- [ ] Which named Oorvani staff work on this platform, and at what share of time
- [ ] ULB election timing in Chennai, Mumbai, Delhi/NCR and Hyderabad — to shortlist two or three for §10
- [ ] Whether the ₹39L second-city budget must fund Citizen Matters newsroom time explicitly
- [ ] Year-two and second-city targets
- [ ] Confirm the four-component split in §20 matches how Oorvani wants to package the work
- [ ] Whether existing funders are content to be named in a fundraising deck
- [ ] Meera K's email and phone for the contact slide
