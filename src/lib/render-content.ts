/**
 * Editorial content -> HTML renderer for the guide/explainer pages (Task 21;
 * architecture.md §9 "layer 2"). `src/i18n/content.ts` (Task 8) reads
 * `content/pages/{lang}/{slug}.md` as a RAW Markdown string via gray-matter
 * (not through Astro's content-collection renderer — see that module's
 * header for why). This is the one place that Markdown string is turned
 * into HTML for a page to `set:html`.
 *
 * Two things this does beyond a bare `marked.parse()`:
 *
 * 1. STRIPS HTML COMMENTS BEFORE PARSING. The content files carry
 *    `<!-- INPUT NEEDED: ... -->` / `<!-- CONFIRM: ... -->` authoring
 *    markers (see content/pages/en/*.md) that must never reach a visitor.
 *    marked does NOT drop HTML comments on its own — verified directly:
 *    `marked.parse('<!-- x -->')` returns the literal string `"<!--
 *    x -->"` in its output (block-level HTML, including comments, passes
 *    through marked's renderer verbatim per CommonMark's HTML-block rule).
 *    A browser wouldn't paint that text, but `set:html`'s source string
 *    would still literally contain "INPUT NEEDED", which is exactly what
 *    tests assert must NOT happen (grep the rendered HTML string, not the
 *    painted DOM) — so comments are removed from the Markdown source
 *    before it ever reaches marked, not left to marked/the browser to hide.
 *
 * 2. REWRITES ROOT-RELATIVE LINKS FOR THE REQUESTED LANGUAGE. Content
 *    files are authored once in English and the Kannada translation
 *    preserves links "exactly as given" (scripts/translate.ts's prompt
 *    rule) — so a Kannada content file's `[text](/voter-faqs)`
 *    link is still the bare English-canonical path, not
 *    `/kn/voter-faqs`. Left alone, a Kannada reader clicking a
 *    content link would silently drop back into English. This renderer's
 *    custom `marked.Renderer.link` runs every internal (root-relative)
 *    href through the same `localePath()` used everywhere else in the
 *    app; absolute/external hrefs (http(s), mailto, #fragment) are left
 *    untouched.
 *
 * SECURITY: content/pages/**\/*.md is repo-authored, not user input, so
 * feeding it to marked and `set:html`-ing the result is acceptable — see
 * the task brief. No `sanitize`/raw-HTML-passthrough option is enabled
 * beyond marked's own defaults; the comment-stripping above is the only
 * thing standing between an authoring marker and the rendered page, so
 * don't remove it.
 */
import { marked } from 'marked';
import { localePath, type Lang } from '../i18n';

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

function stripHtmlComments(markdown: string): string {
  return markdown.replace(HTML_COMMENT_RE, '');
}

/**
 * True for a link this renderer should localize: root-relative, not a bare
 * `#fragment`, and NOT protocol-relative (`//evil.example.com` starts with
 * `/` too, but is an external URL — treating it as internal would run it
 * through `localePath()` and mangle it into `/kn//evil.example.com`-style
 * nonsense instead of leaving it untouched like any other external href).
 */
function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function buildRenderer(lang: Lang) {
  const renderer = new marked.Renderer();
  const baseLink = renderer.link.bind(renderer);

  renderer.link = (token) => {
    const resolvedHref = isInternalHref(token.href) ? localePath(lang, token.href) : token.href;
    return baseLink({ ...token, href: resolvedHref });
  };

  return renderer;
}

/**
 * Render an editorial content page's Markdown body to an HTML string, safe
 * to pass to `set:html` inside `Prose.astro`. Comments are stripped and
 * internal links are localized for `lang` (see the module header).
 */
export function renderContentHtml(body: string, lang: Lang): string {
  const stripped = stripHtmlComments(body);
  return marked.parse(stripped, { renderer: buildRenderer(lang), gfm: true, async: false }) as string;
}

const H2_RE = /^## /gm;

/**
 * Splits a content body into an array of `## `-delimited section strings —
 * `[preamble, section0, section1, ...]` (the leading `preamble` is omitted
 * when the body starts directly with a heading). Each section string runs
 * from its own `## ` line up to (not including) the next one.
 *
 * Several guide pages (CheckRegistration, VoterId, FindBooth) need to
 * interleave a structural element — a guided link-out button, a lookup
 * form/island — BETWEEN two sections of otherwise-prose content, at the
 * exact point the content's own (now-stripped) `<!-- INPUT NEEDED -->`
 * marker sits. Splitting by HEADING COUNT rather than matching marker/
 * heading TEXT keeps this language-independent (the Kannada translation
 * has different heading text but the same heading STRUCTURE) — callers
 * join a prefix subset of the returned chunks, render it, insert their
 * element, then render the remaining chunks.
 */
export function splitMarkdownSections(markdown: string): string[] {
  const indices: number[] = [];
  for (const match of markdown.matchAll(H2_RE)) {
    indices.push(match.index);
  }
  if (indices.length === 0) return [markdown];

  const chunks: string[] = [];
  if (indices[0] > 0) chunks.push(markdown.slice(0, indices[0]));
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : markdown.length;
    chunks.push(markdown.slice(start, end));
  }
  return chunks;
}

/**
 * Extracts genuine question/answer pairs from a content body's `## `
 * sections, for `src/lib/seo.ts#faqLd` (Task 56; HowToVote.astro is the
 * one guide page whose content is fully authored as question-shaped `##`
 * headings — see that page's own docstring).
 *
 * A section only becomes a FAQ entry when its heading text itself ends in
 * `?` — a non-question section title (were one ever added to this content)
 * is simply skipped, never forced into a fabricated Q&A pairing. The
 * answer is the section's remaining Markdown, rendered to HTML and then
 * stripped to plain text (schema.org's `Answer.text` wants text, not
 * markup) — comments are stripped first, same as `renderContentHtml`, so
 * an authoring marker never leaks into a FAQ answer either.
 */
export function extractFaqEntries(body: string): { question: string; answer: string }[] {
  const stripped = stripHtmlComments(body);
  const sections = splitMarkdownSections(stripped).filter((section) => section.startsWith('## '));
  const entries: { question: string; answer: string }[] = [];

  for (const section of sections) {
    const newlineIndex = section.indexOf('\n');
    const headingLine = newlineIndex === -1 ? section : section.slice(0, newlineIndex);
    const question = headingLine.replace(/^##\s+/, '').trim();
    if (!question.endsWith('?')) continue;

    const rest = newlineIndex === -1 ? '' : section.slice(newlineIndex + 1);
    const answerHtml = marked.parse(rest, { gfm: true, async: false }) as string;
    const answerText = answerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (answerText) entries.push({ question, answer: answerText });
  }

  return entries;
}
