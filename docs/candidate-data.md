# Candidate data processing: four stages, people and budget

**For:** Oorvani Foundation Board and the team hiring transcribers and curators

**Date:** 20 September 2026

**Status:** Operating plan for review. Online availability is an assumption; throughput and costs need a representative pilot.

Bengaluru Votes will turn approximately **4,000 candidate affidavits across 369 wards** into sourced report cards in English and Kannada. Citizens can compare candidates and open the original affidavit. The operation follows four stages, in this order:

1. **Siva loads the documents as soon as initial data is available online.**
2. **AI extracts candidate fields and one confidence percentage per affidavit.** Allow three elapsed days for extraction.
3. **Transcribers check the affidavits:** missing data first, low confidence next, then the rest. Allow five working days for transcription.
4. **Curators respond to user flags only**, dismissing incorrect flags or fixing the data. Coverage continues through election day.

The stages can overlap as documents arrive. **We do not wait for a final notification, the final candidate list or the complete bulk set to start loading and processing.** Siva reconciles later candidate-status changes against the official lists. The plan below describes the intended operation; it does not claim that all tools are implemented or change the application's permissions.

## 1. Bulk loading — Siva

**Starting assumption: all election affidavits are available online.** This is the scenario used for planning, not a claim that access has been secured. The separate [acquisition risk assessment](ksec-data-risk.md) records the unresolved access dependency.

As soon as the first documents are available, Siva:

- Downloads and loads available affidavits and the accompanying candidate-list data.
- Matches each document to the correct candidate and ward, checks duplicates and records coverage.
- Preserves the original affidavit and its source link so citizens can open it from the report card.
- Sends usable records to AI extraction without waiting for the remaining documents.
- Loads later arrivals and reconciles rejected or withdrawn candidates as official lists change.

Name, ward, party and gender are expected from the nomination list. Check that assumption against the actual files. If these fields also need reading from scans, or if poor scans need repair, the workload increases. The planned affidavit storage is Google Cloud Storage.

**Time and cost:** loading time depends on the online source and file quality and has not been measured. Siva's loading time and any acquisition charges are not priced in the budget below. The three-day AI allowance starts with usable, matched records; it must not silently absorb unmeasured loading or scan-repair work.

## 2. AI extraction — three elapsed days

For each loaded affidavit, AI produces the following candidate information plus **one confidence percentage for the affidavit as a whole**:

| Field | Information to extract |
|---|---|
| Age | Age declared in the affidavit |
| Educational qualifications | Qualifications as stated in the source |
| Total value of assets | Declared total value |
| Criminal cases | Pending cases and convictions |

An explicit **“not declared”** must remain distinguishable from a missing or unreadable extraction. Confidence is a signal for ordering the human queue, not a measured probability that the affidavit is correct. The pilot must determine the low-confidence threshold; this plan does not invent one.

**Publication remains immediate:** extracted values publish with an “AI-extracted” label and a link to the source. Human review follows. Missing data takes queue priority regardless of the affidavit's confidence percentage.

### AI time budget

**Allow three elapsed days, or 72 hours, for the planned 4,000-affidavit extraction workload.** Begin on the initial usable records and continue as more arrive. This is a processing allowance, not a promise to finish all candidates within three days of the first file appearing if the rest arrive later.

There is no measured processing rate for these Kannada affidavits yet. Retain the earlier planning assumptions of roughly ten scanned pages per affidavit, **two to five minutes per affidavit**, and **25% overhead for ordinary retries and processing**:

| Simultaneous extraction jobs | Modelled elapsed time for 4,000 affidavits, including 25% overhead |
|---|---:|
| 1 | 167–417 hours |
| 6 | 28–69 hours |
| **10: working provision** | **17–42 hours** |

Calculation: **4,000 × minutes per affidavit ÷ simultaneous jobs ÷ 60 × 1.25**.

