/**
 * Demo / test candidate detection. Such rows must never be advertised to
 * crawlers or LLMs: they are excluded from the sitemaps, and their report
 * cards are served `noindex`.
 *
 * Two kinds exist in practice:
 *   - seeded fixtures (`scripts/seed-dev.ts`): slug `demo-ward-<id>-candidate-<n>`,
 *     named "(FICTIONAL)";
 *   - affidavit-pipeline trial loads, marked in the NAME only — "TEST N. Jayapala"
 *     (slug `2001-n-jayapala`, no hint of "test"), "TEST Avvayi (TEST)",
 *     "Sathish Reddy M (TEST 2023 Assembly)".
 * Hence the check looks at both slug and English name. The name patterns are
 * deliberately case-sensitive (an upper-case TEST marker, not a person called
 * "Test").
 */
export function isTestCandidate(candidate: { slug: string; nameEn?: string | null }): boolean {
  if (candidate.slug.startsWith('demo-')) return true;
  const name = candidate.nameEn ?? '';
  return /^TEST\b/.test(name) || /\(TEST\b/.test(name) || /\(FICTIONAL\)/i.test(name);
}
