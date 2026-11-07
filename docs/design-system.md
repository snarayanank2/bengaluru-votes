# Bengaluru Votes — Design System

**Applies to:** `bengaluruvotes.opencity.in` (public site and staff curator/admin/transcriber surfaces)

This system defines reusable visual foundations, section patterns, components, and interaction states. Choose a pattern by the information or task it supports. A route does not own a color, layout, or component variant. Specific pages appear only as example usage in §11.2.

The system extends Open City's forest-green identity, Manrope headings, and PT Sans body text with dark-green, gold, paper, and sage section surfaces. Color communicates hierarchy and system state, never political affiliation.

Token names match `src/styles/tokens.css`; shared styles live in `src/styles/global.css` and `src/styles/buttons.css`. Known gaps are recorded in §12 rather than promoted into design rules. Every component is listed in §13.

## 1. Principles

1. **Trust and neutrality.** Present facts, sources, and uncertainty clearly. Give comparable people or records equal visual weight. Avoid promotional effects and artificial urgency.
2. **Mobile-first.** Preserve reading order and usable controls on narrow screens. Prefer solid surfaces, borders, modest font payloads, and minimal motion.
3. **Bilingual parity.** English and Kannada share hierarchy, functionality, and visual emphasis. Allow translated text to wrap without clipping or truncation.
4. **One system across roles.** Public and staff interfaces share foundations. Dense workspaces may use compact rows; they do not get a different brand.
5. **Patterns before exceptions.** Reuse a section or component according to its purpose. Document a reusable variant when an existing pattern cannot express a recurring need.

## 2. Color

### 2.1 Primitives

Define all hex colors in `src/styles/tokens.css` (`tests/unit/tokens.test.ts` bans hex literals elsewhere under `src/`). Components should consume the semantic layer in §2.2.

| Primitive | Value | Role |
|---|---|---|
| `--oc-forest` | `#426133` | Brand green |
| `--oc-leaf` | `#5e8b48` | Decorative green; not small text on white |
| `--oc-lime` | `#c8e537` | Accent on dark surfaces |
| `--oc-sun` | `#ffd527` | Highlight and deadline accent |
| `--oc-brick` | `#a62635` | Error/destructive color |
| `--oc-rose` | `#d33a4c` | Large error accents |
| `--ink` | `#1a1a1a` | Primary text |
| `--gray-600` | `#616161` | Muted text |
| `--gray-300` | `#c1c1c1` | Borders |
| `--gray-100` | `#f0f0f0` | Subtle surfaces |
| `--forest-tint` | `#eef3ea` | Selected/success surface |
| `--sun-tint` | `#fff8d6` | Notice surface |
| `--brick-tint` | `#faeceb` | Error surface |
| `--white` | `#ffffff` | Default background |
| `--oc-black` | `#000000` | Footer background |
| `--paper` | `#fbfaf6` | Quiet section/navigation surface |
| `--hero-forest` | `#132010` | Dark identity surface |
| `--hero-cream` | `#f2ead9` | Text on dark identity surfaces |
| `--hero-muted` | `#a7b89a` | Secondary text on dark green |
| `--hero-surface` | `#1b2b16` | Inset surface on dark green |
| `--hero-alert` | `#c1392b` | Editorial accent |
| `--hero-button-hover` | `#ece1cb` | Light-action hover |
| `--hero-button-text` | `#18230f` | Text on light actions |
| `--why-vote-bg` | `#f0b429` | Gold explanatory surface |
| `--why-vote-text` | `#6b4a06` | Supporting accents on gold |
| `--why-vote-ink` | `#18230f` | Primary text on gold/white |
| `--why-vote-pill` | `rgba(24, 35, 15, 0.1)` | Topic-pill fill |
| `--methodology-bg` | `#ccdabd` | Sage supporting surface |
| `--methodology-text` | `#28371c` | Text on sage |

Names such as `hero`, `why-vote`, and `methodology` are implementation names. They identify visual roles, not route restrictions.

### 2.2 Semantic tokens

| Semantic token | Maps to | Use |
|---|---|---|
| `--color-text` | `--ink` | Primary text |
| `--color-text-muted` | `--gray-600` | Supporting text |
| `--color-bg` | `--white` | Default background |
| `--color-surface` | `--gray-100` | Subtle inset/disabled surface |
| `--color-border` | `--gray-300` | Borders and dividers |
| `--color-primary` | `--oc-forest` | Main actions, links, selection |
| `--color-primary-surface` | `--forest-tint` | Selected/success background |
| `--color-accent` | `--oc-sun` | Highlight, outline, deadline |
| `--color-accent-surface` | `--sun-tint` | Notice background |
| `--color-danger` | `--oc-brick` | Error/destructive text or fill |
| `--color-danger-surface` | `--brick-tint` | Error background |
| `--color-on-primary` | `--white` | Text on primary fill |
| `--color-on-accent` | `--ink` | Text on sun fill |
| `--color-footer` | `--oc-black` | Footer background |
| `--color-on-footer` | `--oc-lime` | Footer branding and links |
| `--color-header-bg` | `--paper` | Quiet bands and navigation |
| `--color-hero-bg` | `--hero-forest` | Dark identity/hero band |
| `--color-on-hero` | `--hero-cream` | Prominent text on dark green |
| `--color-hero-muted` | `--hero-muted` | Supporting text on dark green |
| `--color-hero-surface` | `--hero-surface` | Dark inset tile or response |
| `--color-hero-alert` | `--hero-alert` | Editorial eyebrow or highlighted fact |
| `--color-on-hero-alert` | `--white` | Text on a `--color-hero-alert` fill (5.4:1) |
| `--color-hero-button-text` | `--hero-button-text` | Light-action text |
| `--color-why-vote-bg` | `--why-vote-bg` | Explanatory gold band |
| `--color-why-vote-text` | `--why-vote-text` | Gold-band kicker and icon |
| `--color-why-vote-ink` | `--why-vote-ink` | Gold-band body text |
| `--color-why-vote-pill` | `--why-vote-pill` | Noninteractive topic pills |
| `--color-methodology-bg` | `--methodology-bg` | Supporting sage band |
| `--color-methodology-text` | `--methodology-text` | Sage-band text |

Use the matching foreground/background pair. Text on a `--color-hero-alert` fill is `--color-on-hero-alert`: the muted hero label colour is only 2.6:1 on that red, and cream is a marginal 4.5:1. For small editorial text on sage, use the darker brick token (`--color-danger`); the brighter hero-alert red does not meet normal-text contrast there. Sun or lime text belongs on a dark surface; never put white text on sun, lime, or leaf. Gold is an explanatory surface, not a warning. Editorial red does not imply a validation error. Pair all statuses with explicit text.

### 2.3 Contrast

Target WCAG AA: at least 4.5:1 for normal text and 3:1 for large text; verify control boundaries and focus indicators against their adjacent surfaces. A token being approved does not make every pairing accessible.

Forest, brick, and muted gray on white are the standard text combinations; ink on sun and lime on black are strong-contrast combinations. Leaf on white is restricted to large text or non-text decoration. Validate new pairings (open checks in §12).

## 3. Provenance styling

A sourced field is a reusable content unit: **label → value → provenance**. It lets a fact retain context when copied, compared, or captured in a screenshot.

- Label: muted 14px; value: regular 16px ink; provenance: muted 13px.
- Keep a shared left edge and 4px between label and value.
- Use a readable source title and link where available. Do not rely on a badge alone to explain provenance.
- Missing values use explicit copy: “Not declared” when the source declares nothing, “Cannot read” when the source is illegible. These are distinct states; never show one as the other, and never imply that unknown means zero.

Two components express provenance:

| Component | Shows | Treatment |
|---|---|---|
| `VerificationLabel.astro` | How the value was checked: “Checked by a person” or “AI-extracted” | 13px muted. `presentation="icon"` (default) shows an icon with a tooltip; `presentation="text"` shows persistent text for reading and comparison surfaces |
| `SourceLine.astro` | Where the value came from: exactly one reserved source badge | See table below; used through `FieldRow.astro` |

