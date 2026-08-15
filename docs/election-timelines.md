# Election Timelines

**Date:** 2026-08-15
**Status:** Assumptions — derived from three precedents, pending KSEC confirmation
**Scope:** What we assume about when each stage of the GBA ward election happens, expressed as days from the announcement (**N**). This document is self-contained and holds the assumptions only; anything that depends on a date should cite this document rather than restate it.

---

## 1. Everything hangs off N

**N is the day the State Election Commission announces the schedule.**

N is the anchor because it is the first moment we know anything. Before N there is no poll date, no notification date, and no candidate. At N the whole calendar arrives at once, in a single press release. Planning against the poll day instead would mean planning against a number nobody has told us yet.

The question this document answers is not "when is the election" but **"once they tell us, how many days do we have?"**

Two notes on what N is not:

- **The announcement and the notification are different events.** The notification is the election notice that formally opens nominations. It came 18 days after the announcement at BBMP, 5 days after at the 2021 Karnataka polls, and on the same day at BMC.
- **The model code does not always take effect at N.** It did at BBMP and BMC. In 2021 it took effect five days later, on the notification day.

---

## 2. The reference elections

Three elections, all extrapolated from press-released schedules.

### BBMP 2015

Bengaluru's last municipal election, eleven years ago, for the 198 wards of the Bruhat Bengaluru Mahanagara Palike. Announced 16 July 2015, polled 22 August.

It matters because it is the same commission and the same city. It ran under judicial deadline pressure after a long delay, as GBA does. It is also the widest of the three: 37 days from announcement to poll, driven entirely by an 18-day wait between the announcement and the notification.

### Karnataka city corporations 2021

Belagavi (58 wards), Hubballi-Dharwad (82) and Kalaburagi (55), plus bypolls elsewhere. Announced 11 August 2021, polled 3 September.

It matters because it is the same commission at a more recent date, and because it is the tightest schedule of the three: 23 days from announcement to poll. Its internal sequence from the notification onward is nearly identical to BBMP's, which is the strongest signal in this document.

### BMC 2026

The Brihanmumbai Municipal Corporation election for 227 wards, announced 15 December 2025 and polled 15 January 2026, alongside 28 other Maharashtra corporations — 2,869 seats and 3.48 crore voters in a single phase.

It is run by the Maharashtra State Election Commission under Maharashtra law, so nothing in it binds KSEC, and its nomination sequence visibly differs — nominations opened eight days after the notification rather than on the day of it. It is here for two reasons: it is eight months old, and it announced 29 corporations in one release polling on one day, which is the only available evidence on how a multi-corporation election gets scheduled.

---

## 3. The reference table

Only the first row carries real dates. Everything below is days from that row.

| Event | BBMP 2015 | Karnataka 2021 | BMC 2026 | **GBA assumption** | Confidence | Why |
|---|---|---|---|---|---|---|
| **Announcement** | 16 Jul 2015 | 11 Aug 2021 | 15 Dec 2025 | **N** | — | The anchor, by definition |
| Model code in force | +0 | +5 | +0 | **N+0** | Medium | Two of three |
| Notification / election notice | +18 | +5 | +0 | **N+5** | **Low** | The three disagree completely. Taking the tighter Karnataka case, because the wider one is the comfortable error |
| Nominations open | +18 | +5 | +8 | **N+5** | **Low** | Same day as the notification in Karnataka; inherits its uncertainty |
| Polling stations fixed; count published | +20 | not recorded | not recorded | **N+7** | **Low** | One dated observation: 6,733 BBMP stations identified and public two days after the notification |
| **Nominations close; affidavits exist** | +25 | +12 | +15 | **N+12** | Medium | Notification+7 at both Karnataka polls, exactly. Confident in the interval, not in where the notification lands |
| Scrutiny; rejected candidates known | +26 | +13 | +16 | **N+13** | Medium | Notification+8 at both Karnataka polls, exactly |
| **Withdrawal closes → final contesting list** | +28 | +15 | +18 | **N+15** | Medium | Notification+10 at both Karnataka polls, exactly |
| Symbols allotted | not recorded | not recorded | +19 | **N+16** | **Low** | One observation, at final list+1 |
| Campaigning ends; silence begins | +35 | +21 | +29 | **N+21** | Medium | 48 hours before the close of poll at all three |
| **Poll** | +37 | +23 | +31 | **N+23** | Medium | Withdrawal+8, the tightest observed. BBMP ran +9, BMC +13 |
| Counting and results | +40 | +26 | +32 | **N+26** | Medium | Poll+3, as at BBMP and in 2021. BMC ran +1 |


**How the assumption column was built.** The sequence from the notification onward comes from the two Karnataka elections, which agree with each other to the day at every stage: nominations close at +7, scrutiny at +8, withdrawal at +10. Where the notification itself sits is the one interval nobody agrees on, and the assumption takes the tighter Karnataka value. The poll is set at the tightest gap observed anywhere, so that nothing is planned against a margin we have not seen.

