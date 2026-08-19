# Message Templates — WhatsApp & Email

**Date:** 2026-07-17
**Status:** Draft — for template-approval submission
**Scope:** Every outbound message the platform sends, in both channels (WhatsApp, Email) and both languages (English, Kannada). This is the submission packet for Twilio/Meta WhatsApp template approval (`docs/project-dependencies.md` §3.7) and the copy source for SendGrid email templates.

> **Contingent, as of 2026-08-14.** The seven ward-scoped sends require registered users, which is **M7 — last in the milestone order and explicitly abandonable** (`docs/milestones.md` §11). If the go/no-go in `docs/gtm-plan.md` §3.1 comes back *no*, R1 through F1 are dropped and this packet reduces to the **OTP login message alone** — 1 message × 2 channels × 2 languages = 4 templates, not 16. Nothing in the drafting below changes either way; what changes is how many of these are ever submitted.
>
> **The OTP templates are not contingent** and are worth submitting on their own timeline: OTP over WhatsApp is how citizens *and* staff log in, and Meta approval runs to weeks. (Staff access does not depend on it — an admin can hand-issue sign-in links, `docs/prd.md` §10 — but that is a floor, not a plan.)

> **Scope check — these are the only automated outbound messages.** The comms calendar is seven ward-scoped sends (`docs/gtm-plan.md` §4) plus the OTP login message (`docs/prd.md` §10) = **8 messages × 2 channels × 2 languages = 16 WhatsApp templates**, matching the count in `docs/project-dependencies.md` §3.7/§9. **Flag outcomes and submission-review outcomes are explicitly *not* emailed or WhatsApped** (`docs/prd.md` §6.1 step 5) — those surface only as status on `/account/submissions`. Do not add a template for them without a PRD change.

---

## 1. Before submitting

- **Kannada text below is a first machine-assisted draft, not submission-ready.** Unlike site content — where machine translation with no human review is a decided product trade (`docs/prd.md` §8) — a *rejected or mistranslated template* costs a re-submission cycle worth weeks (`docs/project-dependencies.md` §3, Path A), and these are read by citizens on an election. **Every Kannada template needs a native-speaker + legal pass before it goes to Meta**, not just the flag-and-correct net the site relies on elsewhere.
- **Category is a proposal, not a decision.** Meta has the final say per template. Classifications below follow the reasoning in `docs/project-dependencies.md` §3.8: only content that is purely transactional/logistical is proposed as Utility; anything touching candidates or a call to a civic action is proposed as Marketing (dearer, separately blockable by the recipient); the OTP message is Authentication (its own rate and its own fixed Meta format).
- **Variables use Meta's numbered placeholder convention** (`{{1}}`, `{{2}}`, …) for maximum template-system compatibility. Each template lists what each number maps to.
- **Every send honours the recipient's saved language preference** (`docs/prd.md` §8, §9) — there is no language picker at send time; the EN and KN templates below are two versions of the same message, not two different messages.
- **Marketing-category templates carry an opt-out footer line**; Utility and Authentication templates do not need one (opt-out for those is account-level, not per-template).
- **Consent framing.** W1 is itself the recorded opt-in moment (`docs/prd.md` §10); every subsequent message is sent under that consent, so none of R1–F1 need to re-justify themselves as "why am I getting this" — that trust is spent once, at registration, not on every send.

---

## 2. Summary

| # | Trigger | Category (proposed) | Content |
|---|---|---|---|
| OTP | Every login (all roles) | Authentication | One-time passcode |
| W1 | On register | Utility | Confirms ward, language, what they'll receive |
| R1 | Roll close −7d | Utility | Last date to join the electoral roll; check registration |
| L1 | Scrutiny complete (≈N+9d) | Marketing | Candidates have filed in your ward (provisional) |
| C1 | E−3w | Marketing | Vote on your ward's top 3 issues |
| C2 | E−2w | Marketing | Final candidate list; report cards complete |
| C3 | E−1w | Marketing | Your ward's top issues; compare candidates; booth locator |
| F1 | E−3d | Utility | Booth, timings, ID to carry |