| Source badge (`SourceLine`) | Treatment | Meaning |
|---|---|---|
| Affidavit | Forest on forest tint; links to the stored affidavit when one is given | Official affidavit source |
| Curator-compiled | Muted gray on gray surface; never links | Compiled and sourced context |
| AI-extracted | Ink on sun tint with dotted sun border; no link | Extracted data not yet confirmed (takes priority over the other two) |

These source-badge treatments are reserved for provenance. Keep provenance labels distinct from status badges (§7.7), topic pills, and action states even when they share palette tokens. Summary fact groups (§7.16) do not automatically need provenance on every item.

## 4. Neutrality rules

**4.1 Party identity is text.** A party appears as its name and, where available, its official symbol. Never assign a color, tint, or accent to a party or candidate in a list, chart, map, or comparison.

**4.2 No party color associations.** The documented gold explanatory surface is permitted. Do not introduce saffron/orange accents or other political color associations.

**4.3 Identical weight, deterministic order.** Comparable records use identical image treatment, typography, field order, and available actions. Candidates are ordered **alphabetically** by English name (id breaks ties) — the same order in both languages, never by status, insertion order, or editorial rank.

**4.4 Semantic colors describe system state, not people.** Error colors describe failed or destructive actions. A criminal-case count, asset figure, or lifecycle status (filed, contesting, withdrawn, rejected) is set in ordinary ink as plain text.

**4.5 Ranked results use one hue.** Every bar is forest on a gray track; order, labels, and numbers convey rank.

**4.6 Identity imagery is neutral.** Identities show neutral initials. No candidate photos are collected. Never invent or use stock photographs.

## 5. Typography

### 5.1 Families

| Role | Latin | Kannada | Weights |
|---|---|---|---|
| Headings, buttons, figures | Manrope | Noto Sans Kannada | 500–800 |
| Body, forms, captions | PT Sans | Noto Sans Kannada | 400, 700 |

```css
--font-heading: Manrope, 'Noto Sans Kannada', system-ui, sans-serif;
--font-body: 'PT Sans', 'Noto Sans Kannada', system-ui, sans-serif;
```

Self-host subset WOFF2 (`scripts/build-fonts.ts` writes `public/fonts/`) with `font-display: swap`; preserve Kannada conjuncts. Preload only the above-the-fold families required by the active language. Payload budget: §11. Use tabular figures for changing counts and aligned numeric columns.

### 5.2 Scale

| Token | Mobile / ≥768px | Line-height token/value | Use |
|---|---|---|---|
| `--text-xs` | 13px | `--leading-xs`: 1.4 | Sources, eyebrows, compact fact labels |
| `--text-sm` | 14px | `--leading-sm`: 1.5 | Labels, helpers, metadata |
| `--text-base` | 16px | `--leading-base`: 1.5 | Body, inputs, buttons |
| `--text-lg` | 18px | `--leading-lg`: 1.5 | Leads, compact identity titles |
| `--text-xl` | 20px | `--leading-xl`: 1.3 | Card titles |
| `--text-2xl` | 24px | `--leading-2xl`: 1.25 | Section/modal headings, fact figures |
| `--text-3xl` | 28px / 32px | `--leading-3xl`: 1.2 | Page H1, identity headings |
| `--text-4xl` | 32px / 40px | `--leading-4xl`: 1.1 | Display headings |

Use 16px as the body and input baseline. Existing band compositions also use 1.6rem (25.6px) section headings and 0.95rem (15.2px) supporting prose; these are local overrides, not named tokens — use the shared scale for new work.

**Eyebrows:** always uppercase (where the script has case), 13px, subordinate to the heading, never a second headline. Apply the shared `.eyebrow` class (`global.css`): uppercase plus 0.04em Latin tracking; `:lang(kn)` resets tracking to normal. Do not hand-roll eyebrow case or tracking in page CSS.

### 5.3 Kannada

- `:lang(kn)` raises body line heights from 1.5 to 1.7 and heading line heights (1.2–1.3) to 1.4. Local CSS must use the `--leading-*` tokens so these overrides apply.
- Use `letter-spacing: normal`; do not apply Latin tracking to Kannada glyphs.
- Kannada has no uppercase: eyebrows keep emphasis through size, weight, and placement. Other text uses sentence case.
- `--kn-pad` is 0px by default and 2px under `:lang(kn)`; use it for extra vertical padding in compact controls.
- Allow multi-line labels and taller controls. Do not truncate translated headings, buttons, or form labels.

### 5.4 Voice

Use plain language and sentence case, except for uppercase eyebrows. Labels name the content; buttons name the outcome, such as “Find my booth” or “Submit flag”. Explain required formats and errors with a concrete next step. Avoid generic “OK”, unexplained abbreviations, and urgency without a real deadline.

## 6. Layout, spacing, shape

### 6.1 Spacing

| Token | Value | Use |
|---|---:|---|
| `--space-1` | 4px | Field internals, micro-gaps |
| `--space-2` | 8px | Related text, icons and labels |
| `--space-3` | 12px | Compact groups |
| `--space-4` | 16px | Card padding, field/card gaps |
| `--space-6` | 24px | Content-to-action separation |
| `--space-8` | 32px | Section padding and ordinary section gaps |
| `--space-12` | 48px | Major-region gaps, desktop hero padding |
| `--space-16` | 64px | Exceptional large-region separation |

The parent owns gaps between siblings; the component owns its internal padding. Prefer flex/grid `gap`, reset browser margins inside composed components, and avoid adding child padding to compensate for a parent's alignment.

Default relationships: heading to lead 8px; heading to content 16px; paragraphs or fields 16px apart; content to actions 24px; sections 32px apart. Do not add these values together when a parent stack already supplies the gap. Fixed control dimensions are not spacing tokens. Never reference an undeclared custom property.

### 6.2 Breakpoints and containers

| Token | Value | Role |
|---|---:|---|
| `--bp-sm` | 480px | Large-phone adjustments |
| `--bp-md` | 768px | Main multi-column transition |
| `--bp-lg` | 1024px | Wide-layout adjustments |
| `--container-prose` | 42rem | Long-form reading |
| `--container-app` | 64rem | Structured content and actions |
| `--container-pad-x` | 16px / 24px ≥md | Shared horizontal inset |

Container widths include their padding under global `border-box`. Full-width backgrounds may extend to viewport edges; their content restores the same container inset. Do not stretch reading text to the viewport width.

### 6.2.1 Alignment and responsive grids

- Align headings, content, and actions to a shared left edge. Center only short self-contained states or controls whose role warrants it.
- Use explicit columns and gaps. Variable-length cards/facts start-align; icon-label pairs and compact control rows center-align across their shared axis.
- Multi-column sections stack below 768px unless a documented pattern says otherwise. Preserve DOM order.
- Use `minmax(0, 1fr)` or `min-width: 0` where content needs to shrink. Do not use fixed heights to align text blocks.
- Numeric columns align right with tabular figures. Their headings use the same alignment.
- Scroll only the component that needs it, such as section navigation or a comparison grid; never create document-wide horizontal overflow.

### 6.3 Shape and elevation

| Token | Value / role |
|---|---|
| `--radius-sm` | 6px: buttons and inputs |
| `--radius-md` | 8px: cards, map frames, dialogs |
| `--radius-full` | 9999px: badges, pills, round identity images |
| `--shadow-sticky` | `0 2px 4px rgba(26,26,26,0.08)` |
| `--shadow-modal` | `0 8px 24px rgba(26,26,26,0.16)` |
| `--shadow-hero-button-hover` | `0 2px 6px rgba(19,32,16,0.08), 0 8px 18px rgba(19,32,16,0.12)` |

Cards are border-first, without a default shadow. Use the subtle hover shadow for light-action hover and an expanded disclosure, not every surface.

### 6.4 Reusable section patterns

