# Candidate affidavit data: process, people, timeline and budget

**For:** Oorvani Foundation Board

**Date:** 20 September 2026

**Status:** Planning proposal for review; staffing, AI timings and budget allowances require validation before commitment.

## 1. The proposal

The Bengaluru Votes platform will turn candidate affidavits into readable, sourced report cards in English and Kannada. Citizens will be able to compare candidates and open the original affidavit behind the information shown.

**This proposal assumes we can obtain all candidate documents and the nomination list in bulk.** It sets aside the acquisition problem to explain the operation once the data arrives. It does not establish that bulk access has been secured; the separate [acquisition risk assessment](ksec-data-risk.md) still records that dependency.

For approximately **4,000 candidates across 369 wards**, the recommended working provision is:

| Item | Proposed provision |
|---|---|
| AI extraction | Reserve one elapsed day, with one additional day of contingency; benchmark before confirming |
| Transcribers | **38 people**, each working eight hours a day for three days, targeting one human reading of every affidavit |
| Curators | **Six people**, each working eight hours a day for the same three days, with continuing correction coverage arranged afterwards |
| Operational window | Approximately **four days from receipt of usable files**, or five with the AI contingency; software and staff must already be ready |
| Candidate-data budget | Approximately **₹1.48–₹1.91 lakh before contingency and taxes**; provisionally **₹2.30 lakh including a 20% contingency, before taxes**, subject to the exclusions in §7 |

The estimates below distinguish existing project decisions from new planning assumptions. They describe the intended operation, not a claim that all the tooling is already implemented. This document does not change the application or approve a vendor switch.

## 2. When the data arrives

The election plan uses **N** to mean the day the election is announced. The following offsets are assumptions from [the election timeline, §§3–4](election-timelines.md), not confirmed election dates. That document remains the authority if the schedule changes.

| Planning point | Expected significance |
|---|---|
| Around **N+12** | Nominations close; plan for the complete filed-candidate affidavit set |
| Around **N+15** | Withdrawals close; the final list of contesting candidates is known |
| Around **N+21** | The project's candidate-related outbound communications stop for the silence period; the website remains available |
| Around **N+23** | Polling day |

There are roughly eight days between the final list and polling. Bulk availability does not itself guarantee usable scans or correct candidate-to-document matching; those checks are part of ingestion.

**Proposed sequencing:** begin processing the provisional filed-candidate set as soon as it arrives, then reconcile rejected and withdrawn candidates against the final list. This buys time but may involve reading some affidavits for candidates who do not ultimately contest. It is an earlier start than the milestone plan's assumption of waiting for the final list and is a proposal for Board consideration.

## 3. What happens to each affidavit

**Bulk receipt → AI extraction and publication → transcriber check → continuing curator corrections.**

### Step 1 — Import and associate the documents

The operations team imports the candidate list and scanned affidavits, checks coverage and duplicates, and associates each document with the correct candidate and ward. The stored affidavit is publicly accessible from the report card; the planned storage is Google Cloud Storage.

Name, ward, party and gender are expected to come from the nomination list. That split must be checked against the actual files. If these details also need reading from scans, the workload rises.

### Step 2 — AI reads and publishes the affidavit fields

AI extracts four groups of information:

- Age.
- Educational qualifications.
- Total value of assets.
- Criminal cases: pending cases and convictions.

An explicit “not declared” in the source must remain distinguishable from a failed or unreadable extraction. The full affidavit remains available for information beyond these four fields.

**Extracted values publish immediately, labelled “AI-extracted”, with a link to the affidavit.** Publication does not wait for human review. Missing values and low-confidence readings move to the front of the human checking queue. AI confidence is a prioritisation signal, not proof that a value is correct.

The current architecture specifies Anthropic for extraction. For the Codex scenario discussed here, **Codex would build and orchestrate an automated OpenAI API extraction process**. Its processing time and API usage are separate from the time and cost of developing that process; a Codex subscription should not be assumed to cover the API bill.

### Step 3 — Transcribers check the AI reading

Paid, Kannada-reading transcribers compare the original scan with the AI's pre-filled fields, confirming or correcting each reading. They receive one affidavit at a time from a city-wide queue and cannot choose a ward, party or candidate.

The queue serves missing values first, then low-confidence readings, then the remaining affidavits. Abandoned assignments return to the queue so documents are not stranded.