*N = EC notification, E = election day (`docs/gtm-plan.md` §3). F1 is the last send — the campaign goes dark for the final 48 hours (`docs/prd.md` §9.2).*

---

## 3. OTP login (Authentication)

**Trigger:** every login attempt, any role (citizen, transcriber, curator, admin) — `docs/prd.md` §10.
**Category:** Authentication (Meta's fixed-format template class; body wording is constrained to Meta's approved authentication patterns, shown below).

### WhatsApp — English (`bv_otp_login_en`)

> Body: `{{1}} is your verification code for Bengaluru Votes.`
> Footer (expiry add-on): `This code expires in 10 minutes.`
> Button: **Copy Code** (Meta-managed autofill button, not free text)

Variables: `{{1}}` = 6-digit OTP.

### WhatsApp — Kannada (`bv_otp_login_kn`)

> Body: `{{1}} ಇದು Bengaluru Votes ಗಾಗಿ ನಿಮ್ಮ ಪರಿಶೀಲನಾ ಸಂಕೇತ.`
> Footer: `ಈ ಸಂಕೇತ 10 ನಿಮಿಷಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ.`
> Button: **Copy Code**

### Email — English

**Subject:** Your Bengaluru Votes verification code: `{{1}}`
**Body:**
> Your verification code is **`{{1}}`**.
>
> This code expires in 10 minutes. If you didn't request this, you can safely ignore this email — nobody can access your account without it.
>
> — Bengaluru Votes, an Oorvani Foundation initiative

### Email — Kannada

**Subject:** ನಿಮ್ಮ Bengaluru Votes ಪರಿಶೀಲನಾ ಸಂಕೇತ: `{{1}}`
**Body:**
> ನಿಮ್ಮ ಪರಿಶೀಲನಾ ಸಂಕೇತ **`{{1}}`**.
>
> ಈ ಸಂಕೇತ 10 ನಿಮಿಷಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ. ನೀವು ಇದನ್ನು ಕೋರದಿದ್ದರೆ, ಈ ಇಮೇಲ್ ಅನ್ನು ನಿರ್ಲಕ್ಷಿಸಬಹುದು — ಈ ಸಂಕೇತವಿಲ್ಲದೆ ಯಾರೂ ನಿಮ್ಮ ಖಾತೆಯನ್ನು ಪ್ರವೇಶಿಸಲಾಗುವುದಿಲ್ಲ.
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ

---

## 4. W1 — Welcome / registration confirmation (Utility)

**Trigger:** on successful registration (OTP confirmed + ward + language set).
**Category:** Utility — a transactional confirmation of the account just created, no promotional content.

### WhatsApp — English (`bv_w1_welcome_en`)

> Welcome to Bengaluru Votes! You're registered for **{{1}} ward**, updates in {{2}}. We'll only message you about: the electoral roll deadline, when candidates file, voting on ward issues, and your polling booth — nothing else. Manage anytime: {{3}}

Variables: `{{1}}` = ward name + number, `{{2}}` = language (English/Kannada), `{{3}}` = link to `/account/notifications`.

### WhatsApp — Kannada (`bv_w1_welcome_kn`)

> Bengaluru Votes ಗೆ ಸ್ವಾಗತ! ನೀವು **{{1}} ವಾರ್ಡ್**ಗೆ ನೋಂದಣಿಯಾಗಿದ್ದೀರಿ, ಅಪ್ಡೇಟ್‌ಗಳು {{2}} ಭಾಷೆಯಲ್ಲಿ. ನಾವು ನಿಮಗೆ ಇವುಗಳ ಬಗ್ಗೆ ಮಾತ್ರ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇವೆ: ಮತದಾರರ ಪಟ್ಟಿ ಗಡುವು, ಅಭ್ಯರ್ಥಿಗಳ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ, ವಾರ್ಡ್ ಸಮಸ್ಯೆಗಳ ಮತದಾನ, ಮತ್ತು ನಿಮ್ಮ ಮತಗಟ್ಟೆ ವಿವರ — ಇವಿಷ್ಟೇ. ಯಾವಾಗ ಬೇಕಾದರೂ ಬದಲಿಸಿ: {{3}}