**The range.** Announcement to poll was 37 days at BBMP, 31 at BMC, 23 in 2021. **Assume about three and a half weeks from N to the poll.** If it turns out longer, the extra time is free; if we assume longer and it is not, the work does not fit.

**N+5 is where to spend effort.** Every date below the notification moves with it, and the observed spread is 18 days. One call to KSEC settles it, and nothing else in this table is worth as much.

**What the booth row does not say.** All three precedents put a station count into the public record before the poll, and all three had a voter-facing booth lookup running by poll day. None of them records when that lookup went live, or when an addressed list of stations was first published (Q3). N+7 covers the count, not the addresses.

---

## 4. What the timeline constrains

These follow from §3 alone and hold regardless of when N falls.

**Nothing about candidates exists before N+5.** No nomination filed, no name known, no affidavit. Anything scheduled earlier that names a specific candidate cannot be honoured.

**No affidavit exists before N+12**, and the set is not complete until then. Filing is back-loaded: most nominations land in the last two days of the window.

**No final list of contesting candidates exists before N+15.** Anything pulled between N+12 and N+15 is a superset — it holds candidates who will be rejected at scrutiny and candidates who will withdraw.

**The working window is eight days**, from the final list at N+15 to the poll at N+23. Measured from the first complete affidavit set at N+12 it is eleven. Any work that depends on candidate records — extraction, verification, review, sign-off — has to fit inside that, and eight days is the figure to plan against, because it is the only window in which the list being worked from is the right one.

**The last two days are unusable.** Silence begins at N+21 and the poll is at N+23.

**Results land at N+26**, which starts the clock on anything measured from the declaration of results.

---

## 5. Open questions

| # | Question | Why it matters | Owner |
|---|---|---|---|
| Q1 | **How long after the announcement does the notification come?** Observed at +18, +5 and +0 | The widest source of error in §3. Every date below it moves with it | unassigned |
| Q2 | **Do all five corporations poll on one day?** The GBA election covers 369 wards across five corporations; all three precedents polled every ward on one day | If not, the tail of §3 forks per corporation and every date becomes ward-dependent | unassigned |
| Q3 | **When does an addressed list of polling stations become public?** No precedent records it | A citizen cannot be told where to vote until it exists | unassigned |
| Q4 | **How and where does KSEC publish candidate affidavits?** The ECI's national affidavit portal does not cover local body polls | No confirmed source for the largest piece of candidate data | unassigned |

---

## 6. How to use this document

- **Quote offsets from N, not dates.** Nothing in the assumption column is a real date. The only real dates here are the three announcements.
- **Plan against the assumption column.** It takes the Karnataka sequence where the two Karnataka elections agree, and the tightest observed value everywhere else.
- **This document does not cite others by design.** Things that depend on dates should point here rather than copy the numbers, so one update at N propagates instead of leaving stale copies behind.
- **When KSEC announces, update this first**, then re-run §4 against the real numbers.

---

## 7. Sources

- **BBMP general election 2015** — announced 16 Jul 2015; notification 3 Aug; nominations close 10 Aug; scrutiny 11 Aug; withdrawal 13 Aug; poll 22 Aug; counting 25 Aug. 198 wards. 6,733 polling stations, reported as identified on 5 Aug, capped at 1,500 voters each with auxiliary stations above that.
- **Karnataka city corporation elections 2021** (Belagavi, Hubballi-Dharwad, Kalaburagi and bypolls) — announced 11 Aug 2021; model code in force and notification 16 Aug; nominations close 23 Aug; scrutiny 24 Aug; withdrawal 26 Aug; poll 3 Sep; counting 6 Sep. 195 corporation wards across the three, 252 wards including the bypolls. Station counts reported near the poll: 3,842 in Hubballi-Dharwad, 415 in Belagavi.
- **BMC general election 2026** — announced and model code in force 15 Dec 2025, covering 29 Maharashtra corporations, 2,869 seats and 3.48 crore voters; notification 15 Dec; nominations 23–30 Dec; scrutiny 31 Dec; withdrawal 2 Jan 2026; final list and symbols 3 Jan; campaigning ends 13 Jan; poll 15 Jan; counting 16 Jan. 227 wards in Greater Mumbai. 39,092 polling booths statewide; the Maharashtra SEC ran an EPIC- and name-wise booth lookup, with slips also distributed door to door.
- Karnataka Municipal Corporations Act, 1976 §§35, 39(ii) — the basis on which candidates file affidavits of assets, liabilities and criminal antecedents with their nominations.
- Greater Bengaluru Governance Act, 2024 (Karnataka Act 36 of 2025) — the five corporations and their ward counts.
