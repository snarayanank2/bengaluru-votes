# GBA Elections Citizen Platform — Design System

**Status:** Living reference v2 · **Applies to:** `bengaluruvotes.opencity.in` · **Updated:** 20 September 2026

This system defines reusable visual foundations, section patterns, components, and interaction states. Choose a pattern by the information or task it supports. A route does not own a color, layout, or component variant. Specific pages appear only as example usage in §11.2.

The system extends Open City's forest-green identity, Manrope headings, and PT Sans body text with dark-green, gold, paper, and sage section surfaces. Color communicates hierarchy and system state, never political affiliation.

**How to read this document:** shared rules describe the design standard; implementation notes distinguish existing component support from guidance that still needs implementation. Token names match `src/styles/tokens.css`; shared styles live in `src/styles/global.css`. Known gaps are recorded in §12 rather than promoted into design rules. Product requirements remain in `overview.md`, `milestones.md`, and `architecture.md`.

## 1. Principles

1. **Trust and neutrality.** Present facts, sources, and uncertainty clearly. Give comparable people or records equal visual weight. Avoid promotional effects and artificial urgency.
2. **Mobile-first.** Preserve reading order and usable controls on narrow screens. Prefer solid surfaces, borders, modest font payloads, and minimal motion.
3. **Bilingual parity.** English and Kannada share hierarchy, functionality, and visual emphasis. Allow translated text to wrap without clipping or truncation.
4. **One system across roles.** Public and staff interfaces share foundations. Dense workspaces may use compact rows; they do not get a different brand.
5. **Patterns before exceptions.** Reuse a section or component according to its purpose. Document a reusable variant when an existing pattern cannot express a recurring need.

## 2. Color

### 2.1 Primitives

Define all hex colors in `src/styles/tokens.css`. Components should consume the semantic layer in §2.2.

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

Names such as `hero`, `why-vote`, `basics`, and `methodology` are existing implementation names. They identify the visual roles below, not route restrictions. This document does not rename tokens or introduce aliases that do not exist.

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

Use the matching foreground/background pair. Sun or lime text belongs on a dark surface; never put white text on sun, lime, or leaf. Gold is an explanatory surface, not a warning by itself. Editorial red does not imply a validation error. Pair all statuses with explicit text.

### 2.3 Contrast

Target WCAG AA: at least 4.5:1 for normal text and 3:1 for large text; verify control boundaries and focus indicators against their adjacent surfaces. A token being approved does not make every pairing accessible.

Forest, brick, and muted gray on white are the standard text combinations; ink on sun and lime on black are strong-contrast combinations. Leaf on white is restricted to large text or non-text decoration. Validate new pairings, especially muted text on editorial red and focus outlines on dark green. Known gaps are in §12; this document is not a blanket conformance claim.

## 3. Provenance styling

A sourced field is a reusable content unit: **label → value → source line**. It lets a fact retain context when copied, compared, or captured in a screenshot.

- Label: muted 14px; value: regular 16px ink; source line: muted 13px.
- Keep a shared left edge, 4px between label and value, and 8px before the source.
- Use a readable source title and link where available. Do not rely on a badge alone to explain provenance.
- Missing values use explicit copy such as “Not declared”; retain the source context. Do not imply that unknown means zero.

| Badge | Treatment | Meaning |
|---|---|---|
| Affidavit | Forest on forest tint | Official affidavit source |
| Curator-compiled | Muted gray on gray surface | Compiled and sourced context |
| AI-extracted | Ink on sun tint with dotted sun border | Extracted data awaiting confirmation |

Keep provenance labels distinct from topic pills and action states even when they share palette tokens. Summary fact groups (§7.16) do not automatically need a source line on every item; the product's sourcing requirements determine where to use this component.

## 4. Neutrality rules

1. Party identity uses text and, where available, an official symbol. Never assign a color to a party or candidate in a list, chart, map, or comparison.
2. The documented gold explanatory surface is permitted. Do not introduce saffron/orange party accents or additional political color associations.
3. Comparable records use identical photo treatment, typography, field order, and available actions. Ordering follows the product's deterministic rule, never visual or editorial favoritism.
4. Error colors describe failed actions, not a person's criminal-case count, assets, or other attributes. Present such values in ordinary ink.
5. Ranked results use a single forest hue on a gray track; order, labels, and numbers convey rank.
6. Photography is documentary: consistent crop/aspect ratio, no partisan filters or duotones. Use neutral initials when an identity has no image, never invented photographs.

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

