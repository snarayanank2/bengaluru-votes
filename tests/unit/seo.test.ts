import { describe, it, expect } from 'vitest';
import {
  absoluteUrl,
  jsonLd,
  orgLd,
  personLd,
  placeLd,
  eventLd,
  faqLd,
  breadcrumbLd,
} from '../../src/lib/seo';

/**
 * Unit tests for src/lib/seo.ts (Task 56) — no DB, no Astro runtime. Covers
 * the security-critical `jsonLd` serializer's escaping and every builder's
 * shape/absolute-URL/omission behavior.
 */

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

describe('absoluteUrl', () => {
  it('resolves a root-relative path against SITE_ORIGIN', () => {
    expect(absoluteUrl('/ward/57')).toBe(`${SITE_ORIGIN}/ward/57`);
    expect(absoluteUrl('/')).toBe(`${SITE_ORIGIN}/`);
  });
});

describe('jsonLd (the security-critical serializer)', () => {
  it('escapes `<` so a literal "</script>" never appears in the output', () => {
    const payload = jsonLd({ name: '</script><script>alert(1)</script>' });
    expect(payload).not.toContain('</script>');
    expect(payload).toContain('\\u003c');
  });

  it('escapes `>` and `&` too', () => {
    const payload = jsonLd({ name: 'Tom & Jerry > Friends' });
    expect(payload).not.toContain('&');
    expect(payload).not.toContain('>');
    expect(payload).toContain('\\u0026');
    expect(payload).toContain('\\u003e');
  });

  it('escaping is reversible/semantically lossless — JSON.parse round-trips to the original value', () => {
    const original = { name: '</script><script>alert(1)</script>', other: 'Tom & Jerry > Friends' };
    const payload = jsonLd(original);
    expect(JSON.parse(payload)).toEqual(original);
  });

  it('leaves ordinary content untouched aside from the escaped characters', () => {
    const payload = jsonLd({ '@type': 'Person', name: 'Jane Doe' });
    expect(JSON.parse(payload)).toEqual({ '@type': 'Person', name: 'Jane Doe' });
  });
});

describe('orgLd', () => {
  it('returns the platform Organization, url = SITE_ORIGIN, Oorvani Foundation as parent/publisher', () => {
    const org = orgLd();
    expect(org['@context']).toBe('https://schema.org');
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('Bengaluru Votes');
    expect(org.url).toBe(SITE_ORIGIN);
    expect((org.parentOrganization as any).name).toBe('Oorvani Foundation');
    expect((org.publisher as any).name).toBe('Oorvani Foundation');
  });
});

describe('personLd', () => {
  it('includes affiliation when a party is given, with an absolute report-card url', () => {
    const person = personLd({ name: 'Jane Doe', party: 'Independent', path: '/candidate/jane-doe' });
    expect(person['@context']).toBe('https://schema.org');
    expect(person['@type']).toBe('Person');
    expect(person.name).toBe('Jane Doe');
    expect(person.url).toBe(`${SITE_ORIGIN}/candidate/jane-doe`);
    expect(person.affiliation).toEqual({ '@type': 'Organization', name: 'Independent' });
  });

  it('omits affiliation entirely when party is absent (null/undefined) — never a placeholder', () => {
    const withNull = personLd({ name: 'Jane Doe', party: null, path: '/candidate/jane-doe' });
    expect(withNull).not.toHaveProperty('affiliation');

    const withUndefined = personLd({ name: 'Jane Doe', path: '/candidate/jane-doe' });
    expect(withUndefined).not.toHaveProperty('affiliation');
  });

  it('never emits a ranking/rating field', () => {
    const person = personLd({ name: 'Jane Doe', party: 'Independent', path: '/candidate/jane-doe' });
    expect(person).not.toHaveProperty('bestRating');
    expect(person).not.toHaveProperty('ratingValue');
    expect(person).not.toHaveProperty('aggregateRating');
  });
});

describe('placeLd', () => {
  it('returns an AdministrativeArea with an absolute url and containedInPlace', () => {
    const place = placeLd({ id: 57, name: 'Test Ward', path: '/ward/57' });
    expect(place['@context']).toBe('https://schema.org');
    expect(place['@type']).toBe('AdministrativeArea');
    expect(place.name).toBe('Test Ward');
    expect(place.identifier).toBe('57');
    expect(place.url).toBe(`${SITE_ORIGIN}/ward/57`);
    expect(place.containedInPlace).toBeTruthy();
  });
});

describe('eventLd', () => {
  it('returns null when election_date is absent', () => {
    expect(eventLd({})).toBeNull();
    expect(eventLd({ election_date: null })).toBeNull();
  });

  it('returns an Event with startDate = election_date when present', () => {
    const event = eventLd({ election_date: '2026-09-15' });
    expect(event).not.toBeNull();
    expect(event!['@context']).toBe('https://schema.org');
    expect(event!['@type']).toBe('Event');
    expect(event!.startDate).toBe('2026-09-15');
  });
});

describe('faqLd', () => {
  it('maps N questions to N Question entries', () => {
    const questions = [
      { question: 'Can I vote NOTA?', answer: 'Yes, it is a valid option.' },
      { question: 'What do I need to bring?', answer: 'Your EPIC or an accepted alternative.' },
      { question: 'When do polls open?', answer: 'See the official schedule.' },
    ];
    const faq = faqLd(questions);
    expect(faq['@context']).toBe('https://schema.org');
    expect(faq['@type']).toBe('FAQPage');
    const entries = faq.mainEntity as any[];
    expect(entries).toHaveLength(3);
    entries.forEach((entry, i) => {
      expect(entry['@type']).toBe('Question');
      expect(entry.name).toBe(questions[i].question);
      expect(entry.acceptedAnswer['@type']).toBe('Answer');
      expect(entry.acceptedAnswer.text).toBe(questions[i].answer);
    });
  });

  it('an empty question list still yields a valid (empty) FAQPage', () => {
    const faq = faqLd([]);
    expect(faq.mainEntity).toEqual([]);
  });
});

describe('breadcrumbLd', () => {
  it('builds a BreadcrumbList with positions 1..n and absolute item URLs', () => {
    const trail = breadcrumbLd([
      { name: 'Bengaluru Votes', url: '/' },
      { name: 'Test Ward', url: '/ward/57' },
      { name: 'Jane Doe', url: '/candidate/jane-doe' },
    ]);
    expect(trail['@context']).toBe('https://schema.org');
    expect(trail['@type']).toBe('BreadcrumbList');
    const items = trail.itemListElement as any[];
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ '@type': 'ListItem', position: 1, name: 'Bengaluru Votes', item: `${SITE_ORIGIN}/` });
    expect(items[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Test Ward', item: `${SITE_ORIGIN}/ward/57` });
    expect(items[2]).toEqual({
      '@type': 'ListItem',
      position: 3,
      name: 'Jane Doe',
      item: `${SITE_ORIGIN}/candidate/jane-doe`,
    });
  });
});