### Email — English

**Subject:** You're set up for {{1}} ward updates
**Body:**
> Thanks for registering with Bengaluru Votes.
>
> - **Ward:** {{1}}
> - **Language:** {{2}}
>
> Here's exactly what we'll send you, and nothing more: the electoral roll deadline, when candidates file nominations in your ward, a chance to vote on your ward's top local issues, and your polling booth details closer to election day.
>
> You can change your ward, language, or channels anytime at {{3}}.
>
> — Bengaluru Votes, an Oorvani Foundation initiative

### Email — Kannada

**Subject:** {{1}} ವಾರ್ಡ್ ಅಪ್ಡೇಟ್‌ಗಳಿಗಾಗಿ ನೀವು ಸಿದ್ಧರಾಗಿದ್ದೀರಿ
**Body:**
> Bengaluru Votes ನಲ್ಲಿ ನೋಂದಾಯಿಸಿಕೊಂಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.
>
> - **ವಾರ್ಡ್:** {{1}}
> - **ಭಾಷೆ:** {{2}}
>
> ನಾವು ನಿಮಗೆ ಕಳುಹಿಸುವುದು ಇಷ್ಟೇ, ಇನ್ನೇನೂ ಅಲ್ಲ: ಮತದಾರರ ಪಟ್ಟಿ ಗಡುವು, ನಿಮ್ಮ ವಾರ್ಡ್‌ನಲ್ಲಿ ಅಭ್ಯರ್ಥಿಗಳ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ, ನಿಮ್ಮ ವಾರ್ಡ್‌ನ ಪ್ರಮುಖ ಸ್ಥಳೀಯ ಸಮಸ್ಯೆಗಳ ಮೇಲೆ ಮತ ಚಲಾಯಿಸುವ ಅವಕಾಶ, ಮತ್ತು ಚುನಾವಣೆ ಸಮೀಪಿಸುತ್ತಿದ್ದಂತೆ ನಿಮ್ಮ ಮತಗಟ್ಟೆ ವಿವರಗಳು.
>
> ನಿಮ್ಮ ವಾರ್ಡ್, ಭಾಷೆ ಅಥವಾ ಚಾನೆಲ್‌ಗಳನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ {{3}} ನಲ್ಲಿ ಬದಲಾಯಿಸಬಹುದು.
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ

---

## 5. R1 — Electoral roll deadline (Utility)

**Trigger:** roll close −7 days. The highest-value send in the plan — the one failure in this funnel that is irreversible (`docs/gtm-plan.md` §4).
**Category:** Utility — a time-critical eligibility notice, not promotional.

### WhatsApp — English (`bv_r1_roll_deadline_en`)

> ⏰ The electoral roll for GBA ward elections closes on **{{1}}**. If your name isn't on it, you cannot vote — no exceptions. Check your registration now: {{2}}

Variables: `{{1}}` = roll deadline date, `{{2}}` = link to `/check-registration`.

### WhatsApp — Kannada (`bv_r1_roll_deadline_kn`)

> ⏰ GBA ವಾರ್ಡ್ ಚುನಾವಣೆಗಳ ಮತದಾರರ ಪಟ್ಟಿ **{{1}}** ರಂದು ಮುಚ್ಚುತ್ತದೆ. ನಿಮ್ಮ ಹೆಸರು ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದಿದ್ದರೆ, ನೀವು ಮತ ಚಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ — ಯಾವುದೇ ವಿನಾಯಿತಿ ಇಲ್ಲ. ಈಗಲೇ ನಿಮ್ಮ ನೋಂದಣಿ ಪರಿಶೀಲಿಸಿ: {{2}}