Self-host subset WOFF2 with `font-display: swap`; preserve Kannada conjuncts. Preload only the above-the-fold families required by the active language. Use tabular figures for changing counts and aligned numeric columns.

### 5.2 Scale

| Token | Mobile / ≥768px | Line-height token/value | Use |
|---|---|---|---|
| `--text-xs` | 13px | `--leading-xs`: 1.4 | Sources, eyebrows, compact fact labels |
| `--text-sm` | 14px | `--leading-sm`: 1.5 | Labels, helpers, metadata |
| `--text-base` | 16px | `--leading-base`: 1.5 | Body, inputs, buttons |
| `--text-lg` | 18px | `--leading-lg`: 1.5 | Leads, compact identity titles |
| `--text-xl` | 20px | `--leading-xl`: 1.3 | Card titles |
| `--text-2xl` | 24px | `--leading-2xl`: 1.25 | Section/modal headings, fact figures |
| `--text-3xl` | 28px / 32px | `--leading-3xl`: 1.2 | Identity headings |
| `--text-4xl` | 32px / 40px | `--leading-4xl`: 1.1 | Display headings |

Use 16px as the body and input baseline. Existing band compositions also use 1.6rem (25.6px) section headings and 0.95rem (15.2px) supporting prose. These are current CSS overrides, not additional named tokens; use the shared scale for new work until a reusable type variant is formalized. Eyebrows are subordinate to headings, not a second headline.

### 5.3 Kannada

- Body line height increases from 1.5 to 1.7; heading line heights of 1.2–1.3 increase to 1.4. Ensure local CSS does not bypass these rules.
- Use `letter-spacing: normal`; do not apply Latin tracking to Kannada glyphs.
- Use sentence case throughout the system. Do not depend on uppercase styling for hierarchy.
- `--kn-pad` is 0px by default and 2px under `:lang(kn)`; use it for extra vertical padding in compact controls where needed.
- Allow multi-line labels and taller controls. Do not truncate translated headings, buttons, or form labels to preserve an English-sized box.

### 5.4 Voice

Use plain language and sentence case. Labels name the content; buttons name the outcome, such as “Find my booth” or “Submit flag”. Explain required formats and errors with a concrete next step. Avoid generic “OK”, unexplained abbreviations, and urgency without a real deadline.

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

The parent owns gaps between siblings; the component owns its internal padding. Prefer flex/grid `gap`, reset browser margins inside composed components, and avoid adding child padding to compensate for a parent's alignment. Use the smallest gap that expresses the relationship.

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
- Use `minmax(0, 1fr)` or `min-width: 0` where content needs to shrink. Do not assume equal line counts or use fixed heights to align text blocks.
- Numeric columns align right with tabular figures. Their headings use the same alignment.
- Scroll only the component that needs it, such as section navigation or a comparison grid; do not create document-wide horizontal overflow.

### 6.3 Shape and elevation

| Token | Value / role |
|---|---|
| `--radius-sm` | 6px: buttons and inputs |
| `--radius-md` | 8px: cards, map frames, dialogs |
| `--radius-full` | 9999px: badges, pills, round identity images |
| `--shadow-sticky` | `0 2px 4px rgba(26,26,26,0.08)` |
| `--shadow-modal` | `0 8px 24px rgba(26,26,26,0.16)` |
| `--shadow-hero-button-hover` | `0 2px 6px rgba(19,32,16,0.08), 0 8px 18px rgba(19,32,16,0.12)` |

Cards are border-first, without a default shadow. Use the subtle hover shadow for light-action hover and an expanded disclosure, not every surface. Existing disclosures use an 11px radius; this is not a shared radius token (§12).

### 6.4 Reusable section patterns

Every section starts with a content hierarchy: optional eyebrow → heading → optional lead → content → related actions. Omit unnecessary layers. Use a semantic `section` with an accessible heading when the content forms a distinct topic.

