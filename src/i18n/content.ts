// Editorial content layer (architecture.md §9, "layer 2": repo Markdown per
// locale — content/pages/en/*.md, content/pages/kn/*.md). This module is the
// ONE runtime mechanism pages use to read that content; it also backs
// tests/unit/content.test.ts directly (no Astro runtime required).
//
// A parallel Astro-side collection is defined in src/content.config.ts using
// the same Zod schema (imported from here) so `getCollection('pages')` /
// `getEntry('pages', id)` work inside .astro templates too, e.g. for content
// authors who want Astro's built-in Markdown rendering. The two are kept in
// sync by construction: they read the same files and validate against the
// same schema. See the "mechanism chosen" note in the Task 8 report — plain
// `astro:content` is a virtual module and isn't resolvable under vitest, so
// getPageContent() below reads the filesystem directly with gray-matter
// instead of going through Astro's content-layer store.

import { readFileSync } from 'node:fs';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Lang } from './index';

export const pageFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string(),
  // Only present in content/pages/kn/*.md — a hash of the English source the
  // Kannada file was generated from, used by the Task 9 staleness check.
  sourceHash: z.string().optional(),
  // Page-specific translation-hint overrides (architecture §9): "render X as
  // Y, not a literal translation". Site-wide terms belong in glossary.json
  // instead; hints here are for a single page's wording.
  hints: z.array(z.string()).optional(),
  // EN files only: the date (YYYY-MM-DD, quoted so YAML keeps it a string) the
  // page's wording last changed. Feeds the sitemap `<lastmod>`
  // (src/lib/seo/sitemaps.ts); authors bump it when they edit the page.
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type PageFrontmatter = z.infer<typeof pageFrontmatterSchema>;

export interface PageEntry extends PageFrontmatter {
  /** The page slug, e.g. "about". */
  slug: string;
  /**
   * The language the returned content is actually authored in. Equal to the
   * requested `lang` unless `fallback` is true.
   */
  lang: Lang;
  /** Raw Markdown body (unrendered) — pages render it with their own Markdown pipeline. */
  body: string;
  /**
   * True when a `kn/` file was requested but did not exist yet, so the EN
   * entry was returned instead (architecture §9: "renders authored
   * language" — never a missing page while Task 9's generator catches up).
   */
  fallback: boolean;
}

// content/pages/ lives at the repo root, not under src/ — resolve relative to
// this module's own location so the lookup is independent of process.cwd().
const CONTENT_ROOT = new URL('../../content/pages/', import.meta.url);

function readPageFile(lang: Lang, slug: string): PageEntry | null {
  const fileUrl = new URL(`${lang}/${slug}.md`, CONTENT_ROOT);
  let raw: string;
  try {
    raw = readFileSync(fileUrl, 'utf-8');
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  const frontmatter = pageFrontmatterSchema.parse(data);
  return { ...frontmatter, slug, lang, body: content.trim(), fallback: false };
}

/**
 * Look up an editorial content page by language and slug.
 *
 * - Unknown slug → `null`.
 * - `kn` requested but the file doesn't exist yet (Task 9 hasn't generated
 *   it) → the EN entry, with `lang: 'en'` and `fallback: true`.
 */
export function getPageContent(lang: Lang, slug: string): PageEntry | null {
  const entry = readPageFile(lang, slug);
  if (entry) return entry;
  if (lang === 'kn') {
    const enEntry = readPageFile('en', slug);
    if (enEntry) return { ...enEntry, fallback: true };
  }
  return null;
}
