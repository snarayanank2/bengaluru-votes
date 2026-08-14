# GBA Elections Citizen Platform — Design System

**Status:** Draft v1 · **Applies to:** `bengaluruvotes.opencity.in` · **Date:** July 2026

This document defines the visual language for the platform: tokens, typography, components, and the rules that keep the interface trustworthy and neutral. It is the reference for anyone building a page from `docs/information-architecture.md`.

The platform is a subdomain of [opencity.in](https://opencity.in/), run by the same operator (Oorvani Foundation). Open City has no formal design system, but its site has a consistent identity — a forest-green and yellow palette, Manrope headings, PT Sans body — and this system extends that identity so the subdomain reads as part of the family. All Open City values below were taken from the live site's theme presets in July 2026.

---

## 1. Principles

1. **Trust is the product.** The visual language must read as civic and institutional, never promotional. Flat surfaces, generous whitespace, visible sources. No marketing gradients, no urgency theatrics — the only countdown that shouts is a real statutory deadline.
2. **Neutral by construction.** Color never encodes a party, a candidate, or a judgment about either. See §4 — these rules are load-bearing, not stylistic.
3. **Mobile-first, low-end-first.** The typical session is a WhatsApp-forwarded link opened on a mid-range Android phone. Prefer system-cheap rendering: borders over shadows, solid colors over gradients, minimal motion, small font payloads.
4. **Bilingual parity.** Kannada is a first-class script, not a translation afterthought. Every type decision is made twice — once for Latin, once for Kannada — and the system encodes both (§5.3).
5. **One system, four roles.** Citizen, curator, and admin screens share the same tokens and components. Curator/admin screens are denser but not differently branded.

---

## 2. Color

### 2.1 Primitives

Named hex values. The first six come directly from Open City's palette; grays and tints are derived here.

| Token | Hex | Origin | Use |
|---|---|---|---|
| `--oc-forest` | `#426133` | Open City accent-1 | Primary brand color |
| `--oc-leaf` | `#5e8b48` | Open City logo green | Decorative/large elements only (fails AA for small text) |
| `--oc-lime` | `#c8e537` | Open City accent-2 | Accent on dark green surfaces only |
| `--oc-sun` | `#ffd527` | Open City accent-6 | Highlight chips, deadline banners (always with black text) |
| `--oc-brick` | `#a62635` | Open City deep red | Error/destructive text and actions |
| `--oc-rose` | `#d33a4c` | Open City contrast red | Large error accents, icons |
| `--ink` | `#1a1a1a` | derived | Primary text |
| `--gray-600` | `#616161` | Open City accent-4 | Secondary text (smallest use: 14px+) |
| `--gray-300` | `#c1c1c1` | Open City accent-5 | Borders, disabled states |
| `--gray-100` | `#f0f0f0` | derived | Subtle surfaces, table stripes |
| `--forest-tint` | `#eef3ea` | derived from forest | Selected states, success surfaces |
| `--sun-tint` | `#fff8d6` | derived from sun | Deadline/notice surfaces |
| `--brick-tint` | `#faeceb` | derived from brick | Error surfaces |
| `--white` | `#ffffff` | — | Page background |
| `--oc-black` | `#000000` | Open City accent-3 | Footer surface (§7.2) — the one black surface |

### 2.2 Semantic tokens

Components consume semantic tokens, never primitives. This keeps a future dark theme possible without touching components (dark mode is out of scope this release).

| Token | Value | Use |
|---|---|---|
| `--color-text` | `--ink` | Body text |
| `--color-text-muted` | `--gray-600` | Captions, timestamps, helper text |
| `--color-bg` | `--white` | Page background |
| `--color-surface` | `--gray-100` | Cards on white, zebra rows |
| `--color-border` | `--gray-300` | Card and input borders, dividers |
| `--color-primary` | `--oc-forest` | Buttons, links, active nav, focus rings |
| `--color-primary-surface` | `--forest-tint` | Selected/success backgrounds |
| `--color-accent` | `--oc-sun` | Deadline banners, highlight chips |
| `--color-accent-surface` | `--sun-tint` | Notice backgrounds |
| `--color-danger` | `--oc-brick` | Error text, destructive buttons |
| `--color-danger-surface` | `--brick-tint` | Error backgrounds |
| `--color-on-primary` | `--white` | Text on forest |
| `--color-on-accent` | `--ink` | Text on sun yellow |
| `--color-footer` | `--oc-black` | Footer background (§7.2) |
| `--color-on-footer` | `--oc-lime` | Footer text and links |

### 2.3 Contrast (checked, WCAG 2.1)

| Pair | Ratio | Verdict |
|---|---|---|
| `#426133` forest on white | 7.0:1 | AA + AAA — safe for text at any size |
| `#a62635` brick on white | 7.1:1 | AA + AAA — safe for error text |
| `#d33a4c` rose on white | 4.7:1 | AA normal text only — prefer brick for text, rose for ≥19px or icons |
| `#5e8b48` leaf on white | 4.0:1 | Large text (≥19px bold / 24px) and graphics only |
| `#616161` gray-600 on white | 5.7:1 | AA — fine for secondary text |
| `#1a1a1a` ink on `#ffd527` sun | 13.9:1 | AAA — the only text treatment allowed on yellow |
| `#c8e537` lime on `#426133` forest | 4.9:1 | AA — accent text on dark green panels |
| `#c8e537` lime on `#000000` black | 15.0:1 | AAA — the footer's text and links (§7.2) |

Never place white text on sun, lime, or leaf. Never place lime or sun on white as text.

---

## 3. Provenance styling — the signature

Every data field on a report card carries a visible source (PRD §11). This source treatment is the platform's visual signature: it appears identically on report cards, compare columns, ward pages, and curator screens, so a screenshot of any field is self-attributing.

**Field row anatomy:** label (muted, 14px) → value (ink, 16px) → source line. The source line is one line, 13px, muted, prefixed by a source badge:

| Badge | Style | Meaning |
|---|---|---|
| **Affidavit** | Forest text on `--forest-tint`, links to the stored affidavit PDF | Official EC affidavit data |
| **Curator-compiled** | Gray-600 text on `--gray-100` | Context compiled and sourced by a curator |
| **AI-extracted** | Ink text on `--sun-tint`, with a dotted `--oc-sun` border | Affidavit data extracted by AI, not yet curator-confirmed (PRD §5.2) |

Rules:

- The badge colors above are reserved. Nothing else on a content page may use `--forest-tint` or `--sun-tint` chips, so a glance always answers "where did this come from."
- When a curator confirms an AI-extracted field, the badge changes to Affidavit — same position, no layout shift.
- A field with no data renders as "Not declared" in muted italic with its source line intact. Absence of data is data.

---

## 4. Neutrality rules

These rules exist because Indian party identities are color identities. Violating them turns a layout choice into an endorsement.

1. **Party identity is text plus ECI symbol only.** A candidate's party appears as its name and official symbol image. Never assign a color, tint, or accent to a party or candidate — not in lists, compare columns, charts, or maps.
2. **No saffron/orange anywhere in the UI.** It cannot appear without reading as partisan. The palette contains no orange; do not add one.
3. **Identical visual weight for all candidates.** Same card size, same photo treatment, same field order, same type scale. Ordering is alphabetical or as specified by the PRD, never editorially ranked.
4. **Semantic colors describe system state, not people.** Green means "your action succeeded," red means "this action failed or deletes something." A criminal-cases field or asset figure is set in plain ink like any other value — the data speaks without alarm coloring.
5. **Issue-vote results use one hue.** Ranked issue bars are all `--oc-forest` at full opacity with a `--gray-100` track. Rank is conveyed by order and number, not by color.
6. **Photography is documentary.** Candidate photos as submitted/sourced, uncropped beyond a consistent aspect ratio, no filters or duotones.

---

## 5. Typography

### 5.1 Families

| Role | Latin | Kannada | Weights |
|---|---|---|---|
| Headings, buttons, data figures | **Manrope** | **Noto Sans Kannada** | 500, 700, 800 |
| Body, forms, captions | **PT Sans** | **Noto Sans Kannada** | 400, 700 |

Manrope and PT Sans come from Open City; neither contains Kannada glyphs, so Noto Sans Kannada rides in every stack and renders whichever glyphs the Latin face lacks:

```css
--font-heading: Manrope, "Noto Sans Kannada", system-ui, sans-serif;
--font-body: "PT Sans", "Noto Sans Kannada", system-ui, sans-serif;
```

**Self-host all three as subset woff2** (`font-display: swap`). No Google Fonts CDN — it leaks visitor IPs to a third party, which contradicts the privacy stance (`/privacy`), and adds a cross-origin round trip on slow networks. Kannada subsetting must keep the full conjunct set; test with real ward names, not lorem ipsum.

Use `font-variant-numeric: tabular-nums` (Manrope) for countdowns, vote counts, and the `/data` metrics so digits don't jitter as they change.

### 5.2 Scale

Mobile-first; the two largest steps grow at the `md` breakpoint.

| Token | Size (mobile / ≥md) | Line height | Use |
|---|---|---|---|
| `--text-xs` | 13px | 1.4 | Source lines, timestamps |
| `--text-sm` | 14px | 1.5 | Field labels, captions, table headers |
| `--text-base` | 16px | 1.5 | Body, inputs, buttons |
| `--text-lg` | 18px | 1.5 | Lead paragraphs |
| `--text-xl` | 20px | 1.3 | Card titles, H3 |
| `--text-2xl` | 24px | 1.25 | H2, modal titles |
| `--text-3xl` | 28px / 32px | 1.2 | H1 |
| `--text-4xl` | 32px / 40px | 1.1 | Home hero, countdown figure |

Body text is never below 16px; nothing interactive is below 14px.

### 5.3 Kannada rules

Kannada conjuncts stack vertically and clip at Latin line heights. On every `/kn/` page (`:lang(kn)`):

- Line height increases one step: body 1.5 → 1.7, headings 1.2–1.3 → 1.4.
- `letter-spacing` is always `normal`. Latin tracking tweaks break Kannada shaping.
- **No uppercase styling anywhere in the system** — Kannada has no case, so a design that leans on caps degrades in half the product. Emphasis comes from weight and size only.
- Buttons, chips, and the app bar get ~2px extra vertical padding via a `:lang(kn)` override rather than per-component tweaks.
- Kannada strings run roughly 10–20% longer than English. Components must tolerate two-line labels: buttons wrap, tabs scroll, nothing truncates a translated label with an ellipsis.

### 5.4 Voice

Sentence case everywhere: headings, buttons, labels. Buttons name the action's outcome ("Check my registration", "Submit flag"), not the mechanism ("Submit", "OK"). Plain verbs, no civic jargon — "ward" is the only term of art, and `/about-election` explains it.

---

## 6. Layout, spacing, shape

### 6.1 Spacing

4px base scale: `--space-1` through `--space-12` = 4, 8, 12, 16, 24, 32, 48, 64px (plus intermediate steps as needed). Component-internal spacing uses 4–16; between-section spacing uses 24–64.

### 6.2 Breakpoints and containers

| Token | Width | Notes |
|---|---|---|
| `--bp-sm` | 480px | Large phones |
| `--bp-md` | 768px | Tablet; type scale steps up |
| `--bp-lg` | 1024px | Desktop; compare grid widens |

Containers: `--container-prose` 42rem (guides, legal, about pages), `--container-app` 64rem (ward pages, compare, curator/admin tables). Side padding 16px mobile, 24px ≥md. Layouts are single-column below `md`; nothing depends on hover.

### 6.3 Shape and elevation

- Radius: `--radius-sm` 6px (buttons, inputs), `--radius-md` 8px (cards, modals), `--radius-full` (chips, badges).
- Elevation is border-first: cards are `1px solid --color-border` on white. Only two shadows exist: `--shadow-sticky` (app bar when scrolled) and `--shadow-modal` (modals, toasts). Nothing else floats.

---

## 7. Components

### 7.1 App bar (global)

White, 56px, sticky, `--shadow-sticky` on scroll. Left: Open City-family logo lockup linking to `/`. Right: language toggle and Sign in / Account. Active nav state: 2px `--oc-forest` underline.

**Language toggle:** a two-segment control, `EN | ಕನ್ನಡ`, each label always in its own script regardless of current language. Active segment: forest text on `--forest-tint`. It navigates to the same path in the other language (IA §1).

### 7.2 Footer (global)

Black (`#000000`) background, lime (`#c8e537`) text — the one dark surface in the system, and the same treatment Open City uses for its own footer. Two columns in a 2:1 split at `md` and up, stacked below it:

- **Left (2fr):** the trust links (About, Voting guide, Data, Partner with us, Press, Terms, Privacy), as a list — two sub-columns from `sm` up. Nav links carry no underline until hover/focus (§7.4).
- **Right (1fr):** "A joint project by" over the Janaagraha and Oorvani Foundation logos, then Open City's X, LinkedIn and Instagram links as icons.

Both partner logos are dark-on-transparent, so each sits on a white `--radius-sm` chip rather than being recolored — a partner's mark is theirs to set, and inverting it would drop Oorvani's red dot. The logos sit side by side wherever they fit and stack in the narrower `md` column; they're never scaled below their legible size to avoid it.

Social icons are 24px marks in 44×44 targets (§7.3), drawn in the footer's own lime rather than Open City's sun-yellow — here yellow is reserved for statutory deadlines and the AI-extracted badge (§7.6). They're icon-only links, so each carries the platform name as its accessible name instead of §7.4's external-link glyph.

### 7.3 Buttons

| Variant | Style | Use |
|---|---|---|
| Primary | White on `--oc-forest`, radius-sm | One per view: the main action |
| Secondary | Forest text, 1.5px forest border, white fill | Alternate actions |
| Tertiary | Forest text, no border, underline on hover/focus | Inline low-stakes actions |
| Destructive | White on `--oc-brick` | Reject, delete, retire — curator/admin only |

Minimum target 44×44px; text 16px, Manrope 700. Loading state replaces the label with a spinner but holds the button's width. Disabled: `--gray-300` fill, `--gray-600` text — used only for genuinely unavailable actions, never to hide a gated one (§7.8).

### 7.4 Links

Forest, underlined in body text (color alone fails color-blind users); nav and card-title links may drop the underline when context makes them obvious. External links (EC/CEO Karnataka lookups) get an external-link glyph — the guided link-out on `/check-registration` is a primary-button-styled link with the glyph, so leaving the platform is explicit.

### 7.5 Cards and field rows

Cards: white, border, radius-md, 16px padding. The **candidate row** (photo 56px circle, name in `--text-xl` Manrope 700, party name + symbol beneath in `--text-sm`) is identical in ward lists and compare headers. The **field row** with its source line (§3) is the unit of the report card; compare columns are the same field rows aligned in a grid so values line up across candidates (IA §3.5). Compare on mobile: 2-up columns with horizontal scroll and sticky field labels.

### 7.6 Banners and countdowns

- **Deadline banner** (roll-closure countdown on `/`, `/check-registration`, `/voting-guide/voter-id`): ink on `--oc-sun`, radius-md, countdown figure in tabular Manrope 800. On citizen-facing pages, yellow is reserved for statutory deadlines and the AI-extracted badge — if everything is urgent, nothing is. (Curator screens also use it for the held-ward work state, §7.13.)
- **Notice banner** (election status, empty-state explainers): ink on `--sun-tint`, no countdown.
- **Error banner:** brick text on `--brick-tint`.

### 7.7 Badges and chips

Radius-full, 13px, 4px 10px padding. Reserved set: the three provenance badges (§3), flag status on `/account/submissions` (pending = gray, accepted = forest on tint, rejected = brick on tint), and ward-readiness state on curator screens (ready = forest, held = sun). Do not invent new chip colors; a new state reuses these or gets a design decision here first.

### 7.8 Gated actions (flag, issue vote, register-for-updates)

Gated actions render in their **full enabled style** for anonymous users — the gate is the Register/Login modal at tap, never a disabled state (core concept: visible-to-all, gated-at-submit). After auth the action resumes in place with no visual reset.

### 7.9 Modals

The three modals (Register/Login, Flag misinformation, Cast issue vote — IA §7) share one shell: white, radius-md (top-sheet, full-width, rounded top corners only below `md`), `--shadow-modal`, scrim `rgba(26,26,26,0.5)`, title in `--text-2xl`, explicit Close button plus scrim-tap and Escape. Focus is trapped inside and returns to the trigger on close. The URL never changes.

- **Register/Login:** single input per step (email/phone → OTP → confirm ward + language). OTP entry is one 6-digit input with `inputmode="numeric" autocomplete="one-time-code"`, not six boxes — six boxes fight low-end keyboards and paste.
- **Cast issue vote:** checkbox list capped at three; the submit button counts down "Vote (2 of 3 selected)".

### 7.10 Forms

Labels above inputs, always visible (no placeholder-as-label). Inputs: 16px text (prevents iOS zoom), 44px min height, radius-sm, `--color-border`; focus border `--oc-forest` plus ring. Errors: brick text below the input plus a border change — never color alone. Helper text muted, above the error slot.

### 7.11 Issue-vote results

Horizontal bars, all `--oc-forest` on a `--gray-100` track (§4 rule 5), rank number and vote share in tabular figures, issue name never truncated. The same component renders the city-wide roll-up on `/data`.

### 7.12 Empty states, loading, toasts

- **Empty states** state a fact and a next step: pre-nomination candidate list — "Candidate nominations open on {date}. Register for updates and we'll tell you when they're in." Muted illustration optional; no sad-face iconography on civic data.
- **Loading:** skeleton bars in `--gray-100` for content; spinners only inside buttons.
- **Toasts:** bottom, ink text on white, forest left-edge for success, brick for failure, auto-dismiss ≥5s, also announced via `aria-live="polite"`.

### 7.13 Curator and admin surfaces

Same tokens, denser rhythm: `--text-sm` table default, 8px cell padding, zebra rows in `--gray-100`, sticky header row. Destructive and publish actions get confirmation dialogs stating scope ("Publishes immediately to /ward/57"). The readiness panel is a pass/fail block: forest tint when passing, sun tint with a listed gap-set when held — never red, because "not ready" is a work state, not an error.

### 7.14 Environment banner

One line of centered `--text-sm` bold, full-bleed, sitting **above** the app bar and below the skip link. It states which deployment the visitor is on, and it exists only on deployments that need to say so — the signal is the `APP_ENV` runtime variable, set per environment in the compose files, and absent everywhere else, so a developer's laptop and the test suites show nothing.

| Environment | Copy (EN) | Surface |
|---|---|---|
| staging | "Testing site: Go away!" | `--color-danger-surface` / `--color-danger` |
| production | "Under construction. Come back on Sep 15!" | `--color-accent-surface` / `--color-text` |

Staging is the loud one on purpose: it carries fictional candidate data and is open to anyone with the URL (architecture §14.2), so it must be impossible to mistake for the real site. Production's is informational, not a warning — the site is real, just not open yet — so it shares the sun tint with the §7.6 notice banner rather than borrowing red.

Not sticky, and not part of the app bar: it is read once on arrival and should then get out of the way, while the app bar has to stay reachable. Scrolling moves it off-screen and lets the app bar take `top: 0`. That also keeps it out of the 56px bar's very tight width budget (§7.1).

Not dismissible. Per-visitor dismissal needs per-visitor state, and the only server-side way to carry that is a cookie, which would break the caching invariant outright (architecture §5). One line of text does not justify that.

`role="status"`, not `role="alert"` — ambient context should not interrupt a screen reader mid-sentence.

---

## 8. Iconography and imagery

Line icons, 1.5px stroke, 20/24px grid, `currentColor` — a single consistent set (e.g. Lucide, self-hosted SVG sprite). Icons never appear without a text label except the close ✕ and external-link glyph, both `aria-label`ed. Maps (ward boundary, booth locator) use a desaturated gray basemap with the boundary in `--oc-forest` at 2px and `--forest-tint` fill at 30% — no red pins, no party-colored anything on maps.

### 8.1 Basemap styling — partially unimplemented, decided 2026-08-14

**What actually ships today is a stock Google basemap: full colour, business POIs, and Google's own red place markers.** The paragraph above describes the intended treatment; only the boundary half of it is implemented.

What *is* implemented, and stays enforced:

- The ward boundary is drawn by us, in `--oc-forest` at 2px with `--forest-tint` fill at 30%, read from CSS custom properties at runtime (`readMapColors`, `src/islands/WardMap.ts`). `tests/unit/tokens.test.ts` bans hex literals outside `tokens.css`, so this cannot drift into a hardcoded colour.
- The platform adds **no markers of its own**, and nothing on the map is keyed to party or candidate data. The island only ever draws one neutral polygon.

What is not:

- The desaturated gray basemap. That requires a cloud map style bound to `GOOGLE_MAPS_MAP_ID` (`docs/gcp.md` §4). A Map ID exists and is required for the map to render at all (`src/lib/maps-config.ts`), but no style is associated with it, so Google serves its defaults.
- Consequently "no red pins" does not hold. The red markers on a ward map are Google's POI pins — hospitals, businesses — not anything this platform places.

**Why it was left this way:** creating and maintaining a cloud map style is console work outside this repo, unversioned and unreviewable, and it was judged not worth the cost before launch. The decision was made deliberately with the visual consequence on screen, not by oversight.

**If this is revisited,** the fix is entirely console-side and needs no deploy: create a style (start from Silver, drop POI density, disable business POIs, mute road and transit colour) and associate it with the existing Map ID. Cloud styles apply on the next page load.

Treat the paragraph above as the target, not as a description of production. Anyone reading a red pin on a ward map as a bug should read this section first.

---

## 9. Motion

Motion is functional only: modal/toast enter-exit (150–200ms ease-out), accordion expansion, focus transitions. No scroll-triggered reveals, no parallax, no animated numbers except the live countdown flip. Everything honors `prefers-reduced-motion: reduce` by dropping to opacity-only or none.

---

## 10. Accessibility floor

- WCAG 2.1 AA contrast throughout, per the checked table in §2.3.
- Visible focus: 2px `--oc-forest` outline, 2px offset, on every interactive element (`:focus-visible`); on the forest footer the outline is `--oc-sun`.
- Touch targets ≥44×44px; adjacent targets ≥8px apart.
- Color never carries meaning alone: links underline, errors get text, badges get labels, bars get numbers.
- Semantic HTML first; modals are `<dialog>` or equivalent with focus trap; `lang` and `hreflang` correct on every page (Kannada pages declare `lang="kn"` so screen readers pick the right voice).
- Test with TalkBack on Android — that's the field configuration, per §1.

---

## 11. Implementation notes

- Tokens ship as CSS custom properties on `:root` in one file (e.g. `src/styles/tokens.css`), with `:lang(kn)` overrides beside them. Components consume semantic tokens only (§2.2). This is framework-agnostic: it works with plain scoped Astro styles today and can seed a Tailwind theme later if one is adopted — that choice is not made here.
- The full font payload (3 families × subset woff2) should stay under ~120KB; preload only the two files above-the-fold pages need per language.
- Print styles matter for one page: `/partner/{slug}`'s poster block. Everything else can rely on defaults.

## 12. Open questions

- ~~The exact Open City logo lockup for subdomains (wordmark? "An Open City project" byline?) needs an asset from Oorvani — not inventable here.~~ **Settled 2026-08-13:** the wordmark asset, no byline. The AppBar (§7.1) renders "Bengaluru Votes" then a hairline rule then the Open City wordmark (`public/img/opencity-logo.png`). Both marks show at every width: 768px and up gets the full wordmark with the logo at 20px; below 768px the wordmark abbreviates to "BV" and the logo drops to 18px, which is what makes room for both on a phone. Below 360px the hairline rule goes too. The abbreviation is presentational only — the home link's `aria-label` is "Bengaluru Votes" at every width.
- Whether Anek Kannada (a display-grade Kannada family) should replace Noto Sans Kannada in headings for more personality. Noto is the safe default; revisit after real Kannada pages exist.
- ~~Ward boundary map styling depends on the mapping library chosen (tracked in `docs/prd.md` §17).~~ **Settled 2026-08-14:** Google Maps JavaScript API, with the basemap styled via a console-managed cloud Map ID (`docs/gcp.md` §4) rather than in code — style changes are no longer visible to code review, so whoever edits the console style should note it in a commit message even though no file changes. The boundary line and fill stay token-driven regardless: `--oc-forest` at 2px, `--forest-tint` at 30%, drawn by the app (§8), not the Map ID.