| Pattern | Anatomy and purpose | Desktop | Mobile |
|---|---|---|---|
| Dark identity/hero | Eyebrow or identity pill, prominent heading, supporting copy, optional action or facts | Dark-green band; 48px vertical padding | 32px padding; content stacks |
| Hero with supporting statistics | Main copy/action plus a compact fact grid | Flexible copy + 260px supporting column; 32px gap; center-aligned as a group | One column, 24px gap; facts may stay two-up |
| Split explanatory section | Heading group beside prose, topic pills, or disclosures | 1:2 columns, 32px gap and vertical padding | One column, 24px gap |
| Content/action band | Heading, description, one task or content collection | White, paper, or sage; 32px vertical padding | Same hierarchy; controls wrap or stack |
| Structured fact group | Parallel label/value units with optional lists | Equal columns, start-aligned, 32px gaps | Single column, 16px gaps |
| Collection section | Heading plus rows, cards, or disclosures | One enclosing band; 16px card gaps or 24px identity-row gaps | Preserve item order and hierarchy |
| Data/media section | Heading, map/chart/media frame, optional explanatory text | Frame aligned to container | Frame resizes; no page overflow |

**Surface selection:** dark green establishes identity; gold gives explanatory material emphasis; white supports detailed reading and interaction; paper gently separates a collection or navigation strip; sage supports a related task or resource collection. Use the matching text tokens in §2.2. A surface's meaning does not depend on its position in a particular route.

**Section rhythm:** continuous color bands meet without an extra gap. Separate content regions use the default 32px gap, or 48px for a clear hierarchy change. Do not combine a large outer gap and large internal padding by accident. Restore the shared inset after any full-width breakout.

## 7. Components

### 7.1 App bar

The global brand/navigation shell is 80px high, sticky at `top: 0`, on paper with `--shadow-sticky`. Its inner row uses the app container. Keep branding at the start and language controls at the end.

The current lockup contains “Bengaluru Votes”, a separator, OpenCity, a decorative star, and Janaagraha. At widths below 768px, the visible wordmark becomes “BV”, retaining the full accessible name. Logo heights are 20px/22px on desktop and 13px/14px on mobile; below 360px the separator disappears. Partner images remain outside the home-link accessible-name override.

The language control keeps `EN | ಕನ್ನಡ` in a fixed order. The current language is a noninteractive selected segment; the alternate language is a link to the equivalent content. Selection is forest on forest tint. No account action is currently rendered in this component. The existing 32px segment height falls short of the target in §10.

### 7.2 Footer

Use black with lime branding/navigation. At 768px and above, use three equal, start-aligned columns, 32px gaps, and a vertical rule plus 32px inset on subsequent columns. Stack in DOM order on mobile. Group project attribution, resource navigation, and utility/legal navigation rather than mixing them in one undifferentiated list.

Use self-hosted approved partner assets. The existing Janaagraha SVG uses a white monochrome filter; Oorvani has a white wordmark. Social marks are 24px inside 44px targets, white at rest and lime on hover, with accessible platform names. Text links underline on hover/focus; use sun focus outlines on black. Link destinations are content configuration, not design-system rules.

### 7.3 Buttons and action groups

Use a native `button` for an action and an anchor for navigation. The shared `Button.astro` supports four variants:

| Variant | Treatment | When to use |
|---|---|---|
| Primary | White on forest | Main action within a section or task |
| Secondary | Forest text, 1.5px forest border, white fill | Supporting or alternative action |
| Tertiary | Forest text, transparent fill/border; underline on hover/focus | Low-emphasis action |
| Destructive | White on brick | Delete or another destructive operation |

**Anatomy:** optional icon + outcome label; 44×44px minimum target; 16px Manrope 700; 6px radius; 8px vertical and 24px horizontal padding. Tertiary actions use 8px horizontal padding. Allow labels to wrap and controls to grow vertically. Icon-label gaps are 8px; icons do not shrink.

| State | Required behavior and appearance |
|---|---|
| Default | Variant remains legible on its containing surface |
| Hover | Preserve the variant's hierarchy; tertiary underlines; light actions use the documented hover fill/shadow |
| Focus | Visible 2px outline with 2px offset; use a contrasting color on dark surfaces |
| Pressed | Preserve geometry and readable feedback; do not depend on motion or color alone |
| Loading | Hold width, show a spinner and accessible busy/status text, prevent duplicate submission at the action layer |
| Disabled | Gray surface, muted text, unavailable semantics; explain the reason where it is not obvious |