Every section starts with a content hierarchy: optional eyebrow → heading → optional lead → content → related actions. Omit unnecessary layers. Use a semantic `section` with an accessible heading when the content forms a distinct topic.

| Pattern | Anatomy and purpose | Desktop | Mobile |
|---|---|---|---|
| Dark identity/hero | Breadcrumbs (§7.15) or eyebrow/identity pill, prominent heading, supporting copy, optional action or facts | Dark-green band; 48px vertical padding | 32px padding; content stacks |
| Hero with supporting statistics | Main copy/action plus a compact fact grid | Flexible copy + 260px supporting column; 32px gap | One column, 24px gap; facts may stay two-up |
| Split explanatory section | Heading group beside prose, topic pills, or disclosures | 1:2 columns, 32px gap and vertical padding | One column, 24px gap |
| Content/action band | Heading, description, one task or content collection | White, paper, or sage; 32px vertical padding | Same hierarchy; controls wrap or stack |
| Structured fact group | Parallel label/value units with optional lists | Equal columns, start-aligned, 32px gaps | Single column, 16px gaps |
| Collection section | Heading plus rows, cards, or disclosures | One enclosing band; 16px card gaps or 24px identity-row gaps | Preserve item order and hierarchy |
| Data/media section | Heading, map/chart/media frame, optional explanatory text | Frame aligned to container | Frame resizes; no page overflow |
| Report card (identity + document beside data) | Dark identity band: breadcrumbs (§7.15), then initials placeholder, name, party and source note; below it a return link (§7.4), then an action group (secondary navigation, tertiary flag) and the fields-and-document layout (§7.17) | Band, then 24px-gap content on white | Same order; document becomes a link |
| Document beside data | Structured fields next to their source PDF (§7.17) | Two columns, document panel sticky and internally scrolled | Fields only; document becomes a link |

**Surface selection:** dark green establishes identity; gold gives explanatory material emphasis; white supports detailed reading and interaction; paper gently separates a collection or navigation strip; sage supports a related task or resource collection. Use the matching text tokens in §2.2.

