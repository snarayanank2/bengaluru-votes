"""English body-text regression gate; see README.md for scope and setup."""
import json
import re
import unittest
from pathlib import Path

import nltk
import textstat
from bs4 import BeautifulSoup
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
# Fail rather than allowing textstat to silently download a different dictionary.
nltk.data.find('corpora/cmudict')
textstat.set_lang('en_US')

def clean(text):
    text = re.sub(r'\{[^}]+\}', '', text)
    text = re.sub(r'https?://\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]+', '', text)
    text = text.replace('’', "'").replace('—', ' ').replace('–', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def stats(blocks):
    blocks = [clean(block) for block in blocks if clean(block)]
    words = sum(textstat.lexicon_count(block, removepunct=True) for block in blocks)
    sentences = sum(max(1, textstat.sentence_count(block)) for block in blocks)
    syllables = sum(textstat.syllable_count(block) for block in blocks)
    score = 206.835 - 1.015 * words / sentences - 84.6 * syllables / words if words else None
    return {'words': words, 'sentences': sentences, 'syllables': syllables, 'score': score}


def mdblocks(raw):
    raw = re.sub(r'^---\n.*?\n---\n', '', raw, flags=re.S)
    raw = re.sub(r'<!--.*?-->', '', raw, flags=re.S)
    soup = BeautifulSoup(MarkdownIt().render(raw), 'html.parser')
    # Reading passages only: no headings, frontmatter, TOC or update date.
    blocks = []
    for node in soup.select('p, li'):
        if node.name == 'li':
            # Paragraphs and nested list items are visited separately.
            node = BeautifulSoup(str(node), 'html.parser').li
            for child in node.select('ul, ol, p'):
                child.decompose()
        text = node.get_text(' ', strip=True)
        if text and not text.startswith('Last updated:'):
            blocks.append(text)
    return blocks


def passages():
    en = json.loads((ROOT / 'src/i18n/en.json').read_text())
    source = (ROOT / 'src/lib/affidavit-extraction.ts').read_text()
    levels = ', '.join(re.findall(r"'([^']+)'", source.split('export const EDUCATION_LEVELS = [')[1].split('] as const')[0]))
    def strings(keys):
        return [en[k].replace('{levels}', levels) for k in keys]
    pages = {}
    for name in ['about', 'about-election', 'voter-faqs', 'privacy', 'terms']:
        pages[name] = mdblocks((ROOT / f'content/pages/en/{name}.md').read_text())
    home = ['home.hero.heading', 'home.hero.subheading']
    home += [f'home.whyVote.paragraph{x}' for x in range(1, 6)]
    home += ['home.whyVote.closing']
    home += [f'home.basics.item{x}.body' for x in range(1, 4)]
    home += ['home.shortcuts.findBooth.description']
    pages['Homepage'] = strings(home)
    shared = ['staff.entry.intro']
    shared += ['staff.entry.answers.' + x for x in ['value', 'notDeclared', 'unreadable', 'partial']]
    shared += ['staff.entry.fields.' + x for x in ['nameParty', 'lists', 'education', 'assets', 'cases']]
    shared += ['staff.entry.never.body', 'staff.basics.account', 'staff.basics.idle', 'staff.basics.keyboard']
    for role in ['curator', 'transcribe']:
        keys = [k for k in en if k.startswith(role + '.guide.')
                and '.meta.' not in k and not k.endswith(('.heading', '.back'))
                and k != 'curator.guide.matching.body']
        keys += shared + ['staff.basics.errors.' + ('transcriber' if role == 'transcribe' else role)]
        if role == 'curator':
            keys += ['flag.review.guide']
        pages[role + ' guide'] = strings(keys)
    return pages


class ReadabilityTests(unittest.TestCase):
    def test_live_reading_pages(self):
        for page, blocks in passages().items():
            with self.subTest(page=page):
                result = stats(blocks)
                self.assertGreater(result['words'], 0, f'{page}: no readable text extracted')
                print(f"{page}: {result['score']:.2f} ({result['words']} words)", flush=True)
                self.assertGreater(result['score'], 65,
                    f"{page}: Flesch Reading Ease {result['score']:.2f}; must be above 65. "
                    'Use shorter sentences and familiar words; preserve required instructions.')

    def test_markdown_excludes_non_prose(self):
        self.assertEqual(mdblocks('---\ntitle: Hidden\n---\n# Heading\n'
            '<!-- hidden -->\nLast updated: today\n\nRead this.\n\n- First item.\n- Second item.\n'),
            ['Read this.', 'First item.', 'Second item.'])

    def test_nested_lists_count_each_passage_once(self):
        self.assertEqual(mdblocks('- Parent.\n  - Child.\n  - Another child.\n'),
                         ['Parent.', 'Child.', 'Another child.'])
        self.assertEqual(mdblocks('- First paragraph.\n\n  Second paragraph.\n'),
                         ['First paragraph.', 'Second paragraph.'])

    def test_cleanup(self):
        self.assertEqual(clean('We’re here—see https://example.org or a@example.org {name}.'),
                         "We're here see or .")

    def test_counts_and_formula(self):
        result = stats(['The cat sat on the mat.'])
        self.assertEqual((result['words'], result['sentences'], result['syllables']), (6, 1, 6))
        self.assertAlmostEqual(result['score'], 116.145)
        self.assertLess(stats(['Institutional administrators systematically operationalize multidimensional methodological frameworks.'])['score'], 65)


if __name__ == '__main__':
    unittest.main()