`Button.astro` retains label geometry for loading and has `aria-busy` on native buttons. Loading alone does not disable submission. `aria-disabled` on an anchor does not prevent navigation; callers must handle unavailable links deliberately. Accessible loading feedback needs review (§12).

**Light action treatment:** for lookup forms on colored bands, use a white/light fill, `--color-hero-button-text`, and 48px minimum height. The current treatment uses 0.95rem/600 type and `--hero-button-hover` on hover, with a 1px lift over 180ms. It is a composition-level style, not a fifth supported `Button` variant.

**Action groups:** main action first, start-aligned, flex-wrap enabled; default gap 8px, or 12px in a spacious action row. Place the group 24px after its content. If actions stack, use a consistent width treatment. Avoid per-button compensating margins. Authentication-gated actions remain enabled (§7.8).

### 7.4 Links

Body links use forest and an underline. Clear navigation and identity links may omit the underline at rest, restoring it on hover/focus. Match focus styling to the surface. External destinations need an understandable cue; labeled external-link glyphs or recognizable social marks may provide it. Use button styling for navigation only when its prominence warrants it; retain anchor semantics.

### 7.5 Cards, rows, and collections

**Base card:** white fill, 1px `--color-border`, 8px radius, 16px padding, no shadow. `Card.astro` supplies this shell only; it does not automatically supply headings, spacing, click behavior, or accessibility semantics.

**Content anatomy:** optional eyebrow/icon → title → body or facts → optional metadata → actions. Use 8px for tightly related text and 16px between groups. Place actions 24px after the main content where there is a distinct action area. Let the parent grid own inter-card gaps.

| Treatment | Use and rules |
|---|---|
| Bordered card | A self-contained content unit or question; use the base shell |
| Unboxed content | Content already grouped by a band; remove redundant borders and fill rather than nesting cards |
| Inset fact tile | A figure and short label on dark green; use dark inset fill, 16px padding, 8px radius |
| Identity row | 56px circular photo/neutral initials, name, then muted 14px secondary identity text; 16px image-to-text gap |
| Sourced field row | Label/value/source anatomy from §3 |

Identity titles use 20px Manrope 700, or 18px for a compact collection. Apply the same choice to every peer. Keep status text subordinate and permit long names to wrap. Lists of identities use 24px between rows; card collections use 16px. Empty collections use §7.12 rather than blank cards.

A noninteractive card must not acquire a pointer cursor or misleading hover elevation. For a single destination, use a real link with a clear accessible name. Do not nest controls inside an enclosing link; multi-action cards have separate controls. Equal-height grid shells are acceptable, but their text starts at the top and must not depend on fixed content heights.

### 7.6 Banners and countdowns

| Kind | Treatment | Content |
|---|---|---|
| Deadline | Ink on sun; 8px radius; tabular figure | A real, confirmed deadline and its meaning |
| Notice | Ink on sun tint | Factual context or limitation |
| Error | Brick on brick tint | What failed and how to recover |
| Inline response | Surface appropriate to its band | Success, ambiguity, unavailability, or next step |

Keep headings, copy, and actions in a readable stack with 16px padding. Use explicit text, not color alone. An empty live region should not paint an empty banner. Announce async responses without moving focus unnecessarily. Countdowns are not a generic device for emphasizing ordinary information.

### 7.7 Badges and topic pills

Badges use 13px text, full radius, and compact padding (existing badge baseline: 4px vertical/10px horizontal). Keep labels short but allow translated text to wrap. Provenance badges follow §3; status badges use neutral gray, forest/tint, or brick/tint with an explicit status label. Held work can use sun tint without implying an error.

Noninteractive topic pills use `--color-why-vote-pill` with matching dark ink. Outlined identity/eyebrow pills use sun on dark green with 4px/12px padding. These describe content; they are not filters. A selectable chip is an actual button or checkbox with state semantics and the 44px target, not a clickable decorative span.

### 7.8 Gated actions

Render authentication-gated actions in their enabled style. Activation opens the relevant authentication flow, then resumes the original action in place. Do not confuse “requires login” with disabled or unavailable. Explain eligibility separately from authentication when the product distinguishes them. Personalized states must be applied client-side; public HTML must not vary by session.

### 7.9 Modals

