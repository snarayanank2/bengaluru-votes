/**
 * Demo / fixture candidate detection (`scripts/seed-dev.ts` seeds slugs of
 * the form `demo-ward-<id>-candidate-<n>`, named "(FICTIONAL)"). Demo rows
 * must never be advertised to crawlers or LLMs: they are excluded from the
 * sitemaps, and their report cards are served `noindex`.
 */
export function isDemoCandidateSlug(slug: string): boolean {
  return slug.startsWith('demo-');
}
