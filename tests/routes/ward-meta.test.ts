import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, type Lang } from '../../src/i18n';
import { oldWardsClause, titleWardName, wardSummary } from '../../src/lib/ward-meta';
import WardEn from '../../src/pages/ward/[id].astro';
import WardKn from '../../src/pages/kn/ward/[id].astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Ward ids are corporation * 1000 + number; 94102 (north) and 93102 (east)
// both show as "Ward 102", the repeated-number case.
const base = {
  zone: 'Zone T',
  assemblyNumber: 163,
  assemblyNameEn: 'Test Assembly',
  assemblyNameKn: 'ಪರೀಕ್ಷಾ ವಿಧಾನಸಭಾ ಕ್ಷೇತ್ರ',
  populationTotal: 1000,
  populationMale: 500,
  populationFemale: 500,
  reservationEn: 'General',
  reservationKn: 'ಸಾಮಾನ್ಯ',
  factsSourceUrl: 'https://example.org/ward-facts.csv',
  factsSourceDate: '2026-08-19',
};
const WARDS = [
  { ...base, id: 94101, nameEn: 'Meta One', nameKn: 'ಮೆಟಾ ಒಂದು', corporation: 'north' as const, boundaryRef: 'meta-94101' },
  { ...base, id: 94102, nameEn: 'Meta Two', nameKn: 'ಮೆಟಾ ಎರಡು', corporation: 'north' as const, boundaryRef: 'meta-94102' },
  { ...base, id: 94103, nameEn: 'Meta Four Ward', nameKn: 'ಮೆಟಾ ನಾಲ್ಕು ವಾರ್ಡ್‌', corporation: 'north' as const, boundaryRef: 'meta-94103' },
  { ...base, id: 93102, nameEn: 'Meta Three', nameKn: 'ಮೆಟಾ ಮೂರು', corporation: 'east' as const, boundaryRef: 'meta-93102' },
];
const overlap = (wardId: number, position: number, number: number, bp: number) => ({
  wardId,
  position,
  oldWardNumber: number,
  oldWardNameEn: `Old ${number}`,
  oldWardNameKn: `ಹಳೆಯ ${number}`,
  publishedOverlapBasisPoints: bp,
});
const OVERLAPS = [
  overlap(94101, 1, 62, 10_000),
  overlap(94102, 1, 63, 6_000),
  overlap(94102, 2, 62, 4_000),
];

function meta(html: string): { title: string; description: string; ogTitle: string; twitterTitle: string; summary: string } {
  const pick = (re: RegExp) => (html.match(re)?.[1] ?? '').replace(/&amp;/g, '&');
  return {
    title: pick(/<title>([^<]*)<\/title>/),
    description: pick(/<meta name="description" content="([^"]*)"/),
    ogTitle: pick(/<meta property="og:title" content="([^"]*)"/),
    twitterTitle: pick(/<meta name="twitter:title" content="([^"]*)"/),
    summary: pick(/<p class="ward-summary"[^>]*>([^<]*)<\/p>/),
  };
}