Use a shared white shell, 8px radius, modal shadow, and `rgba(26,26,26,0.5)` scrim. Below 768px, the existing treatment is a full-width top sheet with rounded top corners. Title uses 24px; content and actions follow the form/spacing rules.

Provide an accessible title, explicit Close action, focus trap, Escape dismissal, and return focus to the trigger. Scrim dismissal must not silently lose important work. Keep the underlying context visible and the URL unchanged for modal tasks. Native dialog semantics are preferred. A multi-step form keeps one coherent title/context and preserves input when users move back.

### 7.10 Form fields and form layouts

**Field anatomy:** visible label → control → optional helper → error. Stack these with 4px gaps; separate fields by 16px. Labels and controls share a left edge. Use 14px bold labels, 14px muted helpers, and 14px brick errors. Never use a placeholder as the only label.

**Control geometry:** 16px body font, 44px minimum height, 8px vertical/12px horizontal padding, white fill, 1.5px gray border, 6px radius. Use consistent widths within a group and `width: 100%` when the layout calls for a full-width field. Keep input text at least 16px to avoid mobile zoom.

| Control | Rules |
|---|---|
| Text, email, telephone, search | Match input type and keyboard to the data; use appropriate autocomplete; keep entered values after validation failure |
| Numeric/date input | Use native semantics only when they fit the data; identifiers are text, not quantities |
| Textarea | Same type, fill, border, and focus treatment; allow multiple lines and vertical growth/resizing |
| Select | Visible label, legible selected value, keyboard access, and the same minimum control height; prefer native behavior |
| Checkbox | Multiple independent choices; label is clickable; align the control to the first text line |
| Radio group | One mutually exclusive choice; group with `fieldset`/`legend`; preserve native keyboard navigation |
| OTP | One input supporting paste, numeric keyboard and one-time-code autocomplete; do not split digits into separate boxes |

`FormField.astro` currently implements single-line inputs (`text`, `email`, `tel`, `password`, `number`, `date`, `search`), label, helper, required indicator, and error linkage. The presence of a type in its API does not authorize a new product flow. Selects, textareas, and grouped choices follow these design rules but are not variants currently provided by that component.

| State | Appearance and semantics |
|---|---|
| Empty/default | Visible label; placeholder may show an example format, never essential instructions |
| Hover | Maintain readable boundary; no layout shift |
| Focus | Forest border plus 2px forest outline, 2px offset; ensure contrast on the surrounding surface |
| Filled | Retain label and helpers; do not substitute a success state merely because text exists |
| Invalid | Brick border and explicit error text; `aria-invalid` and `aria-describedby`; preserve the value |
| Required | Native required semantics and understandable required indicator; not color alone |
| Disabled | Muted treatment, native disabled semantics, no misleading action affordance; explanation when needed |
| Read-only | Value remains readable and selectable; identify the restriction; distinguish from disabled |
| Loading/result | Preserve control geometry; announce progress/result and prevent duplicate requests |

Associate label and control with unique ids. Link helpers and errors through `aria-describedby`; ensure a repeated field does not duplicate ids. Validate at an appropriate task boundary rather than interrupting every keystroke. On failed submit, focus the relevant error/field or a linked summary if several fields need attention. Do not reserve large blank error areas by default.

**Form composition:** stack fields for sequential tasks; use columns only for closely related inputs and collapse them on narrow screens. Place actions 24px after the final field. Explain selection limits before the choice group and expose the current count where useful.

**Compact lookup composition:** a single input plus action may sit inline at 48px height with an 8px gap; an optional location icon gets a 48px target and accessible name. On narrow screens, the input spans the first row, with actions beneath; a simple input/action pair can stack full-width. A visually hidden label is allowed only when persistent surrounding text makes the purpose clear, and the associated label remains accessible. Keep essential helper text visible. Results occupy a separate full-width live region beneath the controls.

### 7.11 Result bars and comparisons

Horizontal result bars use forest fill on a gray track, with a visible label and numeric value. Use one hue across all peers, tabular figures, and full labels that wrap. Rank is expressed through order and numbers. Results must remain understandable without perceiving color.

Comparisons repeat the same field order and alignment across records. On narrow screens, use a contained horizontal scroller when stacking would prevent comparison; preserve row/column labels and keyboard access. Do not convert missing data to zero or visually score a person through color.

### 7.12 Empty, loading, and feedback states

