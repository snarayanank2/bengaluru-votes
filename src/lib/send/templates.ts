/**
 * The exact copy source for every outbound message the platform sends —
 * OTP + the 7 campaign codes (W1, R1, L1, C1, C2, C3, F1), each in both
 * channels (WhatsApp, Email) and both languages (English, Kannada).
 *
 * COPY PROVENANCE: every string below is copied VERBATIM from
 * `docs/messages.md` (the template-approval submission packet — see that
 * file's §1 "Before submitting"). The Kannada text is machine-assisted and
 * explicitly NOT re-translated here — `docs/messages.md` §1 flags it as
 * needing a native-speaker + legal pass before Meta submission; this module
 * just carries whatever text that document currently holds. Do NOT hand-edit
 * the KN strings independently of that doc — update messages.md first, then
 * mirror the change here.
 *
 * Markdown blockquote markers (`>`) in messages.md are documentation
 * formatting only, not message content, and are stripped here. Paragraph
 * breaks are preserved as `\n\n`.
 *
 * NUMBERED-PLACEHOLDER MAPPING: `docs/messages.md` uses Meta's `{{1}}`,
 * `{{2}}`, … convention. Each template's `vars` array gives the NAMED var
 * that fills each position in order — `vars[0]` fills every `{{1}}` in that
 * template, `vars[1]` fills every `{{2}}`, etc. The WhatsApp and Email
 * versions of the SAME code can have different var counts/order (Email
 * bodies often carry extra footer links — notification-prefs, unsubscribe —
 * that the WhatsApp body doesn't), so `vars` is tracked per channel, not per
 * code.
 *
 * WhatsApp Meta template components (Footer, Button) that are not
 * templated free text — e.g. OTP's "Copy Code" button — are not modeled as
 * separate fields; where a footer carries actual copy (OTP's expiry line)
 * it is folded into `bodyTemplate` as a second sentence, since this module's
 * `body` field stands in for "the whole rendered message text" for
 * logging/dev purposes (real production sends go through the approved
 * Twilio Content template referenced by `templateName`, which owns its own
 * component layout).
 */
import type { Lang } from '../../i18n';

export type SendCode = 'W1' | 'R1' | 'L1' | 'C1' | 'C2' | 'C3' | 'F1';
export type TemplateCode = SendCode | 'OTP';
export type TemplateChannel = 'email' | 'whatsapp';

export interface EmailTemplate {
  subjectTemplate: string;
  bodyTemplate: string;
  /** Named vars, in order of {{1}}, {{2}}, … for the EMAIL body/subject. */
  vars: string[];
}

export interface WhatsAppTemplate {
  /** The approved template name, `bv_{code}_{name}_{lang}` (Task's Twilio Content template lookup key for now). */
  templateName: string;
  bodyTemplate: string;
  /** Named vars, in order of {{1}}, {{2}}, … for the WHATSAPP body. */
  vars: string[];
}

export interface TemplateEntry {
  email: EmailTemplate;
  whatsapp: WhatsAppTemplate;
}

