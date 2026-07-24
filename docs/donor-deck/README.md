# Donor deck

Two builds from one script. **Do not edit the `.pptx` files by hand** — edit the
words in [`../donor-narrative.md`](../donor-narrative.md), carry the change into
`build.js`, and regenerate. The narrative is the source of truth.

| File | Slides | Use |
|---|---|---|
| `Oorvani-GBA-Ward-Accountability-2026.pptx` | 23 | **The donor build.** Send this one. |
| `Oorvani-GBA-Deck-INTERNAL.pptx` | 24 | Adds a closing checklist of everything still unconfirmed, and marks the missing contact details. Never send this. |

## Regenerating

```sh
npm install pptxgenjs
node build.js              # donor build
INTERNAL=1 node build.js   # internal build
```

Output paths are set at the bottom of `build.js`.

## Before it goes to a donor

The internal build's last slide carries the full list. The two that would be
noticed immediately:

- **The contact slide has no email or phone.** Deliberately left blank rather
  than invented. It has to be added.
- **The budget rates are estimates**, built from Oorvani's FY 2024-25 audited
  consultancy cost base rather than from confirmed pay bands. Engineering is the
  least certain line — the foundation has not contracted full-time engineers
  before.

## Design notes

Layout rules that the QA passes established, worth keeping if you edit `build.js`:

- **Every text box sets `valign: "top"`.** pptxgenjs centres vertically by
  default, which silently collapses the gap between a card's title and its body
  and misaligns single-line labels against multi-line ones.
- **Card titles and bodies live in one rich-text box**, not two. This is what
  makes it impossible for them to overprint each other when copy changes.
- **One grid throughout:** content spans x 0.62″–9.36″, three columns of 2.78″ or
  two of 4.27″, 0.2″ gutters, content starting at y 1.56″.
- **Palette is deliberately non-partisan** — ink, civic teal, amber. No saffron,
  no party blues or greens. The platform's product is neutrality; the deck should
  not undercut it.
- The ward-grid motif on dark slides is 369 wards in miniature, with a handful
  lit in amber.

## Figures

Every number reconciles three ways, and should continue to:

- By year: ₹1.06 Cr + ₹1.24 Cr
- By city: Bengaluru ₹1.91 Cr + second city ₹39 L
- By component: bridge ₹25 L + programme ₹2.05 Cr

All equal **₹2.30 crore**.
