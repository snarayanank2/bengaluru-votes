import { describe, it, expect } from 'vitest';
import { renderMessage, contentVariablesFor, renderEmailMarkdown } from '../../src/lib/send/render';

describe('src/lib/send/render.ts renderMessage', () => {
  describe('W1 (welcome)', () => {
    const vars = { ward: '57 - Jayanagar', language: 'English', notificationsLink: 'https://bengaluruvotes.opencity.in/account/notifications' };

    it('email EN: subject + body from docs/messages.md §4, with {{1}}=ward, {{2}}=language, {{3}}=notificationsLink interpolated', () => {
      const rendered = renderMessage('W1', 'en', 'email', vars);
      expect(rendered.subject).toBe("You're set up for 57 - Jayanagar ward updates");
      expect(rendered.body).toContain('- **Ward:** 57 - Jayanagar');
      expect(rendered.body).toContain('- **Language:** English');
      expect(rendered.body).toContain('https://bengaluruvotes.opencity.in/account/notifications');
      expect(rendered.body).not.toMatch(/\{\{\d\}\}/); // no leftover placeholders
      expect(rendered.templateSid).toBeUndefined();
    });

    it("whatsapp EN: templateSid 'bv_w1_welcome_en' + rendered body text", () => {
      const rendered = renderMessage('W1', 'en', 'whatsapp', vars);
      expect(rendered.templateSid).toBe('bv_w1_welcome_en');
      expect(rendered.body).toContain('Welcome to Bengaluru Votes!');
      expect(rendered.body).toContain('**57 - Jayanagar ward**');
      expect(rendered.body).toContain('English');
      expect(rendered.body).toContain('https://bengaluruvotes.opencity.in/account/notifications');
      expect(rendered.subject).toBeUndefined();
    });

    it('whatsapp KN: renders the verbatim Kannada copy from docs/messages.md, not a re-translation', () => {
      const rendered = renderMessage('W1', 'kn', 'whatsapp', vars);
      expect(rendered.templateSid).toBe('bv_w1_welcome_kn');
      expect(rendered.body).toContain('Bengaluru Votes ಗೆ ಸ್ವಾಗತ!');
      expect(rendered.body).toContain('**57 - Jayanagar ವಾರ್ಡ್**ಗೆ');
    });

    it('email KN: verbatim Kannada subject + body', () => {
      const rendered = renderMessage('W1', 'kn', 'email', vars);
      expect(rendered.subject).toBe('57 - Jayanagar ವಾರ್ಡ್ ಅಪ್ಡೇಟ್‌ಗಳಿಗಾಗಿ ನೀವು ಸಿದ್ಧರಾಗಿದ್ದೀರಿ');
      expect(rendered.body).toContain('- **ವಾರ್ಡ್:** 57 - Jayanagar');
    });

    it('a missing required var throws missing_var', () => {
      const { notificationsLink: _drop, ...incomplete } = vars;
      expect(() => renderMessage('W1', 'en', 'email', incomplete)).toThrow(/missing_var/);
      expect(() => renderMessage('W1', 'en', 'whatsapp', incomplete)).toThrow(/missing_var/);
    });
  });

  describe('OTP', () => {
    it('email EN: {{1}}=code in both subject and body', () => {
      const rendered = renderMessage('OTP', 'en', 'email', { code: '482913' });
      expect(rendered.subject).toBe('Your Bengaluru Votes verification code: `482913`');
      expect(rendered.body).toContain('**`482913`**');
      expect(rendered.templateSid).toBeUndefined();
    });

    it('whatsapp EN: {{1}}=code, templateSid bv_otp_login_en', () => {
      const rendered = renderMessage('OTP', 'en', 'whatsapp', { code: '482913' });
      expect(rendered.templateSid).toBe('bv_otp_login_en');
      expect(rendered.body).toContain('482913 is your verification code for Bengaluru Votes.');
    });

    it('whatsapp KN: {{1}}=code, verbatim Kannada text, templateSid bv_otp_login_kn', () => {
      const rendered = renderMessage('OTP', 'kn', 'whatsapp', { code: '111222' });
      expect(rendered.templateSid).toBe('bv_otp_login_kn');
      expect(rendered.body).toContain('111222 ಇದು Bengaluru Votes ಗಾಗಿ ನಿಮ್ಮ ಪರಿಶೀಲನಾ ಸಂಕೇತ.');
    });

    it('email KN: {{1}}=code in subject and body', () => {
      const rendered = renderMessage('OTP', 'kn', 'email', { code: '333444' });
      expect(rendered.subject).toBe('ನಿಮ್ಮ Bengaluru Votes ಪರಿಶೀಲನಾ ಸಂಕೇತ: `333444`');
      expect(rendered.body).toContain('**`333444`**');
    });

    it('missing code throws missing_var', () => {
      expect(() => renderMessage('OTP', 'en', 'email', {})).toThrow(/missing_var/);
    });
  });

  describe('F1 (booth logistics) — a 4-var whatsapp template, exercised for var-ordering correctness', () => {
    const vars = {
      booth: 'Govt School, 5th Cross',
      openTime: '7:00 AM',
      closeTime: '6:00 PM',
      boothGuideLink: 'https://bengaluruvotes.opencity.in/voting-guide/find-booth',
    };

    it('whatsapp EN body interpolates all four vars in order', () => {
      const rendered = renderMessage('F1', 'en', 'whatsapp', vars);
      expect(rendered.templateSid).toBe('bv_f1_booth_logistics_en');
      expect(rendered.body).toBe(
        'Election day is close. Your booth: **Govt School, 5th Cross**. Polls open 7:00 AM–6:00 PM. ' +
          'Carry your voter ID (EPIC) or an accepted alternative photo ID. Full details: https://bengaluruvotes.opencity.in/voting-guide/find-booth',
      );
    });

    it('contentVariablesFor returns Twilio-shaped numbered ContentVariables matching the template var order', () => {
      const contentVars = contentVariablesFor('F1', 'en', vars);
      expect(contentVars).toEqual({
        '1': 'Govt School, 5th Cross',
        '2': '7:00 AM',
        '3': '6:00 PM',
        '4': 'https://bengaluruvotes.opencity.in/voting-guide/find-booth',
      });
    });

    it('contentVariablesFor throws missing_var when a required var is absent', () => {
      const { boothGuideLink: _drop, ...incomplete } = vars;
      expect(() => contentVariablesFor('F1', 'en', incomplete)).toThrow(/missing_var/);
    });
  });

  describe('unknown code/lang', () => {
    it('throws unknown_template rather than silently returning undefined', () => {
      // @ts-expect-error deliberately invalid code for the error-path test
      expect(() => renderMessage('NOPE', 'en', 'email', {})).toThrow(/unknown_template/);
    });
  });

  describe('renderEmailMarkdown', () => {
    it('converts an email body Markdown -> HTML: **bold** -> <strong>, "- bullets" -> <ul><li>, [text](url) -> <a href>', () => {
      const rendered = renderMessage('R1', 'en', 'email', {
        deadline: '31 August',
        checkRegistrationLink: 'https://bengaluruvotes.opencity.in/check-registration',
        guideLink: 'https://bengaluruvotes.opencity.in/voting-guide/register',
      });

      const html = renderEmailMarkdown(rendered.body);

      expect(html).toContain('<strong>31 August</strong>');
      expect(html).toContain('<a href="https://bengaluruvotes.opencity.in/check-registration">Check your registration</a>');
      expect(html).not.toContain('**');
      expect(html).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
    });

    it('a body with "- " bullet lines renders a real <ul>/<li> list', () => {
      const rendered = renderMessage('W1', 'en', 'email', {
        ward: '57 - Jayanagar',
        language: 'English',
        notificationsLink: 'https://bengaluruvotes.opencity.in/account/notifications',
      });

      const html = renderEmailMarkdown(rendered.body);

      expect(html).toContain('<ul>');
      expect(html).toContain('<li><strong>Ward:</strong> 57 - Jayanagar</li>');
    });
  });
});
