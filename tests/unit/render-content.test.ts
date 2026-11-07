import { describe, it, expect } from 'vitest';
import { renderContentHtml, splitMarkdownSections, extractFaqEntries } from '../../src/lib/render-content';

describe('renderContentHtml (src/lib/render-content.ts)', () => {
  it('renders Markdown headings/paragraphs/lists to HTML', () => {
    const html = renderContentHtml('## A question heading?\n\nSome body text.\n\n- one\n- two\n', 'en');
    expect(html).toContain('<h2>A question heading?</h2>');
    expect(html).toContain('<p>Some body text.</p>');
    expect(html).toContain('<li>one</li>');
  });

  it('strips HTML comments (INPUT NEEDED / CONFIRM markers) entirely from the output', () => {
    const md = 'Visible before.\n\n<!-- INPUT NEEDED: secret official URL -->\n\nVisible after.\n\n<!-- CONFIRM: something -->\n';
    const html = renderContentHtml(md, 'en');
    expect(html).not.toContain('INPUT NEEDED');
    expect(html).not.toContain('CONFIRM');
    expect(html).not.toContain('<!--');
    expect(html).toContain('Visible before.');
    expect(html).toContain('Visible after.');
  });

  // Page CSS cannot reach markdown output, so the renderer applies the shared
  // body-link class (forest, underlined, 44px) to every link it writes.
  it('marks every rendered link as a body link, internal or external', () => {
    const html = renderContentHtml('[a](/voter-faqs), [b](https://example.org/x "t") and [c](mailto:x@example.org)', 'en');
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) expect(anchor).toMatch(/^<a class="body-link" href="/);
    expect(html).toContain('title="t"');
  });

  it('leaves EN internal links unprefixed', () => {
    const html = renderContentHtml('[link](/check-registration) and [home](/)', 'en');
    expect(html).toContain('href="/check-registration"');
    expect(html).toContain('href="/"');
  });

  it('rewrites internal links with the /kn prefix for lang=kn (including root "/")', () => {
    const html = renderContentHtml('[link](/check-registration) and [home](/)', 'kn');
    expect(html).toContain('href="/kn/check-registration"');
    expect(html).toContain('href="/kn/"');
  });

  it('leaves external (http/https) links untouched for both languages', () => {
    const md = '[ext](https://example.com/path)';
    expect(renderContentHtml(md, 'en')).toContain('href="https://example.com/path"');
    expect(renderContentHtml(md, 'kn')).toContain('href="https://example.com/path"');
  });

  it('treats a protocol-relative link (`//example.com`) as external, not internal — never rewritten to /kn//...', () => {
    const md = '[ext](//example.com/path)';
    expect(renderContentHtml(md, 'en')).toContain('href="//example.com/path"');
    const kn = renderContentHtml(md, 'kn');
    expect(kn).toContain('href="//example.com/path"');
    expect(kn).not.toContain('/kn//example.com');
  });
});

describe('splitMarkdownSections (src/lib/render-content.ts)', () => {
  it('splits a preamble + 3 headings into 4 chunks, each starting at its own heading', () => {
    const md = 'Intro para.\n\n## First?\n\nBody one.\n\n## Second?\n\nBody two.\n\n## Third?\n\nBody three.\n';
    const chunks = splitMarkdownSections(md);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toBe('Intro para.\n\n');
    expect(chunks[1].startsWith('## First?')).toBe(true);
    expect(chunks[2].startsWith('## Second?')).toBe(true);
    expect(chunks[3].startsWith('## Third?')).toBe(true);
    // Rejoining reproduces the original body exactly.
    expect(chunks.join('')).toBe(md);
  });

  it('omits the preamble chunk when the body starts directly with a heading', () => {
    const md = '## Only heading\n\nBody.\n';
    const chunks = splitMarkdownSections(md);
    expect(chunks).toEqual(['## Only heading\n\nBody.\n']);
  });

  it('returns the whole body as a single chunk when there are no ## headings', () => {
    const md = 'Just a paragraph, no headings at all.\n';
    expect(splitMarkdownSections(md)).toEqual([md]);
  });

  it('a subsection heading (###) does not create a new chunk boundary', () => {
    const md = '## Section\n\nBody.\n\n### Subsection\n\nMore body.\n\n## Next section\n\nX.\n';
    const chunks = splitMarkdownSections(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('### Subsection');
  });
});

describe('extractFaqEntries (src/lib/render-content.ts, Task 56)', () => {
  it('extracts a question/answer pair per question-shaped ## heading', () => {
    const md = '## Can I vote NOTA?\n\nYes, NOTA is a valid option.\n\n## What do I bring?\n\nYour EPIC card.\n';
    const entries = extractFaqEntries(md);
    expect(entries).toEqual([
      { question: 'Can I vote NOTA?', answer: 'Yes, NOTA is a valid option.' },
      { question: 'What do I bring?', answer: 'Your EPIC card.' },
    ]);
  });

  it('skips a non-question heading — never fabricates a Q&A pairing', () => {
    const md = '## Overview\n\nSome intro text.\n\n## Can I vote NOTA?\n\nYes.\n';
    const entries = extractFaqEntries(md);
    expect(entries).toEqual([{ question: 'Can I vote NOTA?', answer: 'Yes.' }]);
  });

  it('strips HTML comments (authoring markers) out of the answer text', () => {
    const md = '## Can I vote NOTA?\n\n<!-- INPUT NEEDED: confirm -->Yes, it is valid.\n';
    const entries = extractFaqEntries(md);
    expect(entries[0].answer).not.toContain('INPUT NEEDED');
    expect(entries[0].answer).toContain('Yes, it is valid.');
  });

  it('renders the answer as plain text, not markup, even when the section has lists/links', () => {
    const md = '## What do I need?\n\n- [Item one](/one)\n- Item two\n';
    const entries = extractFaqEntries(md);
    expect(entries[0].answer).not.toContain('<');
    expect(entries[0].answer).toContain('Item one');
    expect(entries[0].answer).toContain('Item two');
  });

  it('returns an empty array when the body has no ## headings at all', () => {
    expect(extractFaqEntries('Just a paragraph.\n')).toEqual([]);
  });
});