Ten simultaneous jobs leave approximately 30 hours inside the 72-hour window at the slower assumed pace. Six just fit the modelled range but leave little margin. These calculations assume jobs can run continuously, including overnight, and that account limits support the throughput. The three-day allowance replaces the earlier one-day run plus a separate contingency day; it is not three days plus another day. Software development, major outages and extensive scan repair remain outside it.

### AI cost budget

**Provision ₹35,000–₹70,000 for extraction API usage, before taxes and the overall budget contingency.** This includes ordinary retries and remains a provisional reserve pending the pilot. Extending the processing window reduces the concurrency needed; it does not by itself reduce the cost of reading the same 4,000 documents.

The reserve came from approximately doubling the older ₹17,000–₹35,000 allowance, which assumed discounted batch processing with the previously specified provider, about 30,000 input and 500 output tokens for each ten-page affidavit. It is **not an OpenAI quote**. A batch option may reduce cost, but its actual price and turnaround must be tested together before lowering the reserve.

The current architecture specifies Anthropic. The proposed alternative is an automated OpenAI API process that Codex builds and orchestrates. API usage is separate from development cost; a Codex subscription should not be assumed to cover the API bill. No vendor switch is approved by this document.

### Pilot before committing the run

Use **50–100 representative Kannada affidavits**, including handwriting and poor scans. Measure errors found by readers, candidate completeness, confidence behaviour, processing time, retry frequency, token use and actual cost. Repeat at the intended concurrency and measure human reading time too. Cleaner English samples can test the machinery but cannot establish Kannada reading accuracy.

## 3. Transcriber queue — five working days

Every loaded and extracted affidavit enters the human queue. Paid, Kannada-reading transcribers receive one affidavit at a time and compare the original scan with the AI-prefilled fields.

**Queue order is mandatory:**

1. Affidavits with missing data.
2. Affidavits with low confidence, using the affidavit-level confidence percentage.
3. All remaining affidavits.

The queue is city-wide. Transcribers cannot choose their ward, party or candidate. Abandoned assignments return to the queue. One transcriber confirms or corrects each assigned affidavit. Their save publishes immediately and marks the checked fields **“checked by a person”**; any fields not checked remain AI-labelled. There is no compulsory second reading or curator approval.

A transcriber must not guess an unreadable value. Unresolved readings remain visibly unresolved. They do not automatically enter the curator queue: that queue contains user flags only. Siva handles loading and source-file problems.

### Staffing and pay

Schedule each transcriber for **eight hours a day for five days: 40 paid hours**. Preserve the earlier productive-time ratio of 20 hours out of 24: this gives **33⅓ productive reading hours per person**, with **6⅔ hours** for briefing, breaks, handover and coordination. This is a staffing assumption to validate in the pilot.

At **ten minutes per affidavit**, one person reads **200 affidavits** over five days. The total workload remains approximately **667 person-hours**.

| Staffing option | Readers | Capacity over five days | Fees at ₹3,500 per person |
|---|---:|---:|---:|
| Minimum full coverage at ten minutes | 20 | 4,000 affidavits | ₹70,000 |
| **Recommended provision** | **23** | **4,600 affidavits** | **₹80,500** |
| Minimum at fifteen minutes per affidavit | 30 | 4,000 affidavits | ₹1,05,000 |

**Provision 23 transcribers**, giving a 15% capacity buffer at the assumed ten-minute pace. The agreed planning fee is **₹3,500 per person for the five-day engagement**. This replaces the previous ₹2,000-for-three-days rate; it is not confirmation that staff have been contracted.

Transcription can start while later AI work continues, once the queue has enough ready work. Schedule the five paid shifts so waiting for files or AI does not consume the budgeted reading hours. Late arrivals may require extending or rescheduling the engagement rather than treating the five days as unlimited availability.

Before recruitment closes, confirm Kannada reading ability, equipment, email access for staff OTP login, shift availability, fees and the queue briefing. Staffing targets full human coverage and does not depend on an unmeasured claim that AI gets 85% of candidates right.

## 4. Curator queue — user flags through election day