- **Empty:** state what is absent and a useful next step where one exists. Distinguish not-yet-available data from a failed request; do not invent a date.
- **Loading:** use neutral skeletons for content and spinners within actions. Preserve layout where possible and announce progress accessibly.
- **Success:** confirm the outcome with text and the existing action context. A color change alone is insufficient.
- **Error:** retain user work and give a concrete recovery action. Keep field errors next to fields and task-level failures near the affected action.
- **Toast:** ink on white with modal shadow; forest or brick accent plus explicit text. Announce nonurgent feedback politely; allow at least five seconds to read it. Persistent or actionable failures need an enduring location as well.

### 7.13 Dense data and work surfaces

Use the same tokens with 14px table text, 8px cell padding, optional gray zebra rows, and sticky column headings. Keep text left-aligned and numbers right-aligned. Status blocks distinguish ready, held, and failed through labels as well as color. Confirmation dialogs are for consequential actions and must state scope and effect; they do not introduce an editorial approval gate.

### 7.14 Environment notice

A compact, full-width notice may appear above the app bar. Use centered 14px bold text, 8px vertical padding, and `role="status"`. It scrolls away and does not alter the app bar's sticky offset. Testing environments use the error palette; informational availability notices use sun tint. Copy and activation are deployment configuration, not design tokens. The current component is not dismissible; do not introduce per-visitor server-rendered state.

### 7.15 Section navigation and disclosures

**Section navigation:** use a paper strip beneath the app bar, sticky at `top: 80px`. Links are 14px bold with 8px/12px padding; active state is forest text plus a 4px underline and `aria-current`. Use real fragment links and update the current section on scroll. On small screens the strip scrolls horizontally without widening the document. Provide enough scroll margin to keep targets below both sticky layers; the existing composition uses 128px. Only show links whose targets exist. This is navigation, not a tab interface that hides content.

**Disclosure/accordion:** use native `details`/`summary`, a clear title, optional number, and trailing chevron. Apply 16px padding, a light border, and 8px between disclosures. Opening reveals body copy and may add the subtle disclosure shadow; rotate the decorative chevron. Multiple items may stay open unless the task calls for an exclusive group. Do not rely on the icon alone to communicate expanded state. Opening the first item initially is optional, not mandatory.

### 7.16 Fact groups and statistics

**Structured facts:** parallel muted labels above ordinary values, using equal columns and start alignment. Compact labels may be 13px; values are regular 16px. Supporting lists belong under their label. A divider may separate related groups without wrapping each fact in another card. Collapse columns to a single stack when labels or values no longer fit.

**Statistics:** use 24px heading-font figures and 13px supporting labels in inset tiles with 16px padding. A two-by-two grid with 12px gaps can remain two-up on mobile if the actual translated content fits. Let height grow with labels; never shrink text to force a fixed tile height. One editorial highlight may use hero-alert, with contrast checked for every foreground. This highlights a fact, not a party or candidate.

## 8. Iconography and imagery

Use consistent line icons on a 20/24px grid, approximately 1.5–2px stroke and `currentColor`. Pair action icons with text or an accessible name. Decorative icons are hidden from assistive technology. Icon-only controls still need full-size targets; an image's visible dimensions are not its hit area.

Identity photos use a consistent crop and neutral placeholder. Partner logos use approved assets with preserved proportions. Maps and charts must not introduce partisan colors or communicate meaning solely through color.

### 8.1 Map/media frames

Use a bordered, 8px-radius frame with a neutral background, overflow contained, and a centered textual fallback. The existing map composition uses 16:10 below 768px and 16:7 above. Retain the frame when content is unavailable so the layout remains understandable.

The app-drawn boundary is forest at 2px, with forest-tint fill at 30%, using CSS tokens. The intended basemap is desaturated and quiet. The current Google basemap remains stock, including colored POIs; the app adds no partisan markers. Cloud styling is managed through the Map ID outside the repository, so the intended neutral basemap must not be described as already implemented. A fallback inspection does not verify a loaded map.

## 9. Motion

Motion explains state: modal/toast transitions around 150–200ms, disclosure chevrons, and subtle light-action hover feedback. Avoid scroll reveals, parallax, or decorative animated figures. Respect `prefers-reduced-motion` by removing transitions and unnecessary movement; retain textual feedback when an animation stops.

## 10. Accessibility floor

