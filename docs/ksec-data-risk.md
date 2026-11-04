# KSEC candidate affidavit data: availability and risk

**The risk:** the Karnataka State Election Commission (KSEC) has historically published **no filled candidate affidavits** online, for any election. There is no KSEC equivalent of `affidavit.eci.gov.in` or MyNeta. This has **not been re-checked for the GBA 2026 cycle**. Unless KSEC publishes this time, every affidavit has to be acquired by hand (§5) before the pipeline in [candidate-data.md](candidate-data.md) has anything to read.

## 1. What KSEC publishes

| Item | Status | Link |
|---|---|---|
| Filled candidate affidavits | Not published in any past election | — |
| Prescribed affidavit format (blank) | e-Gazette, 22 Apr 2026 | [E-gazette copy](https://karsec.karnataka.gov.in/Document/Files/E%20gazzatte%20copy) |
| Candidate lists / nomination data | Not published as structured data | — |
| Results and elected members | Published per body type | [Results](https://karsec.karnataka.gov.in/Results) |
| Assets and liabilities of elected rural local body members (annual Form-1) | Online, behind a member mobile-number login | [sec_al_elected_2020](https://karsec.karnataka.gov.in/sec_al_elected_2020/) |

The live site is `karsec.karnataka.gov.in`; `karsec.gov.in` no longer serves it.

## 2. The affidavit format

Source: e-Gazette Part III, No. 324, 22 April 2026, Order **SECK/ULB/OTHR/1/2026-ULB**, amending SEC orders of 14.07.2003 and 01.06.2018. Nine pages, Kannada. Applies to GBA city corporation candidates among other local bodies.

**Part A**

1. Body type, district, taluk, ward number, voter roll part and serial; name; father's/husband's name; **age**; residence
2. Voter roll enrolment details
3. Phone, email, up to three social media accounts
4. PAN and income tax filing status (candidate, spouse, dependents)
5. Pending criminal cases
6. Convictions
7. Assets, movable and immovable, for self, spouse and dependents
8. Declaration of any disqualification order: Act and case, issuing authority, case number, date
9. Liabilities
10. Educational qualification

**Part B:** verification, including a declaration that the candidate is not disqualified.

GBA candidates execute the affidavit on paid stamp paper and have it **notarised**, so expect scanned images, often handwritten, rather than text PDFs. The extraction model reads the PDF scans directly ([candidate-data.md](candidate-data.md) §3). The report card shows only the fields in candidate-data.md §3.2; the full PDF is linked.

## 3. Recent KSEC elections (no affidavits published)

| Election | Date |
|---|---|
| ULB general and by-elections (58 ULBs) and Sitaramatanda GP | December 2025 |
| ULB general and by-elections | August 2025 |
| Grama Panchayat by-elections | May 2025 |
| Grama Panchayat general election | December 2024 |
| RLB by-elections | Nov–Dec 2024 |

## 4. GBA 2026 timing

- Ward-wise draft voter list published 9 March 2026; affidavit format gazetted 22 April 2026.
- The Supreme Court has set **31 December 2026** as the deadline for the GBA polls and said no further extension will be granted ([South First](https://thesouthfirst.com/karnataka/supreme-court-extends-deadline-to-conduct-greater-bengaluru-authority-polls-to-31-december/)).
- **As of 4 November 2026 no schedule has been announced.** What the deadline implies for the announcement date is in [election-timelines.md](election-timelines.md) §4.

**The acquisition window** is nominations open to scrutiny: about N+5 to N+13 on the assumed timeline (election-timelines.md §3). Collection that is not staffed and rehearsed before the announcement may miss it, and an RTI reply may then arrive after the poll.

## 5. Acquisition options

| Option | What | For | Against |
|---|---|---|---|
| **A. RTI to KSEC** | Request scanned nomination affidavits per corporation, and proactive publication under RTI Act s.4(1)(b) | Authoritative, complete; precedent for future cycles | 30-day statutory clock; likely reply is "inspect at the RO office"; may arrive after the poll |
| **B. Returning Officer offices** during nominations | Affidavits are displayed on RO notice boards; copies on request | Timely, ward-level | Manual; volunteers across five corporations at once; short window |
| **C. District / NIC sites** | Some DC sites (e.g. Yadgir) post ULB election material after notification | Free, sometimes full PDFs | Patchy; no sign of it for Bengaluru |
| **D. MyNeta / ECI affidavits** | Karnataka Assembly 2023 and Lok Sabha 2024 affidavits, structured and public | Already used: the nine fixtures in `tests/fixtures/affidavits/` | ECI Form 26, not the KSEC local-body format; testing only |

The recommendation was A and B in parallel, with the RTI filed before the announcement. Whether it was filed is not recorded (§6).

## 6. Open questions

1. Will KSEC publish GBA affidavits this cycle? Nobody has asked; the 2026 gazette shows it is updating affidavit policy.
2. Was the RTI (option A) filed, and with what result?
3. Who runs collection at RO offices (option B), and is it staffed before the announcement?
4. Does the RO provide copies free or per page, and to any citizen or only to candidates and agents?
5. Are the affidavits Kannada only, or bilingual?
6. Do the five corporations' ROs share one collection point or have five?

## Sources

- [KSEC official site](https://karsec.karnataka.gov.in/)
- [Affidavit format e-Gazette, 22 Apr 2026](https://karsec.karnataka.gov.in/Document/Files/E%20gazzatte%20copy)
- [KSEC assets and liabilities portal](https://karsec.karnataka.gov.in/sec_al_elected_2020/)
- [KSEC results](https://karsec.karnataka.gov.in/Results)
- [Supreme Court extends GBA poll deadline to 31 December, South First](https://thesouthfirst.com/karnataka/supreme-court-extends-deadline-to-conduct-greater-bengaluru-authority-polls-to-31-december/)
- [MyNeta: Karnataka](https://www.myneta.info/state_assembly.php?state=Karnataka)
- [Yadgir DC: urban local body elections](https://yadgir.nic.in/en/urban-local-body-elections/)