**Curators respond to user-flagged candidate-data problems only.** When a user flags candidate information as wrong, the flag enters the curator queue. The curator checks the reported issue against the affidavit and chooses one of two outcomes:

| Finding | Curator action |
|---|---|
| The flag is incorrect or unsupported | Dismiss the flag with a reason |
| The published data is wrong | Fix the data; the correction publishes immediately |

Curators do not routinely read every affidavit, approve transcriber work, monitor transcriber performance, handle ingestion exceptions or receive unflagged transcription cases. Publication does not depend on their approval.

**Curation starts when published data receives user flags and continues through election day.** It can therefore overlap AI extraction and transcription. It is an ongoing rota, not another fixed three-day or five-day production stage.

### Workload and provision

Assume **5% of 4,000 candidates are flagged: about 200 candidate cases** over the period. For planning, retain **ten minutes of total handling per flagged candidate**, including related flags, rather than assuming exactly one flag per candidate or counting duplicates twice.

| Planning measure | Estimate |
|---|---:|
| Candidates with user flags | 200 |
| Total handling time | Approximately 33⅓ hours |
| **Recommended curator provision** | **2 people on a rota through election day** |
| Casework capacity to reserve | 20 productive hours each across the period; 40 hours total |
| Planning fee | ₹5,000 each for the cycle; **₹10,000 total** |

Two curators provide shared availability and about 6⅔ hours of casework capacity above the estimate. This headcount is a planning recommendation, not a measured service-level requirement. Confirm daily coverage, handovers and response expectations before hiring. The 40-hour capacity reservation does not imply full-time daily shifts, and the cycle fee does not mean unlimited work.

Flags may cluster near polling or take longer than ten minutes. Multiple distinct problems, repeated flags, or unresolved source issues can exceed the allowance. Review actual incoming work and remaining capacity daily. A 20-minute handling average would double casework to about 67 hours and require more provision. Any coverage after election day would need a separate agreement.

One human reading can still miss an error. Source links, visible checking labels and the user-flag queue support correction; a “checked by a person” label is not a guarantee of accuracy. The current plan has no change-history or restore facility.

## 5. Combined schedule and election window

**Start with the initial data as soon as it appears.** Siva keeps loading later arrivals while AI and transcribers work on ready records. Official-list changes update candidate status without delaying the start of processing.

| Stage | Start | Time allocation |
|---|---|---|
| Bulk loading: Siva | First available online data | Rolling as files arrive; duration to measure |
| AI extraction | First usable, matched records | Three elapsed days of provision for the planned workload |
| Transcription | Enough AI-processed work for productive shifts | Five eight-hour working days per person |
| Curation | Users flag published candidate data | Ongoing rota through election day |

**Conservative capacity envelope: three AI days followed by five transcription days, or eight days after a complete usable set is ready for AI.** Actual work overlaps where possible, so early loading can bring checks forward. The eight-day envelope excludes unmeasured bulk-loading time and does not guarantee completion eight days after the first partial release. Arrival timing and the remaining queue determine the finish.

The [election timeline](election-timelines.md) uses **N** for the announcement and contains planning offsets, not confirmed dates:

| Planning event | Implication for this operation |
|---|---|
| Initial documents appear, whenever that is | Loading and processing begin immediately |
| Around N+12: nominations close | If a complete set is ready for AI then, the conservative eight-day finish is around **N+20** |
| Around N+15: final contesting list | Reconcile rejections/withdrawals. If the complete set is only AI-ready then, the eight-day finish is around **N+23**, with no pre-poll margin |
| Around N+21: outbound candidate communications stop | The website and user-flag handling remain available |
| Around N+23: polling | Curator coverage continues through election day |

The N+15 case is a late-data scenario, **not an instruction to wait**. Earlier partial work helps but does not establish a guaranteed completion date. Late files or a slow pilot require an explicit staffing or coverage decision. Data completion also does not itself complete the wider launch campaign.

## 6. Combined cost budget

The budget covers the **candidate-data operation**, not the full platform or election campaign. It uses **23 transcribers for five days at ₹3,500 each**, **two curators at ₹5,000 each through election day**, and the existing non-staff reserves.

