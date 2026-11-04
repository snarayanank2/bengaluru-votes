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
| `--basics-muted` | `#57624a` | Disclosure icon color |
| `--basics-border` | `rgba(24, 35, 15, 0.12)` | Light disclosure border |
| `--methodology-bg` | `#ccdabd` | Sage supporting surface |
| `--methodology-text` | `#28371c` | Text on sage |

Names such as `hero`, `why-vote`, `basics`, and `methodology` are implementation names. They identify visual roles, not route restrictions.

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
| `--color-hero-button-text` | `--hero-button-text` | Light-action text |
| `--color-why-vote-bg` | `--why-vote-bg` | Explanatory gold band |
| `--color-why-vote-text` | `--why-vote-text` | Gold-band kicker and icon |
| `--color-why-vote-ink` | `--why-vote-ink` | Gold-band body text |
| `--color-why-vote-pill` | `--why-vote-pill` | Noninteractive topic pills |
| `--color-basics-muted` | `--basics-muted` | Disclosure chevron |
| `--color-basics-border` | `--basics-border` | Disclosure border |
| `--color-methodology-bg` | `--methodology-bg` | Supporting sage band |
| `--color-methodology-text` | `--methodology-text` | Sage-band text |

Use the matching foreground/background pair. For small editorial text on sage, use the darker brick token (`--color-danger`); the brighter hero-alert red does not meet normal-text contrast there. Sun or lime text belongs on a dark surface; never put white text on sun, lime, or leaf. Gold is an explanatory surface, not a warning. Editorial red does not imply a validation error. Pair all statuses with explicit text.

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
| Document beside data | Structured fields next to their source PDF (§7.17) | Two columns, document panel sticky and internally scrolled | Fields only; document becomes a link |

**Surface selection:** dark green establishes identity; gold gives explanatory material emphasis; white supports detailed reading and interaction; paper gently separates a collection or navigation strip; sage supports a related task or resource collection. Use the matching text tokens in §2.2.

**Section rhythm:** continuous color bands meet without an extra gap. Separate content regions use the default 32px gap, or 48px for a clear hierarchy change. The final full-width band meets the footer directly; no container bottom padding or empty spacer beneath it. Restore the shared inset after any full-width breakout.

## 7. Components

### 7.1 App bar

The global public brand/navigation shell (`AppBar.astro`) is 80px high, sticky at `top: 0`, on paper with `--shadow-sticky`. Its inner row uses the app container. Branding at the start, language control at the end. It never reads cookies or session and renders no account action.

