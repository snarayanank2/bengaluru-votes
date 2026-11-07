# English readability test

CI requires each of the eight live reading pages to score **above 65** on Flesch Reading Ease. It compares the unrounded score, and reports the page and score on failure. This is an estimate of reading difficulty, not a test of accuracy or understanding. Preserve needed instructions and disclosures when simplifying text.

Run locally (no database or app needed):

```sh
python3 -m venv /tmp/bv-readability-venv
/tmp/bv-readability-venv/bin/pip install -r tests/readability/requirements.txt
export NLTK_DATA=/tmp/bv-readability-nltk
/tmp/bv-readability-venv/bin/python tests/readability/setup_dictionary.py
/tmp/bv-readability-venv/bin/python -m unittest discover -s tests/readability -v
```

This separate Python check runs in the shared CI gate, alongside `npm test`. Python is not needed by the site or added to its production image. Dependencies and the CMU pronunciation dictionary are pinned to preserve the scoring method used in the original audit. Dictionary setup requires network access; scoring does not.

## What counts

- Homepage: hero statement and explanatory copy.
- Live editorial pages: About, About the election, Voter FAQs, Privacy and Terms. Count paragraphs and list items once; omit headings, frontmatter, comments and update dates.
- Curator and transcriber guides: guide instructions, shared field-entry rules and account help. Curator instructions also include flag-review guidance. Exclude metadata, headings, back links and the unused `curator.guide.matching.body` string.

The selectors live in `passages()` in `test_readability.py`. Update them when adding a reading page or moving its text. New paragraphs in the existing editorial pages and new guide strings in their namespaces are picked up automatically.

Navigation, controls, footer, database content, legacy unrouted pages and Kannada are excluded. Flesch's English formula does not assess Kannada.

## Calculation

Use textstat with `en_US`: `206.835 - 1.015 × words / sentences - 84.6 × syllables / words`. Sum word, sentence and syllable counts across a page's blocks before applying the formula. Each block has at least one sentence. Do not average block scores or round before checking the threshold.

Normalize curly apostrophes and dash separators; omit URLs, email addresses and runtime placeholders. Expand the education-level list from the source. The dependency versions, dictionary and extraction rules match the original audit. Syllable estimates can still be wrong for local names and acronyms.
