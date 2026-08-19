import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';

/**
 * Task 21 — the six guide/explainer pages (IA §3.7-§3.12, PRD
 * §5.6/§5.7/§5.8/§5.9/§5.10/§5.17). Container-rendered, both languages,
 * mirroring tests/routes/home.test.ts's structure.
 *
 * app_settings is mocked (these pages' settings needs are simple key
 * reads, same pattern as tests/routes/home.test.ts). FindBooth's no-JS POST
 * branch calls `lookupBoothByEpic` directly (not via fetch), which is the
 * same function /api/booth-lookup uses — it is mocked here so this suite
 * never reaches the BBMP electoral API. The endpoint's own behaviour is
 * covered by tests/routes/booth-lookup.test.ts.
 */
vi.mock('../../src/lib/settings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/lib/booth-lookup', () => ({ lookupBoothByEpic: vi.fn() }));

import { getSettings } from '../../src/lib/settings';
import { lookupBoothByEpic } from '../../src/lib/booth-lookup';
import CheckRegistration from '../../src/features/pages/CheckRegistration.astro';
import AboutElection from '../../src/features/pages/AboutElection.astro';
import VotingGuide from '../../src/features/pages/VotingGuide.astro';
import VoterId from '../../src/features/pages/VoterId.astro';
import HowToVote from '../../src/features/pages/HowToVote.astro';
import FindBooth from '../../src/features/pages/FindBooth.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ids so this suite never collides with another test
// file's fixtures in the shared (not reset-between-files) test DB.
const WARD = {
  id: 98001,
  nameEn: 'Guides Test Ward',
  nameKn: 'ಗೈಡ್ಸ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'west' as const,
  zone: 'Zone T',
  boundaryRef: 'guides-test-ward',
};

/**
 * A successful booth lookup, as `lookupBoothByEpic` returns it. The voter is
 * fictional — the real upstream returns a real person's name and no such
 * record belongs in this repo.
 */
const EPIC = 'ZZZ0000001';

const BOOTH_RESULT = {
  result: 'booth' as const,
  voter: { epic: EPIC, nameEn: 'Demo Voter (FICTIONAL)', nameKn: 'ಡೆಮೊ ಮತದಾರ (ಕಾಲ್ಪನಿಕ)' },
  ward: { id: WARD.id, nameEn: WARD.nameEn, nameKn: WARD.nameKn, corporation: WARD.corporation },
  booth: {
    nameEn: 'Guides Test Govt School',
    nameKn: 'ಗೈಡ್ಸ್ ಪರೀಕ್ಷಾ ಸರ್ಕಾರಿ ಶಾಲೆ',
    serialNo: 1242,
    lat: 12.97,
    lng: 77.59,
  },
};

/**
 * Extracts the first `<a ...>` opening tag whose attributes contain
 * `marker` (e.g. `data-external-link`) — attribute ORDER in the rendered
 * markup (class, href, target, rel, aria-disabled, data-*) doesn't match
 * source order, so tests assert against this substring rather than a
 * single order-sensitive regex across the whole document.
 */
function findAnchorTag(html: string, marker: string): string {
  const anchorRe = /<a\b[^>]*>/g;
  for (const match of html.matchAll(anchorRe)) {
    if (match[0].includes(marker)) return match[0];
  }
  throw new Error(`findAnchorTag: no <a> tag containing "${marker}" found`);
}

/**
 * Extracts each `<li>...</li>` from the VotingGuide `<ol class="step-list">`
 * structural checklist, in document order — lets a test bind a step's
 * label text to ITS OWN href (adjacency), not just assert both appear
 * somewhere on the page (which wouldn't catch a step wired to the wrong
 * link, e.g. all 6 steps accidentally pointing at the same href).
 */
function extractStepListItems(html: string): string[] {
  const olMatch = html.match(/<ol class="step-list">([\s\S]*?)<\/ol>/);
  if (!olMatch) throw new Error('extractStepListItems: no <ol class="step-list"> found');
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  return [...olMatch[1].matchAll(liRe)].map((m) => m[1]);
}

function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