async function render(lang: Lang, id: number) {
  const container = await AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
  const res = await container.renderToResponse(lang === 'kn' ? WardKn : WardEn, {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, `/ward/${id}`)}`),
  });
  return meta(await res.text());
}

afterAll(async () => {
  await client.end();
});

describe('Ward page <title> and meta description (task 194)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const w of WARDS) await db.insert(schema.wards).values(w).onConflictDoUpdate({ target: schema.wards.id, set: w });
    await db.delete(schema.wardOldWardOverlaps).where(inArray(schema.wardOldWardOverlaps.wardId, WARDS.map((w) => w.id)));
    await db.insert(schema.wardOldWardOverlaps).values(OVERLAPS);
  });

  it('en: one old ward lying wholly inside', async () => {
    const m = await render('en', 94101);
    expect(m.title).toBe('Meta One Ward 101, North Corp — GBA Election Candidates');
    expect(m.description).toBe(
      'Meta One (Ward 101, North Corporation, within old BBMP ward 62): candidates, ward map, key areas and how to vote in the GBA election.',
    );
  });

  it('kn: one old ward lying wholly inside', async () => {
    const m = await render('kn', 94101);
    expect(m.title).toBe('ಮೆಟಾ ಒಂದು ವಾರ್ಡ್ 101, ಉತ್ತರ ನಗರ ಪಾಲಿಕೆ — ಜಿಬಿಎ ಚುನಾವಣಾ ಅಭ್ಯರ್ಥಿಗಳು');
    expect(m.description).toContain('ಮೆಟಾ ಒಂದು (ವಾರ್ಡ್ 101, ಉತ್ತರ ನಗರ ಪಾಲಿಕೆ, ಹಳೆಯ ಬಿಬಿಎಂಪಿ ವಾರ್ಡ್ 62 ಒಳಗೆ ಇದೆ):');
  });

  it('lists every old ward, in number order, when there are several', async () => {
    const en = await render('en', 94102);
    expect(en.title).toBe('Meta Two Ward 102, North Corp — GBA Election Candidates');
    expect(en.description).toContain('(Ward 102, North Corporation, includes parts of old BBMP wards 62, 63):');
    const kn = await render('kn', 94102);
    expect(kn.description).toContain('ಹಳೆಯ ಬಿಬಿಎಂಪಿ ವಾರ್ಡ್‌ಗಳಾದ 62, 63ರ ಭಾಗಗಳನ್ನು ಒಳಗೊಂಡಿದೆ');
  });

  it('does not repeat "Ward" when the official name already ends in it', async () => {
    const en = await render('en', 94103);
    expect(en.title).toBe('Meta Four Ward 103, North Corp — GBA Election Candidates');
    expect(en.title).not.toContain('Ward Ward');
    expect(en.description).toContain('Meta Four (Ward 103,');
    const kn = await render('kn', 94103);
    expect(kn.title).toBe('ಮೆಟಾ ನಾಲ್ಕು ವಾರ್ಡ್ 103, ಉತ್ತರ ನಗರ ಪಾಲಿಕೆ — ಜಿಬಿಎ ಚುನಾವಣಾ ಅಭ್ಯರ್ಥಿಗಳು');
    expect(kn.title).not.toContain('ವಾರ್ಡ್ ವಾರ್ಡ್');
  });

  it('omits the old-ward clause when none is recorded', async () => {
    const en = await render('en', 93102);
    expect(en.description).toBe(
      'Meta Three (Ward 102, East Corporation): candidates, ward map, key areas and how to vote in the GBA election.',
    );
    const kn = await render('kn', 93102);
    expect(kn.description).toContain('(ವಾರ್ಡ್ 102, ಪೂರ್ವ ನಗರ ಪಾಲಿಕೆ):');
  });

  it.each(['en', 'kn'] as const)('%s: a repeated ward number is told apart by corporation', async (lang) => {
    const a = await render(lang, 94102);
    const b = await render(lang, 93102);
    expect(a.title).not.toBe(b.title);
    expect(a.title).toContain('102');
    expect(b.title).toContain('102');
  });

  it.each(['en', 'kn'] as const)('%s: Open Graph and Twitter titles match the <title>', async (lang) => {
    const m = await render(lang, 94101);
    expect(m.ogTitle).toBe(m.title);
    expect(m.twitterTitle).toBe(m.title);
  });
});

describe('Ward page summary under the H1 (task 207)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const w of WARDS) await db.insert(schema.wards).values(w).onConflictDoUpdate({ target: schema.wards.id, set: w });
    await db.delete(schema.wardOldWardOverlaps).where(inArray(schema.wardOldWardOverlaps.wardId, WARDS.map((w) => w.id)));
    await db.insert(schema.wardOldWardOverlaps).values(OVERLAPS);
  });

  it('en: states the ward, corporation, zone, constituency, reservation and old ward in server HTML', async () => {
    const m = await render('en', 94101);
    expect(m.summary).toBe(
      'Meta One is Ward 101 in the North Corporation. It is in the Zone T zone and the Test Assembly assembly constituency. ' +
        'Its reservation category is General. The ward lies within old BBMP ward 62.',
    );
  });

  it('kn: renders the Kannada summary with Kannada names', async () => {
    const m = await render('kn', 94101);
    expect(m.summary).toBe(
      'ಮೆಟಾ ಒಂದು, ಉತ್ತರ ನಗರ ಪಾಲಿಕೆಯ ವಾರ್ಡ್ 101 ಆಗಿದೆ. ಇದು Zone T ವಲಯ ಮತ್ತು ಪರೀಕ್ಷಾ ವಿಧಾನಸಭಾ ಕ್ಷೇತ್ರ ವಿಧಾನಸಭಾ ಕ್ಷೇತ್ರದಲ್ಲಿದೆ. ' +
        'ಇದರ ಮೀಸಲಾತಿ ವರ್ಗ ಸಾಮಾನ್ಯ. ಈ ವಾರ್ಡ್ ಹಳೆಯ ಬಿಬಿಎಂಪಿ ವಾರ್ಡ್ 62 ಒಳಗೆ ಇದೆ.',
    );
  });

  it('uses the plural old-ward sentence, and leaves it out when none is recorded', async () => {
    expect((await render('en', 94102)).summary).toContain('The ward includes parts of old BBMP wards 62, 63.');
    const none = await render('en', 93102);
    expect(none.summary).toContain('Meta Three is Ward 102 in the East Corporation.');
    expect(none.summary).not.toContain('old BBMP');
  });
});

describe('wardSummary', () => {
  const o = (n: number | null, bp: number) => ({ oldWardNumber: n, publishedOverlapBasisPoints: bp });
  const facts = {
    wardName: 'Doddabommasandra',
    wardNumber: 11,
    corporation: 'North',
    zone: 'Byatarayanapura',
    assembly: 'Byatarayanapura',
    reservation: 'General (Women)',
    oldWardOverlaps: [o(10, 8_580), o(9, 1_410)],
  };

  it('joins the sentences in order', () => {
    expect(wardSummary('en', facts)).toBe(
      'Doddabommasandra is Ward 11 in the North Corporation. It is in the Byatarayanapura zone and the Byatarayanapura assembly constituency. ' +
        'Its reservation category is General (Women). The ward includes parts of old BBMP wards 9, 10.',
    );
  });

  it('leaves out sentences whose facts are missing', () => {
    expect(wardSummary('en', { ...facts, assembly: null, reservation: null, oldWardOverlaps: [] })).toBe(
      'Doddabommasandra is Ward 11 in the North Corporation. It is in the Byatarayanapura zone.',
    );
  });

  it('chooses the old-ward wording by share, as the meta description does', () => {
    const only = (overlaps: ReturnType<typeof o>[]) => wardSummary('en', { ...facts, oldWardOverlaps: overlaps });
    expect(only([o(5, 9_900)])).toContain('The ward lies within old BBMP ward 5.');
    expect(only([o(5, 6_260)])).toContain('Most of the ward lies within old BBMP ward 5.');
    expect(only([o(5, 3_000)])).toContain('The ward includes part of old BBMP ward 5.');
    expect(only([o(5, 10_000), o(null, 0)])).toContain('The ward includes part of old BBMP ward 5.');
  });
});

describe('titleWardName', () => {
  it('drops a trailing "Ward" the template would repeat, in either language', () => {
    expect(titleWardName('en', 'Nele Maheshwaramma Temple Ward')).toBe('Nele Maheshwaramma Temple');
    expect(titleWardName('en', 'Raja Kempegowda ward')).toBe('Raja Kempegowda');
    expect(titleWardName('kn', 'ದೇವರಾಜ ಅರಸು ವಾರ್ಡ್‌')).toBe('ದೇವರಾಜ ಅರಸು');
    expect(titleWardName('en', 'Wardha Palya')).toBe('Wardha Palya');
    expect(titleWardName('en', 'Ward')).toBe('Ward');
  });
});

describe('oldWardsClause', () => {
  const o = (n: number | null, bp: number) => ({ oldWardNumber: n, publishedOverlapBasisPoints: bp });

  it('is empty with no usable old ward', () => {
    expect(oldWardsClause('en', [])).toBe('');
    expect(oldWardsClause('en', [o(null, 10_000)])).toBe('');
  });

  it('chooses the single-ward wording by share', () => {
    expect(oldWardsClause('en', [o(5, 10_000)])).toBe(', within old BBMP ward 5');
    expect(oldWardsClause('en', [o(5, 9_900)])).toBe(', within old BBMP ward 5');
    expect(oldWardsClause('en', [o(5, 9_550)])).toBe(', mostly within old BBMP ward 5');
    expect(oldWardsClause('en', [o(5, 6_260)])).toBe(', mostly within old BBMP ward 5');
    expect(oldWardsClause('en', [o(5, 3_000)])).toBe(', includes part of old BBMP ward 5');
  });

  it('never says "within" when an unnumbered old ward is also recorded', () => {
    expect(oldWardsClause('en', [o(5, 9_000), o(null, 1_000)])).toBe(', includes part of old BBMP ward 5');
    expect(oldWardsClause('en', [o(5, 10_000), o(null, 0)])).toBe(', includes part of old BBMP ward 5');
  });

  it('lists several, sorted, and uses the plural form', () => {
    expect(oldWardsClause('en', [o(63, 6_000), o(62, 4_000), o(9, 50)])).toBe(
      ', includes parts of old BBMP wards 9, 62, 63',
    );
  });
});
