# KSEC Candidate Affidavit Data — Availability & Risk Note

**Prepared:** 15 August 2026
**Context:** Sourcing candidate affidavit data for the GBA (Greater Bengaluru Authority) 2026 corporation elections
**Bottom line:** The Karnataka State Election Commission does **not** publish filled candidate affidavits online — for any election, past or upcoming. There is no KSEC equivalent of `affidavit.eci.gov.in` or MyNeta. Any product that depends on machine-readable affidavit data for GBA must plan to acquire it manually.

---

## 1. What KSEC actually publishes

| Item | Status | Link |
|---|---|---|
| Filled candidate affidavits (nomination) | **Not published** — no repository, no per-candidate PDFs | — |
| Prescribed affidavit *format* (blank) | Published as e-Gazette, 22 Apr 2026 | [E-gazette copy](https://karsec.karnataka.gov.in/Document/Files/E%20gazzatte%20copy) |
| Candidate lists / nomination data | Not published as structured data | — |
| Results & elected members | Published per body type | [Results](https://karsec.karnataka.gov.in/Results) |
| Assets & liabilities of *elected* RLB members (annual Form-1) | Filed online, but gated behind member mobile-number login | [sec_al_elected_2020](https://karsec.karnataka.gov.in/sec_al_elected_2020/) |

**Site note:** `karsec.gov.in` is dead/redirecting. Live site is **`karsec.karnataka.gov.in`**. Any old bookmarks or scrapers pointing at the former will fail.

---

## 2. The affidavit format (what the data will look like)

Source: e-Gazette Part III, Bengaluru, Wednesday 22 April 2026, No. 324 — Order **SECK/ULB/OTHR/1/2026-ULB** dated 22/04/2026, amending earlier SEC orders RACHUAA 11 EYUB 2002 (14.07.2003) and RACHUAA 29 EYUB 2018 (01.06.2018). Nine pages, Kannada.

Applies to candidates for: GBA city corporations (5), municipal corporations, city municipal councils, town municipal councils, town panchayats, ZP, TP, GP.

### Field structure

**Part A**

1. Body type, district, taluk, ward/constituency number, voter roll part & serial no.; candidate name; father/husband name; **age**; residence
2. Voter roll enrolment details (part no., serial no.)
3. Phone, email, social media accounts (up to 3)
4. PAN + income tax filing status (candidate, spouse, dependents)
5. Pending criminal cases
6. Cases of conviction
7. Assets — movable and immovable, self / spouse / dependents
8. **NEW (2026 amendment):** declaration of disqualification under any statutory or local authority order — (a) Act & case under which disqualified, (b) authority that issued it, (c) case number, (d) date of disqualification order
9. Liabilities
10. Educational qualification

**Part B** — verification, including a **new clause (B)** declaring the candidate is not disqualified and has not served any disqualification order.

### Procedural notes in the gazette

- **GBA city corporation / municipal / ZP / TP candidates:** affidavit must be executed on paid stamp paper and **notarised** at a documents office
- **Grama Panchayat candidates:** plain paper, signed before the Election Officer — no fee, no notary
- Candidate must read/have read the full contents and certify only applicable entries

**Practical implication:** the format is Kannada-language and notarised-scan-based, i.e. the same OCR problem as the Tamil Nadu affidavits — expect scanned images, not text-layer PDFs. Budget for OCR + manual verification, not parsing.

---

## 3. Recent KSEC elections (no affidavits published for any)

| Election | Date |
|---|---|
| ULB general + by-elections (58 ULBs) & Sitaramatanda GP | December 2025 |
| ULB general + by-elections | August 2025 |
| Grama Panchayat by-elections | May 2025 |
| Grama Panchayat general election | December 2024 |
| RLB by-elections | Nov–Dec 2024 |

---

## 4. GBA 2026 status (as of 15 Aug 2026)

- Ward-wise **draft voter list** published 09.03.2026
- **Affidavit format gazetted** 22.04.2026 — a strong signal that notification is being prepared
- **Nomination and poll dates: not yet notified** in any verifiable source. Wikipedia says "by August 2026" with nomination dates TBD; one aggregator claims 14–24 June, unconfirmed. Do not plan against either.

**Risk:** the affidavit acquisition window is the nomination-to-scrutiny period — typically 7–10 days. If collection isn't staffed and rehearsed before notification, the window closes and the data is gone until an RTI cycle completes.

---

## 5. Acquisition options

### Option A — RTI to KSEC *(recommended, start now)*

Request scanned nomination affidavits per corporation, and separately request proactive publication under s.4(1)(b) RTI Act.

- **Pros:** authoritative, complete, creates a precedent for future cycles
- **Cons:** 30-day statutory clock; likely reply is "inspect at RO office"; may arrive after the election
- **Cost/effort:** low effort, low cost, slow

### Option B — Returning Officer offices during nomination window *(recommended, run in parallel)*

Affidavits are displayed on RO notice boards; copies are provided on request.

- **Pros:** timely, ward-level granularity, matches product need exactly
- **Cons:** manual; needs volunteers across 5 corporations simultaneously; short window
- **Cost/effort:** high effort, needs advance coordination

### Option C — District / NIC sites

Some Karnataka DC sites (e.g. Yadgir) publish ULB election material post-notification.

- **Pros:** occasionally full PDFs, zero cost
- **Cons:** patchy, inconsistent format, no guarantee for Bengaluru
- **Cost/effort:** low effort, low yield

### Option D — MyNeta / ECI data for pipeline testing

Karnataka Assembly 2023 and Lok Sabha 2024 affidavits are structured and available today.

- **Pros:** immediate, clean, good for building and testing extraction now
- **Cons:** wrong election type — ECI Form 26 in English, not KSEC Kannada local-body format
- **Cost/effort:** minimal

**Recommendation:** A + B in parallel, with D used immediately to build and test the extraction pipeline. File the RTI before notification, not after.

---

## 6. Open questions

1. Will KSEC publish GBA affidavits at all this cycle? Worth asking directly — the 22 Apr gazette shows they are actively updating affidavit policy.
2. Does the RO provide affidavit copies free or at per-page cost, and to any citizen or only to candidates/agents?
3. Will affidavits be in Kannada only, or bilingual? Affects OCR tooling choice.
4. Are the 5 GBA corporations' ROs coordinated under one office, or 5 separate collection points?

---

## Sources

- [KSEC official site](https://karsec.karnataka.gov.in/)
- [Affidavit format e-Gazette, 22 Apr 2026](https://karsec.karnataka.gov.in/Document/Files/E%20gazzatte%20copy)
- [KSEC assets & liabilities portal (elected RLB members)](https://karsec.karnataka.gov.in/sec_al_elected_2020/)
- [KSEC results](https://karsec.karnataka.gov.in/Results)
- [2026 Greater Bengaluru Authority elections — Wikipedia](https://en.wikipedia.org/wiki/2026_Greater_Bengaluru_Authority_elections)
- [MyNeta — Karnataka](https://www.myneta.info/state_assembly.php?state=Karnataka)
- [Yadgir DC — urban local body elections](https://yadgir.nic.in/en/urban-local-body-elections/)