### Email — English

**Subject:** 7 days left to join the electoral roll
**Body:**
> The electoral roll for the GBA ward elections closes on **{{1}}**.
>
> If you're not on the roll by then, no amount of candidate information helps — you simply can't vote. It takes two minutes to check.
>
> **[Check your registration]({{2}})**
>
> If you're not yet enrolled, or you've moved since you last voted, see our step-by-step guide: {{3}}
>
> — Bengaluru Votes, an Oorvani Foundation initiative

### Email — Kannada

**Subject:** ಮತದಾರರ ಪಟ್ಟಿಗೆ ಸೇರಲು 7 ದಿನಗಳು ಬಾಕಿ
**Body:**
> GBA ವಾರ್ಡ್ ಚುನಾವಣೆಗಳ ಮತದಾರರ ಪಟ್ಟಿ **{{1}}** ರಂದು ಮುಚ್ಚುತ್ತದೆ.
>
> ಅಷ್ಟರೊಳಗೆ ನೀವು ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದಿದ್ದರೆ, ಎಷ್ಟೇ ಅಭ್ಯರ್ಥಿ ಮಾಹಿತಿ ಇದ್ದರೂ ಪ್ರಯೋಜನವಿಲ್ಲ — ನೀವು ಮತ ಚಲಾಯಿಸಲು ಸಾಧ್ಯವಾಗುವುದಿಲ್ಲ. ಪರಿಶೀಲಿಸಲು ಎರಡು ನಿಮಿಷ ಸಾಕು.
>
> **[ನಿಮ್ಮ ನೋಂದಣಿ ಪರಿಶೀಲಿಸಿ]({{2}})**
>
> ನೀವು ಇನ್ನೂ ನೋಂದಾಯಿಸಿಲ್ಲದಿದ್ದರೆ, ಅಥವಾ ಕೊನೆಯ ಬಾರಿ ಮತ ಚಲಾಯಿಸಿದಾಗಿನಿಂದ ಸ್ಥಳಾಂತರಗೊಂಡಿದ್ದರೆ, ನಮ್ಮ ಹಂತ-ಹಂತದ ಮಾರ್ಗದರ್ಶಿ ನೋಡಿ: {{3}}
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ

---

## 6. L1 — Candidates filed (provisional) (Marketing)

**Trigger:** scrutiny complete, ≈N+9d. Framed as provisional because withdrawals can still shrink the list (`docs/gtm-plan.md` §4).
**Category:** Marketing (candidate content). Gated per PRD §9.1 — held for any ward whose data isn't ready.

### WhatsApp — English (`bv_l1_candidates_filed_en`)

> Nominations have closed in **{{1}} ward** — {{2}} candidates have filed so far (the list may still change after withdrawals). See who's standing: {{3}}
>
> Reply STOP to opt out.

Variables: `{{1}}` = ward name, `{{2}}` = candidate count, `{{3}}` = link to `/ward/{id}` (candidate list is inline).

### WhatsApp — Kannada (`bv_l1_candidates_filed_kn`)

> **{{1}} ವಾರ್ಡ್**ನಲ್ಲಿ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ ಮುಗಿದಿದೆ — ಇಲ್ಲಿಯವರೆಗೆ {{2}} ಅಭ್ಯರ್ಥಿಗಳು ನಾಮಪತ್ರ ಸಲ್ಲಿಸಿದ್ದಾರೆ (ಹಿಂಪಡೆಯುವಿಕೆಗಳ ನಂತರ ಪಟ್ಟಿ ಬದಲಾಗಬಹುದು). ಯಾರು ಸ್ಪರ್ಧಿಸುತ್ತಿದ್ದಾರೆ ನೋಡಿ: {{3}}
>
> ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.

### Email — English