- Target WCAG AA contrast for text and interactive boundaries; verify actual foreground/background pairs.
- Provide visible keyboard focus, logical focus order, native semantics, and meaningful accessible names.
- Targets are at least 44×44px; keep distinct actions sufficiently separated, normally 8px. Inline text links need readable spacing without disrupting prose.
- Do not use color, icons, position, hover, or motion as the only way to communicate meaning.
- Use a skip link, landmarks, hierarchical headings, correct document language, and equivalent bilingual navigation.
- Preserve content at narrow widths and text zoom. Allow wrapping and content growth; isolate necessary horizontal scrolling.
- Modal focus is trapped and restored. Async updates are announced with an appropriate live region; avoid interruptive alerts for ambient context.
- Test keyboard interaction and TalkBack on Android, including error recovery and long Kannada text.

## 11. Implementation and usage

Tokens live on `:root` in `src/styles/tokens.css`, with Kannada overrides beside them. Components consume existing tokens; add and document a token before referencing a new custom property. Use shared Astro components and vanilla TypeScript behavior; this document does not introduce another UI framework.

Choose an existing component before writing a visually similar one. Choose a section pattern independently of its content. Preserve public cache safety: personalize through the existing client-side mechanism, not session-dependent public HTML. Keep demo data unmistakably fictional.

### 11.1 UI completion checklist

1. Inspect the live rendered UI using the `agent-browser` skill/CLI; load `agent-browser skills get core` before the first browser command.
2. Check 390px and desktop widths, English and Kannada, plus sparse, dense, and long-text content.
3. Review section proportions, shared left edges, vertical alignment, control sizes, wrapping, and horizontal overflow.
4. Exercise keyboard focus, hover, pressed/loading/disabled states, validation, and recovery where applicable.
5. Confirm parent-owned gaps, component-owned padding, valid token references, and appropriate surface contrast.
6. Check semantic structure, accessible names, error associations, console output, and representative screenshots at readable scale.
7. Compare repeated elements for consistent anatomy, hierarchy, and spacing. Do not fix one record using special margins or fixed text heights.
8. Run checks appropriate to the change, including relevant tests, typecheck, and translation staleness for UI work. Documentation-only revisions need source/diff consistency checks, not unrelated database tests.

### 11.2 Example usage

Examples illustrate the patterns; they do not limit where a pattern may be used.

| Example | Patterns/components used |
|---|---|
| Home page: introduction and ward finder | Dark hero with supporting statistics; compact lookup; outlined eyebrow; inline response |
| Home page: why vote | Gold split explanatory section; prose and topic pills |
| Home page: election basics | White split explanatory section with numbered disclosures |
| Home page: booth finder | Sage content/action band with compact lookup |
| Ward page: identity and local facts | Dark identity band; structured facts; outlined identity pill |
| Ward page: navigation and boundary | Sticky section navigation; responsive map frame and fallback |
| Ward page: candidate collection | Paper collection band; compact identity rows; status text and secondary action |
| Ward page: issue voting | White action band; gated primary action; result bars |
| Ward page: questions | Sage collection band containing bordered cards |

## 12. Implementation gaps

These are existing differences between the design standard and the implementation. This documentation revision does not change UI code or claim that the following gaps are resolved.

- Language segments are 32px high; compact navigation and utility links need review against the target-size rules.
- Muted labels on editorial red and focus indicators on dark green need contrast verification.
- Some compositions use fixed 1.2 heading line heights, tracked eyebrows, uppercase Latin text, or local font stacks that bypass the Kannada/sentence-case rules.
- Existing CSS references undeclared `--leading-md` and `--space-10`; local spacing values, an 11px disclosure radius, and a literal translucent divider also remain outside the shared token system.
- One fact-grid implementation collapses at 760px rather than the shared 768px breakpoint. Use the shared breakpoint for new work unless content warrants a documented exception.
- Some section-navigation links remain visible when their conditional target is absent.
- The single-line field component generates ids from `name`; repeated instances need an explicit uniqueness strategy. It does not expose every control/state described in §7.10.
- Button loading markup hides the spinner's nested status text from assistive technology; busy announcements and disabled-link behavior need verification before claiming complete state support.
- The stock basemap exception remains as described in §8.1. Font-family changes beyond the current stacks remain a separate design decision.