| Item, in operational order | Basis | Planning amount |
|---|---|---:|
| Bulk loading | Siva; time and any acquisition charges not priced | Excluded |
| AI extraction | Same 4,000-document workload; provisional API reserve | ₹35,000–₹70,000 |
| Transcription | 23 × ₹3,500 for five days | ₹80,500 |
| Curation | 2 × ₹5,000 for the cycle; rota through election day | ₹10,000 |
| Affidavit storage and downloads | Existing cycle allowance | ₹2,000–₹10,000 |
| Kannada translation | Up to the existing platform-wide allowance | ₹5,000 |
| **Subtotal** | Before contingency and taxes | **₹1,32,500–₹1,75,500** |
| Contingency | 20% of subtotal | ₹26,500–₹35,100 |
| **Planning total** | Before applicable taxes | **₹1,59,000–₹2,10,600** |

**Proposed rounded provision: ₹2.11 lakh before taxes.** This remains conditional on the pilot and the scope below; it is not approved spending or a guaranteed cap. Longer AI time does not create an assumed API discount.

If reading takes fifteen minutes, the minimum becomes 30 transcribers, without the 15% reading-capacity buffer. At ₹3,500 each, transcription costs ₹1,05,000 and the same budget with two curators becomes **₹1,88,400–₹2,40,000 including 20% contingency, before taxes**. Measure the pace before fixing the team.

**Excluded or shared costs:** Siva's loading time, acquisition charges, software development, the operations lead's time, recruitment/training beyond the engagement, workspace/equipment/travel, shared email/OTP services, wider hosting and backup, legal review, and citizen outreach. Additional curator hours or post-election coverage are not separately priced. Finance should review applicable taxes and foreign-exchange movements and avoid double-counting costs already funded in platform budgets. Storage and translation remain inherited allowances, not refreshed vendor quotations.

## 7. Hiring and readiness decisions

| Decision | What Oorvani needs to confirm |
|---|---|
| Bulk loading | Siva's access and loading method, starting with initial online data |
| AI | Representative pilot, provider/model, ten-job throughput, confidence threshold and actual API cost |
| Transcribers | Provision 23 Kannada readers, five shifts, ₹3,500 each, equipment and working staff email login |
| Curators | Provision two vetted people, ₹5,000 each, daily rota and reserved casework hours through polling |
| Coordination and finance | Named operations lead and budget owner; ₹2.11 lakh provisional envelope before taxes |
| Rehearsal and daily review | Prove loading, source links, labels, assignments and flag resolution; track imported, extracted, checked, unresolved and flagged records against capacity |

## References and status of assumptions

- [Stakeholder overview](overview.md), §§3.1, 8–9 and 11: report-card scope, publication policy and original fee/workload assumptions. The five-day ₹3,500 transcriber engagement and revised staffing above replace the older operation's figures.
- [Milestone plan](milestones.md), §§9–11 and 13, and [architecture](architecture.md), §§6–7: implementation context. This operating brief follows the clarified flags-only curator role and immediate initial-data start; older descriptions of broader curator oversight do not define this operation.
- [Election timeline](election-timelines.md), §§3–4: authority for unconfirmed election offsets.
- [Acquisition risk assessment](ksec-data-risk.md): the online-access dependency assumed solved for this scenario.
- [OpenAI PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs) and [rate limits](https://developers.openai.com/api/docs/guides/rate-limits): technical references retained from the earlier proposal, which consulted them on 20 September 2026. They do not establish affidavit-specific time, accuracy or cost.

The four stages, Siva's loading ownership, immediate initial-data start, affidavit-level confidence, three-day AI window, five-day transcription window, 5% flagged-candidate assumption, curation through polling and ₹3,500 transcriber fee reflect the clarified planning brief. The 23-reader/two-curator provision, productive-time ratio, AI and human processing rates, API reserve and contingency remain estimates to validate. None is measured performance or a confirmed staff contract.