**Subject:** Candidates have filed in {{1}} ward
**Body:**
> Nominations closed in **{{1}} ward** with **{{2}} candidates** filing so far. This list is provisional — some candidates may still withdraw before the final list is confirmed.
>
> **[See who's standing]({{3}})**
>
> — Bengaluru Votes, an Oorvani Foundation initiative
>
> *[Manage your notification preferences]({{4}}) · [Unsubscribe]({{5}})*

### Email — Kannada

**Subject:** {{1}} ವಾರ್ಡ್‌ನಲ್ಲಿ ಅಭ್ಯರ್ಥಿಗಳು ನಾಮಪತ್ರ ಸಲ್ಲಿಸಿದ್ದಾರೆ
**Body:**
> **{{1}} ವಾರ್ಡ್**ನಲ್ಲಿ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ ಮುಗಿದಿದ್ದು, ಇಲ್ಲಿಯವರೆಗೆ **{{2}} ಅಭ್ಯರ್ಥಿಗಳು** ಸಲ್ಲಿಸಿದ್ದಾರೆ. ಈ ಪಟ್ಟಿ ತಾತ್ಕಾಲಿಕವಾಗಿದ್ದು, ಅಂತಿಮ ಪಟ್ಟಿ ಖಚಿತಗೊಳ್ಳುವ ಮೊದಲು ಕೆಲವು ಅಭ್ಯರ್ಥಿಗಳು ಹಿಂಪಡೆಯಬಹುದು.
>
> **[ಯಾರು ಸ್ಪರ್ಧಿಸುತ್ತಿದ್ದಾರೆ ನೋಡಿ]({{3}})**
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ
>
> *[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{4}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{5}})*

---

## 7. C1 — Vote on ward issues (Marketing)

**Trigger:** E−3w. Candidate data is still churning at this point, so the send fills the slot with something the platform can already stand behind (`docs/gtm-plan.md` §4).
**Category:** Marketing (call to a civic action).

### WhatsApp — English (`bv_c1_issue_vote_en`)

> What matters most in **{{1}} ward** — roads, water, waste, safety? Vote for your top 3 local issues and make your voice count: {{2}}
>
> Reply STOP to opt out.

Variables: `{{1}}` = ward name, `{{2}}` = link to `/ward/{id}/issues`.

### WhatsApp — Kannada (`bv_c1_issue_vote_kn`)

> **{{1}} ವಾರ್ಡ್**ನಲ್ಲಿ ಏನು ಮುಖ್ಯ — ರಸ್ತೆಗಳು, ನೀರು, ತ್ಯಾಜ್ಯ, ಸುರಕ್ಷತೆ? ನಿಮ್ಮ ಟಾಪ್ 3 ಸ್ಥಳೀಯ ಸಮಸ್ಯೆಗಳಿಗೆ ಮತ ಹಾಕಿ ಮತ್ತು ನಿಮ್ಮ ಧ್ವನಿ ಎಣಿಕೆಗೆ ಬರಲಿ: {{2}}
>
> ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.

### Email — English

**Subject:** Vote for {{1}} ward's top 3 issues
**Body:**
> Roads, water, waste, safety — what should your corporator prioritise? Your ward's curator has put together the local issues that matter, and your top-3 vote adds to a public, ward-by-ward signal.
>
> **[Vote now]({{2}})**
>
> — Bengaluru Votes, an Oorvani Foundation initiative
>
> *[Manage your notification preferences]({{3}}) · [Unsubscribe]({{4}})*

### Email — Kannada