export const templates: Record<TemplateCode, Record<Lang, TemplateEntry>> = {
  OTP: {
    en: {
      whatsapp: {
        templateName: 'bv_otp_login_en',
        bodyTemplate:
          '{{1}} is your verification code for Bengaluru Votes. This code expires in 10 minutes.',
        vars: ['code'],
      },
      email: {
        subjectTemplate: 'Your Bengaluru Votes verification code: `{{1}}`',
        bodyTemplate:
          'Your verification code is **`{{1}}`**.\n\n' +
          "This code expires in 10 minutes. If you didn't request this, you can safely ignore this email — nobody can access your account without it.\n\n" +
          '— Bengaluru Votes, an Oorvani Foundation initiative',
        vars: ['code'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_otp_login_kn',
        bodyTemplate:
          '{{1}} ಇದು Bengaluru Votes ಗಾಗಿ ನಿಮ್ಮ ಪರಿಶೀಲನಾ ಸಂಕೇತ. ಈ ಸಂಕೇತ 10 ನಿಮಿಷಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ.',
        vars: ['code'],
      },
      email: {
        subjectTemplate: 'ನಿಮ್ಮ Bengaluru Votes ಪರಿಶೀಲನಾ ಸಂಕೇತ: `{{1}}`',
        bodyTemplate:
          'ನಿಮ್ಮ ಪರಿಶೀಲನಾ ಸಂಕೇತ **`{{1}}`**.\n\n' +
          'ಈ ಸಂಕೇತ 10 ನಿಮಿಷಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ. ನೀವು ಇದನ್ನು ಕೋರದಿದ್ದರೆ, ಈ ಇಮೇಲ್ ಅನ್ನು ನಿರ್ಲಕ್ಷಿಸಬಹುದು — ಈ ಸಂಕೇತವಿಲ್ಲದೆ ಯಾರೂ ನಿಮ್ಮ ಖಾತೆಯನ್ನು ಪ್ರವೇಶಿಸಲಾಗುವುದಿಲ್ಲ.\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ',
        vars: ['code'],
      },
    },
  },

  W1: {
    en: {
      whatsapp: {
        templateName: 'bv_w1_welcome_en',
        bodyTemplate:
          "Welcome to Bengaluru Votes! You're registered for **{{1}} ward**, updates in {{2}}. " +
          "We'll only message you about: the electoral roll deadline, when candidates file, voting on ward issues, and your polling booth — nothing else. Manage anytime: {{3}}",
        vars: ['ward', 'language', 'notificationsLink'],
      },
      email: {
        subjectTemplate: "You're set up for {{1}} ward updates",
        bodyTemplate:
          'Thanks for registering with Bengaluru Votes.\n\n' +
          '- **Ward:** {{1}}\n' +
          '- **Language:** {{2}}\n\n' +
          "Here's exactly what we'll send you, and nothing more: the electoral roll deadline, when candidates file nominations in your ward, a chance to vote on your ward's top local issues, and your polling booth details closer to election day.\n\n" +
          'You can change your ward, language, or channels anytime at {{3}}.\n\n' +
          '— Bengaluru Votes, an Oorvani Foundation initiative',
        vars: ['ward', 'language', 'notificationsLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_w1_welcome_kn',
        bodyTemplate:
          'Bengaluru Votes ಗೆ ಸ್ವಾಗತ! ನೀವು **{{1}} ವಾರ್ಡ್**ಗೆ ನೋಂದಣಿಯಾಗಿದ್ದೀರಿ, ಅಪ್ಡೇಟ್‌ಗಳು {{2}} ಭಾಷೆಯಲ್ಲಿ. ' +
          'ನಾವು ನಿಮಗೆ ಇವುಗಳ ಬಗ್ಗೆ ಮಾತ್ರ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇವೆ: ಮತದಾರರ ಪಟ್ಟಿ ಗಡುವು, ಅಭ್ಯರ್ಥಿಗಳ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ, ವಾರ್ಡ್ ಸಮಸ್ಯೆಗಳ ಮತದಾನ, ಮತ್ತು ನಿಮ್ಮ ಮತಗಟ್ಟೆ ವಿವರ — ಇವಿಷ್ಟೇ. ಯಾವಾಗ ಬೇಕಾದರೂ ಬದಲಿಸಿ: {{3}}',
        vars: ['ward', 'language', 'notificationsLink'],
      },
      email: {
        subjectTemplate: '{{1}} ವಾರ್ಡ್ ಅಪ್ಡೇಟ್‌ಗಳಿಗಾಗಿ ನೀವು ಸಿದ್ಧರಾಗಿದ್ದೀರಿ',
        bodyTemplate:
          'Bengaluru Votes ನಲ್ಲಿ ನೋಂದಾಯಿಸಿಕೊಂಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.\n\n' +
          '- **ವಾರ್ಡ್:** {{1}}\n' +
          '- **ಭಾಷೆ:** {{2}}\n\n' +
          'ನಾವು ನಿಮಗೆ ಕಳುಹಿಸುವುದು ಇಷ್ಟೇ, ಇನ್ನೇನೂ ಅಲ್ಲ: ಮತದಾರರ ಪಟ್ಟಿ ಗಡುವು, ನಿಮ್ಮ ವಾರ್ಡ್‌ನಲ್ಲಿ ಅಭ್ಯರ್ಥಿಗಳ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ, ನಿಮ್ಮ ವಾರ್ಡ್‌ನ ಪ್ರಮುಖ ಸ್ಥಳೀಯ ಸಮಸ್ಯೆಗಳ ಮೇಲೆ ಮತ ಚಲಾಯಿಸುವ ಅವಕಾಶ, ಮತ್ತು ಚುನಾವಣೆ ಸಮೀಪಿಸುತ್ತಿದ್ದಂತೆ ನಿಮ್ಮ ಮತಗಟ್ಟೆ ವಿವರಗಳು.\n\n' +
          'ನಿಮ್ಮ ವಾರ್ಡ್, ಭಾಷೆ ಅಥವಾ ಚಾನೆಲ್‌ಗಳನ್ನು ಯಾವಾಗ ಬೇಕಾದರೂ {{3}} ನಲ್ಲಿ ಬದಲಾಯಿಸಬಹುದು.\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ',
        vars: ['ward', 'language', 'notificationsLink'],
      },
    },
  },

  R1: {
    en: {
      whatsapp: {
        templateName: 'bv_r1_roll_deadline_en',
        bodyTemplate:
          '⏰ The electoral roll for GBA ward elections closes on **{{1}}**. If your name isn\'t on it, you cannot vote — no exceptions. Check your registration now: {{2}}',
        vars: ['deadline', 'checkRegistrationLink'],
      },
      email: {
        subjectTemplate: '7 days left to join the electoral roll',
        bodyTemplate:
          'The electoral roll for the GBA ward elections closes on **{{1}}**.\n\n' +
          "If you're not on the roll by then, no amount of candidate information helps — you simply can't vote. It takes two minutes to check.\n\n" +
          '**[Check your registration]({{2}})**\n\n' +
          "If you're not yet enrolled, or you've moved since you last voted, see our step-by-step guide: {{3}}\n\n" +
          '— Bengaluru Votes, an Oorvani Foundation initiative',
        vars: ['deadline', 'checkRegistrationLink', 'guideLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_r1_roll_deadline_kn',
        bodyTemplate:
          '⏰ GBA ವಾರ್ಡ್ ಚುನಾವಣೆಗಳ ಮತದಾರರ ಪಟ್ಟಿ **{{1}}** ರಂದು ಮುಚ್ಚುತ್ತದೆ. ನಿಮ್ಮ ಹೆಸರು ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದಿದ್ದರೆ, ನೀವು ಮತ ಚಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ — ಯಾವುದೇ ವಿನಾಯಿತಿ ಇಲ್ಲ. ಈಗಲೇ ನಿಮ್ಮ ನೋಂದಣಿ ಪರಿಶೀಲಿಸಿ: {{2}}',
        vars: ['deadline', 'checkRegistrationLink'],
      },
      email: {
        subjectTemplate: 'ಮತದಾರರ ಪಟ್ಟಿಗೆ ಸೇರಲು 7 ದಿನಗಳು ಬಾಕಿ',
        bodyTemplate:
          'GBA ವಾರ್ಡ್ ಚುನಾವಣೆಗಳ ಮತದಾರರ ಪಟ್ಟಿ **{{1}}** ರಂದು ಮುಚ್ಚುತ್ತದೆ.\n\n' +
          'ಅಷ್ಟರೊಳಗೆ ನೀವು ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದಿದ್ದರೆ, ಎಷ್ಟೇ ಅಭ್ಯರ್ಥಿ ಮಾಹಿತಿ ಇದ್ದರೂ ಪ್ರಯೋಜನವಿಲ್ಲ — ನೀವು ಮತ ಚಲಾಯಿಸಲು ಸಾಧ್ಯವಾಗುವುದಿಲ್ಲ. ಪರಿಶೀಲಿಸಲು ಎರಡು ನಿಮಿಷ ಸಾಕು.\n\n' +
          '**[ನಿಮ್ಮ ನೋಂದಣಿ ಪರಿಶೀಲಿಸಿ]({{2}})**\n\n' +
          'ನೀವು ಇನ್ನೂ ನೋಂದಾಯಿಸಿಲ್ಲದಿದ್ದರೆ, ಅಥವಾ ಕೊನೆಯ ಬಾರಿ ಮತ ಚಲಾಯಿಸಿದಾಗಿನಿಂದ ಸ್ಥಳಾಂತರಗೊಂಡಿದ್ದರೆ, ನಮ್ಮ ಹಂತ-ಹಂತದ ಮಾರ್ಗದರ್ಶಿ ನೋಡಿ: {{3}}\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ',
        vars: ['deadline', 'checkRegistrationLink', 'guideLink'],
      },
    },
  },

  L1: {
    en: {
      whatsapp: {
        templateName: 'bv_l1_candidates_filed_en',
        bodyTemplate:
          "Nominations have closed in **{{1}} ward** — {{2}} candidates have filed so far (the list may still change after withdrawals). See who's standing: {{3}}\n\n" +
          'Reply STOP to opt out.',
        vars: ['ward', 'candidateCount', 'candidatesLink'],
      },
      email: {
        subjectTemplate: 'Candidates have filed in {{1}} ward',
        bodyTemplate:
          'Nominations closed in **{{1}} ward** with **{{2}} candidates** filing so far. This list is provisional — some candidates may still withdraw before the final list is confirmed.\n\n' +
          "**[See who's standing]({{3}})**\n\n" +
          '— Bengaluru Votes, an Oorvani Foundation initiative\n\n' +
          '*[Manage your notification preferences]({{4}}) · [Unsubscribe]({{5}})*',
        vars: ['ward', 'candidateCount', 'candidatesLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_l1_candidates_filed_kn',
        bodyTemplate:
          '**{{1}} ವಾರ್ಡ್**ನಲ್ಲಿ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ ಮುಗಿದಿದೆ — ಇಲ್ಲಿಯವರೆಗೆ {{2}} ಅಭ್ಯರ್ಥಿಗಳು ನಾಮಪತ್ರ ಸಲ್ಲಿಸಿದ್ದಾರೆ (ಹಿಂಪಡೆಯುವಿಕೆಗಳ ನಂತರ ಪಟ್ಟಿ ಬದಲಾಗಬಹುದು). ಯಾರು ಸ್ಪರ್ಧಿಸುತ್ತಿದ್ದಾರೆ ನೋಡಿ: {{3}}\n\n' +
          'ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.',
        vars: ['ward', 'candidateCount', 'candidatesLink'],
      },
      email: {
        subjectTemplate: '{{1}} ವಾರ್ಡ್‌ನಲ್ಲಿ ಅಭ್ಯರ್ಥಿಗಳು ನಾಮಪತ್ರ ಸಲ್ಲಿಸಿದ್ದಾರೆ',
        bodyTemplate:
          '**{{1}} ವಾರ್ಡ್**ನಲ್ಲಿ ನಾಮಪತ್ರ ಸಲ್ಲಿಕೆ ಮುಗಿದಿದ್ದು, ಇಲ್ಲಿಯವರೆಗೆ **{{2}} ಅಭ್ಯರ್ಥಿಗಳು** ಸಲ್ಲಿಸಿದ್ದಾರೆ. ಈ ಪಟ್ಟಿ ತಾತ್ಕಾಲಿಕವಾಗಿದ್ದು, ಅಂತಿಮ ಪಟ್ಟಿ ಖಚಿತಗೊಳ್ಳುವ ಮೊದಲು ಕೆಲವು ಅಭ್ಯರ್ಥಿಗಳು ಹಿಂಪಡೆಯಬಹುದು.\n\n' +
          '**[ಯಾರು ಸ್ಪರ್ಧಿಸುತ್ತಿದ್ದಾರೆ ನೋಡಿ]({{3}})**\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ\n\n' +
          '*[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{4}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{5}})*',
        vars: ['ward', 'candidateCount', 'candidatesLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
  },

  C1: {
    en: {
      whatsapp: {
        templateName: 'bv_c1_issue_vote_en',
        bodyTemplate:
          'What matters most in **{{1}} ward** — roads, water, waste, safety? Vote for your top 3 local issues and make your voice count: {{2}}\n\n' +
          'Reply STOP to opt out.',
        vars: ['ward', 'issuesLink'],
      },
      email: {
        subjectTemplate: "Vote for {{1}} ward's top 3 issues",
        bodyTemplate:
          'Roads, water, waste, safety — what should your corporator prioritise? ' +
          "Your ward's curator has put together the local issues that matter, and your top-3 vote adds to a public, ward-by-ward signal.\n\n" +
          '**[Vote now]({{2}})**\n\n' +
          '— Bengaluru Votes, an Oorvani Foundation initiative\n\n' +
          '*[Manage your notification preferences]({{3}}) · [Unsubscribe]({{4}})*',
        vars: ['ward', 'issuesLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_c1_issue_vote_kn',
        bodyTemplate:
          '**{{1}} ವಾರ್ಡ್**ನಲ್ಲಿ ಏನು ಮುಖ್ಯ — ರಸ್ತೆಗಳು, ನೀರು, ತ್ಯಾಜ್ಯ, ಸುರಕ್ಷತೆ? ನಿಮ್ಮ ಟಾಪ್ 3 ಸ್ಥಳೀಯ ಸಮಸ್ಯೆಗಳಿಗೆ ಮತ ಹಾಕಿ ಮತ್ತು ನಿಮ್ಮ ಧ್ವನಿ ಎಣಿಕೆಗೆ ಬರಲಿ: {{2}}\n\n' +
          'ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.',
        vars: ['ward', 'issuesLink'],
      },
      email: {
        subjectTemplate: '{{1}} ವಾರ್ಡ್‌ನ ಟಾಪ್ 3 ಸಮಸ್ಯೆಗಳಿಗೆ ಮತ ಹಾಕಿ',
        bodyTemplate:
          'ರಸ್ತೆಗಳು, ನೀರು, ತ್ಯಾಜ್ಯ, ಸುರಕ್ಷತೆ — ನಿಮ್ಮ ಕಾರ್ಪೊರೇಟರ್ ಯಾವುದಕ್ಕೆ ಆದ್ಯತೆ ನೀಡಬೇಕು? ' +
          'ನಿಮ್ಮ ವಾರ್ಡ್‌ನ ಕ್ಯುರೇಟರ್ ಮುಖ್ಯವಾದ ಸ್ಥಳೀಯ ಸಮಸ್ಯೆಗಳ ಪಟ್ಟಿ ಸಿದ್ಧಪಡಿಸಿದ್ದಾರೆ, ಮತ್ತು ನಿಮ್ಮ ಟಾಪ್-3 ಮತ ಸಾರ್ವಜನಿಕ, ವಾರ್ಡ್‌ವಾರು ಸಂಕೇತಕ್ಕೆ ಸೇರುತ್ತದೆ.\n\n' +
          '**[ಈಗಲೇ ಮತ ಹಾಕಿ]({{2}})**\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ\n\n' +
          '*[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{3}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{4}})*',
        vars: ['ward', 'issuesLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
  },

  C2: {
    en: {
      whatsapp: {
        templateName: 'bv_c2_final_candidates_en',
        bodyTemplate:
          'The final candidate list for **{{1}} ward** is out, and report cards are complete — track record, assets, cases, and more, all sourced. Read before you vote: {{2}}\n\n' +
          'Reply STOP to opt out.',
        vars: ['ward', 'candidatesLink'],
      },
      email: {
        subjectTemplate: "{{1}} ward's final candidate list is ready",
        bodyTemplate:
          'The candidate list for **{{1}} ward** is now final, and every report card is complete — name and party, track record, criminal cases, declared assets, education, and news coverage, each with its source shown.\n\n' +
          '**[Read the report cards]({{2}})** · **[Compare candidates side by side]({{3}})**\n\n' +
          '— Bengaluru Votes, an Oorvani Foundation initiative\n\n' +
          '*[Manage your notification preferences]({{4}}) · [Unsubscribe]({{5}})*',
        vars: ['ward', 'reportCardsLink', 'compareLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_c2_final_candidates_kn',
        bodyTemplate:
          '**{{1}} ವಾರ್ಡ್**ನ ಅಂತಿಮ ಅಭ್ಯರ್ಥಿಗಳ ಪಟ್ಟಿ ಪ್ರಕಟವಾಗಿದೆ, ಮತ್ತು ರಿಪೋರ್ಟ್ ಕಾರ್ಡ್‌ಗಳು ಪೂರ್ಣಗೊಂಡಿವೆ — ಹಿಂದಿನ ಕಾರ್ಯಸಾಧನೆ, ಆಸ್ತಿ, ಪ್ರಕರಣಗಳು, ಎಲ್ಲವೂ ಮೂಲಸಹಿತ. ಮತ ಹಾಕುವ ಮೊದಲು ಓದಿ: {{2}}\n\n' +
          'ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.',
        vars: ['ward', 'candidatesLink'],
      },
      email: {
        subjectTemplate: '{{1}} ವಾರ್ಡ್‌ನ ಅಂತಿಮ ಅಭ್ಯರ್ಥಿಗಳ ಪಟ್ಟಿ ಸಿದ್ಧವಾಗಿದೆ',
        bodyTemplate:
          '**{{1}} ವಾರ್ಡ್**ನ ಅಭ್ಯರ್ಥಿಗಳ ಪಟ್ಟಿ ಈಗ ಅಂತಿಮಗೊಂಡಿದ್ದು, ಪ್ರತಿ ರಿಪೋರ್ಟ್ ಕಾರ್ಡ್ ಪೂರ್ಣಗೊಂಡಿದೆ — ಹೆಸರು ಮತ್ತು ಪಕ್ಷ, ಹಿಂದಿನ ಕಾರ್ಯಸಾಧನೆ, ಕ್ರಿಮಿನಲ್ ಪ್ರಕರಣಗಳು, ಘೋಷಿತ ಆಸ್ತಿ, ವಿದ್ಯಾರ್ಹತೆ, ಮತ್ತು ಸುದ್ದಿ ವರದಿಗಳು, ಪ್ರತಿಯೊಂದಕ್ಕೂ ಮೂಲ ಸಹಿತ.\n\n' +
          '**[ರಿಪೋರ್ಟ್ ಕಾರ್ಡ್‌ಗಳನ್ನು ಓದಿ]({{2}})** · **[ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹೋಲಿಸಿ]({{3}})**\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ\n\n' +
          '*[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{4}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{5}})*',
        vars: ['ward', 'reportCardsLink', 'compareLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
  },

  C3: {
    en: {
      whatsapp: {
        templateName: 'bv_c3_compare_booth_en',
        bodyTemplate:
          'One week to go. See what **{{1}} ward** voted as its top issues, compare candidates side by side, and find your polling booth: {{2}}\n\n' +
          'Reply STOP to opt out.',
        vars: ['ward', 'compareLink'],
      },
      email: {
        subjectTemplate: "One week out: {{1}} ward's top issues, candidates, and your booth",
        bodyTemplate:
          "**[See {{1}} ward's top voted issues]({{2}})**\n\n" +
          '**[Compare all candidates side by side]({{3}})**\n\n' +
          '**[Find your polling booth]({{4}})**\n\n' +
          "This is the last candidate update you'll get from us — the next message, closer to election day, will be logistics only.\n\n" +
          '— Bengaluru Votes, an Oorvani Foundation initiative\n\n' +
          '*[Manage your notification preferences]({{5}}) · [Unsubscribe]({{6}})*',
        vars: ['ward', 'issuesLink', 'compareLink', 'boothLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_c3_compare_booth_kn',
        bodyTemplate:
          'ಇನ್ನೊಂದು ವಾರ ಬಾಕಿ. **{{1}} ವಾರ್ಡ್** ಟಾಪ್ ಸಮಸ್ಯೆಗಳೆಂದು ಮತ ಹಾಕಿದ್ದನ್ನು ನೋಡಿ, ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹೋಲಿಸಿ, ಮತ್ತು ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಪತ್ತೆಹಚ್ಚಿ: {{2}}\n\n' +
          'ನಿರ್ಗಮಿಸಲು STOP ಎಂದು ಉತ್ತರಿಸಿ.',
        vars: ['ward', 'compareLink'],
      },
      email: {
        subjectTemplate: 'ಇನ್ನೊಂದು ವಾರ ಬಾಕಿ: {{1}} ವಾರ್ಡ್‌ನ ಟಾಪ್ ಸಮಸ್ಯೆಗಳು, ಅಭ್ಯರ್ಥಿಗಳು, ಮತ್ತು ನಿಮ್ಮ ಮತಗಟ್ಟೆ',
        bodyTemplate:
          '**[{{1}} ವಾರ್ಡ್‌ನ ಟಾಪ್ ಮತ ಪಡೆದ ಸಮಸ್ಯೆಗಳನ್ನು ನೋಡಿ]({{2}})**\n\n' +
          '**[ಎಲ್ಲಾ ಅಭ್ಯರ್ಥಿಗಳನ್ನು ಹೋಲಿಸಿ]({{3}})**\n\n' +
          '**[ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಪತ್ತೆಹಚ್ಚಿ]({{4}})**\n\n' +
          'ಇದು ನಮ್ಮಿಂದ ನೀವು ಪಡೆಯುವ ಕೊನೆಯ ಅಭ್ಯರ್ಥಿ ಅಪ್ಡೇಟ್ — ಚುನಾವಣೆ ಸಮೀಪಿಸುತ್ತಿದ್ದಂತೆ ಬರುವ ಮುಂದಿನ ಸಂದೇಶ ಕೇವಲ ಲಾಜಿಸ್ಟಿಕ್ಸ್ ಬಗ್ಗೆ ಮಾತ್ರ ಇರುತ್ತದೆ.\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ\n\n' +
          '*[ನಿಮ್ಮ ಅಧಿಸೂಚನೆ ಆದ್ಯತೆಗಳನ್ನು ನಿರ್ವಹಿಸಿ]({{5}}) · [ಚಂದಾ ರದ್ದುಗೊಳಿಸಿ]({{6}})*',
        vars: ['ward', 'issuesLink', 'compareLink', 'boothLink', 'notificationsLink', 'unsubscribeLink'],
      },
    },
  },

  F1: {
    en: {
      whatsapp: {
        templateName: 'bv_f1_booth_logistics_en',
        bodyTemplate:
          'Election day is close. Your booth: **{{1}}**. Polls open {{2}}–{{3}}. Carry your voter ID (EPIC) or an accepted alternative photo ID. Full details: {{4}}',
        vars: ['booth', 'openTime', 'closeTime', 'boothGuideLink'],
      },
      email: {
        subjectTemplate: 'Your polling booth and what to carry',
        bodyTemplate:
          '**Your booth:** {{1}}\n' +
          '**Polling hours:** {{2}} – {{3}}\n' +
          "**Carry:** your voter ID (EPIC), or an accepted alternative photo ID if it hasn't arrived — see the full list here: {{4}}\n\n" +
          "This is our last message before election day — we won't send anything further, though the site stays fully available if you need it.\n\n" +
          '— Bengaluru Votes, an Oorvani Foundation initiative',
        vars: ['booth', 'openTime', 'closeTime', 'boothGuideLink'],
      },
    },
    kn: {
      whatsapp: {
        templateName: 'bv_f1_booth_logistics_kn',
        bodyTemplate:
          'ಚುನಾವಣೆ ದಿನ ಸಮೀಪಿಸಿದೆ. ನಿಮ್ಮ ಮತಗಟ್ಟೆ: **{{1}}**. ಮತದಾನ {{2}}–{{3}} ಸಮಯದಲ್ಲಿ. ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ (EPIC) ಅಥವಾ ಅಂಗೀಕೃತ ಪರ್ಯಾಯ ಫೋಟೋ ಗುರುತಿನ ಚೀಟಿ ತನ್ನಿ. ಪೂರ್ಣ ವಿವರಗಳು: {{4}}',
        vars: ['booth', 'openTime', 'closeTime', 'boothGuideLink'],
      },
      email: {
        subjectTemplate: 'ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಮತ್ತು ಏನು ತರಬೇಕು',
        bodyTemplate:
          '**ನಿಮ್ಮ ಮತಗಟ್ಟೆ:** {{1}}\n' +
          '**ಮತದಾನ ಸಮಯ:** {{2}} – {{3}}\n' +
          '**ತನ್ನಿ:** ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ (EPIC), ಅಥವಾ ಅದು ಬಂದಿಲ್ಲದಿದ್ದರೆ ಅಂಗೀಕೃತ ಪರ್ಯಾಯ ಫೋಟೋ ಗುರುತಿನ ಚೀಟಿ — ಪೂರ್ಣ ಪಟ್ಟಿಯನ್ನು ಇಲ್ಲಿ ನೋಡಿ: {{4}}\n\n' +
          'ಚುನಾವಣೆ ದಿನದ ಮೊದಲು ಇದು ನಮ್ಮ ಕೊನೆಯ ಸಂದೇಶ — ನಾವು ಇನ್ನೇನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಆದರೆ ನಿಮಗೆ ಅಗತ್ಯವಿದ್ದರೆ ಸೈಟ್ ಸಂಪೂರ್ಣವಾಗಿ ಲಭ್ಯವಿರುತ್ತದೆ.\n\n' +
          '— Bengaluru Votes, ಒಂದು Oorvani Foundation ಉಪಕ್ರಮ',
        vars: ['booth', 'openTime', 'closeTime', 'boothGuideLink'],
      },
    },
  },
};