**Lockup:** the “Bengaluru Votes” text wordmark (the home link), a hairline separator, the OpenCity logo, a decorative star, and the Janaagraha logo; no byline. Below 768px the visible wordmark becomes “BV” (CSS only; the home link's accessible name stays “Bengaluru Votes”). Logo heights are 20px/22px on desktop, 13px/14px below 768px, and 12px below 360px, where the separator also disappears. Partner images sit outside the home link so they keep their own alt text.

**Language control:** `EN | ಕನ್ನಡ` in fixed order. The current language is a noninteractive selected segment (forest on forest tint); the alternate language links to the equivalent page. Both segments have a minimum 44×44px target.

Staff layouts (`CuratorLayout`, `AdminLayout`, `TranscriberLayout`) use their own 56px bar without the language toggle (§7.13).

### 7.2 Footer

Black with lime branding/navigation. At 768px and above, three start-aligned columns with 32px gaps and a vertical rule plus 32px inset on subsequent columns; stack in DOM order on mobile. Group project attribution, resource navigation, and utility/legal navigation separately.

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

`aria-disabled` on an anchor does not prevent navigation; callers must handle unavailable links deliberately.

**Light variant:** `variant="light"`: white fill/border, `--color-hero-button-text`, 48px minimum height, 6px radius, 0.95rem/600 in the language-aware heading font. Enabled hover uses `--hero-button-hover`, `--shadow-hero-button-hover`, and a 1px lift over 180ms. Reduced motion removes the lift and transition. Page CSS owns placement and width only.

**Icon-only shape:** `iconOnly` with a localized `label`, which becomes the accessible name; the component throws on an empty label. One decorative 20×20px SVG centered in a 44×44px target (48×48px for light), zero padding, no shrinking. Light icon-only for utility actions on colored bands; tertiary icon-only for low-emphasis utility actions on light surfaces (ink, transparent at rest, gray hover, darker gray pressed, forest focus outline, no underline). The icon is hidden from assistive technology; never rely on its shape or a hover tooltip as the only name.

**Shared implementation:** `Button.astro` and client-created controls share `src/styles/buttons.css`. Classes: `btn btn--<variant> btn-shared`, plus `btn--icon` for icon-only. A client-created control uses the same classes and supplies its own accessible label, disabled/busy semantics, and event handling. Do not recreate button styles in a page or island.

Language segments (§7.1), social icon links (§7.2), section navigation, and disclosure toggles (§7.15) have their own control patterns. Noninteractive pills (§7.7) are not buttons.

**Action groups:** main action first, start-aligned, flex-wrap; gap 8px, or 12px in a spacious row. Place the group 24px after its content. If actions stack, use a consistent width. Avoid per-button compensating margins.

### 7.4 Links

Body links use forest and an underline. Navigation and identity links may omit the underline at rest, restoring it on hover/focus. Match focus styling to the surface. External destinations need an understandable cue: the labeled external-link glyph (`ExternalLinkOut.astro`) or a recognizable social mark. Use button styling for navigation only when its prominence warrants it; retain anchor semantics.

**Guided link-out (`ExternalLinkOut.astro`):** a primary-styled anchor to an official external process, always `target="_blank" rel="noopener noreferrer"` with the labeled glyph. When the URL setting is empty, it renders a disabled-looking placeholder and a visible “(official link pending)” note rather than inventing a URL.

### 7.5 Cards, rows, and collections

**Base card:** white fill, 1px `--color-border`, 8px radius, 16px padding, no shadow. `Card.astro` supplies this shell only — no headings, spacing, click behavior, or semantics.

**Content anatomy:** optional eyebrow/icon → title → body or facts → optional metadata → actions. 8px for tightly related text, 16px between groups, 24px before a distinct action area. The parent grid owns inter-card gaps.

| Treatment | Use and rules |
|---|---|
| Bordered card | A self-contained content unit or question; base shell |
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

`Banner` uses 12px/16px padding and an 8px radius. `DeadlineBanner` computes remaining days server-side from a `YYYY-MM-DD` date. Use explicit text, not color alone. An empty live region must not paint an empty banner. Announce async responses without moving focus unnecessarily. Countdowns are never a device for emphasizing ordinary information.

### 7.7 Badges and topic pills

**Status badges (`Badge.astro`):** 13px, full radius, 4px/10px padding, explicit label. Exactly three variants; add another only by documenting it here first.

| Variant | Treatment | Meaning |
|---|---|---|
| `flag-pending` | Muted gray on gray surface | A flagged correction awaits review |
| `flag-accepted` | Forest on forest tint | The correction was accepted and published |
| `flag-rejected` | Brick on brick tint | The flag was reviewed and rejected |

The default label comes from i18n; the slot may override wording, not color. Provenance badges are a separate reserved set (§3, `SourceLine.astro`). Allow translated labels to wrap.

**Topic and identity pills:** noninteractive topic pills use `--color-why-vote-pill` with matching dark ink. Outlined identity/eyebrow pills use sun on dark green with 4px/12px padding. These describe content; they are not filters. A selectable chip is a real button or checkbox with state semantics and a 44px target.

### 7.8 Gated actions

Removed: sign-in-gated public actions (no public action requires sign-in). See §11 for the cache-safety rule.

### 7.9 Modals

`ModalShell.ts` (`ModalController`) provides shared behavior over native `<dialog>`: explicit Close (`data-modal-close`), Escape, scrim-tap dismissal, focus trap, focus return to the trigger, and no URL change. Each modal component owns its markup and CSS.

Visual shell: white, 8px radius, `--shadow-modal`, `rgba(26,26,26,0.5)` scrim. Below 768px, a full-width bottom sheet with rounded top corners. Title in 24px. Close is a tertiary icon-only button (§7.3). Content and actions follow §7.10.

Provide an accessible title. Scrim dismissal must not lose important work; preserve form input on every failed submission. A multi-step form keeps one title and context across steps, asks for a **single input per step**, and preserves input when users move back.

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

Associate label and control with unique ids; link helpers and errors through `aria-describedby`. Validate at a task boundary, not every keystroke. On failed submit, focus the relevant field or a linked summary. Do not reserve blank error areas.

**Form composition:** stack fields for sequential tasks; use columns only for closely related inputs and collapse them on narrow screens. Actions 24px after the final field.

**Choice group with a limit:** labeled native checkboxes in bordered option rows (48px minimum height, 12px padding, 6px radius), two equal columns from 768px, one below. Checked rows take a forest border; hover a forest border; keyboard focus a 2px forest outline on the row. State the selection limit before the group; once it is reached, disable unchecked options while keeping checked ones deselectable. The primary submit shows the live count (“n of N selected”) and is enabled only when the selection is valid. Errors and success stay inline and are announced.

**Compact lookup:** a single input plus action inline at 48px height with an 8px gap; an optional location action is a light icon-only button (§7.3). On narrow screens the input spans the first row with actions beneath. A visually hidden label is allowed only when persistent surrounding text makes the purpose clear. Keep essential helper text visible. Results go in a separate full-width live region beneath the controls.

**Affidavit field group (`AffidavitFieldInputs.astro`, staff):** a `fieldset[data-field]` with a three-way status (value / not declared / cannot read) followed by the field's inputs. `AffidavitFields.ts` disables the inputs unless the status is “value” and keeps an assets total live.

### 7.11 Result bars and comparisons

**Result bars (`IssueBars.astro`, and the same anatomy rendered client-side by `IssueVote.ts`):** forest fill on a gray track, a visible label, rank number, and share in tabular figures. One hue across all peers (§4.5); full labels wrap, never truncate. Rank is expressed through order and numbers and remains understandable without color.

**Comparisons:** repeat the same field order and alignment across records, in alphabetical record order (§4.3). On narrow screens use a contained horizontal scroller with a sticky row-label column rather than stacking; keep column headings and keyboard access. Do not convert missing data to zero or visually score a person.

### 7.12 Empty, loading, and feedback states

- **Empty (`EmptyState.astro`):** a fact (18px ink) and an optional next step (16px muted), centered, 32px/16px padding; optional slot for an action. Distinguish not-yet-available data from a failed request; do not invent a date. No sad-face iconography.
- **Loading:** spinners only inside actions (§7.3); preserve layout and announce progress accessibly. There are no content skeletons.
- **Success:** confirm the outcome with text in the existing action context. Color alone is insufficient.
- **Error:** retain user work and give a concrete recovery action. Field errors sit next to fields; task-level failures near the affected action.
- **Toast (`Toast.astro`; mirrored by `FlagModal.ts`'s success toast):** fixed bottom-center, ink on white, `--shadow-modal`, 4px forest (success) or brick (failure) left edge, `role="status"` `aria-live="polite"`, visible for at least five seconds. Persistent or actionable failures also need an enduring location.

### 7.13 Curator and admin surfaces

Staff layouts (`CuratorLayout`, `AdminLayout`, `TranscriberLayout`) share the tokens with a denser rhythm: a 56px bar with skip link and no language toggle, 14px table text, 8px cell padding, odd-row gray zebra stripes, sticky column headings where tables scroll. Text left-aligned, numbers right-aligned. Status uses `Badge` labels (§7.7), never color alone; a held or not-ready item is a work state, not an error.

**Confirmation:** destructive and publishing actions require a confirmation that states scope and effect — a required checkbox in the same form naming the public path the change appears on (or the user affected), checked again server-side. This is a no-JS confirmation step, not an editorial approval gate. Irreversible actions say so.

**Working layouts:** curator screens that decide against a source document use `CuratorSplit.astro` (§7.17).

### 7.14 Environment notice

`EnvBanner.astro` renders a compact, full-width notice above the app bar: centered 14px bold text, 8px vertical padding, `role="status"`. It scrolls away and does not alter the app bar's sticky offset; it is not dismissible (that would need per-visitor state). `src/lib/env-banner.ts` maps `APP_ENV` to a variant; the only variant is `production` (an informational sun-tint notice, copy in `banner.production`). Any other or missing value renders nothing, so local development and tests show no banner.

### 7.15 Section navigation, breadcrumbs, and disclosures

**Section navigation:** a paper strip beneath the app bar, sticky at the app bar's height. Links are 14px bold with 8px/12px padding and a 44px minimum height; the active link is forest with a 4px underline and `aria-current`. Real fragment links with smooth scrolling (immediate under reduced motion); the current section updates on scroll. On small screens the strip scrolls horizontally without widening the document. Targets get a `scroll-margin-top` that clears both sticky layers. Only show links whose targets exist. This is navigation, not tabs.

**Breadcrumbs (`Breadcrumbs.astro`):** above the page title in a dark identity band. Pass localized `items` (label + `href`) in hierarchy order. Ancestors are links; the last item is noninteractive text with `aria-current="page"`. A `nav` with a localized accessible name wraps an ordered list; `›` separators are decorative (`aria-hidden`). 14px body text, cream ancestor links, muted hero color for the current item and separators, 8px gaps. Links have a 44×44px minimum target, underline on hover/focus, and a sun focus outline. Whole items wrap onto further lines; long labels wrap without truncation or overflow. A place label shows its public number and localized name, never an internal id.

**Disclosure/accordion:** native `details`/`summary`, a clear title, optional number, trailing chevron. 16px padding, light border, 8px between disclosures. Opening may add the subtle disclosure shadow and rotates the decorative chevron. Multiple items may stay open unless the task needs an exclusive group. Do not rely on the icon alone to show state.

### 7.16 Fact groups and statistics

**Structured facts:** muted labels above ordinary values, equal columns, start-aligned. Compact labels may be 13px; values regular 16px. Supporting lists sit under their label. A divider may separate groups without wrapping each fact in a card. Collapse to one column when content no longer fits.

**Statistics:** 24px heading-font figures and 13px labels in inset tiles with 16px padding. A two-by-two grid with 12px gaps may stay two-up on mobile if translated content fits. Height grows with labels; never shrink text to force a tile height. One editorial highlight may use hero-alert, with contrast checked. It highlights a fact, never a party or candidate.

### 7.17 Document beside data

Shows structured fields next to the source PDF they come from. `AffidavitScan.astro` supplies the document panel: a bar with a localized “open PDF” link (new tab) above an embedded viewer, with a localized region label.

| Variant | Layout |
|---|---|
| Reading (public) | From 768px, fields and document in a 2:3 grid with a 24px gap; the bordered document panel is sticky below the app bar, fits the remaining viewport height, and scrolls internally. Below 768px the panel is hidden; the field list keeps its source link. |
| Working (`CuratorSplit.astro`, staff) | From 900px, document left and work panel right (58:42, panel at least 26rem), filling the viewport below the 56px staff bar; only the panel scrolls. Below 900px they stack and the document collapses to its link (`collapse`). |

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
- Targets at least 44×44px; distinct actions normally 8px apart.
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
| Home: booth finder | Sage content/action band with compact lookup (`BoothLookupForm`) |
| Ward: identity and local facts | Dark identity band; breadcrumbs; structured facts |
| Ward: navigation and boundary | Sticky section navigation; map frame and fallback |
| Ward: candidates | Paper collection band; `CandidateRow` identity rows; plain status text; secondary compare link |
| Ward: issue voting | White action band; choice group with a limit (`IssueVote`); result bars; secondary “show results” |
| Candidate report card | `CandidateProfileField` rows with `VerificationLabel`; document beside data (reading) |
| Comparison | Breadcrumbs; contained scroller with sticky labels; `VerificationLabel presentation="text"` |
| Flag an error | Modal (§7.9); primary submit; success toast |
| Curator queue and editor | Dense tables; `Badge`; `CuratorSplit`; confirmation checkbox; destructive for removals, dismissals, and bans |

## 12. Known gaps

Differences between this standard and the code. Fix them; do not copy them.

- `Home.astro` (ward-result paragraph) references undeclared `--leading-md`; it should use `--leading-base`.
- Local values outside the token system: an 11px disclosure radius (`Home.astro`), a literal translucent divider (`Ward.astro`), and local spacing values in band compositions.
- Contrast not yet verified: muted labels on editorial red; focus indicators on dark green.
- Some compositions still use fixed heading line heights or local font stacks that bypass the Kannada rules (§5.3).
- `FormField.astro` derives ids from `name`; repeated instances need an explicit uniqueness strategy.
- Disabled links and duplicate-submission prevention are caller responsibilities; button styling does not enforce them.
- The basemap is stock Google (colored POIs); the desaturated style needs a Map ID change outside the repo (§8.1).
- `FieldRow`, `SourceLine`, `IssueBars`, and `Toast` are tested but not currently rendered by any page (§13).
- Brand lockup is decided (text wordmark plus partner logos, no byline; §7.1) — listed here because code cites it.

## 13. Component inventory

All files in `src/components/` plus the shared islands in `src/islands/`. “Unused” means no page renders it today.

| File | Purpose | Variants / key props | Section |
|---|---|---|---|
| `AppBar.astro` | Global public header: wordmark, partner logos, language toggle | `lang`, `path` | §7.1 |
| `Footer.astro` | Global footer: partners, navigation, legal, social | `lang` | §7.2 |
| `SkipLink.astro` | “Skip to main content” link, visible on focus | `lang` | §10 |
| `EnvBanner.astro` | Per-deployment notice above the app bar | `lang`; variant from `APP_ENV` (`production` only) | §7.14 |
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
| `EmptyState.astro` | Fact plus next step | `fact`, `nextStep`, slot | §7.12 |
| `Toast.astro` | Bottom toast markup. Unused (the flag toast mirrors its styles) | `kind`: success/failure | §7.12 |
| `FormField.astro` | Single-line labeled input with helper/error | `type`, `name`, `label`, `helper`, `error`, `required`, `value`, `placeholder` | §7.10 |
| `BoothLookupForm.astro` | Voter-ID (EPIC) booth lookup and result; `BoothLookup.ts` posts to `/api/booth-lookup` | `lang`, `result` | §7.10 |
| `IssueVote.astro` + `IssueVote.ts` | Anonymous issue vote: choice group with a limit, then saved choices and top results | `issues`, `lang` | §7.10, §7.11 |
| `IssueBars.astro` | Server-rendered ranked result bars. Unused (`IssueVote.ts` renders its own bars) | `results`, `showCounts` | §7.11 |
| `FlagModal.astro` + `FlagModal.ts` | Anonymous “flag an error” dialog with field picker, CAPTCHA, success toast | `lang` | §7.9 |
| `ModalShell.ts` | `ModalController`: shared dialog behavior | `open(trigger)`, `close()` | §7.9 |
| `AffidavitScan.astro` | Document panel: open-PDF link and embedded viewer | `pdfUrl`, `collapse` | §7.17 |
| `CuratorSplit.astro` | Staff document-beside-work layout; loads `AffidavitFields.ts` | `pdfUrl` (nullable), slot | §7.17 |
| `AffidavitFieldInputs.astro` + `AffidavitFields.ts` | One affidavit field: three-way status and inputs | `fieldKey`, `status`, `inputs`, `error` | §7.10 |
| `CuratorFieldForm.astro` | Curator correction of one field with publish confirmation | `field`, `label`, `confirmPath`, `submitLabel`, `embedded`, `raw`, `error` | §7.13 |
| `CuratorWardForm.astro` | Curator move of a candidate to another ward with confirmation | `wards`, `wardId`, `confirmPath`, `submitLabel` | §7.13 |
| `WardLookup.ts` | Home ward finder: inline results, location button | — | §7.10 |
| `WardMap.ts` | Ward boundary on Google Maps | — | §8.1 |
| `WardSectionNav.ts` | Current-section tracking for section navigation | — | §7.15 |
| `TranscribeForm.ts` | Transcriber screen: disables inputs per status, assets total, hold countdown | — | §7.10 |