async function renderPage(
  Component: any,
  lang: Lang,
  path: string,
  request?: Request,
): Promise<{ html: string; response: Response }> {
  const container = await makeContainer();
  const response = await container.renderToResponse(Component, {
    partial: false,
    props: { lang },
    request: request ?? new Request(`${SITE_ORIGIN}${localePath(lang, path)}`),
  });
  const html = normalize(await response.text());
  return { html, response };
}

const NO_SETTINGS: Record<string, string | null> = {
  notification_date: null,
  election_date: null,
  roll_deadline: null,
  roll_lookup_url: null,
  form6_url: null,
  form8_url: null,
  booth_lookup_url: null,
};

describe('Guide & explainer pages (Task 21) — IA §3.7-§3.12', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(getSettings).mockReset().mockResolvedValue(NO_SETTINGS);
    vi.mocked(lookupBoothByEpic).mockReset();
  });

  describe('CheckRegistration (/check-registration)', () => {
    it('renders a distinctive sentence from the EN content, in both languages, with correct title/description/lang', async () => {
      const en = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(en.html).toContain('the worst mistake this platform could make');
      expect(en.html).toContain('<title>Check if you');
      expect(en.html).toMatch(/<html lang="en"/);

      const kn = await renderPage(CheckRegistration, 'kn', '/check-registration');
      expect(kn.html).toContain('ಈ ವೇದಿಕೆ ಮಾಡಬಹುದಾದ ಅತ್ಯಂತ ಕೆಟ್ಟ ತಪ್ಪು');
      expect(kn.html).toMatch(/<html lang="kn"/);
    });

    it('never leaks the INPUT NEEDED authoring marker into the rendered HTML', async () => {
      const { html } = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(html).not.toContain('INPUT NEEDED');
    });

    it('eligibility basics appear BEFORE the external link-out button, in document order', async () => {
      const { html } = await renderPage(CheckRegistration, 'en', '/check-registration');
      const eligibilityIndex = html.indexOf('18 years or older');
      const linkOutIndex = html.indexOf('data-external-link');
      expect(eligibilityIndex).toBeGreaterThan(-1);
      expect(linkOutIndex).toBeGreaterThan(-1);
      expect(eligibilityIndex).toBeLessThan(linkOutIndex);
    });

    it('the guided link-out carries the external glyph and rel="noopener noreferrer", target=_blank', async () => {
      const { html } = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(html).toContain('class="external-glyph"');
      const anchor = findAnchorTag(html, 'data-external-link');
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).toContain('target="_blank"');
    });

    it('shows the pending-note placeholder and href="#" when roll_lookup_url is not set', async () => {
      const { html } = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(html).toContain('Official link pending');
      expect(html).toContain('href="#"');
    });

    it('uses the real URL and omits the pending note once roll_lookup_url is set', async () => {
      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, roll_lookup_url: 'https://voters.eci.gov.in/' });
      const { html } = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(html).toContain('href="https://voters.eci.gov.in/"');
      expect(html).not.toContain('Official link pending');
    });

    it('renders DeadlineBanner when roll_deadline is set in the future, not when absent/past', async () => {
      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, roll_deadline: '2099-12-31' });
      const future = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(future.html).toContain('deadline-banner');

      vi.mocked(getSettings).mockResolvedValue(NO_SETTINGS);
      const absent = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(absent.html).not.toContain('deadline-banner');

      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, roll_deadline: '2000-01-01' });
      const past = await renderPage(CheckRegistration, 'en', '/check-registration');
      expect(past.html).not.toContain('deadline-banner');
    });
  });

  describe('AboutElection (/about-election)', () => {
    it('renders a distinctive sentence from the EN content, in both languages', async () => {
      const en = await renderPage(AboutElection, 'en', '/about-election');
      expect(en.html).toContain('Greater Bengaluru Authority (GBA)');
      const kn = await renderPage(AboutElection, 'kn', '/about-election');
      expect(kn.html).toContain('ಗ್ರೇಟರ್ ಬೆಂಗಳೂರು ಅಥಾರಿಟಿ');
    });

    it('never leaks the "election status banner" authoring comment into the rendered HTML', async () => {
      const { html } = await renderPage(AboutElection, 'en', '/about-election');
      expect(html).not.toContain('this page never hard-codes a status or date');
    });

    it('shows "notification awaited" when notification_date is absent', async () => {
      const { html } = await renderPage(AboutElection, 'en', '/about-election');
      expect(html).toContain('Election notification awaited');
    });

    it('shows the election status once both dates are set', async () => {
      vi.mocked(getSettings).mockResolvedValue({
        ...NO_SETTINGS,
        notification_date: '2026-08-01',
        election_date: '2026-09-15',
      });
      const { html } = await renderPage(AboutElection, 'en', '/about-election');
      expect(html).not.toContain('Election notification awaited');
      expect(html).toContain('2026-08-01');
      expect(html).toContain('2026-09-15');
    });

    it('emits Event JSON-LD once election_date is set (Task 56, src/lib/seo.ts#eventLd)', async () => {
      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, election_date: '2026-09-15' });
      const { html } = await renderPage(AboutElection, 'en', '/about-election');
      const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      expect(match, 'expected an application/ld+json script tag').not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed['@type']).toBe('Event');
      expect(parsed.startDate).toBe('2026-09-15');
    });

    it('emits NO Event JSON-LD when election_date is absent — never a placeholder date', async () => {
      const { html } = await renderPage(AboutElection, 'en', '/about-election');
      expect(html).not.toMatch(/application\/ld\+json/);
    });
  });

  describe('VotingGuide (/voting-guide)', () => {
    it('renders a distinctive sentence from the EN content, in both languages', async () => {
      const en = await renderPage(VotingGuide, 'en', '/voting-guide');
      expect(en.html).toContain('nearly everyone under thirty has never voted');
      const kn = await renderPage(VotingGuide, 'kn', '/voting-guide');
      expect(kn.html).toContain('ಬೆಂಗಳೂರಿನ ಕೊನೆಯ ವಾರ್ಡ್ ಚುನಾವಣೆ');
    });

    it('never leaks the "roll-deadline countdown" authoring comment into the rendered HTML', async () => {
      const { html } = await renderPage(VotingGuide, 'en', '/voting-guide');
      expect(html).not.toContain('PRD §5.6, §5.17');
    });

    it('all 6 checklist steps deep-link to the right EN paths', async () => {
      const { html } = await renderPage(VotingGuide, 'en', '/voting-guide');
      for (const href of [
        '/check-registration',
        '/voting-guide/voter-id',
        '/voting-guide/find-booth',
        '/voting-guide/how-to-vote',
      ]) {
        expect(html).toContain(`href="${href}"`);
      }
      // Ward-finder AND candidates steps both deep-link to '/'.
      const rootLinks = html.match(/href="\/"/g) ?? [];
      expect(rootLinks.length).toBeGreaterThanOrEqual(2);
    });

    it('all 6 checklist steps deep-link to the right kn paths', async () => {
      const { html } = await renderPage(VotingGuide, 'kn', '/voting-guide');
      for (const href of [
        '/kn/check-registration',
        '/kn/voting-guide/voter-id',
        '/kn/voting-guide/find-booth',
        '/kn/voting-guide/how-to-vote',
      ]) {
        expect(html).toContain(`href="${href}"`);
      }
      const rootLinks = html.match(/href="\/kn\/"/g) ?? [];
      expect(rootLinks.length).toBeGreaterThanOrEqual(2);
    });

    it('each step in the structural checklist binds ITS OWN label to ITS OWN href (EN) — not just "both appear somewhere"', async () => {
      const { html } = await renderPage(VotingGuide, 'en', '/voting-guide');
      const items = extractStepListItems(html);
      expect(items).toHaveLength(6);

      // Ordered [label, href] pairs matching VotingGuide.astro's `steps` array
      // exactly (src/i18n/en.json `votingGuide.steps.*`).
      const expected: Array<[string, string]> = [
        ["Check you", '/check-registration'], // "Check you're on the roll" — split at the apostrophe below.
        ['Enrol or transfer your registration', '/voting-guide/voter-id'],
        ['Find your ward', '/'],
        ['Read about the candidates', '/'],
        ['Find your booth', '/voting-guide/find-booth'],
        ['Vote on election day', '/voting-guide/how-to-vote'],
      ];

      expected.forEach(([label, href], i) => {
        const li = items[i];
        expect(li, `step ${i + 1} <li> should contain its own label "${label}"`).toContain(label);
        expect(li, `step ${i + 1} <li> should link to its own href "${href}"`).toContain(`href="${href}"`);
      });
    });

    it('each step in the structural checklist binds ITS OWN label to ITS OWN href (kn) — not just "both appear somewhere"', async () => {
      const { html } = await renderPage(VotingGuide, 'kn', '/voting-guide');
      const items = extractStepListItems(html);
      expect(items).toHaveLength(6);

      // Ordered [label, href] pairs matching VotingGuide.astro's `steps` array
      // exactly (src/i18n/kn.json `votingGuide.steps.*`).
      const expected: Array<[string, string]> = [
        ['ನೀವು ಪಟ್ಟಿಯಲ್ಲಿ ಇದ್ದೀರಾ ಎಂದು ಪರಿಶೀಲಿಸಿ', '/kn/check-registration'],
        ['ನಿಮ್ಮ ನೋಂದಣಿಯನ್ನು ನೋಂದಾಯಿಸಿ ಅಥವಾ ವರ್ಗಾಯಿಸಿ', '/kn/voting-guide/voter-id'],
        ['ನಿಮ್ಮ ವಾರ್ಡ್ ಹುಡುಕಿ', '/kn/'],
        ['ಅಭ್ಯರ್ಥಿಗಳ ಬಗ್ಗೆ ಓದಿ', '/kn/'],
        ['ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಹುಡುಕಿ', '/kn/voting-guide/find-booth'],
        ['ಚುನಾವಣೆಯ ದಿನ ಮತ ಚಲಾಯಿಸಿ', '/kn/voting-guide/how-to-vote'],
      ];

      expected.forEach(([label, href], i) => {
        const li = items[i];
        expect(li, `step ${i + 1} <li> should contain its own label "${label}"`).toContain(label);
        expect(li, `step ${i + 1} <li> should link to its own href "${href}"`).toContain(`href="${href}"`);
      });
    });

    it('renders DeadlineBanner near the steps when roll_deadline is set in the future', async () => {
      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, roll_deadline: '2099-12-31' });
      const { html } = await renderPage(VotingGuide, 'en', '/voting-guide');
      expect(html).toContain('deadline-banner');
    });
  });

  describe('VoterId (/voting-guide/voter-id)', () => {
    it('renders a distinctive sentence from the EN content, in both languages', async () => {
      const en = await renderPage(VoterId, 'en', '/voting-guide/voter-id');
      expect(en.html).toContain('A vote registered elsewhere does not count in this election.');
      const kn = await renderPage(VoterId, 'kn', '/voting-guide/voter-id');
      expect(kn.html).toContain('ಬೇರೆಡೆ ನೋಂದಾಯಿಸಿದ ಮತವು ಈ ಚುನಾವಣೆಯಲ್ಲಿ ಪರಿಗಣಿಸಲ್ಪಡುವುದಿಲ್ಲ');
    });

    it('never leaks the INPUT NEEDED authoring markers (Form 6 + Form 8 URLs) into the rendered HTML', async () => {
      const { html } = await renderPage(VoterId, 'en', '/voting-guide/voter-id');
      expect(html).not.toContain('INPUT NEEDED');
    });

    it('the "registered in another city" / Form 8 transfer content is present', async () => {
      const { html } = await renderPage(VoterId, 'en', '/voting-guide/voter-id');
      // marked HTML-escapes the apostrophe in "I'm" to &#39;.
      expect(html).toContain('I&#39;m registered to vote in another city');
      expect(html).toContain('Form 8');
      expect(html).toContain('Form 6');
    });

    it('renders two guided link-out buttons (Form 6, Form 8), both with the external glyph + rel=noopener', async () => {
      const { html } = await renderPage(VoterId, 'en', '/voting-guide/voter-id');
      const externalLinks = html.match(/data-external-link/g) ?? [];
      expect(externalLinks.length).toBe(2);
      expect(html).toContain('Fill Form 6 online');
      expect(html).toContain('Fill Form 8 online');
      // Every page also carries Base.astro's global Register/Login modal
      // (Task 27), whose step-3 consent sentence links to /terms and
      // /privacy with the SAME rel, and the footer's three social links
      // (design-system §7.2) — so the page-wide count is these two guided
      // link-out buttons PLUS those five, not just 2.
      expect((html.match(/rel="noopener noreferrer"/g) ?? []).length).toBe(7);
    });

    it('renders DeadlineBanner when roll_deadline is set in the future', async () => {
      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, roll_deadline: '2099-12-31' });
      const { html } = await renderPage(VoterId, 'en', '/voting-guide/voter-id');
      expect(html).toContain('deadline-banner');
    });
  });

  describe('HowToVote (/voting-guide/how-to-vote)', () => {
    it('renders a distinctive sentence from the EN content, in both languages', async () => {
      const en = await renderPage(HowToVote, 'en', '/voting-guide/how-to-vote');
      expect(en.html).toContain('This guide assumes no prior knowledge.');
      const kn = await renderPage(HowToVote, 'kn', '/voting-guide/how-to-vote');
      expect(kn.html).toContain('ಈ ಮಾರ್ಗದರ್ಶಿ ಯಾವುದೇ ಪೂರ್ವ ಜ್ಞಾನವನ್ನು ಊಹಿಸುವುದಿಲ್ಲ');
    });

    it('never leaks authoring markers (including the CONFIRM marker) into the rendered HTML', async () => {
      const { html } = await renderPage(HowToVote, 'en', '/voting-guide/how-to-vote');
      expect(html).not.toContain('INPUT NEEDED');
      expect(html).not.toContain('CONFIRM: SEC EVM');
    });

    it('question-shaped headings render as real, visible <h2> elements (AEO, architecture.md §8)', async () => {
      const { html } = await renderPage(HowToVote, 'en', '/voting-guide/how-to-vote');
      expect(html).toContain('<h2>Can I vote NOTA?</h2>');
      // marked HTML-escapes the apostrophe in "What's" to &#39;.
      expect(html).toContain('<h2>What&#39;s different about voting in a ward election?</h2>');
    });

    it('FAQ answers are plain visible text, not hidden behind a <details> accordion', async () => {
      const { html } = await renderPage(HowToVote, 'en', '/voting-guide/how-to-vote');
      expect(html).not.toContain('<details');
      expect(html).not.toContain('<summary');
      // The NOTA answer's key fact is unconditionally in the markup.
      expect(html).toContain('None of the Above');
    });

    it('emits FAQPage JSON-LD built from this page\'s own question-shaped headings (Task 56, src/lib/seo.ts#faqLd)', async () => {
      const { html } = await renderPage(HowToVote, 'en', '/voting-guide/how-to-vote');
      const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      expect(match, 'expected an application/ld+json script tag').not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed['@type']).toBe('FAQPage');
      expect(Array.isArray(parsed.mainEntity)).toBe(true);
      expect(parsed.mainEntity.length).toBeGreaterThanOrEqual(5); // this content has 7 question-shaped `##` headings
      const notaEntry = parsed.mainEntity.find((entry: any) => entry.name === 'Can I vote NOTA?');
      expect(notaEntry, 'expected a "Can I vote NOTA?" Question entry').toBeTruthy();
      expect(notaEntry['@type']).toBe('Question');
      expect(notaEntry.acceptedAnswer['@type']).toBe('Answer');
      expect(notaEntry.acceptedAnswer.text).toContain('None of the Above');
    });
  });

  describe('FindBooth (/voting-guide/find-booth)', () => {
    it('renders a distinctive sentence from the EN content, in both languages', async () => {
      const en = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      expect(en.html).toContain('It is the number polling officials look you up by on voting day');

      // The Kannada assertion deliberately does NOT pin a translated
      // sentence: content/pages/kn/find-booth.md is regenerated by
      // `npm run translate` and its wording is not ours to fix in a test.
      // What must hold is that the kn twin renders the KANNADA file — so the
      // English sentence is absent — while keeping "EPIC" in Latin script,
      // which is what the translation hint for this page requires.
      const kn = await renderPage(FindBooth, 'kn', '/voting-guide/find-booth');
      expect(kn.html).not.toContain('It is the number polling officials look you up by on voting day');
      expect(kn.html).toContain('EPIC');
    });

    it('never leaks the INPUT NEEDED authoring marker into the rendered HTML', async () => {
      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      expect(html).not.toContain('INPUT NEEDED');
    });

    it('asks for a voter ID, not an address — the input mode changed 2026-08-19', async () => {
      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      expect(html).toContain('name="epic"');
      expect(html).not.toContain('name="address"');
      expect(html).toContain(t('en', 'findBooth.form.label'));
    });

    it('the no-JS form action is locale-correct (posts back to the kn URL on the kn page)', async () => {
      const en = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      expect(en.html).toContain('action="/voting-guide/find-booth"');
      const kn = await renderPage(FindBooth, 'kn', '/voting-guide/find-booth');
      expect(kn.html).toContain('action="/kn/voting-guide/find-booth"');
    });

    it('emits its own BoothLookup island script, plus Base.astro\'s global Register/Login, Flag, Vote modal, MeSlot, and ?src attribution scripts (Tasks 27/28/32/33/49) — no others', async () => {
      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      const scriptOpenTags = html.match(/<script\b[^>]*>/g) ?? [];
      // Six scripts: this page's own BoothLookup island, four Base.astro
      // module scripts (RegisterLoginModal, FlagModal, VoteModal, MeSlot),
      // and Base.astro's inline `?src` attribution writer (Task 49,
      // src/lib/attribution.ts) — never a stray/unexpected seventh script.
      expect(scriptOpenTags).toHaveLength(6);
      expect(html).toMatch(/FindBooth\.astro\?astro&type=script/);
      expect(html).toMatch(/RegisterLoginModal\.astro\?astro&type=script/);
      expect(html).toMatch(/FlagModal\.astro\?astro&type=script/);
      expect(html).toMatch(/VoteModal\.astro\?astro&type=script/);
      expect(html).toMatch(/Base\.astro\?astro&type=script/);
      expect(html).toMatch(/bv_src/);
    });

    it('the always-visible guided link-out to the official EC booth finder is present on a plain GET (no-JS fallback)', async () => {
      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      // marked HTML-escapes the apostrophe in "Can't" to &#39;.
      expect(html).toContain('Can&#39;t find your booth here?');
      expect(html).toContain('data-external-link');
      expect(html).toContain('Official link pending');
    });

    it('external booth-finder link carries the glyph and rel="noopener noreferrer"', async () => {
      vi.mocked(getSettings).mockResolvedValue({ ...NO_SETTINGS, booth_lookup_url: 'https://ceokarnataka.gov.in/booth' });
      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      expect(html).toContain('class="external-glyph"');
      const anchor = findAnchorTag(html, 'data-external-link');
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).toContain('href="https://ceokarnataka.gov.in/booth"');
    });

    /**
     * Astro HTML-escapes text content, so an i18n string with an apostrophe
     * ("We couldn't...") appears as `couldn&#39;t` in the markup. Assertions
     * against `t()` output have to escape the same way.
     */
    function esc(text: string): string {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /**
     * The rendered result region only. The form itself carries every message
     * as a `data-msg-*` attribute for the island to read — including the
     * un-substituted `{serialNo}` template — so a page-level "does not
     * contain" assertion would always fail. What matters is what the VISITOR
     * is shown, which is this region.
     */
    function boothResult(html: string): string {
      const start = html.indexOf('data-booth-result');
      if (start === -1) throw new Error('boothResult: no [data-booth-result] region found');
      const end = html.indexOf('</form>', start);
      return html.slice(start, end);
    }

    /** A no-JS form POST of an EPIC number to this page. */
    function epicPost(epic: string): Request {
      return new Request(`${SITE_ORIGIN}/voting-guide/find-booth`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `epic=${encodeURIComponent(epic)}`,
      });
    }

    it('no-JS POST: server-renders the voter, the ward link and the booth, cache-control no-store', async () => {
      vi.mocked(lookupBoothByEpic).mockResolvedValueOnce(BOOTH_RESULT);

      const { html, response } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth', epicPost(EPIC));

      expect(lookupBoothByEpic).toHaveBeenCalledWith(EPIC);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(html).toContain(BOOTH_RESULT.voter.nameEn);
      expect(html).toContain(EPIC);
      expect(html).toContain(BOOTH_RESULT.booth.nameEn);
      // The serial number is what polling officials ask for — it must be
      // rendered as a number, not left as the {serialNo} template.
      expect(boothResult(html)).toContain('1242');
      expect(boothResult(html)).not.toContain('{serialNo}');
      // OUR name for the ward, linked to OUR ward page.
      expect(html).toContain(`href="/ward/${WARD.id}"`);
      expect(html).toContain(WARD.nameEn);
    });

    it('renders the directions link from the booth coordinates (spec §7)', async () => {
      vi.mocked(lookupBoothByEpic).mockResolvedValueOnce(BOOTH_RESULT);

      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth', epicPost(EPIC));

      expect(html).toContain('https://www.google.com/maps/dir/');
      expect(html).toContain(
        `destination=${encodeURIComponent(`${BOOTH_RESULT.booth.lat},${BOOTH_RESULT.booth.lng}`)}`,
      );
      const anchor = findAnchorTag(html, 'google.com/maps/dir');
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain(
        `aria-label="${t('en', 'findBooth.result.directionsAriaLabel', { boothName: BOOTH_RESULT.booth.nameEn })}"`,
      );
      // Also carried as data-msg-* attributes for the JS island to read.
      expect(html).toContain(`data-msg-directions="${t('en', 'findBooth.result.directions')}"`);
    });

    // The booth is the answer the citizen came for; failing to place it in one
    // of our 369 wards must not throw that away.
    it('a booth we cannot place in a ward still renders, with the ward-unknown line', async () => {
      vi.mocked(lookupBoothByEpic).mockResolvedValueOnce({ ...BOOTH_RESULT, ward: null });

      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth', epicPost(EPIC));

      expect(html).toContain(BOOTH_RESULT.booth.nameEn);
      expect(boothResult(html)).toContain(esc(t('en', 'findBooth.result.wardUnknown')));
      expect(html).not.toContain(`href="/ward/${WARD.id}"`);
    });

    it('no-JS POST, not_found: says the voter ID was not found, never that the lookup broke', async () => {
      vi.mocked(lookupBoothByEpic).mockResolvedValueOnce({ result: 'not_found' });

      const { html, response } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth', epicPost('ZZZ0000002'));

      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(boothResult(html)).toContain(esc(t('en', 'findBooth.result.notFound')));
      expect(boothResult(html)).not.toContain(esc(t('en', 'findBooth.result.unavailable')));
    });

    // Conflating these two tells a citizen something false about their own
    // registration — see the i18n hint on findBooth.result.unavailable.
    it.each(['timeout', 'failed', 'malformed', 'budget'] as const)(
      'no-JS POST, unavailable/%s: says the lookup is down, never that the voter ID is missing',
      async (reason) => {
        vi.mocked(lookupBoothByEpic).mockResolvedValueOnce({ result: 'unavailable', reason });

        const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth', epicPost(EPIC));

        expect(boothResult(html)).toContain(esc(t('en', 'findBooth.result.unavailable')));
        expect(boothResult(html)).not.toContain(esc(t('en', 'findBooth.result.notFound')));
      },
    );

    it('an empty POST never reaches the lookup', async () => {
      const { html } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth', epicPost('   '));

      expect(lookupBoothByEpic).not.toHaveBeenCalled();
      expect(boothResult(html)).toContain(esc(t('en', 'findBooth.result.notFound')));
    });

    it('GET is unaffected — no cache-control: no-store, and no result markup', async () => {
      const { html, response } = await renderPage(FindBooth, 'en', '/voting-guide/find-booth');
      expect(response.headers.get('cache-control')).not.toBe('no-store');
      expect(lookupBoothByEpic).not.toHaveBeenCalled();
      expect(html).not.toContain('booth-card');
    });
  });
});