**Section rhythm:** continuous color bands meet without an extra gap. Separate content regions use the default 32px gap, or 48px for a clear hierarchy change. The final full-width band meets the footer directly; no container bottom padding or empty spacer beneath it. A final white content region (for example a report card's fields and document) keeps its 32px bottom padding; only full-width bands meet the footer flush. Restore the shared inset after any full-width breakout.

## 7. Components

### 7.1 App bar

The global public brand/navigation shell (`AppBar.astro`) is 80px high, sticky at `top: 0`, on paper with `--shadow-sticky`. Its inner row uses the app container. Branding at the start, language control at the end. It never reads cookies or session and renders no account action.

**Lockup:** the “Bengaluru Votes” text wordmark (the home link), a hairline separator, the OpenCity logo, a decorative star, and the Janaagraha logo; no byline. The wordmark link is 44px high; the compact “BV” may be narrower than 44px so the logos are not crowded. Below 768px the visible wordmark becomes “BV” (CSS only; the home link's accessible name stays “Bengaluru Votes”). Logo heights are 20px/22px on desktop, 13px/14px below 768px, and 12px below 360px, where the separator also disappears. Partner images sit outside the home link so they keep their own alt text.

**Language control:** `EN | ಕನ್ನಡ` in fixed order. The current language is a noninteractive selected segment (forest on forest tint); the alternate language links to the equivalent page. Both segments have a minimum 44×44px target.

Staff layouts (`CuratorLayout`, `AdminLayout`, `TranscriberLayout`) use their own 56px bar without the language toggle (§7.13).

### 7.2 Footer

Black with lime branding/navigation. On a page shorter than the viewport (a 404, the sign-in form) the footer still sits on the bottom edge: the body is a viewport-tall flex column and `main` takes the slack (`global.css`); pages do not size themselves to achieve this. At 768px and above, three start-aligned columns with 32px gaps and a vertical rule plus 32px inset on subsequent columns; stack in DOM order on mobile. Group project attribution, resource navigation, and utility/legal navigation separately.

Partner assets are self-hosted under `public/img/` (CSP is `img-src 'self'`). The Janaagraha SVG uses a white monochrome filter; Oorvani has a white wordmark. Social marks are 24px inside 44px targets, white at rest and lime on hover, each with an accessible platform name. Text links underline on hover/focus; use sun focus outlines on black.

### 7.3 Buttons and action groups

Use a native `button` for an action and an anchor for navigation (`Button.astro` renders an `<a>` when given `href`). `Button.astro` supports five visual variants. Icon-only is a shape option on a variant, not a separate level of emphasis.

| Variant | Treatment | When to use |
|---|---|---|
| Primary | White on forest | Main action within a section or task |
| Secondary | Forest text, 1.5px forest border, white fill | Supporting or alternative action |
| Tertiary | Forest text, transparent fill/border; underline on hover/focus | Low-emphasis action |
| Destructive | White on brick | Delete, ban, erase, or another destructive operation |
| Light | White fill/border, dark text, 48px minimum height | An action on a dark or colored band; pairs with 48px lookup inputs |

**Anatomy:** optional icon + outcome label; 44×44px minimum target; 16px Manrope 700; 6px radius; 8px vertical and 24px horizontal padding (tertiary: 8px horizontal). Labels wrap and controls grow vertically. Icon-label gap 8px; icons do not shrink.

| State | Required behavior and appearance |
|---|---|
| Default | Variant remains legible on its containing surface |
| Hover | Preserve hierarchy; tertiary text underlines; light uses its hover fill, shadow, and 1px lift; tertiary icon-only uses a gray fill |
| Focus | 2px forest outline with 2px offset; light adds a 4px white outer ring so it stays visible on dark bands |
| Pressed | Preserve geometry; light drops its lift; tertiary icon-only uses a darker gray fill |
| Loading | Label stays in layout and accessible name (hidden visually); spinner plus localized sr-only status text; `aria-busy`. Loading alone does not disable submission |
| Disabled | Gray surface, muted text, no lift or shadow, unavailable semantics; explain the reason where it is not obvious |

**Gated submit:** where a form needs one explicit confirmation (§7.13), the submit button is disabled until that checkbox is ticked and a short muted hint beside it says why. The script owns the toggle and the server re-checks the confirmation; with no script the button stays usable, so nobody is locked out. `PublishConfirm.astro` renders the whole unit (the enlarged tick row, the primary submit and the hint) and `GatedSubmit.ts` toggles it; every field, ward and match publishing form uses it rather than its own checkbox and button. The admin confirmations (discarding an affidavit, removing a user, changing a role) have no gated button, so they do not use the unit, but they do use its tick: the shared `.confirm-tick` class (`global.css`, 26px box in a row at least 48px tall), never a bare checkbox.

`aria-disabled` on an anchor does not prevent navigation; callers must handle unavailable links deliberately.

**Light variant:** `variant="light"`: white fill/border, `--color-hero-button-text`, 48px minimum height, 6px radius, 0.95rem/600 in the language-aware heading font. Enabled hover uses `--hero-button-hover`, `--shadow-hero-button-hover`, and a 1px lift over 180ms. Reduced motion removes the lift and transition. Page CSS owns placement and width only.

**Icon-only shape:** `iconOnly` with a localized `label`, which becomes the accessible name; the component throws on an empty label. One decorative 20×20px SVG centered in a 44×44px target (48×48px for light), zero padding, no shrinking. Light icon-only for utility actions on colored bands; tertiary icon-only for low-emphasis utility actions on light surfaces (ink, transparent at rest, gray hover, darker gray pressed, forest focus outline, no underline). The icon is hidden from assistive technology; never rely on its shape or a hover tooltip as the only name.

**Shared implementation:** `Button.astro` and client-created controls share `src/styles/buttons.css`. Classes: `btn btn--<variant> btn-shared`, plus `btn--icon` for icon-only. A client-created control uses the same classes and supplies its own accessible label, disabled/busy semantics, and event handling. Do not recreate button styles in a page or island.

Language segments (§7.1), social icon links (§7.2), section navigation, and disclosure toggles (§7.15) have their own control patterns. Noninteractive pills (§7.7) are not buttons.

**Action groups:** main action first, start-aligned, flex-wrap; gap 8px, or 12px in a spacious row. Place the group 24px after its content. If actions stack, use a consistent width. Avoid per-button compensating margins.

### 7.4 Links

Body links use forest and an underline. Shared class `.body-link` (`global.css`): forest, underlined, 44px tall, for a link on a row of its own or in a list; page CSS only positions it. Links in rendered editorial Markdown get the class from the renderer (`render-content.ts`), because page CSS cannot reach that markup; the admin console's area links and back links carry it too. Inside a `.staff-table` cell the link's text starts at the cell's top edge like the rest of the row. Navigation and identity links may omit the underline at rest, restoring it on hover/focus. Match focus styling to the surface. External destinations need an understandable cue: the labeled external-link glyph (`ExternalLinkOut.astro`) or a recognizable social mark. A link in a table cell or a card (a row's “Review”, a name that opens a record) is a body link too, at least 44px wide and tall. Use button styling for navigation only when its prominence warrants it; retain anchor semantics.

**Return link:** where a page sits under a parent and a visible way back is wanted beyond the breadcrumb (§7.15), add a text link, never a button: a body link (forest, underlined, semibold) led by a decorative `‹` chevron (`aria-hidden`), localized, at least 44px high, using the global forest focus outline. It sits at the start of the light content area, directly beneath the dark identity band. The destination is the parent in the same language twin. A report card uses it to return to its ward (“Back to ward”).

**Guided link-out (`ExternalLinkOut.astro`):** a primary-styled anchor to an official external process, always `target="_blank" rel="noopener noreferrer"` with the labeled glyph. When the URL setting is empty, it renders a disabled-looking placeholder and a visible “(official link pending)” note rather than inventing a URL.

### 7.5 Cards, rows, and collections

**Base card:** white fill, 1px `--color-border`, 8px radius, 16px padding, no shadow. `Card.astro` supplies this shell only — no headings, spacing, click behavior, or semantics.

**Content anatomy:** optional eyebrow/icon → title → body or facts → optional metadata → actions. 8px for tightly related text, 16px between groups, 24px before a distinct action area. The parent grid owns inter-card gaps.

| Treatment | Use and rules |
|---|---|
| Bordered card | A self-contained content unit; base shell |
| Unboxed content | Content already grouped by a band; remove redundant borders rather than nesting cards |
| Inset fact tile | A figure and short label on dark green; dark inset fill, 16px padding, 8px radius |
| Identity row (`CandidateRow.astro`) | 56px circle with neutral initials (§4.6), name in 20px Manrope 700, party as muted 14px text; 16px image-to-text gap; identical markup for every peer |
| Sourced field row (`FieldRow.astro`, `CandidateProfileField.astro`) | Label/value/provenance anatomy from §3 |

Use one title size (20px, or 18px for a compact collection) for every peer. Keep status text subordinate and let long names wrap. Identity lists use 24px between rows; card collections 16px. Empty collections use §7.12 rather than blank cards.

A noninteractive card must not acquire a pointer cursor or hover elevation. For a single destination, use a real link with a clear accessible name. Do not nest controls inside an enclosing link. Equal-height grid shells are fine; text starts at the top and never depends on fixed heights.

### 7.6 Banners and countdowns

| Kind | Component | Treatment | Content |
|---|---|---|---|
| Deadline | `DeadlineBanner.astro` | Ink on solid sun; 8px radius; days-remaining figure in tabular Manrope 800 | A real, dated statutory deadline only |
| Notice | `Banner kind="notice"` | Ink on sun tint; `role="status"` | Factual context or limitation |
| Error | `Banner kind="error"` | Brick on brick tint; `role="alert"` | What failed and how to recover |
| Inline response | Local | Surface appropriate to its band | Success, ambiguity, unavailability, or next step |

`Banner` uses 12px/16px padding and an 8px radius. `DeadlineBanner` computes remaining days server-side from a `YYYY-MM-DD` date. Use explicit text, not color alone. An empty live region must not paint an empty banner. Announce async responses without moving focus unnecessarily. Countdowns are never a device for emphasizing ordinary information. **Outcomes after a redirect or a save** (saved, released, a hold that ran out, language saved) use a notice, and so does a save that would change nothing (“Nothing changed, so nothing was published”), which is answered with HTTP 200, not 400, since nothing failed. The candidate editor shows “Saved and published” after a successful save, which is also the success kind: an error banner is for an action that failed and needs recovery. A page that shows such an outcome from a query string must confirm on the server that it really happened; the query string alone is never proof. These notices are not one-time: reloading within the confirmation window shows them again, because the check is against stored state, not a cookie.

### 7.7 Badges and topic pills

**Status badges (`Badge.astro`):** 13px, full radius, 4px/10px padding, explicit label. Exactly three variants; add another only by documenting it here first.

| Variant | Treatment | Meaning |
|---|---|---|
| `flag-pending` | Muted gray on gray surface with a 1px border, so it still reads as a pill on a gray striped row | A flagged correction awaits review |
| `flag-accepted` | Forest on forest tint | The correction was accepted and published |
| `flag-rejected` | Brick on brick tint | The flag was reviewed and rejected |

The default label comes from i18n; the slot may override wording, not color. A waiting work item whose reason is not a flag (an affidavit that needs a match) uses `flag-pending` with its own label, so status is never bare bold text. Provenance badges are a separate reserved set (§3, `SourceLine.astro`). Allow translated labels to wrap.

**Topic and identity pills:** noninteractive topic pills use `--color-why-vote-pill` with matching dark ink. Outlined identity/eyebrow pills use sun on dark green with 4px/12px padding. These describe content; they are not filters. A selectable chip is a real button or checkbox with state semantics and a 44px target.

### 7.8 Gated actions

Removed: sign-in-gated public actions (no public action requires sign-in). See §11 for the cache-safety rule.

### 7.9 Modals

`ModalShell.ts` (`ModalController`) provides shared behavior over native `<dialog>`: explicit Close (`data-modal-close`), Escape, focus trap, focus return to the trigger, and no URL change. Scrim-tap dismissal is on by default and off with `{ closeOnScrim: false }`. Each modal component owns its markup and CSS.

Visual shell: white, 8px radius, `--shadow-modal`, `rgba(26,26,26,0.5)` scrim. Below 768px, a full-width bottom sheet with rounded top corners. Title in 24px. Close is a tertiary icon-only button (§7.3). The title and Close sit in a sticky head, so a dialog taller than the viewport scrolls beneath them and they are never out of view, whichever field has focus. Content and actions follow §7.10.

Provide an accessible title. A modal that contains a form must not dismiss on a scrim tap (`closeOnScrim: false`): it closes only through the Close button and Escape, so typed text is never lost to a stray click. Preserve form input on every failed submission. When a modal lets the user tick several options (checkboxes in a `fieldset` with a `legend`), each ticked option reveals its own labelled group of inputs; unticked groups are hidden and disabled so they neither validate nor submit, and they keep what was typed if the box is ticked again. Messages about partial outcomes name the items affected and stay in the modal when nothing succeeded. A multi-step form keeps one title and context across steps, asks for a **single input per step**, and preserves input when users move back.

### 7.10 Form fields and form layouts

**Field anatomy:** visible label → control → optional helper → error, with 4px gaps; 16px between fields. Labels and controls share a left edge. 14px bold labels, 14px muted helpers, 14px brick errors. Never use a placeholder as the only label.

**Control geometry:** 16px font (prevents mobile zoom), 44px minimum height, 8px/12px padding, white fill, 1.5px gray border, 6px radius. Consistent widths within a group; `width: 100%` where the layout calls for it.

| Control | Rules |
|---|---|
| Text, email, telephone, search | Match input type and keyboard to the data; appropriate autocomplete; keep values after validation failure |
| Numeric/date input | Native semantics only when they fit; identifiers (such as a voter ID) are text, not quantities |
| Textarea | Same type, fill, border, focus; vertical growth/resizing |
| Select | Visible label, legible selected value, keyboard access, same minimum height; prefer native |
| Checkbox | Multiple independent choices; clickable label; align control to the first text line |
| Radio group | One mutually exclusive choice; `fieldset`/`legend`; native keyboard navigation |

`FormField.astro` implements single-line inputs (`text`, `email`, `tel`, `password`, `number`, `date`, `search`) with label, helper, required indicator, and error linkage. Selects, textareas, and grouped choices follow these rules but are not provided by that component.

| State | Appearance and semantics |
|---|---|
| Empty/default | Visible label; placeholder may show an example format, never essential instructions |
| Hover | Readable boundary; no layout shift |
| Focus | Forest border plus 2px forest outline, 2px offset |
| Filled | Retain label and helpers; no success state merely because text exists |
| Invalid | Brick border and explicit error text; `aria-invalid` and `aria-describedby`; preserve the value |
| Required | Native required semantics and a visible indicator, not color alone |
| Disabled | Muted, native disabled semantics, explanation when needed |
| Read-only | Readable and selectable; distinguish from disabled |
| Loading/result | Preserve geometry; announce progress/result; prevent duplicate requests |

Associate label and control with unique ids; link helpers and errors through `aria-describedby`. Validate at a task boundary, not every keystroke. On failed submit, focus the relevant field or a linked summary: a server-rendered form that re-renders with an error puts `autofocus` on the field and links the error to it, and a script-validated form is `novalidate` and shows its own inline error (brick border, text, `aria-invalid`, `aria-describedby`) rather than the browser's bubble. Do not reserve blank error areas.

**Form composition:** stack fields for sequential tasks; use columns only for closely related inputs and collapse them on narrow screens. Actions 24px after the final field.

**Choice group with a limit:** labeled native checkboxes in bordered option rows (48px minimum height, 12px padding, 6px radius), two equal columns from 768px, one below. Checked rows take a forest border; hover a forest border; keyboard focus a 2px forest outline on the row. State the selection limit before the group; once it is reached, disable unchecked options while keeping checked ones deselectable. The primary submit shows the live count (“n of N selected”) and is enabled only when the selection is valid. Errors and success stay inline and are announced.

**Compact lookup:** a single input plus action inline at 48px height with an 8px gap; an optional location action is a light icon-only button (§7.3). On narrow screens the input spans the first row with actions beneath. A visually hidden label is allowed only when persistent surrounding text makes the purpose clear. Keep essential helper text visible. Results go in a separate full-width live region beneath the controls. While a request is pending that region says so (“Searching…”) and the request is abandoned after a timeout with an in-place message; an empty field is answered with “Enter an address”, never with an outage message. A lookup never falls back to a native form submit to a route that may not exist.

**Affidavit field group (`AffidavitFieldInputs.astro`, staff):** a `fieldset[data-field]` with a three-way status (value / not declared / cannot read) followed by the field's inputs. `AffidavitFields.ts` disables the inputs unless the status is “value” and keeps an assets total live.

- **Status choice:** a row of pill-shaped radio labels, each at least 44px tall with the whole label as the target, a forest border and tint when chosen, and the focus outline on the label. They wrap rather than shrink.
- **Source label:** the legend carries `VerificationLabel` in its text presentation (“Checked by a person” / “AI-extracted”, §3); never a hand-made badge.
- **Widths:** every control in a group is full width, two related inputs sit in equal columns, and a free-text value that can be long (a qualification as written) takes the full width. Nothing is capped at a narrower width than its neighbours.
- **Invalid:** the controls of the refused field take the brick border and `aria-invalid`, the error text has an id they point to with `aria-describedby`, and on a refused save focus goes to the first invalid control (`focusFirstInvalid`), because the page summary sits far above the fields. Entered values are preserved.
- **No nested boxes:** inside a card the field group is flat; several groups in one card are separated by a rule above each (§7.5), not by borders of their own.

### 7.11 Result bars and comparisons

**Result bars (`IssueBars.astro`, and the same anatomy rendered client-side by `IssueVote.ts`):** forest fill on a gray track, a visible label, rank number, and share in tabular figures. One hue across all peers (§4.5); full labels wrap, never truncate. Rank is expressed through order and numbers and remains understandable without color.

**Comparisons:** repeat the same field order and alignment across records, in alphabetical record order (§4.3). On narrow screens use a contained horizontal scroller with a sticky row-label column rather than stacking; keep column headings and keyboard access. Do not convert missing data to zero or visually score a person.

**Comparison table anatomy:** a focusable (`tabindex="0"`) scroller with a localized `aria-label`, described by its scroll hint, around a table with a visually hidden `caption`. The corner cell is a localized “Details” column header; each candidate column header carries the identity row and links to the report card; row headers are 14px muted and sticky (128px wide on mobile, 176px from 768px), with `scope` on every header. The scroll hint shows only while the table overflows its scroller (`scrollWidth` > `clientWidth`), so it never promises scrolling that is not possible. The page's H1 is the ward name and its task is named by the breadcrumb tail and the caption; a visible title for the task is optional. Identity rows (full name, party, ward) may repeat what the header and breadcrumb already say, so the table is complete on its own, and their cells keep their verification labels. Text-presentation verification labels are 13px muted. `ScrollHint.ts` (§13) owns the scroll-hint visibility. The comparison page writes this anatomy by hand (its scroller also has a sticky label column); any other wide table uses `ScrollRegion.astro`, which wraps the table in the same focusable, named region with the same hint and a hint text that does not promise a sticky column.

### 7.12 Empty, loading, and feedback states

- **Empty (`EmptyState.astro`):** a fact (18px ink) and an optional next step (16px muted), centered, 32px/16px padding; optional slot for an action. When the state is the whole page (a 404 or 500) `headingLevel={1}` makes the fact the page's H1. Distinguish not-yet-available data from a failed request; do not invent a date. No sad-face iconography.
- **Loading:** spinners only inside actions (§7.3); preserve layout and announce progress accessibly. There are no content skeletons.
- **Success:** confirm the outcome with text in the existing action context. Color alone is insufficient.
- **Error:** retain user work and give a concrete recovery action. Field errors sit next to fields; task-level failures near the affected action.
- **Toast (`Toast.astro`; mirrored by `FlagModal.ts`'s success toast):** fixed bottom-center, ink on white, `--shadow-modal`, 4px forest (success) or brick (failure) left edge, `role="status"` `aria-live="polite"`, visible for at least five seconds. Persistent or actionable failures also need an enduring location.

### 7.13 Curator and admin surfaces

Staff layouts (`CuratorLayout`, `AdminLayout`, `TranscriberLayout`) share the tokens with a denser rhythm: a 56px bar with skip link and no language toggle, 14px table text, 8px cell padding, odd-row gray zebra stripes, sticky column headings where tables scroll. Text left-aligned, numbers right-aligned. Status uses `Badge` labels (§7.7), never color alone; a held or not-ready item is a work state, not an error.

**Confirmation:** destructive and publishing actions require a confirmation that states scope and effect — a required checkbox in the same form naming the public path the change appears on (or the user affected), checked again server-side. This is a no-JS confirmation step, not an editorial approval gate. Irreversible actions say so.

**Account controls:** every staff bar ends with `StaffAccountLinks.astro`: a link to the person's account page and a tertiary Sign out button in a POST form carrying the CSRF token (it works without script). The account page shows the email, role and saved screen language (a labeled radio group) and repeats Sign out as a primary button. On narrow screens a bar may wrap its section links onto a second row so these controls always fit.

**Staff bar:** the wordmark and every section link (the admin bar has none yet) are at least 44px tall (links also 44px wide), the same 14px text as the account link, and the link for the section or page the person is on carries `aria-current="page"` and is bold with a 4px underline (§7.15), so the current place is never color alone. The account link marks itself the same way on the account page.

**Headings:** a staff screen's H1 is `--text-2xl` (24px) on every screen, including the reading screen, which has no larger title than the others.

**Staff errors:** a 403 or 404 inside the staff area renders inside that area's layout (the bar with its navigation and account controls, never the public bar, language toggle or footer), in the language the person saved. It has a document title, an H1 saying what happened, one sentence of explanation and a primary link back to the area's home. An unknown id is a 404 even where the person's role could not see the record, so an id never confirms a record exists. A wrong-role request is a 403 with the person's own area shown. `StaffError.astro` is the page.

**Staff tables:** `.staff-table` (`global.css`; the admin tables do not use it yet) gives 14px text, 8px cell padding, gray odd rows, bottom rules, column headings that stay in view while the page scrolls (`position: sticky`), start-aligned text and right-aligned tabular figures for `.num` columns with their heading aligned the same way. Every heading cell has `scope="col"`, an action column has a visually hidden heading, and the table has a visually hidden caption. A link in a row is a body link (§7.4). A table that can be wider than its container sits in `ScrollRegion.astro` (§7.11); a table that instead fits a phone by wrapping and dropping a column (the flag queue) stays outside it so its headings can stay in view; a column dropped on a phone moves its content into another cell instead of losing it. An empty list is an `EmptyState` (§7.12), not a bare paragraph; the same holds for the admin lists and work queues. A row names a record by its content, never by a database id or a stored key: a value with no label reads “Other”.

**Place labels:** a ward named in running text, a table cell or a heading is the public label “Ward 23 Jogpalya” (§7.15), identical in both languages, from `src/lib/ward-label.ts`. The one exception is a select of every ward, which prefixes the corporation (“South 23 · Jogpalya”) because ward numbers repeat across corporations; a value shown exactly as read from a document (the ward an AI read) stays as read and is labelled so.

**Key and value lists:** a label above its value, 4px apart, sharing a left edge, 13px muted labels (§7.16); never a label and value running together on one wrapping line. The shared class is `.kv-list` (`global.css`) on the `dl`; its pairs flow into as many columns as fit. A moment in such a list is a readable India-time date and time (`formatDateTime`), never a raw database timestamp.

**Guide callouts:** a rule the reader must not miss in prose (“Never guess”) is a `Banner` notice around its heading and text, not a differently styled box.

**Hold timer:** a countdown for a time-limited task (the transcriber's 10-minute hold) is a `role="timer"` element named by its label. It never announces every tick: a visible warning appears at five minutes and a polite live region announces at five and at one minute, in plain words that say what is lost. When time runs out the person is returned to the area's start, where a notice explains it (§7.6); the server treats a hold within ten seconds of ending as run out, so a browser clock a moment ahead of the server's still finds the notice. Running out is a work state with a notice, not an error banner.

**Reading screen:** the transcriber's screen (`Reading.astro`) shows the document beside the form (the same 58:42 split as §7.17, only the form column scrolls), three fact tiles (ward, AI confidence, time left; §7.16 statistics at staff density), an instruction line, one field group per field (§7.10) with the AI's note in a gray block under its inputs, and a save bar across the full width under both columns (outside the form element, tied to it with the `form` attribute) that holds the `PublishConfirm` unit with its tick, button and hint on one row (`compact`), so it stays a small share of the screen however narrow the form column is. A disclosure (§7.15) holds the “wrong ward or document” report. It is a desktop-only screen.

**Guides:** a staff guide is a single prose column (44rem) with an H1, a lead, an “On this page” contents list (`GuideContents.astro`) whose links all land on a section `id`, and short sections each with an H2 and either a paragraph or a short list. It uses the screen's own words for every button and label (Reject, Fix and publish, Cannot read), never a synonym. Rules that apply to more than one role are written once and shown in each guide: `FieldEntryRules.astro` (how to enter a value, ending in the “Never guess” callout) and `StaffGuideBasics.astro` (language, sign-out, idle sign-out, 403 and 404 pages, the skip link past the PDF viewer). Do not state a rule the product has not decided.

**Disabled primary action:** a primary action that cannot run (Start with nothing waiting) stays in its card and the reason is stated in plain text above it; it is never removed or left unexplained.

**Language options:** the option for a language other than the screen's is labelled with its name in the screen language followed by its own name in brackets (“Kannada (ಕನ್ನಡ)”, “ಇಂಗ್ಲಿಷ್ (English)”), so a reader who cannot read the screen language can still find it; the screen's own language is one plain name.

**Working layouts:** curator screens that decide against a source document use `CuratorSplit.astro` (§7.17), with the document collapsible on every screen that uses it.

**Per-item selection with a bulk action:** when a list of records can be acted on together (for example marking reports as spam), put a labeled checkbox on each record (the whole row at least 44px tall), name the records by position (“Report 2 of 5”), never by database id, and put the bulk action in its own section after the decisions it is not part of, with a button disabled until at least one record is ticked and a hint saying so.

### 7.15 Section navigation, breadcrumbs, and disclosures

**Section navigation:** a paper strip beneath the app bar, sticky at the app bar's height. Links are 14px bold with 8px/12px padding and a 44px minimum height; the active link is forest with a 4px underline and `aria-current`. Real fragment links with smooth scrolling (immediate under reduced motion); the current section updates on scroll. On small screens the strip scrolls horizontally without widening the document. Targets get a `scroll-margin-top` that clears both sticky layers. Focusable controls that can sit beneath the sticky app bar (links in a table header, and focusable scroll regions) get a `scroll-margin-top` that clears it too, so a focus ring is never hidden (WCAG 2.4.11). Do not set `scroll-padding` on `html`: it would add to the section targets' margins. A horizontal scroller with a sticky column sets `scroll-padding-inline-start` to that column's width, so focused content never sits beneath it. Only show links whose targets exist. This is navigation, not tabs.

**Link group:** a short row of sibling links that change how one list is shown (a sort order) or move through it (Previous / Next). Class `.link-group` in `global.css`: pill-shaped links with a 1.5px border, a 44px minimum height and 8px gaps in a labelled `nav`. The current choice has `aria-current="true"`, a forest border and a forest tint with bold text, so the state is visible as well as exposed. A pager renders only when there is another page.

**Breadcrumbs (`Breadcrumbs.astro`):** above the page title in a dark identity band. Pass localized `items` (label + `href`) in hierarchy order. Ancestors are links; the last item is noninteractive text with `aria-current="page"`. Each separator trails its item, so a wrapped line never starts with `›`. A `nav` with a localized accessible name wraps an ordered list; `›` separators are decorative (`aria-hidden`). 14px body text, cream ancestor links, muted hero color for the current item and separators, 8px gaps. Links have a 44×44px minimum target, underline on hover/focus, and a sun focus outline. Whole items wrap onto further lines; long labels wrap without truncation or overflow. Names and labels that contain a number-hyphen-number token (for example a demo candidate id) keep it whole wherever a candidate's name is shown as a row or column heading (`CandidateRow.astro` swaps in a non-breaking hyphen); ordinary names break at spaces only. A place label shows its public number and localized name (the localized `nav.ward` string, “Ward 1 Ramaswamy Palya”), never an internal id, and reads the same in every breadcrumb, field value, title, lookup result and vote message. A client island builds it with `formatWardLabel` from the `nav.ward` template the server renders onto its markup, so it cannot differ from the server's label. A report card's trail is Home › Ward › Candidate name; it also carries a return link (§7.4) to the ward. A comparison page's H1 is the ward name; its breadcrumb's last item names the page (“Compare candidates”) and the table carries its own accessible caption.

**Disclosure/accordion:** native `details`/`summary`, a clear title, optional number, trailing chevron. 16px padding, light border, 8px between disclosures. Opening may add the subtle disclosure shadow and rotates the decorative chevron (a 10px stroke chevron centred in a 20px box, so it reads as an icon, not a corner mark). Multiple items may stay open unless the task needs an exclusive group. Do not rely on the icon alone to show state. The shared classes are `.disclosure` (the bordered box and the 44px-tall summary with its rotating chevron) and `.disclosure-body` (the content padding), in `global.css`; page CSS only positions the box.

### 7.16 Fact groups and statistics

**Structured facts:** muted labels above ordinary values, equal columns, start-aligned. Compact labels may be 13px; values regular 16px. Supporting lists sit under their label. A divider may separate groups without wrapping each fact in a card. Collapse to one column when content no longer fits.

**Statistics:** 24px heading-font figures and 13px labels in inset tiles with 16px padding. A two-by-two grid with 12px gaps may stay two-up on mobile if translated content fits. Height grows with labels; never shrink text to force a tile height. One editorial highlight may use hero-alert, with its figure and label in `--color-on-hero-alert` (§2.2). It highlights a fact, never a party or candidate. A row of state tiles wraps (two-up at least on a phone) rather than forcing one row; labels wrap inside their tile.

### 7.17 Document beside data

Shows structured fields next to the source PDF they come from. `AffidavitScan.astro` supplies the document panel: a bar with a localized “open PDF” link (new tab) above an embedded viewer, with a localized region label.

| Variant | Layout |
|---|---|
| Reading (public) | From 768px, fields and document in a 2:3 grid with a 24px gap; the bordered document panel is sticky below the app bar, fits the remaining viewport height, and scrolls internally. Below 768px the panel is hidden; the field list keeps its source link. |
| Working (`CuratorSplit.astro`, staff) | From 900px, document left and work panel right (58:42, panel at least 26rem), filling the viewport below the 56px staff bar; only the panel scrolls. Below 900px they stack and the document collapses to its link (`collapse`). |

The embedded viewer is the browser's own PDF viewer, so its load-error text cannot be localized; the localized “open PDF” link above it (a body link, §7.4, with a 44px target) is the fallback and stays visible whenever the panel does. Never hide that link.

**Collapsible document:** `CuratorSplit` with `collapsible` adds, from 900px, a secondary “Hide affidavit” / “Show affidavit” toggle (`aria-expanded`, `aria-controls`) and an “open in a new tab” link at the top of the work panel. Hiding gives the panel the full width at a readable measure. The toggle is rendered hidden and revealed by script, so without script the document simply stays open.

Both columns must be shrinkable (`minmax(0, …)`) and let long values wrap. Without a document, keep the single-column layout.

## 8. Iconography and imagery

Consistent line icons on a 20/24px grid, approximately 1.5–2px stroke, `currentColor`. Decorative icons are hidden from assistive technology. Icon-only controls still need full-size targets.

Icons appear with a visible text label, except these, each with an accessible name: the modal close ✕, the external-link glyph (`role="img"` with `aria-label`), the location action in a compact lookup, and footer social marks.

Partner logos use approved assets with preserved proportions. Maps and charts must not introduce partisan colors or communicate meaning solely through color. Identity imagery follows §4.6.

### 8.1 Map/media frames

A bordered, 8px-radius frame with a neutral background, contained overflow, and a centered textual fallback (shown until the map loads, or permanently when maps are disabled). The map uses 16:10 below 768px and 16:7 above. Keep the frame when content is unavailable.

The app-drawn boundary (`WardMap.ts`) is forest at 2px over a 30% forest-tint fill, read from CSS tokens; no markers or pins. The intended basemap is desaturated; basemap styling belongs to the Google Maps Map ID outside the repository, and the current basemap is stock (§12).

## 9. Motion

Motion explains state: modal/toast transitions around 150–200ms, disclosure chevrons, and subtle light-action hover feedback. No scroll reveals, parallax, or decorative animation. Respect `prefers-reduced-motion` by removing transitions and unnecessary movement; keep textual feedback.

## 10. Accessibility floor

- Target WCAG AA contrast for text and interactive boundaries; verify actual pairs.
- Visible keyboard focus, logical focus order, native semantics, meaningful accessible names.
- Targets at least 44×44px; distinct actions normally 8px apart. A smaller glyph (for example the 16px verification icon) keeps its look but extends an invisible 44×44px hit area around it. Inline body links and the wordmark link also reach 44px height (`min-height` with `inline-flex`). Native radios and checkboxes may stay small only when the whole label row is the target and at least 44px tall. A confirmation checkbox that gates a primary action is enlarged (26px) in a label row at least 48px tall and as wide as its form, with a visible focus outline on the row.
- Vendor-rendered controls (the reCAPTCHA badge, Google Maps attribution, the browser PDF viewer) are exempt from the target size, but must not cover page content or controls at any width, and the page must offer its own localized fallback beside them. A page that embeds the PDF viewer also gives keyboard users a way past it: a skip link (the `SkipLink` component, 44px tall, with its own target and label, shown on focus) right after the “open PDF” link, to the panel that holds the form, since the viewer alone can take several tab stops.
- Never use color, icons, position, hover, or motion as the only carrier of meaning.
- Every layout renders `SkipLink.astro` first (a “Skip to main content” link to `#main-content`, visible on focus), plus landmarks, hierarchical headings, correct document language, and equivalent bilingual navigation.
- Preserve content at narrow widths and text zoom; isolate necessary horizontal scrolling.
- Modal focus is trapped and restored. Async updates use an appropriate live region; use `status` rather than `alert` for ambient context.
- Test keyboard interaction and TalkBack on Android, including error recovery and long Kannada text.

## 11. Implementation and usage

- Tokens live on `:root` in `src/styles/tokens.css`, with `:lang(kn)` overrides beside them. Add and document a token before referencing a new custom property.
- Use shared Astro components and vanilla TypeScript islands (`src/islands/`); no UI framework. Choose an existing component (§13) before writing a visually similar one.
- **Cache safety:** public page HTML never varies by visitor or session. Personalized state (for example an issue-vote receipt) is fetched and applied client-side by an island. Islands are bundled modules, never inline scripts.
- **Font budget:** the total self-hosted WOFF2 payload targets ~120KB, with a hard ceiling of 150KB (153,600 bytes), enforced by `scripts/build-fonts.ts` and `tests/unit/tokens.test.ts`.
- **Print styles:** none; pages rely on browser defaults.
- Keep demo data unmistakably fictional.

### 11.1 UI completion checklist

1. Inspect the live rendered UI in a browser (the `agent-browser` CLI is the project's tool).
2. Check 390px and desktop widths, English and Kannada, plus sparse, dense, and long-text content.
3. Review section proportions, shared left edges, vertical alignment, control sizes, wrapping, and horizontal overflow.
4. Exercise keyboard focus, hover, pressed/loading/disabled states, validation, and recovery where applicable.
5. Confirm parent-owned gaps, component-owned padding, valid token references, and surface contrast.
6. Check semantic structure, accessible names, error associations, console output, and screenshots at readable scale.
7. Compare repeated elements for consistent anatomy, hierarchy, and spacing. Do not fix one record with special margins or fixed heights.
8. Run checks appropriate to the change: relevant tests, typecheck, and translation staleness for UI work.

### 11.2 Example usage

Examples illustrate the patterns; they do not limit where a pattern may be used.

| Example | Patterns/components used |
|---|---|
| Home: introduction and ward finder | Dark hero with supporting statistics; compact lookup (light + light icon-only location); outlined eyebrow; inline response |
| Home: why vote | Gold split explanatory section; topic pills |
| Home: election basics | White split explanatory section with numbered disclosures |
| Home: booth finder | Sage content/action band with compact lookup (`BoothLookupForm`) and the guided link-out to the official finder |
| Ward: identity and local facts | Dark identity band; breadcrumbs; structured facts |
| Ward: navigation and boundary | Sticky section navigation; map frame and fallback |
| Ward: candidates | Paper collection band; `CandidateRow` identity rows; plain status text; secondary compare link |
| Ward: issue voting | White action band; choice group with a limit (`IssueVote`); result bars; secondary “show results” |
| Candidate report card | `CandidateProfileField` rows with `VerificationLabel`; document beside data (reading) |
| Comparison | Breadcrumbs; contained scroller with sticky labels; `VerificationLabel presentation="text"` |
| Flag an error | Modal (§7.9); primary submit; success toast |
| Curator queue and editor | Dense tables; `Badge`; `CuratorSplit`; confirmation checkbox; destructive for removals, rejections, and bans |

## 12. Known gaps

Differences between this standard and the code. Fix them; do not copy them.

- `Home.astro` (ward-result paragraph) references undeclared `--leading-md`; it should use `--leading-base`.
- Local values outside the token system: a literal translucent divider (`Ward.astro`) and local spacing values in band compositions.
- Contrast not yet verified: focus indicators on dark green. (Labels on the editorial red are fixed: `--color-on-hero-alert`, §2.2.)
- Some compositions still use fixed heading line heights or local font stacks that bypass the Kannada rules (§5.3).
- `FormField.astro` derives ids from `name`; repeated instances need an explicit uniqueness strategy.
- Disabled links and duplicate-submission prevention are caller responsibilities; button styling does not enforce them.
- The basemap is stock Google (colored POIs); the desaturated style needs a Map ID change outside the repo (§8.1).
- `FieldRow`, `SourceLine`, `IssueBars`, and `Toast` are tested but not currently rendered by any page (§13).
- The reCAPTCHA badge sits fixed bottom-right and, on narrow screens, covers the edge of the issue list. Moving it or hiding it behind the required legal notice is a pending decision (§10).
- Brand lockup is decided (text wordmark plus partner logos, no byline; §7.1) — listed here because code cites it.

## 13. Component inventory

All files in `src/components/` plus the shared islands in `src/islands/`. “Unused” means no page renders it today.

| File | Purpose | Variants / key props | Section |
|---|---|---|---|
| `AppBar.astro` | Global public header: wordmark, partner logos, language toggle | `lang`, `path` | §7.1 |
| `Footer.astro` | Global footer: partners, navigation, legal, social | `lang` | §7.2 |
| `SkipLink.astro` | “Skip to main content” link, visible on focus; with `href` and `label`, a local skip link (past the PDF viewer) | `lang`, `href`, `label` | §10 |
| `Breadcrumbs.astro` | Hierarchical navigation in a dark band | `items: {label, href?}[]`, `lang` | §7.15 |
| `Button.astro` | Action or navigation control | `variant`: primary/secondary/tertiary/destructive/light; `href`, `target`, `rel`, `type`, `disabled`, `loading`, `iconOnly` + `label`, `data-*` | §7.3 |
| `ExternalLinkOut.astro` | Primary-styled link to an official external process, with pending state | `href` (nullable), `label`, `lang` | §7.4, §8 |
| `Card.astro` | Bordered card shell | slot only | §7.5 |
| `CandidateRow.astro` | Identity row: initials/image circle, name, party | `candidate`, `lang` | §7.5, §4 |
| `FieldRow.astro` | Label → value → `SourceLine`; pending-translation indicator. Unused | `label`, `value`, `sourceType`, `sourceUrl`, `aiExtracted`, `notDeclared`, `authoredLang`, `translationStatus` | §3, §7.5 |
| `SourceLine.astro` | Reserved provenance badge (Affidavit / Curator-compiled / AI-extracted). Used only by `FieldRow` | `sourceType`, `sourceUrl`, `aiExtracted` | §3 |
| `CandidateProfileField.astro` | Report-card field: label, value (optional link), verification label; Not declared / Cannot read | `label`, `value`, `valueUrl`, `aiExtracted`, `showVerification`, `notDeclared`, `unreadable` | §3 |
| `VerificationLabel.astro` | “Checked by a person” / “AI-extracted” | `aiExtracted`; `presentation`: icon (tooltip) / text | §3 |
| `Badge.astro` | Flag status badge | `variant`: flag-pending/flag-accepted/flag-rejected; slot overrides label | §7.7 |
| `Banner.astro` | Notice or error banner | `kind`: notice/error | §7.6 |
| `DeadlineBanner.astro` | Statutory deadline countdown | `deadlineISO`, `labelKey` | §7.6 |
| `EmptyState.astro` | Fact plus next step; the fact is the page H1 when the state is the whole page | `fact`, `nextStep`, `headingLevel`, slot | §7.12 |
| `Toast.astro` | Bottom toast markup. Unused (the flag toast mirrors its styles) | `kind`: success/failure | §7.12 |
| `FormField.astro` | Single-line labeled input with helper/error | `type`, `name`, `label`, `helper`, `error`, `required`, `value`, `placeholder` | §7.10 |
| `BoothLookupForm.astro` | Voter-ID (EPIC) booth lookup and result; `BoothLookup.ts` posts to `/api/booth-lookup`, shows “Searching…”, and answers a 400, timeout or failure in place; the form has no action | `lang`, `result` | §7.10 |
| `IssueVote.astro` + `IssueVote.ts` | Anonymous issue vote: choice group with a limit, then saved choices and top results | `issues`, `lang` | §7.10, §7.11 |
| `IssueBars.astro` | Server-rendered ranked result bars. Unused (`IssueVote.ts` renders its own bars) | `results`, `showCounts` | §7.11 |
| `FlagModal.astro` + `FlagModal.ts` | Anonymous “flag an error” dialog with field picker, CAPTCHA, success toast | `lang` | §7.9 |
| `ModalShell.ts` | `ModalController`: shared dialog behavior | `open(trigger)`, `close()` | §7.9 |
| `AffidavitScan.astro` | Document panel: open-PDF link and embedded viewer; with `skipTo`, a skip link past the viewer | `pdfUrl`, `collapse`, `id`, `skipTo` | §7.17 |
| `CuratorSplit.astro` + `AffidavitToggle.ts` | Staff document-beside-work layout; loads `AffidavitFields.ts`; optional hide/show toggle | `pdfUrl` (nullable), `collapsible`, slot | §7.17 |
| `GuideContents.astro` | “On this page” list of links to a staff guide's sections | `lang`, `items: {id, label}[]` | §7.13 |
| `FieldEntryRules.astro` | The rules for entering an affidavit value, shared by both staff guides | `lang` | §7.13 |
| `StaffGuideBasics.astro` | Account, idle sign-out, error-page and keyboard notes shared by both staff guides | `lang` | §7.13 |
| `StaffAccountLinks.astro` | Account link and Sign out form at the end of every staff bar | `lang` | §7.13 |
| `SpamSelection.ts` | Keeps a bulk-action button disabled until a record checkbox is ticked | — | §7.13 |
| `AffidavitFieldInputs.astro` + `AffidavitFields.ts` | One affidavit field: three-way status and inputs | `fieldKey`, `status`, `inputs`, `error` | §7.10 |
| `CuratorFieldForm.astro` | Curator correction of one field with publish confirmation | `field`, `label`, `confirmPath`, `submitLabel`, `embedded`, `raw`, `error` | §7.13 |
| `CuratorWardForm.astro` | Curator move of a candidate to another ward with confirmation | `wards`, `wardId`, `confirmPath`, `submitLabel` | §7.13 |
| `WardLookup.ts` | Home ward finder: inline results, location button | — | §7.10 |
| `WardMap.ts` | Ward boundary on Google Maps | — | §8.1 |
| `WardSectionNav.ts` | Current-section tracking for section navigation | — | §7.15 |
| `ScrollHint.ts` | Shows a scroll hint only while its table overflows; pairs each `[data-scroll-hint]` with the `[data-scroll-region]` after it | — | §7.11 |
| `ScrollRegion.astro` | A wide table in a focusable, named scroller with a hint | `lang`, `label`, `id` | §7.11, §7.13 |
| `PublishConfirm.astro` + `GatedSubmit.ts` | The required confirmation tick (the shared `.confirm-tick`), the primary submit it gates and the hint; the island disables the submit until the tick | `label`, `hint`, `submitLabel`, `name`, `checked`, `compact`, `form` | §7.3, §7.13 |
| `TranscribeForm.ts` | Transcriber screen: disables inputs per status, assets total, hold countdown with a warning and live announcements, focus on the first invalid control | — | §7.10, §7.13 |