**One transcriber reads each assigned affidavit. Their save publishes immediately and marks the checked fields “checked by a person”.** There is no compulsory second reading, consensus process or curator approval. Any fields not checked remain visibly AI-extracted.

### Step 4 — Curators correct and oversee

The planned curator operation works across the city. Curators examine difficult cases, investigate citizen flags against the affidavit, correct any published field when needed, and reject unsupported flags with a reason. They monitor transcriber performance, including readings subsequently corrected, and track candidate completeness.

Curators provide correction and oversight; they do not routinely perform a second reading of every affidavit. Their edits publish immediately. Completeness is a coverage indicator, not a publication gate.

This model accepts a quality trade-off: a transcriber may accept a confident but wrong pre-filled AI value. Citizen flags, curator intervention and visible checking labels provide ongoing safeguards, but a human-check label is not a guarantee of accuracy. The current plan has no change-history or restore facility; errors are corrected in the current record.

## 4. How long AI extraction could take

**There is no measured Codex/OpenAI processing rate for these affidavits yet.** The following is a capacity model, not a vendor guarantee or benchmark result.

Assume approximately 4,000 affidavits, around ten scanned pages each, with **two to five minutes of processing per affidavit**, and add **25% for processing overhead and retries**. Page count, handwriting, scan quality, model choice and additional reading attempts may change this substantially.

| Simultaneous extraction jobs | Estimated elapsed time for 4,000 affidavits, including the 25% allowance |
|---|---:|
| One | 167–417 hours |
| Ten | 17–42 hours |
| Twenty | 8–21 hours |

Calculation: **4,000 × minutes per affidavit ÷ simultaneous jobs ÷ 60 × 1.25**. This assumes jobs can keep running continuously, including overnight; human staff work the agreed eight-hour shifts.