**Subject:** {{1}} ವಾರ್ಡ್‌ನ ಟಾಪ್ 3 ಸಮಸ್ಯೆಗಳಿಗೆ ಮತ ಹಾಕಿ
**Body:**
> ರಸ್ತೆಗಳು, ನೀರು, ತ್ಯಾಜ್ಯ, ಸುರಕ್ಷತೆ — ನಿಮ್ಮ ಕಾರ್ಪೊರೇಟರ್ ಯಾವುದಕ್ಕೆ ಆದ್ಯತೆ ನೀಡಬೇಕು? ನಿಮ್ಮ ವಾರ್ಡ್‌ನ ಕ್ಯುರೇಟರ್ ಮುಖ್ಯವಾದ ಸ್ಥಳೀಯ ಸಮಸ್ಯೆಗಳ ಪಟ್ಟಿ ಸಿದ್ಧಪಡಿಸಿದ್ದಾರೆ, ಮತ್ತು ನಿಮ್ಮ ಟಾಪ್-3 ಮತ ಸಾರ್ವಜನಿಕ, ವಾರ್ಡ್‌ವಾರು ಸಂಕೇತಕ್ಕೆ ಸೇರುತ್ತದೆ.
>
> **[ಈಗಲೇ ಮತ ಹಾಕಿ]({{2}})**
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ
>
> *[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{3}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{4}})*

---

## 8. C2 — Final candidate list (Marketing)

**Trigger:** E−2w. This is the real content beat — final list, report cards complete (`docs/gtm-plan.md` §3).
**Category:** Marketing (candidate content). Gated per PRD §9.1.

### WhatsApp — English (`bv_c2_final_candidates_en`)

> The final candidate list for **{{1}} ward** is out, and report cards are complete — track record, assets, cases, and more, all sourced. Read before you vote: {{2}}
>
> Reply STOP to opt out.

Variables: `{{1}}` = ward name, `{{2}}` = link to `/ward/{id}` (candidate list is inline).

### WhatsApp — Kannada (`bv_c2_final_candidates_kn`)

> **{{1}} ವಾರ್ಡ್**ನ ಅಂತಿಮ ಅಭ್ಯರ್ಥಿಗಳ ಪಟ್ಟಿ ಪ್ರಕಟವಾಗಿದೆ, ಮತ್ತು ರಿಪೋರ್ಟ್ ಕಾರ್ಡ್‌ಗಳು ಪೂರ್ಣಗೊಂಡಿವೆ — ಹಿಂದಿನ ಕಾರ್ಯಸಾಧನೆ, ಆಸ್ತಿ, ಪ್ರಕರಣಗಳು, ಎಲ್ಲವೂ ಮೂಲಸಹಿತ. ಮತ ಹಾಕುವ ಮೊದಲು ಓದಿ: {{2}}
>
> ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.

### Email — English

**Subject:** {{1}} ward's final candidate list is ready
**Body:**
> The candidate list for **{{1}} ward** is now final, and every report card is complete — name and party, track record, criminal cases, declared assets, education, and news coverage, each with its source shown.
>
> **[Read the report cards]({{2}})** · **[Compare candidates side by side]({{3}})**
>
> — Bengaluru Votes, an Oorvani Foundation initiative
>
> *[Manage your notification preferences]({{4}}) · [Unsubscribe]({{5}})*

### Email — Kannada

**Subject:** {{1}} ವಾರ್ಡ್‌ನ ಅಂತಿಮ ಅಭ್ಯರ್ಥಿಗಳ ಪಟ್ಟಿ ಸಿದ್ಧವಾಗಿದೆ
**Body:**
> **{{1}} ವಾರ್ಡ್**ನ ಅಭ್ಯರ್ಥಿಗಳ ಪಟ್ಟಿ ಈಗ ಅಂತಿಮಗೊಂಡಿದ್ದು, ಪ್ರತಿ ರಿಪೋರ್ಟ್ ಕಾರ್ಡ್ ಪೂರ್ಣಗೊಂಡಿದೆ — ಹೆಸರು ಮತ್ತು ಪಕ್ಷ, ಹಿಂದಿನ ಕಾರ್ಯಸಾಧನೆ, ಕ್ರಿಮಿನಲ್ ಪ್ರಕರಣಗಳು, ಘೋಷಿತ ಆಸ್ತಿ, ವಿದ್ಯಾರ್ಹತೆ, ಮತ್ತು ಸುದ್ದಿ ವರದಿಗಳು, ಪ್ರತಿಯೊಂದಕ್ಕೂ ಮೂಲ ಸಹಿತ.
>
> **[ರಿಪೋರ್ಟ್ ಕಾರ್ಡ್‌ಗಳನ್ನು ಓದಿ]({{2}})** · **[ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹೋಲಿಸಿ]({{3}})**
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ
>
> *[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{4}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{5}})*

