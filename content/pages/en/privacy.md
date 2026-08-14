---
title: Privacy policy
description: What personal data this platform collects, why, who processes it, and your rights over it under the DPDP Act, 2023.
---

<!-- LEGAL REVIEW REQUIRED -->

*This page is a working draft of the privacy policy for this platform, structured around the sections the product specification requires (PRD §5.16). It has not been reviewed by a lawyer and must not be treated as final or binding until it has been. In particular, the retention period below is a product proposal pending legal confirmation — see the note in that section — and this page cannot ship in its current form until that confirmation lands.*

## Who operates this platform?

This platform is operated by the **Oorvani Foundation**.

## What personal data do we collect, and why?

- **Email address and/or phone number** — to send a one-time password (OTP) for sign-in, and, if you consent, ward election updates and critical product notices.
- **Address, converted to your ward** — so we can show you the right ward and, if you register, send you updates relevant to your ward.
- **Your device's location, only if you ask us to use it** — the "use my current location" button on the ward finder sends your coordinates to us once, so we can work out which ward you are standing in. We use them for that answer and then discard them: they are never stored, never written to our logs, and never sent to any other company. Your browser asks your permission first, and typing your address instead works just as well.
- **Language preference** — so we show you the site, and send notifications, in the language you chose.
- **`src` attribution** — if you arrived via a partner's tagged link, we record which partner sent you, for measurement only. This grants no permissions and doesn't change anything you see.
- **Standard server logs** — the ordinary technical logs any web server keeps (IP address, request timestamps, and similar), kept for security and operational purposes.
- **Google Analytics usage data and cookies** — see below.

## How do we measure site usage?

We use **Google Analytics** to understand how visitors use this platform, alongside our own server-side application events. Google Analytics sets cookies and collects usage data (pages visited, general location, device type) as described in Google's own privacy policy.

## reCAPTCHA on the partner-with-us form

The [partner with us](/partner-with-us) expression-of-interest form is protected by **Google reCAPTCHA v3**, which sets its own cookies and sends usage data to Google, to keep that anonymous, no-account form safe from automated abuse. No other form on this platform uses reCAPTCHA.

## Who else processes your data?

We share personal data only with the service providers that operate this platform, strictly under contract, on our behalf, and never for their own purposes. This is the complete list:

- **SendGrid and Twilio** — receive your contact details (email and/or phone number) to deliver the OTPs and updates you've consented to. If you choose WhatsApp as your delivery channel, your number is additionally handled under **Meta's** WhatsApp Business terms, since WhatsApp messages are delivered through Meta's platform.
- **Google Geocoding** — receives the address you enter to look up your ward, sent server-side. We cache only the normalized address-to-ward result, never linked back to your account or identity.
- **Anthropic** — processes candidate report-card text (for translation between English and Kannada, and for extracting structured data from affidavits). This is candidate data drawn from public records, not your personal contact details.
- **Sentry** — receives server-side error reports if something goes wrong, scrubbed of contact details and addresses before being sent.

Each of these providers operates under executed data-processing terms with the Oorvani Foundation.

## Do you sell or share my data?

No. We do not sell citizen data, and we do not share it with anyone except the service providers listed above, who process it strictly on our behalf under contract. Your contact details are used for **two purposes only**:

1. **Ward election updates** — for your registered home ward, if you've opted in.
2. **Critical product updates** — narrowly meaning service-affecting notices, such as a security incident, a material change to these terms, or the platform shutting down. This is **not** a channel for announcing new features, and we don't use it that way.

<!-- If a future "civic tools beyond this election" feature is ever built, using these contacts to promote it needs its own, freshly collected consent — not this clause. See the optional "future civic tools" checkbox at registration, where that separate consent is collected. -->

## Consent and withdrawal

Signing up for ward updates by email or WhatsApp is opt-in. You can withdraw consent for these updates at any time from your account notification settings, or by following the unsubscribe/opt-out instructions included in each message. Withdrawing consent doesn't affect your ability to use the platform's public, read-only features.

## Your rights under the DPDP Act, 2023

As a data principal under India's Digital Personal Data Protection Act, 2023, you have the right to:

- Know what personal data of yours we hold and how it's processed.
- Correct or update inaccurate or incomplete personal data.
- **Request erasure** of your personal data, subject to any legal retention requirements.
- Withdraw consent for optional processing (such as ward update notifications) at any time.
- Nominate another individual to exercise these rights on your behalf in the event of your death or incapacity, as provided under the Act.

**A note on backups:** when you request erasure, we remove your personal data from the live system. However, encrypted nightly backups already taken before your request will still contain that data until those backups age out and are rotated out under our retention schedule — erasure is not instantaneous across every backup copy.

## Grievance officer

<!-- INPUT NEEDED: named grievance officer and contact details, as required under the DPDP Act, 2023. -->

## How long do you keep my data?

Our proposal — pending confirmation by legal counsel — is that citizen contact data (email, phone, address-derived ward, and related account data) is deleted or anonymized **within 3 months of the election results being declared**, with encrypted backups aging out on rotation.

**This retention period is a product proposal, not yet legally confirmed**, and this page will state the exact, confirmed period once that legal review is complete. Until then, treat any specific number you may see elsewhere as provisional.

## Issue votes

Votes cast on ward issues are published only in **aggregate** — a ranked order with percentage shares for the ward — never as an individually identifiable vote tied to your name or account.

## Language of this policy

This policy is published in both English and Kannada. **The English version is legally controlling.** The Kannada version is a courtesy translation provided for accessibility.

<!-- LEGAL REVIEW REQUIRED: exact wording of the Kannada courtesy-translation note, to be confirmed by counsel. -->

## Changes to this policy

We may update this policy from time to time, particularly once the retention period above is legally confirmed. Material changes will be reflected with an updated date on this page.

## Contact us

<!-- INPUT NEEDED: contact details for privacy questions or DPDP rights requests, distinct from or alongside the grievance officer contact above. -->