Provisionally reserve **24 elapsed hours**, plus another day of contingency, using twenty simultaneous jobs if account limits permit. This covers the extraction run and ordinary retries, not software development, a major outage or extensive repair of unusable source files. The table assumes no material throughput loss from account limits: OpenAI limits requests and tokens, and PDF processing includes page images as well as text. See [official PDF-input guidance](https://developers.openai.com/api/docs/guides/file-inputs) and [rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits).

Before committing the schedule, run **50–100 representative Kannada affidavits** through the proposed model, including handwriting and poor scans. Measure completion time, tokens and actual cost, retry frequency, candidate-level completeness, and errors found by human readers. Repeat the throughput check at the intended concurrency. Cleaner English affidavits can test the machinery but cannot establish Kannada reading accuracy.

The one-day estimate assumes ordinary concurrent requests. A discounted asynchronous batch service has different scheduling behaviour; its price and turnaround must be evaluated together rather than combining the cheapest batch price with the fastest interactive timing.

## 5. How many people are needed

Everyone is scheduled for **eight hours a day for three days: 24 paid working hours**. For staffing, allow **20 productive casework hours per person**, reserving four hours across the engagement for briefing, breaks, handover and coordination. This follows the existing planning method.

### Transcribers

At **ten minutes per affidavit**, one person can read 120 affidavits in 20 productive hours. Reading all 4,000 requires approximately **667 person-hours**.

| Option | Transcribers | Capacity over three days | Transcriber fees at ₹2,000 each |
|---|---:|---:|---:|
| Priority cases only | 5 | 600 affidavits | ₹10,000 |
| Minimum for all 4,000 at the assumed pace | 34 | 4,080 affidavits | ₹68,000 |
| **Recommended provision** | **38** | **4,560 affidavits** | **₹76,000** |
| Slower reading: 15 minutes each | 50 | 4,000 affidavits | ₹1,00,000 |

The five-person option relies on AI returning all four fields correctly and confidently for 85% of candidates. **That 85% is an unmeasured assumption.** It would leave approximately 3,400 affidavits without a human reading. If 85% instead describes accuracy per field, four fields compound to only about 52% clean candidates under an independence assumption; approximately 1,912 candidates would need attention, requiring 16 transcribers at ten minutes each.

The full-coverage proposal avoids depending on that 85% assumption for staffing. Thirty-eight people provide about 14% capacity above the 4,000-document workload, but do not absorb a rise to 15 minutes per document. At the theoretical maximum of 24 uninterrupted productive hours, 28 people suffice; that leaves no allowance for ordinary non-reading time.

**Rounding correction:** earlier documents refer to 33 people for full coverage. At 120 documents per person, 33 cover 3,960; the minimum must be rounded up to 34.

### Curators

For sizing, assume **ten minutes of curator attention per escalated candidate case**. Treat this as total handling time per case, including any associated flags, rather than counting flags and escalations twice. Both the frequency and duration are new assumptions to test.

| Share of candidates needing curator attention | Cases | Casework hours | Minimum curators at 20 productive hours each |
|---|---:|---:|---:|
| 5% | 200 | 33 | 2 |
| 10% | 400 | 67 | 4 |
| 15% | 600 | 100 | 5 |

**Four curators are a reasonable baseline; provision six.** Six provide 120 casework hours, leaving 20 hours beyond the 15% scenario for oversight and harder cases. The original plan has four curators; increasing to six is a proposal. If cases take longer or public flags exceed these assumptions, staffing or duration must increase.

The three-day shift is the intensive initial operation. Corrections and citizen flags will continue afterwards. A named curator rota through polling and results must be agreed; the cycle fee below does not specify unlimited hours.

## 6. The working schedule

Let **D** be the day a usable bulk set becomes available. Preparation must be completed before D: the extraction and review tools, candidate matching, staff accounts and email OTP delivery, model benchmark, recruitment, briefing materials and shift commitments.

| Period | AI and operations | Transcribers | Curators |
|---|---|---|---|
| D: approximately first 24 hours | Import, match and extract; publish AI-labelled fields progressively | Scheduled reading shifts begin once there is enough ready work | Resolve ingestion exceptions; confirm the review queue is usable |
| D+1 to D+3: three eight-hour shifts | Finish retries and reconcile candidate status as official lists change | Read the queue in priority order; target every affidavit | Resolve escalations and flags alongside reading; check coverage and quality |
| After the three shifts | Keep source links and candidate status current | Additional work only if required and resourced | Continue the agreed correction rota |

The conservative staffing calculation assumes the three full reading shifts start **after** the extraction day. Starting some readers earlier can help, but waiting for AI should not consume their budgeted 20 productive hours. Preliminary curator ingestion work must fit within the reserved non-casework allowance or be handled by the operations lead; it is not an assumed fourth eight-hour curator shift.

Under the planning calendar, usable files at N+12 imply a target finish around **N+16**, or N+17 with one extra AI day. Receipt only at the final list around N+15 implies N+19, or N+20 with contingency. These are operational illustrations derived from [the election timeline](election-timelines.md), not launch commitments. Late receipt, a delayed benchmark or unfinished tooling consumes this margin directly. Completing the data operation does not itself complete the wider launch campaign.

## 7. What it could cost

The following is a **candidate-data operation budget**, not the whole platform or election campaign budget. Staff rates come from [the stakeholder overview, §§8–9](overview.md). They are project planning rates, not confirmation that people have been contracted at those rates.

### Recommended provision: 38 transcribers and six curators

| Item | Basis | Planning amount |
|---|---|---:|
| Transcribers | 38 × ₹2,000 for the three-day engagement | **₹76,000** |
| Curators | 6 × ₹5,000 for the election cycle, including the intensive three days; subsequent availability to be agreed | **₹30,000** |
| AI extraction | Provisional reserve for the proposed OpenAI/API run; includes routine retries, pending benchmark and model pricing | **₹35,000–₹70,000** |
| Affidavit storage and public downloads | Existing cycle allowance; depends on file sizes and readership | **₹2,000–₹10,000** |
| Kannada translation | Allow up to the existing platform-wide translation estimate; candidate-data share may be smaller | **₹5,000** |
| **Subtotal** | Before contingency and taxes | **₹1,48,000–₹1,91,000** |
| Contingency | 20% of subtotal | **₹29,600–₹38,200** |
| **Planning total** | Before applicable taxes | **₹1,77,600–₹2,29,200** |

**Proposed provision: ₹2.30 lakh before taxes for the scope above.** This is a conditional budget envelope for Board consideration, not an approved expenditure or a guaranteed cap.

**Basis of the AI allowance:** the existing overview models ₹17,000–₹35,000 for 4,000 ten-page affidavits, around 30,000 input and 500 output tokens each, using discounted batch processing in the previously specified provider setup. That is not an OpenAI quote. The ₹35,000–₹70,000 above is a new provisional reserve, approximately twice the older range, to avoid budgeting a fast concurrent run at an assumed batch discount. Doubling an old allowance does not establish the new provider's actual price; the representative pilot must replace it, including retries and tax treatment, before spend is authorised. The older page/token and storage/download allowances also require validation against the received files.

For comparison, using the same non-staff allowances:

| Staffing option | Staff fees | Subtotal before contingency and taxes | With 20% contingency, before taxes |
|---|---:|---:|---:|
| 5 transcribers + 4 curators; priority cases only | ₹30,000 | ₹72,000–₹1,15,000 | ₹86,400–₹1,38,000 |
| 34 transcribers + 4 curators; minimum full-coverage plan | ₹88,000 | ₹1,30,000–₹1,73,000 | ₹1,56,000–₹2,07,600 |
| **38 transcribers + 6 curators; recommended provision** | **₹1,06,000** | **₹1,48,000–₹1,91,000** | **₹1,77,600–₹2,29,200** |

If reading takes 15 minutes, 50 transcribers add ₹24,000 to the recommended team's fees. With six curators and the same other allowances, the total becomes approximately **₹2.06–₹2.58 lakh including 20% contingency, before taxes**. This is why the pilot must measure human reading time as well as AI speed.

**Excluded or shared costs:** bulk-data acquisition charges, software development, the operations lead's time, recruitment/training beyond the stated engagement, workspace/equipment/travel, shared email/OTP services, wider hosting and backup, legal review, and citizen outreach or marketing. No extra curator fee for post-window work is priced here; agree the cycle engagement or budget any additional fee. Applicable taxes and foreign-exchange movements need finance review. Existing platform budgets may already cover shared services and curator fees; allocate them once rather than adding this entire envelope on top of overlapping lines. Storage and translation figures are inherited planning allowances, not refreshed vendor quotations.

## 8. What Oorvani needs to settle before the window opens

1. **Choose the coverage target:** one human reading of all affidavits, with the recommended 38 transcribers and six curators, or a smaller team that knowingly leaves most fields AI-labelled.
2. **Name an operations lead and budget owner.** Recruit Kannada-reading staff, vet curators, confirm fees, equipment and availability, and agree the post-window correction rota.
3. **Run the representative pilot.** Confirm the model/provider, extraction accuracy, API limits, elapsed time, human reading pace and actual cost; resize the team and budget if needed.
4. **Rehearse the complete operation before bulk arrival.** Prove import, matching, source links, publication labels, staff login, assignments and correction handling. Staff email access is a dependency even if citizen messaging is not ready.
5. **Confirm the calendar and early-start approach.** Reserve staff against the official schedule and decide whether processing may begin on the provisional candidate list. Review the daily count of imported, extracted, human-checked and unresolved records against the remaining capacity.

The proposal is designed to make the first complete human pass achievable within three working days, while giving citizens immediate access to clearly labelled AI readings and the original sources. It remains conditional on a ready pipeline, usable bulk files and a pilot that supports the assumed pace.

## References and status of assumptions

- [Stakeholder overview](overview.md), §§3.1, 8, 9 and 11: report-card fields, publication policy, pay rates and original volume/workload assumptions.
- [Milestone plan](milestones.md), §§9–11 and 13: curator, transcriber, ingestion and real-data workflows. This proposal's earlier provisional-list start, staffing and budget are additions for consideration.
- [Architecture](architecture.md), §§6–7: storage, assignments and immediate publication. OpenAI extraction is a proposed alternative to the documented Anthropic provider.
- [Election timeline](election-timelines.md), §§3–4: authoritative planning offsets; no date in this proposal is a confirmed election date.
- [Acquisition risk assessment](ksec-data-risk.md): the unresolved dependency assumed solved for this scenario.
- [OpenAI PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs) and [rate limits](https://developers.openai.com/api/docs/guides/rate-limits): technical constraints, consulted 20 September 2026. Neither supplies the affidavit-specific time, accuracy or cost estimates above.

The 2–5 minute AI time, 25% processing allowance, 5–15% curator case rate, ten-minute curator handling time, 38/6 staffing recommendation, ₹35,000–₹70,000 AI reserve and 20% budget contingency are new planning assumptions. They must not be presented as measured performance, vendor quotes or already approved decisions.