---

## 9. C3 — Top issues, compare candidates, find your booth (Marketing)

**Trigger:** E−1w. The last candidate content any citizen receives — nothing candidate-related is sent after this (`docs/gtm-plan.md` §4).
**Category:** Marketing (candidate comparison content, alongside logistics).

### WhatsApp — English (`bv_c3_compare_booth_en`)

> One week to go. See what **{{1}} ward** voted as its top issues, compare candidates side by side, and find your polling booth: {{2}}
>
> Reply STOP to opt out.

Variables: `{{1}}` = ward name, `{{2}}` = link to `/ward/{id}/compare` (issues and booth-locator links included in the linked page / email body).

### WhatsApp — Kannada (`bv_c3_compare_booth_kn`)

> ಇನ್ನೊಂದು ವಾರ ಬಾಕಿ. **{{1}} ವಾರ್ಡ್** ಟಾಪ್ ಸಮಸ್ಯೆಗಳೆಂದು ಮತ ಹಾಕಿದ್ದನ್ನು ನೋಡಿ, ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹೋಲಿಸಿ, ಮತ್ತು ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಪತ್ತೆಹಚ್ಚಿ: {{2}}
>
> ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.

### Email — English

**Subject:** One week out: {{1}} ward's top issues, candidates, and your booth
**Body:**
> **[See {{1}} ward's top voted issues]({{2}})**
>
> **[Compare all candidates side by side]({{3}})**
>
> **[Find your polling booth]({{4}})**
>
> This is the last candidate update you'll get from us — the next message, closer to election day, will be logistics only.
>
> — Bengaluru Votes, an Oorvani Foundation initiative
>
> *[Manage your notification preferences]({{5}}) · [Unsubscribe]({{6}})*

### Email — Kannada

**Subject:** ಇನ್ನೊಂದು ವಾರ ಬಾಕಿ: {{1}} ವಾರ್ಡ್‌ನ ಟಾಪ್ ಸಮಸ್ಯೆಗಳು, ಅಭ್ಯರ್ಥಿಗಳು, ಮತ್ತು ನಿಮ್ಮ ಮತಗಟ್ಟೆ
**Body:**
> **[{{1}} ವಾರ್ಡ್‌ನ ಟಾಪ್ ಮತ ಪಡೆದ ಸಮಸ್ಯೆಗಳನ್ನು ನೋಡಿ]({{2}})**
>
> **[ಎಲ್ಲಾ ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹೋಲಿಸಿ]({{3}})**
>
> **[ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಪತ್ತೆಹಚ್ಚಿ]({{4}})**
>
> ಇದು ನಮ್ಮಿಂದ ನೀವು ಪಡೆಯುವ ಕೊನೆಯ ಅಭ್ಯರ್ಥಿ ಅಪ್ಡೇಟ್ — ಚುನಾವಣೆ ಸಮೀಪಿಸುತ್ತಿದ್ದಂತೆ ಬರುವ ಮುಂದಿನ ಸಂದೇಶ ಕೇವಲ ಲಾಜಿಸ್ಟಿಕ್ಸ್ ಬಗ್ಗೆ ಮಾತ್ರ ಇರುತ್ತದೆ.
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ
>
> *[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{5}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{6}})*

---

## 10. F1 — Booth, timings, ID to carry (Utility)

**Trigger:** E−3d. The last send of the campaign — nothing goes out in the final 48 hours (`docs/prd.md` §9.2, `docs/gtm-plan.md` §4).
**Category:** Utility — pure logistics, no candidate content, no call to a civic action beyond voting itself.

### WhatsApp — English (`bv_f1_booth_logistics_en`)

> Election day is close. Your booth: **{{1}}**. Polls open {{2}}–{{3}}. Carry your voter ID (EPIC) or an accepted alternative photo ID. Full details: {{4}}

Variables: `{{1}}` = booth name/address, `{{2}}`/`{{3}}` = poll open/close times, `{{4}}` = link to `/voting-guide/find-booth`.

### WhatsApp — Kannada (`bv_f1_booth_logistics_kn`)

> ಚುನಾವಣೆ ದಿನ ಸಮೀಪಿಸಿದೆ. ನಿಮ್ಮ ಮತಗಟ್ಟೆ: **{{1}}**. ಮತದಾನ {{2}}–{{3}} ಸಮಯದಲ್ಲಿ. ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ (EPIC) ಅಥವಾ ಅಂಗೀಕೃತ ಪರ್ಯಾಯ ಫೋಟೋ ಗುರುತಿನ ಚೀಟಿ ತನ್ನಿ. ಪೂರ್ಣ ವಿವರಗಳು: {{4}}

### Email — English

**Subject:** Your polling booth and what to carry
**Body:**
> **Your booth:** {{1}}
> **Polling hours:** {{2}} – {{3}}
> **Carry:** your voter ID (EPIC), or an accepted alternative photo ID if it hasn't arrived — see the full list here: {{4}}
>
> This is our last message before election day — we won't send anything further, though the site stays fully available if you need it.
>
> — Bengaluru Votes, an Oorvani Foundation initiative

### Email — Kannada

**Subject:** ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಮತ್ತು ಏನು ತರಬೇಕು
**Body:**
> **ನಿಮ್ಮ ಮತಗಟ್ಟೆ:** {{1}}
> **ಮತದಾನ ಸಮಯ:** {{2}} – {{3}}
> **ತನ್ನಿ:** ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ (EPIC), ಅಥವಾ ಅದು ಬಂದಿಲ್ಲದಿದ್ದರೆ ಅಂಗೀಕೃತ ಪರ್ಯಾಯ ಫೋಟೋ ಗುರುತಿನ ಚೀಟಿ — ಪೂರ್ಣ ಪಟ್ಟಿಯನ್ನು ಇಲ್ಲಿ ನೋಡಿ: {{4}}
>
> ಚುನಾವಣೆ ದಿನದ ಮೊದಲು ಇದು ನಮ್ಮ ಕೊನೆಯ ಸಂದೇಶ — ನಾವು ಇನ್ನೇನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಆದರೆ ನಿಮಗೆ ಅಗತ್ಯವಿದ್ದರೆ ಸೈಟ್ ಸಂಪೂರ್ಣವಾಗಿ ಲಭ್ಯವಿರುತ್ತದೆ.
>
> — Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ

---

## 11. Submission checklist

- [ ] Legal review of all 16 WhatsApp bodies + 16 email bodies (consent framing, no electioneering language, RPA §126 clean)
- [ ] Native Kannada speaker review of all 8 Kannada WhatsApp templates and 8 Kannada email templates
- [ ] Confirm proposed category per template with Twilio before Meta submission (§3.8 cost implications — Marketing is dearer and separately blockable)
- [ ] Submit the OTP templates as soon as `/privacy` is published — approval runs weeks. The seven send templates wait on the `docs/gtm-plan.md` §3.1 go/no-go
- [ ] Wire SendGrid email templates with the same 8×2 content, matched to the recipient's saved language preference (`docs/prd.md` §8)
- [ ] Verify every link variable resolves per-recipient (ward-scoped URLs), not to a generic page
- [ ] Confirm unsubscribe links in Marketing-category emails hit the one-click mechanism (`docs/project-dependencies.md` §3.16)
