# Curator Functionality (M7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Curators fix flagged candidate values against the affidavit with structured inputs, move candidates between wards, match waiting affidavits, find and edit any candidate, and read a guide.

**Architecture:** The transcriber screen's field inputs and form parsing are extracted into shared modules and reused by three curator screens (flag item, candidate editor, matching item), all laid out as "affidavit left, form right". Every value a curator saves goes through the existing single writer, `publishAffidavitFields`; ward moves go through one new helper shared with the admin path. No migration.

**Tech Stack:** Astro 5 SSR (Node adapter), TypeScript, Drizzle ORM on Postgres, Vitest with Astro's container API for route tests, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-10-13-curator-functionality-design.md`. Read it before starting any task.

## Global Constraints

- **No migration.** Do not add a file under `drizzle/` or change a table definition in `src/db/schema.ts`.
- **`tests/routes/transcribe.test.ts`, `tests/unit/transcribe.test.ts` and `tests/routes/admin-affidavits.test.ts` must pass without being edited.** They guard the refactors in Tasks 1, 2, 3 and 8. If one fails, the refactor is wrong, not the test.
- **Every i18n key goes in both `src/i18n/en.json` and `src/i18n/kn.json`** (flat key → string maps). A key missing from `kn.json` throws in the test environment. This plan gives the English; write the Kannada by hand, using `src/i18n/glossary.json` for recurring terms and the neighbouring `curator.*` / `transcribe.*` keys for register. `{name}`-style placeholders are kept verbatim in both.
- **Curator routes have no `/kn/` twin.** Language comes from `loadCuratorLang(session.userId)`. Every curator response sets `cache-control: no-store`.
- **Curator pages are plain server-rendered form POSTs** with a hidden `formAction` field and the CSRF field (`CSRF_FIELD_NAME` from `src/lib/csrf.ts`, value `Astro.locals.csrfToken`). A success redirects (302); a refusal re-renders with status 400.
- **Every curator publish carries a required `confirmPublish` checkbox, re-checked server-side.**
- **Match the surrounding code:** docstring density, naming, and the "route twin owns HTTP, `src/lib` owns logic, `src/features/pages` owns markup" split.
- **Commit messages** are one plain sentence in the style of `git log` (e.g. "Hand out only affidavits the AI has read"), ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on the branch `curator-functionality`. Never push.

### Running tests

Tests need the test database described in `AGENTS.md` under "Tests need a database". In this plan `TEST <args>` means:

```sh
docker compose -f deploy/compose.local.yml run --rm --no-deps --build \
  -e DATABASE_URL=postgres://gba:gba_local_dev@postgres:5432/bv_test \
  -e SITE_ORIGIN=https://bengaluruvotes.opencity.in -e MASTER_PASSWORD= \
  app npx vitest run <args>
```

Type checking is `docker compose -f deploy/compose.local.yml run --rm --no-deps app npm run typecheck` (written `TYPECHECK` below). Run it at the end of every task.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **Rupee amounts typed with digit grouping** (`1,02,10,000`) on a curator fix: accepted, and recognised as unchanged when the number is the same as the published one. Tasks 1 and 5.
2. **A fix POSTed directly for a candidate with no stored affidavit:** refused with nothing written, even though the page shows no form. Task 5.
3. **A flagged field whose published row has only legacy free text** (`value_data` null): the form opens empty and a save writes structured data. Task 5.
4. **Search text containing `%` or `_`:** matched literally, not as a wildcard. Task 7.
5. **A ward id that does not exist, or is not a number,** in a ward fix or the editor's ward form: refused with nothing moved. Task 5.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/affidavit-form.ts` (new) | One field's form strings ↔ `FieldData`; validation errors | 1 |
| `src/components/AffidavitFieldInputs.astro` (new) | Status radios + inputs for one field | 2 |
| `src/components/AffidavitScan.astro` (new) | The PDF pane | 2 |
| `src/islands/AffidavitFields.ts` (new) | Client: disable inputs by status, live assets total | 2 |
| `src/lib/affidavit-publish.ts` | `curator` actor role; `moveCandidateWard` | 3 |
| `src/lib/affidavit-queue.ts` | `confirmMatch` takes a role; match list/item loaders | 3, 8 |
| `src/lib/candidate-profile.ts`, `src/pages/api/flags.ts`, `src/lib/flags.ts` | Flag intake limited to eight candidate fields; new resolution type | 4, 5 |
| `src/lib/curator-fix.ts` (new) | Parse and save a curator's field or ward correction | 5 |
| `src/components/CuratorSplit.astro`, `CuratorFieldForm.astro`, `CuratorWardForm.astro` (new) | Two-pane shell and the two fix forms | 5 |
| `src/lib/curator.ts`, `src/features/pages/curator/*`, `src/pages/curator/*` | Queue item, editor, search, ward list, dashboard | 5, 6, 7 |
| `src/lib/curator-matching.ts`, `src/pages/curator/matching/*`, `src/features/pages/curator/Match*.astro` (new) | Matching screens | 8 |
| `src/pages/curator/guide.astro`, `src/features/pages/curator/Guide.astro` (new) | Guide | 9 |
| `tests/routes/support/staff-harness.ts` (new) | Shared route-test harness for the new suites | 5 |
| Docs, `scripts/seed-dev.ts`, `scripts/seed-e2e.ts`, `tests/e2e/flag.spec.ts` | Bring docs and seeds in line; browser check | 10 |

---

### Task 1: Shared form parsing (`affidavit-form.ts`)

**Files:**
- Create: `src/lib/affidavit-form.ts`
- Modify: `src/lib/transcribe.ts` (remove the moved code; import it back)
- Test: `tests/unit/affidavit-form.test.ts`

**Interfaces:**
- Consumes: `AFFIDAVIT_FIELD_KEYS`, `checkFieldData`, `AffidavitFieldKey`, `FieldData`, `FieldStatus` from `src/lib/affidavit-publish.ts`; `EDUCATION_LEVELS`, `GENDERS`, `EducationLevel`, `Gender` from `src/lib/affidavit-extraction.ts`.
- Produces, all exported from `src/lib/affidavit-form.ts`:
  - `FIELD_INPUTS: Record<AffidavitFieldKey, readonly string[]>`
  - `STATUSES: readonly FieldStatus[]` (`['value', 'not_declared', 'unreadable']`)
  - `type FieldError = 'required' | 'whole_number' | 'age_range' | 'choose'`
  - `interface RawField { status: FieldStatus; inputs: Record<string, string> }`
  - `inputsOf(data: FieldData): Record<string, string>`
  - `fieldFromInputs(key: AffidavitFieldKey, status: FieldStatus, inputs: Record<string, string>): FieldData`
  - `errorFor(data: FieldData, inputs: Record<string, string>): FieldError | null`
  - `readFieldForm(form: FormData, key: AffidavitFieldKey): RawField`
  - `storedFieldData(key: AffidavitFieldKey, valueData: unknown): FieldData | null`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/affidavit-form.test.ts`:

```ts
/** One field's form strings to a structured value and back (src/lib/affidavit-form.ts). No database. */
import { describe, it, expect } from 'vitest';
import { errorFor, fieldFromInputs, inputsOf, readFieldForm, storedFieldData, FIELD_INPUTS } from '../../src/lib/affidavit-form';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('readFieldForm', () => {
  it('reads only the named field, defaulting the status to value', () => {
    const raw = readFieldForm(form({ movableInr: '10', immovableInr: '20', age: '44' }), 'assets');
    expect(raw).toEqual({ status: 'value', inputs: { movableInr: '10', immovableInr: '20' } });
  });

  it('reads the posted status and treats an unknown one as value', () => {
    expect(readFieldForm(form({ 'status.age': 'not_declared' }), 'age').status).toBe('not_declared');
    expect(readFieldForm(form({ 'status.age': 'nonsense' }), 'age').status).toBe('value');
  });

  it('gives an empty string for an input that was not posted (a disabled input is not submitted)', () => {
    expect(readFieldForm(form({ 'status.cases': 'unreadable' }), 'cases').inputs).toEqual({ pending: '', convictions: '' });
  });
});

describe('fieldFromInputs and errorFor', () => {
  it('accepts Indian digit grouping and spaces in rupee amounts', () => {
    const data = fieldFromInputs('assets', 'value', { movableInr: '1,02,10,000', immovableInr: '3 50 00 000' });
    expect(data).toEqual({ key: 'assets', status: 'value', movableInr: 10210000, immovableInr: 35000000 });
    expect(errorFor(data, { movableInr: '1,02,10,000', immovableInr: '3 50 00 000' })).toBeNull();
  });

  it.each([
    ['full_name', { name: '  ' }, 'required'],
    ['party', { party: '' }, 'required'],
    ['gender', { gender: 'robot' }, 'choose'],
    ['education', { educationLevel: '', educationStated: 'B.Com' }, 'choose'],
    ['age', { age: '' }, 'required'],
    ['age', { age: 'forty' }, 'whole_number'],
    ['age', { age: '7' }, 'age_range'],
    ['assets', { movableInr: '12.5', immovableInr: '0' }, 'whole_number'],
    ['cases', { pending: '', convictions: '' }, 'required'],
  ] as const)('refuses %s %j as %s', (key, inputs, error) => {
    expect(errorFor(fieldFromInputs(key, 'value', inputs), inputs)).toBe(error);
  });

  it('ignores the inputs when the status is not value', () => {
    const data = fieldFromInputs('age', 'not_declared', { age: 'forty' });
    expect(data).toEqual({ key: 'age', status: 'not_declared', years: null });
    expect(errorFor(data, { age: 'forty' })).toBeNull();
  });
});

describe('inputsOf', () => {
  it('round-trips every field through the form', () => {
    const samples = [
      { key: 'full_name', status: 'value', text: 'A. Person' },
      { key: 'party', status: 'value', text: 'Independent' },
      { key: 'gender', status: 'value', gender: 'female' },
      { key: 'age', status: 'value', years: 52 },
      { key: 'education', status: 'value', level: 'Graduate', stated: 'B.Com' },
      { key: 'assets', status: 'value', movableInr: 1, immovableInr: 2 },
      { key: 'cases', status: 'value', pending: 2, convictions: 0 },
    ] as const;
    for (const sample of samples) {
      const inputs = inputsOf(sample);
      expect(Object.keys(inputs).sort()).toEqual([...FIELD_INPUTS[sample.key]].sort());
      expect(fieldFromInputs(sample.key, 'value', inputs)).toEqual(sample);
    }
  });
});

describe('storedFieldData', () => {
  it('returns the stored value only when it is for this field', () => {
    const age = { key: 'age', status: 'value', years: 52 };
    expect(storedFieldData('age', age)).toEqual(age);
    expect(storedFieldData('cases', age)).toBeNull();
    expect(storedFieldData('age', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `TEST tests/unit/affidavit-form.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/affidavit-form`.

- [ ] **Step 3: Create `src/lib/affidavit-form.ts`**

Move these out of `src/lib/transcribe.ts` unchanged: `FIELD_INPUTS`, the `STATUSES` constant, `inputsOf`, `FieldError`, `wholeNumber`, `fieldFromInputs`, `errorFor`. Export all except `wholeNumber`. Add a module docstring and the two new functions:

```ts
/**
 * One affidavit field as a form: the strings its inputs carry, the
 * structured value they stand for, and why a value is refused. Shared by
 * the transcriber's reading screen and the curator's fix forms, so a field
 * has one set of inputs and one set of rules wherever a person types it.
 */
import { checkFieldData, type AffidavitFieldKey, type FieldData, type FieldStatus } from './affidavit-publish';
import { EDUCATION_LEVELS, GENDERS, type EducationLevel, type Gender } from './affidavit-extraction';

// ... FIELD_INPUTS, STATUSES, FieldError, inputsOf, wholeNumber, fieldFromInputs, errorFor moved here ...

/** What was posted for one field, as posted, so a refused save can show it back unchanged. */
export interface RawField {
  status: FieldStatus;
  inputs: Record<string, string>;
}

/** Reads one field's status (`status.{key}`) and inputs from a posted form. */
export function readFieldForm(form: FormData, key: AffidavitFieldKey): RawField {
  const raw = String(form.get(`status.${key}`) ?? 'value');
  const inputs: Record<string, string> = {};
  for (const name of FIELD_INPUTS[key]) inputs[name] = String(form.get(name) ?? '');
  return { status: STATUSES.includes(raw as FieldStatus) ? (raw as FieldStatus) : 'value', inputs };
}

/** The structured value stored for `key`, or null when the row has none (never written, or replaced by free text). */
export function storedFieldData(key: AffidavitFieldKey, valueData: unknown): FieldData | null {
  const data = valueData as FieldData | null | undefined;
  return data && data.key === key ? data : null;
}
```

- [ ] **Step 4: Rebuild `transcribe.ts` on it**

In `src/lib/transcribe.ts`: delete the moved definitions, add

```ts
import { errorFor, fieldFromInputs, inputsOf, readFieldForm, type FieldError } from './affidavit-form';
export { FIELD_INPUTS, inputsOf, type FieldError } from './affidavit-form';
```

(the re-export keeps `Reading.astro` and `tests/unit/transcribe.test.ts` importing from `transcribe` as they do now), and replace `readForm` with:

```ts
export function readForm(form: FormData): RawForm {
  const status = {} as Record<AffidavitFieldKey, FieldStatus>;
  const checked: AffidavitFieldKey[] = [];
  const inputs: Record<string, string> = {};
  for (const key of AFFIDAVIT_FIELD_KEYS) {
    const field = readFieldForm(form, key);
    status[key] = field.status;
    Object.assign(inputs, field.inputs);
    if (form.get(`checked.${key}`) != null) checked.push(key);
  }
  return { status, checked, inputs };
}
```

Remove imports `transcribe.ts` no longer uses.

- [ ] **Step 5: Run the tests**

Run: `TEST tests/unit/affidavit-form.test.ts tests/unit/transcribe.test.ts tests/routes/transcribe.test.ts`, then `TYPECHECK`.
Expected: all pass, with the two transcribe files unedited.

- [ ] **Step 6: Commit**

```bash
git add src/lib/affidavit-form.ts src/lib/transcribe.ts tests/unit/affidavit-form.test.ts
git commit -m "Move one field's form parsing out of the transcriber module so curators can share it"
```

---

### Task 2: Shared field inputs, PDF pane and client behaviour

**Files:**
- Create: `src/components/AffidavitFieldInputs.astro`, `src/components/AffidavitScan.astro`, `src/islands/AffidavitFields.ts`
- Modify: `src/features/pages/transcribe/Reading.astro`, `src/islands/TranscribeForm.ts`
- Test: `tests/unit/affidavit-fields-island.test.ts`; guard: `tests/routes/transcribe.test.ts`

**Interfaces:**
- Consumes: `STATUSES`, `FieldError` from Task 1.
- Produces:
  - `<AffidavitFieldInputs lang fieldKey status inputs error? />` where `fieldKey: AffidavitFieldKey`, `status: FieldStatus`, `inputs: Record<string, string>`, `error?: FieldError`. Renders the status radios (`name="status.{fieldKey}"`), a `<div class="inputs" data-inputs>` with that field's inputs (names from `FIELD_INPUTS`), a default `<slot />`, then the error sentence. It must be placed inside a `<fieldset data-field={fieldKey}>`.
  - `<AffidavitScan lang pdfUrl collapse? />`: the "open PDF" link and the iframe. `collapse` (boolean, default false) hides the iframe below 900px, leaving the link.
  - `src/islands/AffidavitFields.ts`: `syncStatus(field: HTMLFieldSetElement): void`, `syncTotal(root: ParentNode): void`, `initAffidavitFields(): void`.

- [ ] **Step 1: Write the failing island test**

Look at `tests/unit/ward-section-nav.test.ts` for how this repo sets up a DOM for island tests, and use the same environment directive. Create `tests/unit/affidavit-fields-island.test.ts`:

```ts
// @vitest-environment happy-dom  (use whichever DOM environment ward-section-nav.test.ts declares)
import { describe, it, expect, beforeEach } from 'vitest';
import { initAffidavitFields } from '../../src/islands/AffidavitFields';

const FIELD = `
  <form><fieldset data-field="assets">
    <label><input type="radio" name="status.assets" value="value" checked /></label>
    <label><input type="radio" name="status.assets" value="not_declared" /></label>
    <div data-inputs>
      <input name="movableInr" value="1,00,000" data-assets-part />
      <input name="immovableInr" value="2,00,000" data-assets-part />
    </div>
    <strong data-assets-total>—</strong>
  </fieldset></form>`;

describe('initAffidavitFields', () => {
  beforeEach(() => {
    document.body.innerHTML = FIELD + FIELD;
    initAffidavitFields();
  });

  it('totals each fieldset on its own', () => {
    const [first, second] = Array.from(document.querySelectorAll<HTMLElement>('[data-assets-total]'));
    expect(first.textContent).toBe('₹3,00,000');
    const input = document.querySelectorAll<HTMLInputElement>('[name="movableInr"]')[1];
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(second.textContent).toBe('—');
    expect(first.textContent).toBe('₹3,00,000');
  });

  it('disables the inputs when the status is not value, and enables them again', () => {
    const field = document.querySelector<HTMLFieldSetElement>('fieldset')!;
    const [value, notDeclared] = Array.from(field.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    notDeclared.checked = true;
    notDeclared.dispatchEvent(new Event('change', { bubbles: true }));
    expect(field.querySelector<HTMLInputElement>('[name="movableInr"]')!.disabled).toBe(true);
    value.checked = true;
    value.dispatchEvent(new Event('change', { bubbles: true }));
    expect(field.querySelector<HTMLInputElement>('[name="movableInr"]')!.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `TEST tests/unit/affidavit-fields-island.test.ts`
Expected: FAIL, cannot resolve `../../src/islands/AffidavitFields`.

- [ ] **Step 3: Create `src/islands/AffidavitFields.ts`**

Move `formatInr`, `parseWhole`, `syncStatus` and `syncTotal` here from `src/islands/TranscribeForm.ts`. `syncTotal` takes a `ParentNode` instead of a form. Add:

```ts
/**
 * Client behaviour for affidavit field groups (`fieldset[data-field]`)
 * wherever they are rendered: inputs are disabled unless the status is
 * "value", and an assets group shows its running total. Each fieldset is
 * handled on its own, so a page may hold several, in one form or many.
 */
export function initAffidavitFields(): void {
  document.querySelectorAll<HTMLFieldSetElement>('fieldset[data-field]').forEach((field) => {
    syncStatus(field);
    syncTotal(field);
    field.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'radio') syncStatus(field);
    });
    field.addEventListener('input', () => syncTotal(field));
  });
}
```

In `TranscribeForm.ts`, import `syncStatus` and `syncTotal` from `./AffidavitFields` and delete its own copies. `initTranscribeForm` keeps its own listeners (the tick behaviour and the countdown are the transcriber's alone) and keeps calling `syncTotal(form)`.

- [ ] **Step 4: Create `src/components/AffidavitScan.astro`**

```astro
---
/**
 * The affidavit beside the form that is being filled from it: a link that
 * opens the PDF on its own, and the PDF itself. With `collapse`, a narrow
 * screen gets only the link (a phone cannot show a scan and a form at once).
 */
import { t, type Lang } from '../i18n';

interface Props {
  lang: Lang;
  pdfUrl: string;
  collapse?: boolean;
}

const { lang, pdfUrl, collapse = false } = Astro.props;
---

<section class:list={['scan', { 'scan--collapse': collapse }]} aria-label={t(lang, 'transcribe.reading.pdfTitle')}>
  <p class="scan-bar">
    <a href={pdfUrl} target="_blank" rel="noopener noreferrer">{t(lang, 'transcribe.reading.openPdf')}</a>
  </p>
  <iframe class="scan-frame" src={`${pdfUrl}#navpanes=0&view=FitH`} title={t(lang, 'transcribe.reading.pdfTitle')}></iframe>
</section>

<style>
  /* .scan, .scan-bar and .scan-frame rules moved verbatim from Reading.astro */

  @media (max-width: 899px) {
    .scan--collapse {
      border-right: 0;
      border-bottom: 1px solid var(--color-border);
    }
    .scan--collapse .scan-frame {
      display: none;
    }
  }
</style>
```

Move the three `.scan*` rules out of `Reading.astro`'s `<style>` into this one, verbatim.

- [ ] **Step 5: Create `src/components/AffidavitFieldInputs.astro`**

Frontmatter:

```astro
---
/**
 * One affidavit field's inputs: the three-way status, then the inputs that
 * field takes. Rendered inside a `fieldset[data-field]`, which
 * src/islands/AffidavitFields.ts looks for. The default slot sits between
 * the inputs and the error (the transcriber screen puts the AI's note there).
 */
import { t, type Lang } from '../i18n';
import { EDUCATION_LEVELS, GENDERS } from '../lib/affidavit-extraction';
import { formatInr, type AffidavitFieldKey, type FieldStatus } from '../lib/affidavit-publish';
import { STATUSES, type FieldError } from '../lib/affidavit-form';

interface Props {
  lang: Lang;
  fieldKey: AffidavitFieldKey;
  status: FieldStatus;
  inputs: Record<string, string>;
  error?: FieldError;
}

const { lang, fieldKey, status, inputs, error } = Astro.props;
const value = (name: string) => inputs[name] ?? '';

/** The total shown before the island takes over; blank unless both parts are plain whole numbers. */
function assetsTotal(movable: string, immovable: string): string {
  const parse = (text: string) => (/^[\d,\s]+$/.test(text) ? Number(text.replace(/[,\s]/g, '')) : NaN);
  const sum = parse(movable) + parse(immovable);
  return Number.isFinite(sum) ? formatInr(sum) : '—';
}
---
```

Body: move, verbatim, from `Reading.astro` the `<div class="status" role="radiogroup">…</div>` block and the whole `<div class="inputs" data-inputs>…</div>` block (the seven `field.key === …` branches, including the assets total and the two help lines). In the moved markup replace `field.key` with `fieldKey`, `field.status` with `status`, and `field.value(` with `value(`. After the inputs block add:

```astro
<slot />
{error && <p class="field-error">{t(lang, `transcribe.error.${error}`)}</p>}
```

Style: copy into this component's `<style>` the rules `.status`, `.status-option` (and its two `:has` rules), `.inputs`, `.input-row`, `.input`, `.input--short`, `.input > span`, the three `.input input/select/textarea` rule groups, `.total`, `.total strong`, `.help`, `.field-error` from `Reading.astro`. Astro styles are scoped per component, so `Reading.astro` must **keep** its own copies of `.input` (and the `.input …` rule groups), `.input > span` and `.help`, which its release and report forms still use; delete from `Reading.astro` only the rules nothing there uses any more (`.status*`, `.inputs`, `.input-row`, `.input--short`, `.total*`, `.field-error`).

- [ ] **Step 6: Use them in `Reading.astro`**

Replace the scan section with `<AffidavitScan lang={lang} pdfUrl={view.pdfUrl} />`. Inside each fieldset, keep the legend and the tick label, and replace the status block, the inputs block, the AI note and the error with:

```astro
<AffidavitFieldInputs lang={lang} fieldKey={field.key} status={field.status} inputs={field.inputs} error={field.error}>
  {field.note && (
    <p class="ai-note">
      <strong>{t(lang, 'transcribe.reading.aiNote')}</strong> {field.note}
    </p>
  )}
</AffidavitFieldInputs>
```

In the frontmatter the per-field `value` closure becomes a plain record: build `inputs` as `Object.fromEntries(FIELD_INPUTS[field.key].map((name) => [name, raw?.inputs[name] ?? field.inputs[name] ?? '']))` (import `FIELD_INPUTS` from `../../../lib/affidavit-form`). Remove `assetsTotal`, `STATUSES` and the imports `Reading.astro` no longer uses. `.ai-note` stays styled in `Reading.astro` (slotted content is styled by the parent).

- [ ] **Step 7: Run the tests**

Run: `TEST tests/unit/affidavit-fields-island.test.ts tests/routes/transcribe.test.ts tests/unit/components.test.ts`, then `TYPECHECK`.
Expected: all pass, `transcribe.test.ts` unedited.

- [ ] **Step 8: Check the transcriber screen in a browser**

Start the local stack (`docker compose -f deploy/compose.local.yml up -d --build`), sign in as a transcriber or admin (the local stack uses the master password; see `docs/superpowers/specs/2026-10-13-master-password-admin-design.md`), open `/transcribe`, press Start, and confirm the reading screen looks and behaves as before: scan on the left, status pills, inputs disabling on "Not declared", assets total updating, tick setting itself on edit. If there is nothing to draw, say so in your report instead of skipping silently.

- [ ] **Step 9: Commit**

```bash
git add src/components/AffidavitFieldInputs.astro src/components/AffidavitScan.astro src/islands/AffidavitFields.ts src/islands/TranscribeForm.ts src/features/pages/transcribe/Reading.astro tests/unit/affidavit-fields-island.test.ts
git commit -m "Share the affidavit field inputs and the PDF pane as components"
```

---

### Task 3: Curator as a publishing actor; one ward-move helper

**Files:**
- Modify: `src/lib/affidavit-publish.ts`, `src/lib/affidavit-queue.ts`, `src/pages/admin/affidavits.astro`
- Test: `tests/unit/affidavit-publish.test.ts`, `tests/unit/affidavit-queue.test.ts`; guard: `tests/routes/admin-affidavits.test.ts`

**Interfaces:**
- Produces:
  - `type PublishActor = { userId: number | null; role: 'system' | 'admin' | 'curator' | 'transcriber' }`
  - `moveCandidateWard(tx: Tx, candidateId: number, wardId: number, sourceUrl: string): Promise<void>` in `src/lib/affidavit-publish.ts`
  - `confirmMatch(actor: { userId: number; role: 'curator' | 'admin' }, id: number, input: ConfirmMatchInput): Promise<{ candidateId: number }>`
  - `publishExtractionTx`'s `new` target: `confirmedBy: { userId: number; role: 'curator' | 'admin' } | null` (was `number | null`)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/affidavit-publish.test.ts`, using that file's existing fixtures (its ward, a candidate helper, `appDb`/`db`), add:

```ts
describe('moveCandidateWard', () => {
  it('moves the candidate, marks the ward row person-checked, and re-homes only its pending flags', async () => {
    // `candidateId` is in WARD_A with a `ward` field row that is ai_extracted; `otherId` is another candidate in WARD_A.
    const [pending] = await db.insert(schema.flagItems).values({ wardId: WARD_A.id, targetType: 'candidate_field', targetRef: `candidate:${candidateId}:age`, status: 'pending' }).returning();
    const [resolved] = await db.insert(schema.flagItems).values({ wardId: WARD_A.id, targetType: 'candidate_field', targetRef: `candidate:${candidateId}:cases`, status: 'rejected' }).returning();
    const [others] = await db.insert(schema.flagItems).values({ wardId: WARD_A.id, targetType: 'candidate_field', targetRef: `candidate:${otherId}:age`, status: 'pending' }).returning();

    await appDb.transaction((tx) => moveCandidateWard(tx, candidateId, WARD_B.id, '/media/1/abc'));

    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId));
    expect(candidate.wardId).toBe(WARD_B.id);
    const [wardRow] = await db.select().from(schema.candidateFields).where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'ward')));
    expect(wardRow.aiExtracted).toBe(false);
    expect(wardRow.sourceUrl).toBe('/media/1/abc');
    const wardOf = async (id: number) => (await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, id)))[0].wardId;
    expect(await wardOf(pending.id)).toBe(WARD_B.id);
    expect(await wardOf(resolved.id)).toBe(WARD_A.id);
    expect(await wardOf(others.id)).toBe(WARD_A.id);
  });
});

it('records a curator as the person who checked a value', async () => {
  await appDb.transaction((tx) =>
    publishAffidavitFields(tx, { userId: curatorId, role: 'curator' }, candidateId, [{ key: 'age', status: 'value', years: 41 }], { sourceUrl: '/media/1/abc', checked: true }),
  );
  const [row] = await db.select().from(schema.candidateFields).where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'age')));
  expect(row.checkedBy).toBe(curatorId);
  expect(row.aiExtracted).toBe(false);
});
```

Create the second ward, the second candidate, the user and the flag-row cleanup in that file's `beforeAll`/`afterAll` in the same style as its existing fixtures (delete `flag_items` by `wardId` before deleting the wards).

In `tests/unit/affidavit-queue.test.ts` add, using its `queued()` helper and `completeExtraction`/`processOne` as the neighbouring tests do to get an affidavit into `needs_matching` with reason `reported_by_transcriber` on an existing candidate (the existing tests around `reportWrongDocument` or `match_reason` show how; if none builds that state, set the row's `state`, `matchReason` and `candidateId` directly):

```ts
it('lets a curator confirm a sent-back affidavit: the candidate moves and the curator is the checker', async () => {
  // `id` is a needs_matching affidavit attached to `candidateId` in WARD_SOUTH.
  await confirmMatch({ userId: curatorId, role: 'curator' }, id, { wardId: WARD_WEST.id, name: 'Moved Person', party: 'Independent' });
  const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId));
  expect(candidate.wardId).toBe(WARD_WEST.id);
  expect(candidate.nameEn).toBe('Moved Person');
  const [nameRow] = await db.select().from(schema.candidateFields).where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'full_name')));
  expect(nameRow.checkedBy).toBe(curatorId);
  expect((await affidavit(id)).state).toBe('published');
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `TEST tests/unit/affidavit-publish.test.ts tests/unit/affidavit-queue.test.ts`
Expected: FAIL (`moveCandidateWard` is not exported; `role: 'curator'` is a type error; `confirmMatch` rejects the role argument at typecheck).

- [ ] **Step 3: Implement**

`src/lib/affidavit-publish.ts`: widen `PublishActor` as above. Add (importing `flagItems` from the schema and `like` from `drizzle-orm`):

```ts
/**
 * Moves a candidate to another ward because a person said so: the ward row
 * on the public page loses its AI label, and the candidate's pending flags
 * follow it so the queue lists them under the ward the candidate is now in.
 * The slug keeps the old ward number: the candidate's URL does not change.
 */
export async function moveCandidateWard(tx: Tx, candidateId: number, wardId: number, sourceUrl: string): Promise<void> {
  await tx.update(candidates).set({ wardId, updatedAt: new Date() }).where(eq(candidates.id, candidateId));
  await publishWardLabel(tx, candidateId, { sourceUrl, aiExtracted: false });
  await tx
    .update(flagItems)
    .set({ wardId })
    .where(and(eq(flagItems.status, 'pending'), eq(flagItems.targetType, 'candidate_field'), like(flagItems.targetRef, `candidate:${candidateId}:%`)));
}
```

`src/lib/affidavit-queue.ts`:
- `publishExtractionTx`: the `new` target's `confirmedBy` becomes `{ userId: number; role: 'curator' | 'admin' } | null`; the actor built from it is `{ userId: target.confirmedBy.userId, role: target.confirmedBy.role }` (rename the local from `admin` to `confirmer`, and say "A person confirmed" in the comment).
- `confirmMatch`: signature as above. In the sent-back branch replace the inline `tx.update(candidates).set({ wardId … })` and the `publishWardLabel` call with one `await moveCandidateWard(tx, row.candidateId, ward.id, sourceUrl)` placed where the update was, and pass `{ userId: actor.userId, role: actor.role }` to `publishAffidavitFields`. In the `new` branch pass `confirmedBy: { userId: actor.userId, role: actor.role }`.
- Update the docstrings that say "an admin" to "an admin or a curator".

`src/pages/admin/affidavits.astro`: `const actor = { userId: session.userId, role: 'admin' as const };`

- [ ] **Step 4: Run the tests**

Run: `TEST tests/unit/affidavit-publish.test.ts tests/unit/affidavit-queue.test.ts tests/routes/admin-affidavits.test.ts`, then `TYPECHECK`.
Expected: all pass, `admin-affidavits.test.ts` unedited.

- [ ] **Step 5: Commit**

```bash
git add src/lib/affidavit-publish.ts src/lib/affidavit-queue.ts src/pages/admin/affidavits.astro tests/unit/affidavit-publish.test.ts tests/unit/affidavit-queue.test.ts
git commit -m "Let a curator publish checked values and move a candidate between wards through one helper"
```

---

### Task 4: Flag intake limited to eight candidate fields

**Files:**
- Modify: `src/lib/candidate-profile.ts`, `src/features/pages/Candidate.astro`, `src/pages/api/flags.ts`, `src/lib/flags.ts`
- Test: `tests/routes/flags.test.ts`, `tests/unit/flags.test.ts`, `tests/routes/candidate.test.ts`

**Interfaces:**
- Produces: `FLAGGABLE_FIELD_KEYS` (readonly tuple: `full_name, ward, party, gender, age, education, assets, cases`) and `type FlaggableFieldKey` from `src/lib/candidate-profile.ts`. `deriveTargetWardId(targetType, targetRef)` throws `InvalidFlagTargetError` for anything but a `candidate_field` ref naming an existing candidate and a flaggable key.

- [ ] **Step 1: Write the failing tests**

In `tests/routes/flags.test.ts`, with that file's existing authenticated-POST helper and candidate fixture, add:

```ts
it.each([
  ['ward_field', (c: number, w: number) => `ward:${w}:name`],
  ['ward_issue', () => 'ward_issue:1'],
  ['candidate_field', (c: number) => `candidate:${c}:ec_affidavit`],
  ['candidate_field', (c: number) => `candidate:${c}:track_record`],
] as const)('refuses a %s flag on %s', async (targetType, ref) => {
  const res = await postFlag({ wardId: WARD.id, targetType, targetRef: ref(candidateId, WARD.id), detail: 'wrong' });
  expect(res.status).toBe(400);
  const rows = await db.select().from(schema.flagItems).where(eq(schema.flagItems.targetRef, ref(candidateId, WARD.id)));
  expect(rows).toHaveLength(0);
});

it('still accepts a flag on the candidate\'s ward', async () => {
  const res = await postFlag({ wardId: WARD.id, targetType: 'candidate_field', targetRef: `candidate:${candidateId}:ward`, detail: 'This candidate is in ward 12' });
  expect(res.status).toBe(200);
});
```

(`postFlag`, `WARD`, `candidateId` stand for whatever that file already calls them.) Delete the existing tests in `tests/routes/flags.test.ts` and `tests/unit/flags.test.ts` that assert a `ward_field` or `ward_issue` flag is **accepted** or that `deriveTargetWardId` resolves one; keep and adapt any that assert a malformed ref is refused. If an existing accepted-flag test uses a field key outside the eight, change it to `age`.

In `tests/routes/candidate.test.ts` add an assertion on the rendered candidate page:

```ts
expect(html).not.toContain(`candidate:${candidateId}:ec_affidavit`);
expect(html).toContain(`candidate:${candidateId}:ward`);
```

(The targets are JSON in a `data-flag-targets` attribute, so the colons may be HTML-escaped as they are today; match the form the existing assertions in that file use.)

- [ ] **Step 2: Run and confirm they fail**

Run: `TEST tests/routes/flags.test.ts tests/unit/flags.test.ts tests/routes/candidate.test.ts`
Expected: the new refusals FAIL (the API returns 200).

- [ ] **Step 3: Implement**

`src/lib/candidate-profile.ts`:

```ts
/** What a citizen may flag: every profile field but the affidavit document itself, which no one can correct from a flag. */
export const FLAGGABLE_FIELD_KEYS = ['full_name', 'ward', 'party', 'gender', 'age', 'education', 'assets', 'cases'] as const satisfies readonly CandidateProfileFieldKey[];
export type FlaggableFieldKey = (typeof FLAGGABLE_FIELD_KEYS)[number];
```

`src/features/pages/Candidate.astro`: build `flagTargets` from `FLAGGABLE_FIELD_KEYS` and fix the comment ("all nine" → "eight of the nine profile fields; the affidavit document is not flaggable").

`src/pages/api/flags.ts`: `targetType: z.literal('candidate_field')`. Update the docstring.

`src/lib/flags.ts`: `deriveTargetWardId` keeps only the `candidate_field` branch and adds the key check; anything else throws:

```ts
export async function deriveTargetWardId(targetType: FlagTargetType, targetRef: string): Promise<number> {
  if (targetType !== 'candidate_field') throw new InvalidFlagTargetError();
  const match = /^candidate:(\d+):(.+)$/.exec(targetRef);
  if (!match || !(FLAGGABLE_FIELD_KEYS as readonly string[]).includes(match[2]!)) throw new InvalidFlagTargetError();
  const [row] = await db.select({ wardId: candidates.wardId }).from(candidates).where(eq(candidates.id, Number(match[1])));
  if (!row) throw new InvalidFlagTargetError();
  return row.wardId;
}
```

Rewrite its docstring to the one remaining case, saying that `ward_field` and `ward_issue` remain in the DB enum only so old rows can be read. Drop the now-unused `wards` and `wardIssues` imports. Leave `FlagTargetType` as it is.

- [ ] **Step 4: Run the tests**

Run: `TEST tests/routes/flags.test.ts tests/unit/flags.test.ts tests/routes/candidate.test.ts tests/unit/flag-modal.test.ts`, then `TYPECHECK`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidate-profile.ts src/features/pages/Candidate.astro src/pages/api/flags.ts src/lib/flags.ts tests/routes/flags.test.ts tests/unit/flags.test.ts tests/routes/candidate.test.ts
git commit -m "Accept flags only on the eight candidate fields a curator can correct"
```

---

### Task 5: The flag item: affidavit beside a structured fix

**Files:**
- Create: `src/lib/curator-fix.ts`, `src/components/CuratorSplit.astro`, `src/components/CuratorFieldForm.astro`, `src/components/CuratorWardForm.astro`, `tests/routes/support/staff-harness.ts`, `tests/routes/curator-flag-fix.test.ts`
- Modify: `src/lib/flags.ts`, `src/lib/curator.ts`, `src/features/pages/curator/QueueItem.astro`, `src/pages/curator/queue/[id].astro`, `src/i18n/en.json`, `src/i18n/kn.json`, `tests/routes/curator.test.ts`, `tests/unit/flags.test.ts`, `tests/unit/curator.test.ts`

**Interfaces:**
- Consumes: Task 1 (`readFieldForm`, `fieldFromInputs`, `errorFor`, `inputsOf`, `storedFieldData`, `RawField`, `FieldError`), Task 2 (components, `initAffidavitFields`), Task 3 (`moveCandidateWard`, `curator` actor), Task 4 (`FLAGGABLE_FIELD_KEYS`).
- Produces, from `src/lib/curator-fix.ts`:

```ts
export type StaffActor = { userId: number; role: 'curator' | 'admin' };
export interface WardOption { id: number; label: string }
export interface FixCandidate {
  id: number; slug: string; nameEn: string; partyEn: string;
  wardId: number; wardNameEn: string; wardNameKn: string;
  /** The stored affidavit every value points to; null for a candidate created by hand. */
  pdfUrl: string | null;
}
/** One field as the fix form shows it. */
export interface FixField {
  key: AffidavitFieldKey;
  status: FieldStatus;
  inputs: Record<string, string>;
  /** The published text, or null when nothing is published. */
  valueEn: string | null;
  aiExtracted: boolean;
  checked: boolean;
}
export type ParsedField = { ok: true; data: FieldData } | { ok: false; key: string; error?: FieldError; raw: RawField };
export type ParsedWard = { ok: true; wardId: number } | { ok: false; key: string };

export function wardOptionLabel(ward: { id: number; nameEn: string; corporation: string }): string;
export async function loadWardOptions(): Promise<WardOption[]>;
export async function latestAffidavitOf(candidateId: number): Promise<{ pdfUrl: string } | null>;
export async function loadFixCandidate(candidateId: number): Promise<FixCandidate | null>;
export async function loadFixFields(candidate: FixCandidate): Promise<FixField[]>;          // all seven, in AFFIDAVIT_FIELD_KEYS order
export async function publishedFieldData(candidate: FixCandidate, key: AffidavitFieldKey): Promise<FieldData | null>;
export function parseFieldFix(form: FormData, key: AffidavitFieldKey, published: FieldData | null): ParsedField;
export async function parseWardFix(form: FormData, currentWardId: number): Promise<ParsedWard>;
export async function saveFieldFix(actor: StaffActor, candidateId: number, data: FieldData, sourceUrl: string): Promise<void>;
export async function saveWardFix(candidateId: number, wardId: number, sourceUrl: string): Promise<void>;
```

- Produces, from `src/lib/flags.ts`:

```ts
export type FlagFix =
  | { kind: 'field'; candidateId: number; data: FieldData; sourceUrl: string }
  | { kind: 'ward'; candidateId: number; wardId: number; sourceUrl: string };
export type ResolveFlagResolution = { accept: true; fix: FlagFix } | { accept: false; reason: string };
```

- Produces, from `src/lib/curator.ts`: `QueueItemDetail` loses `candidateField` and gains
  `candidate: FixCandidate | null`, `fieldKey: string | null`, and
  `fix: { kind: 'field'; field: FixField } | { kind: 'ward'; wardId: number } | { kind: 'none' }`;
  `handleFlagFix(actor, item, form): Promise<FixOutcome>` replaces `handleAccept`, where
  `type FixOutcome = { kind: 'accepted' } | { kind: 'already_resolved' } | { kind: 'refused'; key: string; error?: FieldError; raw?: RawField }`.
- Produces components:
  - `<CuratorSplit lang pdfUrl>` (default slot is the right-hand panel; `pdfUrl: string | null`)
  - `<CuratorFieldForm lang csrfToken formAction field label confirmPath submitLabel error? raw? />` (`field: FixField`)
  - `<CuratorWardForm lang csrfToken formAction wards wardId confirmPath submitLabel />`
- Produces the test harness in `tests/routes/support/staff-harness.ts` (Step 1).

**i18n keys to add** (English; add Kannada too). Remove the `curator.queueItem.accept.*`, `curator.queueItem.error.sourceRequired`, `.valueRequired` and `.acceptUnsupported` keys once nothing uses them.

| Key | English |
|---|---|
| `curator.fix.heading` | Fix the published value |
| `curator.fix.wardHeading` | Move to the right ward |
| `curator.fix.wardLabel` | Ward |
| `curator.fix.confirm` | I have checked this against the affidavit. It publishes immediately to {path}. |
| `curator.fix.submit` | Fix and publish |
| `curator.fix.wardSubmit` | Move and publish |
| `curator.fix.badge.ai` | AI-extracted |
| `curator.fix.badge.checked` | Checked by a person |
| `curator.fix.noAffidavit` | This candidate has no stored affidavit, so there is nothing to check a value against. |
| `curator.fix.noAffidavitLink` | Add the affidavit in the candidate editor |
| `curator.fix.dismissOnly` | This kind of flag is no longer accepted. It can only be dismissed. |
| `curator.fix.error.confirmRequired` | Tick the box to confirm before publishing. |
| `curator.fix.error.unchanged` | Nothing changed. If the published value is right, dismiss the flag. |
| `curator.fix.error.noAffidavit` | This candidate has no stored affidavit. Add one before changing a value. |
| `curator.fix.error.unsupported` | This flag can only be dismissed. |
| `curator.fix.error.unknownWard` | Choose a ward from the list. |
| `curator.queueItem.published.heading` | Published now |
| `curator.queueItem.published.none` | Nothing is published for this field. |
| `curator.queueItem.candidateLine` | {name} · {ward} |
| `curator.queueItem.editCandidate` | Open in the candidate editor |

- [ ] **Step 1: Write the test harness**

Create `tests/routes/support/staff-harness.ts`:

```ts
/**
 * Shared set-up for the curator route suites: a database handle, a request
 * driven through the REAL middleware and the real page twin (the technique
 * every route suite here uses), people with sessions, and a candidate with
 * a published affidavit behind it.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../src/db/schema';
import { db as appDb } from '../../../src/db/client';
import { SESSION_COOKIE, createSession } from '../../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../../src/lib/csrf';
import { onRequest } from '../../../src/middleware';
import { fieldsFromExtraction, publishAffidavitFields } from '../../../src/lib/affidavit-publish';
import type { AffidavitExtraction } from '../../../src/lib/affidavit-extraction';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. These tests need a Postgres database of their own — see AGENTS.md ("Tests need a database").');
}

export const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

export const client = postgres(process.env.DATABASE_URL, { max: 1 });
export const db = drizzle(client, { schema });
export { schema };

export type Role = 'citizen' | 'transcriber' | 'curator' | 'admin';
export type Auth = { userId: number; cookieValue: string; token: string };
export interface WardFixture { id: number; nameEn: string; nameKn: string; corporation: 'south'; zone: string; boundaryRef: string }

export function ward(id: number, label: string): WardFixture {
  return { id, nameEn: `${id % 1000} - ${label}`, nameKn: `${label} ಕನ್ನಡ`, corporation: 'south', zone: 'Zone T', boundaryRef: `staff-harness-${id}` };
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: { site: SITE_ORIGIN, i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } } },
  });
}

export async function run(component: unknown, path: string, opts: { auth?: Auth; form?: FormData; params?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(path, SITE_URL);
  const headers = new Headers({ 'sec-fetch-site': 'same-origin' });
  const cookieValue = opts.auth?.cookieValue;
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  const request = new Request(url, { method: opts.form ? 'POST' : 'GET', headers, body: opts.form });
  const cookiesStub = { get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined) };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;
  const container = await makeContainer();
  const next = async () => container.renderToResponse(component as any, { partial: false, params: opts.params, request, locals: locals as unknown as App.Locals });
  return (await onRequest(ctx, next)) as Response;
}

/** Tracks what a suite created so `cleanup` can remove exactly that. */
export class Fixtures {
  userIds: number[] = [];
  wardIds: number[] = [];
  constructor(private emailPrefix: string) {}

  async wards(...wards: WardFixture[]): Promise<void> {
    for (const w of wards) {
      await db.insert(schema.wards).values(w).onConflictDoUpdate({ target: schema.wards.id, set: w });
      this.wardIds.push(w.id);
    }
  }

  async person(role: Role): Promise<Auth> {
    const [row] = await db.insert(schema.users).values({ email: `${this.emailPrefix}${randomUUID()}@example.com`, role }).returning({ id: schema.users.id });
    this.userIds.push(row.id);
    const { id, cookieValue } = await createSession(row.id);
    return { userId: row.id, cookieValue, token: issueCsrfToken(id) };
  }

  /** A stored PDF. `createdBy` is the first person this suite made, so cleanup finds it. */
  async pdf(): Promise<{ mediaId: number; sha256: string; pdfUrl: string }> {
    const bytes = Buffer.from(`%PDF-1.4 staff harness ${randomUUID()}`);
    const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
    const [m] = await db.insert(schema.media).values({ bytes, contentType: 'application/pdf', sha256, size: bytes.length, createdBy: this.userIds[0] }).returning({ id: schema.media.id });
    return { mediaId: m.id, sha256, pdfUrl: `/media/${m.id}/${sha256.slice(0, 16)}` };
  }

  /** A candidate with a published, AI-read affidavit: what a citizen flags. */
  async candidateWithAffidavit(wardId: number) {
    const e = extraction(wardId);
    const { mediaId, sha256, pdfUrl } = await this.pdf();
    const [c] = await db.insert(schema.candidates).values({ slug: `staff-harness-${randomUUID()}`, wardId, nameEn: e.identity.name.text!, partyEn: e.identity.party.text! }).returning({ id: schema.candidates.id, slug: schema.candidates.slug });
    await appDb.transaction((tx) => publishAffidavitFields(tx, { userId: null, role: 'system' }, c.id, fieldsFromExtraction(e), { sourceUrl: pdfUrl, checked: false }));
    const [a] = await db.insert(schema.candidateAffidavits).values({ candidateId: c.id, mediaId, sha256, state: 'published', extraction: e, confidence: e.confidence, attempts: 1 }).returning({ id: schema.candidateAffidavits.id });
    return { candidateId: c.id, slug: c.slug, affidavitId: a.id, pdfUrl, extraction: e };
  }

  /** A candidate somebody typed in, with no affidavit behind it. */
  async bareCandidate(wardId: number, nameEn = `Bare Person ${randomUUID().slice(0, 8)} (FICTIONAL)`): Promise<number> {
    const [c] = await db.insert(schema.candidates).values({ slug: `staff-harness-${randomUUID()}`, wardId, nameEn, partyEn: 'Independent' }).returning({ id: schema.candidates.id });
    return c.id;
  }

  /** An affidavit the worker read but could not publish. */
  async waitingAffidavit(opts: { wardId: number; reason: 'ward_unresolved' | 'possible_duplicate' | 'reported_by_transcriber'; candidateId?: number; note?: string; name?: string }) {
    const e = extraction(opts.wardId, opts.name);
    const { mediaId, sha256, pdfUrl } = await this.pdf();
    const [a] = await db
      .insert(schema.candidateAffidavits)
      .values({ candidateId: opts.candidateId ?? null, mediaId, sha256, state: 'needs_matching', matchReason: opts.reason, matchNote: opts.note ?? null, extraction: e, confidence: e.confidence, attempts: 1 })
      .returning({ id: schema.candidateAffidavits.id });
    return { affidavitId: a.id, pdfUrl, extraction: e };
  }

  async cleanup(): Promise<void> {
    if (this.wardIds.length) await db.delete(schema.flagSubmissions).where(inArray(schema.flagSubmissions.flagItemId, db.select({ id: schema.flagItems.id }).from(schema.flagItems).where(inArray(schema.flagItems.wardId, this.wardIds))));
    if (this.wardIds.length) await db.delete(schema.flagItems).where(inArray(schema.flagItems.wardId, this.wardIds));
    const mediaIds = this.userIds.length ? (await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, this.userIds[0]))).map((r) => r.id) : [];
    if (mediaIds.length) await db.delete(schema.candidateAffidavits).where(inArray(schema.candidateAffidavits.mediaId, mediaIds));
    const candidateIds = this.wardIds.length ? (await db.select({ id: schema.candidates.id }).from(schema.candidates).where(inArray(schema.candidates.wardId, this.wardIds))).map((r) => r.id) : [];
    if (candidateIds.length) {
      await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
      await db.delete(schema.candidates).where(inArray(schema.candidates.id, candidateIds));
    }
    if (mediaIds.length) await db.delete(schema.media).where(inArray(schema.media.id, mediaIds));
    if (this.userIds.length) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, this.userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, this.userIds));
    }
    if (this.wardIds.length) await db.delete(schema.wards).where(inArray(schema.wards.id, this.wardIds));
  }
}

export function tokenForm(auth: Auth, fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set(CSRF_FIELD_NAME, auth.token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export function extraction(wardId: number, name = `Harness Person ${randomUUID().slice(0, 8)} (FICTIONAL)`): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 10210000, immovableInr: 35000000, totalInr: 45210000, note: 'Self 2 crore; spouse 2.5 crore' },
    cases: { status: 'value', pending: 2, convictions: 0, note: 'IPC 420 and 468' },
    identity: {
      name: { status: 'value', text: name },
      ward: { status: 'value', number: wardId % 1000, name: 'As read', corporation: 'south' },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'female' },
    },
    confidence: 64,
  };
}

export async function fieldRow(candidateId: number, key: string) {
  const rows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
  return rows.find((r) => r.fieldKey === key);
}
```

If a table that references users, candidates or flag items makes `cleanup` fail on a foreign key (for example a `resolved_by` or `checked_by` column), delete or null those rows first; the first person a suite makes must be created before any `pdf()` call.

- [ ] **Step 2: Write the failing route tests**

Create `tests/routes/curator-flag-fix.test.ts`:

```ts
/**
 * `/curator/queue/{id}`: a flag seen against the affidavit, fixed with the
 * flagged field's structured inputs or by moving the candidate to another
 * ward, or dismissed. Through the real middleware and page twin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { submitFlag } from '../../src/lib/flags';
import { t } from '../../src/i18n';
import QueueItemRoute from '../../src/pages/curator/queue/[id].astro';

// This suite owns ward ids 99411 and 99412.
const WARD_A = ward(99411, 'Flag Fix Test Ward A');
const WARD_B = ward(99412, 'Flag Fix Test Ward B');
const fx = new Fixtures('curator-flag-fix-test-');
let curator: Auth;
let citizen: Auth;

const item = (id: number, auth?: Auth, form?: FormData) => run(QueueItemRoute, `/curator/queue/${id}`, { auth, form, params: { id: String(id) } });
const flag = async (candidateId: number, key: string) => (await submitFlag(citizen.userId, { targetType: 'candidate_field', targetRef: `candidate:${candidateId}:${key}`, detail: `The ${key} is wrong` })).flagItemId;
const flagRow = async (id: number) => (await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, id)))[0];
const fix = (fields: Record<string, string>) => tokenForm(curator, { formAction: 'fix', confirmPublish: 'on', ...fields });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD_A, WARD_B);
  curator = await fx.person('curator');
  citizen = await fx.person('citizen');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

describe('who may open a flag', () => {
  it('refuses a citizen', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await item(await flag(c.candidateId, 'age'), citizen)).status).toBe(403);
  });
});

describe('a flag on an affidavit field', () => {
  it('shows the affidavit beside the flagged field, pre-filled with the published value', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await item(await flag(c.candidateId, 'assets'), curator);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain(`src="${c.pdfUrl}#navpanes=0&amp;view=FitH"`);
    expect(html).toContain('name="movableInr" value="10210000"');
    expect(html).toContain('name="immovableInr" value="35000000"');
    expect(html).not.toContain('name="age"');
    expect(html).toContain('The assets is wrong');
  });

  it('publishes the fix as a structured, person-checked value and accepts the flag', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'assets');
    const res = await item(id, curator, fix({ 'status.assets': 'value', movableInr: '1,02,10,000', immovableInr: '2,40,00,000' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/curator/queue');
    const row = (await fieldRow(c.candidateId, 'assets'))!;
    expect(row.valueData).toEqual({ key: 'assets', status: 'value', movableInr: 10210000, immovableInr: 24000000 });
    expect(row.checkedBy).toBe(curator.userId);
    expect(row.aiExtracted).toBe(false);
    expect(row.sourceUrl).toBe(c.pdfUrl);
    expect(row.sourceType).toBe('official');
    expect((await flagRow(id)).status).toBe('accepted');
    expect((await flagRow(id)).resolvedBy).toBe(curator.userId);
  });

  it('publishes "not declared" as an answer', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'cases');
    expect((await item(id, curator, fix({ 'status.cases': 'not_declared' }))).status).toBe(302);
    const row = (await fieldRow(c.candidateId, 'cases'))!;
    expect(row.notDeclared).toBe(true);
    expect(row.valueEn).toBeNull();
  });

  it('refuses the published value typed again, however the digits are grouped', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'assets');
    const res = await item(id, curator, fix({ 'status.assets': 'value', movableInr: '1,02,10,000', immovableInr: '3,50,00,000' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', 'curator.fix.error.unchanged'));
    expect((await flagRow(id)).status).toBe('pending');
    expect((await fieldRow(c.candidateId, 'assets'))!.checkedBy).toBeNull();
  });

  it('refuses an invalid value, writes nothing, and shows back what was typed', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'age');
    const res = await item(id, curator, fix({ 'status.age': 'value', age: 'forty' }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain(t('en', 'transcribe.error.whole_number'));
    expect(html).toContain('name="age" value="forty"');
    expect((await fieldRow(c.candidateId, 'age'))!.valueData).toEqual({ key: 'age', status: 'value', years: 52 });
    expect((await flagRow(id)).status).toBe('pending');
  });

  it('refuses a fix without the confirmation tick', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'age');
    const res = await item(id, curator, tokenForm(curator, { formAction: 'fix', 'status.age': 'value', age: '41' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', 'curator.fix.error.confirmRequired'));
    expect((await flagRow(id)).status).toBe('pending');
  });

  it('opens empty for a field that holds only free text, and a save gives it structure', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await db.update(schema.candidateFields).set({ valueData: null, valueEn: 'Some college' }).where(eq(schema.candidateFields.id, (await fieldRow(c.candidateId, 'education'))!.id));
    const id = await flag(c.candidateId, 'education');
    const html = await (await item(id, curator)).text();
    expect(html).toContain('Some college');
    expect(html).toContain('name="educationStated" value=""');
    expect((await item(id, curator, fix({ 'status.education': 'value', educationLevel: 'Graduate', educationStated: 'B.Com' }))).status).toBe(302);
    expect((await fieldRow(c.candidateId, 'education'))!.valueData).toEqual({ key: 'education', status: 'value', level: 'Graduate', stated: 'B.Com' });
  });

  it('tells a second curator the flag is already resolved', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'age');
    expect((await item(id, curator, fix({ 'status.age': 'value', age: '41' }))).status).toBe(302);
    const res = await item(id, curator, fix({ 'status.age': 'value', age: '42' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(t('en', 'curator.queueItem.alreadyResolved'));
    expect((await fieldRow(c.candidateId, 'age'))!.valueData).toEqual({ key: 'age', status: 'value', years: 41 });
  });
});

describe('a flag on the ward', () => {
  it('moves the candidate, takes its other pending flags along, and accepts the flag', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const other = await flag(c.candidateId, 'age');
    const id = await flag(c.candidateId, 'ward');
    const html = await (await item(id, curator)).text();
    expect(html).toContain(`<option value="${WARD_A.id}" selected`);
    expect((await item(id, curator, fix({ wardId: String(WARD_B.id) }))).status).toBe(302);
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, c.candidateId));
    expect(candidate.wardId).toBe(WARD_B.id);
    expect(candidate.slug).toBe(c.slug);
    expect((await fieldRow(c.candidateId, 'ward'))!.aiExtracted).toBe(false);
    expect((await flagRow(id)).status).toBe('accepted');
    expect((await flagRow(other)).wardId).toBe(WARD_B.id);
  });

  it.each([
    ['the ward the candidate is already in', () => String(WARD_A.id), 'curator.fix.error.unchanged'],
    ['a ward that does not exist', () => '99999999', 'curator.fix.error.unknownWard'],
    ['something that is not a number', () => 'north', 'curator.fix.error.unknownWard'],
  ] as const)('refuses %s', async (_label, wardId, key) => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'ward');
    const res = await item(id, curator, fix({ wardId: wardId() }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', key));
    expect((await db.select().from(schema.candidates).where(eq(schema.candidates.id, c.candidateId)))[0].wardId).toBe(WARD_A.id);
    expect((await flagRow(id)).status).toBe('pending');
  });
});

describe('flags that cannot be fixed here', () => {
  it('offers only dismissal for a candidate with no stored affidavit, and refuses a fix posted anyway', async () => {
    const candidateId = await fx.bareCandidate(WARD_A.id);
    const id = await flag(candidateId, 'age');
    const html = await (await item(id, curator)).text();
    expect(html).not.toContain('value="fix"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain(`/curator/candidate/${candidateId}`);
    const res = await item(id, curator, fix({ 'status.age': 'value', age: '41' }));
    expect(res.status).toBe(400);
    expect(await fieldRow(candidateId, 'age')).toBeUndefined();
    expect((await item(id, curator, tokenForm(curator, { formAction: 'reject', reason: 'No affidavit on file yet' }))).status).toBe(302);
    expect((await flagRow(id)).status).toBe('rejected');
  });

  it('offers only dismissal for an old ward-issue flag', async () => {
    const [old] = await db.insert(schema.flagItems).values({ wardId: WARD_A.id, targetType: 'ward_issue', targetRef: 'ward_issue:999999', status: 'pending' }).returning({ id: schema.flagItems.id });
    const html = await (await item(old.id, curator)).text();
    expect(html).not.toContain('value="fix"');
    expect(html).toContain(t('en', 'curator.fix.dismissOnly'));
    expect((await item(old.id, curator, fix({ wardId: String(WARD_B.id) }))).status).toBe(400);
    expect((await flagRow(old.id)).status).toBe('pending');
  });
});
```

- [ ] **Step 3: Run and confirm they fail**

Run: `TEST tests/routes/curator-flag-fix.test.ts`
Expected: FAIL (no fix form; `formAction=fix` falls through to the reject handler).

- [ ] **Step 4: Implement `src/lib/curator-fix.ts`**

```ts
/**
 * A curator's correction to one published value, wherever it is made: from
 * a citizen's flag (`/curator/queue/{id}`) or in the candidate editor
 * (`/curator/candidate/{id}`). A correction is one affidavit field typed
 * into that field's structured inputs, or the candidate moved to another
 * ward. Both are checked against the stored affidavit, which is the source
 * the published value points to: a candidate with no affidavit has nothing
 * to correct against.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidateAffidavits, candidateFields, candidates, media, wards } from '../db/schema';
import { AFFIDAVIT_FIELD_KEYS, moveCandidateWard, publishAffidavitFields, sameFieldData, type AffidavitFieldKey, type FieldData, type FieldStatus } from './affidavit-publish';
import { errorFor, fieldFromInputs, inputsOf, readFieldForm, storedFieldData, type FieldError, type RawField } from './affidavit-form';
import { translateFieldSoon } from './translate-runtime';

// ... the exported types from the Interfaces block ...

/** "South 14 · Hebbal": `name_en` already starts with the ward number ("14 - Hebbal"). */
export function wardOptionLabel(ward: { id: number; nameEn: string; corporation: string }): string {
  const corporation = ward.corporation[0]!.toUpperCase() + ward.corporation.slice(1);
  return `${corporation} ${ward.id % 1000} · ${ward.nameEn.replace(/^\d+\s*-\s*/, '')}`;
}

export async function loadWardOptions(): Promise<WardOption[]> {
  const rows = await db.select({ id: wards.id, nameEn: wards.nameEn, corporation: wards.corporation }).from(wards).orderBy(wards.corporation, wards.id);
  return rows.map((row) => ({ id: row.id, label: wardOptionLabel(row) }));
}

/** The candidate's most recently stored affidavit that has been published, or null. */
export async function latestAffidavitOf(candidateId: number): Promise<{ pdfUrl: string } | null> {
  const [row] = await db
    .select({ mediaId: media.id, sha256: media.sha256 })
    .from(candidateAffidavits)
    .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
    .where(and(eq(candidateAffidavits.candidateId, candidateId), eq(candidateAffidavits.state, 'published')))
    .orderBy(desc(candidateAffidavits.createdAt), desc(candidateAffidavits.id))
    .limit(1);
  return row ? { pdfUrl: `/media/${row.mediaId}/${row.sha256.slice(0, 16)}` } : null;
}

export async function loadFixCandidate(candidateId: number): Promise<FixCandidate | null> {
  const [row] = await db
    .select({ id: candidates.id, slug: candidates.slug, nameEn: candidates.nameEn, partyEn: candidates.partyEn, wardId: wards.id, wardNameEn: wards.nameEn, wardNameKn: wards.nameKn })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(eq(candidates.id, candidateId));
  if (!row) return null;
  return { ...row, pdfUrl: (await latestAffidavitOf(candidateId))?.pdfUrl ?? null };
}

/** What is published for `key` as a structured value. Name and party come from the candidate row, which is what the public page shows. */
function structured(candidate: FixCandidate, key: AffidavitFieldKey, stored: typeof candidateFields.$inferSelect | undefined): FieldData | null {
  if (key === 'full_name') return { key, status: 'value', text: candidate.nameEn };
  if (key === 'party') return { key, status: 'value', text: candidate.partyEn };
  return storedFieldData(key, stored?.valueData);
}

export async function loadFixFields(candidate: FixCandidate): Promise<FixField[]> {
  const rows = await db.select().from(candidateFields).where(eq(candidateFields.candidateId, candidate.id));
  const byKey = new Map(rows.map((row) => [row.fieldKey, row]));
  return AFFIDAVIT_FIELD_KEYS.map((key) => {
    const stored = byKey.get(key);
    const data = structured(candidate, key, stored);
    // Free text with no structure behind it: keep what the row says about the answer, and leave the inputs empty.
    const status: FieldStatus = data?.status ?? (stored?.unreadable ? 'unreadable' : stored?.notDeclared ? 'not_declared' : 'value');
    return {
      key,
      status,
      inputs: data ? inputsOf(data) : inputsOf(fieldFromInputs(key, 'unreadable', {})),
      valueEn: key === 'full_name' ? candidate.nameEn : key === 'party' ? candidate.partyEn : (stored?.valueEn ?? null),
      aiExtracted: stored?.aiExtracted ?? false,
      checked: stored?.checkedBy != null,
    };
  });
}

export async function publishedFieldData(candidate: FixCandidate, key: AffidavitFieldKey): Promise<FieldData | null> {
  const [stored] = await db.select().from(candidateFields).where(and(eq(candidateFields.candidateId, candidate.id), eq(candidateFields.fieldKey, key)));
  return structured(candidate, key, stored);
}

/** One field's posted correction: refused without the confirmation tick, when invalid, or when it is what is published already. */
export function parseFieldFix(form: FormData, key: AffidavitFieldKey, published: FieldData | null): ParsedField {
  const raw = readFieldForm(form, key);
  if (form.get('confirmPublish') == null) return { ok: false, key: 'curator.fix.error.confirmRequired', raw };
  const data = fieldFromInputs(key, raw.status, raw.inputs);
  const error = errorFor(data, raw.inputs);
  if (error) return { ok: false, key: `transcribe.error.${error}`, error, raw };
  if (published && sameFieldData(data, published)) return { ok: false, key: 'curator.fix.error.unchanged', raw };
  return { ok: true, data };
}

export async function parseWardFix(form: FormData, currentWardId: number): Promise<ParsedWard> {
  if (form.get('confirmPublish') == null) return { ok: false, key: 'curator.fix.error.confirmRequired' };
  const raw = String(form.get('wardId') ?? '').trim();
  const wardId = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  const [ward] = Number.isInteger(wardId) ? await db.select({ id: wards.id }).from(wards).where(eq(wards.id, wardId)) : [];
  if (!ward) return { ok: false, key: 'curator.fix.error.unknownWard' };
  if (ward.id === currentWardId) return { ok: false, key: 'curator.fix.error.unchanged' };
  return { ok: true, wardId: ward.id };
}

/** Publishes one corrected field outside any flag (the candidate editor). */
export async function saveFieldFix(actor: StaffActor, candidateId: number, data: FieldData, sourceUrl: string): Promise<void> {
  const translate = await db.transaction((tx) => publishAffidavitFields(tx, actor, candidateId, [data], { sourceUrl, checked: true }));
  for (const fieldId of translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });
}

export async function saveWardFix(candidateId: number, wardId: number, sourceUrl: string): Promise<void> {
  await db.transaction((tx) => moveCandidateWard(tx, candidateId, wardId, sourceUrl));
}
```

Check `sameFieldData` in `src/lib/affidavit-publish.ts` compares `education.stated` so that `null` and `''` do not differ; `fieldFromInputs` already turns an empty `educationStated` into `null`. If `inputsOf(fieldFromInputs(key, 'unreadable', {}))` does not yield an empty string for every input name, build the empty record from `FIELD_INPUTS[key]` instead.

- [ ] **Step 5: Change `resolveFlag` in `src/lib/flags.ts`**

Replace `ResolveFlagResolution` with the two types in the Interfaces block. In the accept branch:

```ts
if (resolution.accept) {
  const { fix } = resolution;
  let translate: number[] = [];
  if (fix.kind === 'field') {
    translate = await publishAffidavitFields(tx, actor, fix.candidateId, [fix.data], { sourceUrl: fix.sourceUrl, checked: true });
  } else {
    await moveCandidateWard(tx, fix.candidateId, fix.wardId, fix.sourceUrl);
  }
  await tx
    .update(flagItems)
    .set({ status: 'accepted', resolutionReason: null, resolvedBy: actor.userId, resolvedAt: new Date() })
    .where(and(eq(flagItems.id, flagItemId), eq(flagItems.status, 'pending')));
  return translate;
}
```

The reject branch returns `[]`. After the transaction: `for (const fieldId of translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });`. Remove the `publishCandidateFieldTx` import and rewrite the function's docstring: ACCEPT applies a structured field correction or a ward move and marks the item accepted in the same transaction. Keep the RE-RESOLVE GUARD paragraph.

In `tests/unit/flags.test.ts`, change every `resolveFlag(..., { accept: true, publish: {...} })` to pass `fix: { kind: 'field', candidateId, data: { key: 'age', status: 'value', years: 41 }, sourceUrl: '/media/1/abc' }` and assert on `valueData`/`checkedBy` instead of the free-text columns. Keep the dedupe, double-resolve and reject tests.

- [ ] **Step 6: Change `src/lib/curator.ts`**

- `CuratorActor` becomes `export type CuratorActor = StaffActor` (import from `./curator-fix`).
- Delete `CandidateFieldContext`, `handleAccept`, the local `isHttpUrl` if nothing else in the file uses it (the candidate field handler still does until Task 6; leave it if so).
- `humanTargetLabel`: delete (and its tests in `tests/unit/curator.test.ts`); replace with

```ts
/** What a queue row is about, in words: the candidate's field for today's flags, the raw reference for rows older than the eight-field rule. */
export function flagFieldKey(targetType: FlagTargetType, targetRef: string): string | null {
  return targetType === 'candidate_field' ? (parseCandidateFieldTargetRef(targetRef)?.fieldKey ?? null) : null;
}
```

  `loadQueueList` returns `fieldKey: string | null` and `candidateNameEn: string | null` per row instead of `targetLabel` (left-join `candidates` on `candidates.id = split_part(target_ref, ':', 2)::int` only when `target_type = 'candidate_field'`; a simple way is a second query for the candidate ids parsed from the rows). `Queue.astro` shows `"{candidate} — {field label}"` using `CANDIDATE_PROFILE_LABEL_KEYS[fieldKey]` when the key is a profile key, else the raw `targetRef`. Update the assertions in `tests/routes/curator.test.ts` that used `humanTargetLabel`.
- `loadQueueItem`: after loading the item and submissions,

```ts
let candidate: FixCandidate | null = null;
let fieldKey: string | null = null;
let fix: QueueItemDetail['fix'] = { kind: 'none' };
const parsed = item.targetType === 'candidate_field' ? parseCandidateFieldTargetRef(item.targetRef) : null;
if (parsed) {
  candidate = await loadFixCandidate(parsed.candidateId);
  fieldKey = parsed.fieldKey;
  if (candidate && candidate.pdfUrl) {
    if (parsed.fieldKey === 'ward') fix = { kind: 'ward', wardId: candidate.wardId };
    else if ((AFFIDAVIT_FIELD_KEYS as readonly string[]).includes(parsed.fieldKey)) {
      fix = { kind: 'field', field: (await loadFixFields(candidate)).find((f) => f.key === parsed.fieldKey)! };
    }
  }
}
```

  Also load `published`: for a field fix it is on `fix.field`; for the ward it is the ward name. The page needs nothing more.
- Add:

```ts
export type FixOutcome =
  | { kind: 'accepted' }
  | { kind: 'already_resolved' }
  | { kind: 'refused'; key: string; error?: FieldError; raw?: RawField };

/**
 * Handles the FIX form: the flagged field's corrected value, or the ward
 * the candidate belongs in. The correction and the flag's acceptance are
 * one transaction (`resolveFlag`). Refused when there is no affidavit to
 * check against, when the flag is one that can only be dismissed, and for
 * everything `parseFieldFix` / `parseWardFix` refuse.
 */
export async function handleFlagFix(actor: CuratorActor, item: QueueItemDetail, form: FormData): Promise<FixOutcome> {
  if (item.fix.kind === 'none' || !item.candidate) {
    const noAffidavit = item.candidate !== null && item.candidate.pdfUrl === null;
    return { kind: 'refused', key: noAffidavit ? 'curator.fix.error.noAffidavit' : 'curator.fix.error.unsupported' };
  }
  const candidate = item.candidate;
  const sourceUrl = candidate.pdfUrl!;
  let fix: FlagFix;
  if (item.fix.kind === 'ward') {
    const parsed = await parseWardFix(form, candidate.wardId);
    if (!parsed.ok) return { kind: 'refused', key: parsed.key };
    fix = { kind: 'ward', candidateId: candidate.id, wardId: parsed.wardId, sourceUrl };
  } else {
    const key = item.fix.field.key;
    const parsed = parseFieldFix(form, key, await publishedFieldData(candidate, key));
    if (!parsed.ok) return { kind: 'refused', key: parsed.key, error: parsed.error, raw: parsed.raw };
    fix = { kind: 'field', candidateId: candidate.id, data: parsed.data, sourceUrl };
  }
  try {
    await resolveFlag(actor, item.id, { accept: true, fix });
  } catch (err) {
    if (err instanceof Error && err.message === 'flag_already_resolved') return { kind: 'already_resolved' };
    throw err;
  }
  return { kind: 'accepted' };
}
```

Update the module docstring's Task references to describe what the module does now.

- [ ] **Step 7: Build the three components**

`src/components/CuratorSplit.astro`:

```astro
---
/**
 * The curator's working layout: the affidavit on the left, staying in view,
 * and what is being decided on the right. On a narrow screen the two stack
 * and the scan collapses to a link. With no affidavit there is one column.
 */
import AffidavitScan from './AffidavitScan.astro';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
  pdfUrl: string | null;
}

const { lang, pdfUrl } = Astro.props;
---

<div class:list={['split', { 'split--single': !pdfUrl }]}>
  {pdfUrl && <AffidavitScan lang={lang} pdfUrl={pdfUrl} collapse />}
  <section class="split-panel">
    <slot />
  </section>
</div>

<script>
  import { initAffidavitFields } from '../islands/AffidavitFields';
  initAffidavitFields();
</script>

<style>
  .split-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-6) var(--container-pad-x) var(--space-8);
  }

  .split--single .split-panel {
    max-width: var(--container-prose);
    margin-inline: auto;
  }

  @media (min-width: 900px) {
    .split:not(.split--single) {
      display: grid;
      grid-template-columns: minmax(0, 58fr) minmax(26rem, 42fr);
      height: calc(100vh - 56px);
    }

    .split:not(.split--single) .split-panel {
      min-height: 0;
      overflow-y: auto;
      padding-inline: var(--space-6);
    }
  }
</style>
```

`src/components/CuratorFieldForm.astro`: a `<form method="post">` holding the CSRF field, `<input type="hidden" name="formAction" value={formAction} />`, then

```astro
<fieldset class:list={['field', { 'field--error': error }]} data-field={field.key}>
  <legend>
    <span class="field-name">{label}</span>
    <span class:list={['badge', field.checked ? 'badge--checked' : 'badge--ai']}>
      {t(lang, field.checked ? 'curator.fix.badge.checked' : 'curator.fix.badge.ai')}
    </span>
  </legend>
  <AffidavitFieldInputs lang={lang} fieldKey={field.key} status={raw?.status ?? field.status} inputs={raw?.inputs ?? field.inputs} error={error} />
  <label class="confirm">
    <input type="checkbox" name="confirmPublish" required />
    <span>{t(lang, 'curator.fix.confirm', { path: confirmPath })}</span>
  </label>
  <Button type="submit" variant="primary" lang={lang}>{submitLabel}</Button>
</fieldset>
```

Show the badge only when `field.aiExtracted || field.checked`. Props: `lang`, `csrfToken`, `formAction: string`, `field: FixField`, `label: string`, `confirmPath: string`, `submitLabel: string`, `error?: FieldError`, `raw?: RawField`. Copy the `.field`, `.field--error`, `legend`-related, `.field-name`, `.badge*` rules from `Reading.astro` into this component's `<style>` (leave `Reading.astro`'s copies in place) and style `.confirm` like `Reading.astro`'s `.tick` without the top border.

`src/components/CuratorWardForm.astro`: a `<form method="post">` with the CSRF field, the hidden `formAction`, a labelled `<select name="wardId" class="form-input" required>` listing `wards` (`<option value={ward.id} selected={ward.id === wardId}>{ward.label}</option>`), the same confirm label, and a primary submit button. Props: `lang`, `csrfToken`, `formAction: string`, `wards: WardOption[]`, `wardId: number`, `confirmPath: string`, `submitLabel: string`.

- [ ] **Step 8: Rebuild `QueueItem.astro` and its route twin**

`src/pages/curator/queue/[id].astro`: dispatch `formAction === 'fix'` to `handleFlagFix`, `'reject'` to `handleReject`, anything else to a bare 400. `accepted`/`rejected` redirect to `/curator/queue` as now; `already_resolved` re-loads and shows the notice with 200; `refused` sets `status = 400` and passes `message = { kind: 'error', key }` plus `fixError` and `fixRaw` to the page. Load `wards` with `loadWardOptions()` only when `item.fix.kind === 'ward'`.

`src/features/pages/curator/QueueItem.astro`: props `lang`, `csrfToken`, `item`, `wards: WardOption[]`, `message?`, `fixError?: FieldError`, `fixRaw?: RawField`. Wrap everything in `<CuratorSplit lang={lang} pdfUrl={item.candidate?.pdfUrl ?? null}>` and render, in order:

1. Back link; `<h1>`; a line with the status badge, `curator.queueItem.candidateLine` (candidate name and ward name with the leading number stripped as `Reading.astro` does) and the field label (`CANDIDATE_PROFILE_LABEL_KEYS[item.fieldKey]` when it is a profile key, otherwise `item.targetRef`); for a candidate, a link `curator.queueItem.editCandidate` to `/curator/candidate/{id}`.
2. The message banner and, for a resolved item, the resolution reason (as now).
3. The submissions card (unchanged markup).
4. For a field fix, a "Published now" card showing `field.valueEn` (or `common.notDeclared`, or `curator.queueItem.published.none`).
5. When pending: `fix.kind === 'field'` → a card with heading `curator.fix.heading` and `<CuratorFieldForm formAction="fix" field={item.fix.field} label={…} confirmPath={`/ward/${item.wardId}`} submitLabel={t(lang, 'curator.fix.submit')} error={fixError} raw={fixRaw} />`; `fix.kind === 'ward'` → heading `curator.fix.wardHeading` and `<CuratorWardForm formAction="fix" wards={wards} wardId={item.fix.wardId} … submitLabel={t(lang, 'curator.fix.wardSubmit')} />`; `fix.kind === 'none'` with a candidate that has no affidavit → `curator.fix.noAffidavit` and the link `curator.fix.noAffidavitLink` to the editor; otherwise `curator.fix.dismissOnly`.
6. When pending: the dismiss card (existing reject form, unchanged, placed last).

Remove the old accept form and the `SourceLine`/`FormField` imports if unused.

- [ ] **Step 9: Update the old tests**

In `tests/routes/curator.test.ts` delete the tests of the free-text accept form (value/source/notDeclared/sourceType/authoredLang, "accept unsupported" for ward targets, `sourceRequired`, `valueRequired`) and the `humanTargetLabel` import; fix the remaining queue-list and reject tests for the new markup. The new suite covers the fix path.

- [ ] **Step 10: Run the tests**

Run: `TEST tests/routes/curator-flag-fix.test.ts tests/routes/curator.test.ts tests/unit/flags.test.ts tests/unit/curator.test.ts tests/routes/account.test.ts tests/unit/i18n.test.ts`, then `TYPECHECK`.
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A src tests
git commit -m "Show a flag against the affidavit and fix it with the field's structured inputs or a ward move"
```

---

### Task 6: The candidate editor on structured fields

**Files:**
- Modify: `src/lib/curator.ts`, `src/features/pages/curator/CandidateEdit.astro`, `src/pages/curator/candidate/[id].astro`, `src/lib/publish.ts`, `src/i18n/en.json`, `src/i18n/kn.json`
- Test: create `tests/routes/curator-candidate-fields.test.ts`; modify `tests/routes/curator-candidate.test.ts`, `tests/unit/publish-candidate.test.ts`, `tests/unit/translate-runtime.test.ts`, `tests/unit/affidavit-publish.test.ts`

**Interfaces:**
- Consumes: everything Task 5 produces from `src/lib/curator-fix.ts`, the three components, the harness.
- Produces, from `src/lib/curator.ts`:
  - `CandidateEditData` loses `fields: Record<ReportCardFieldKey, …>` and gains `pdfUrl: string | null` and `fields: FixField[]`.
  - `handleCandidateFieldFix(actor, candidate: CandidateEditData, key: AffidavitFieldKey, form): Promise<EditFixOutcome>` and `handleCandidateWardFix(candidate: CandidateEditData, form): Promise<EditFixOutcome>`, where `type EditFixOutcome = { kind: 'saved' } | { kind: 'refused'; key: string; error?: FieldError; raw?: RawField }`.
  - `handleCandidateCorePublish` no longer reads `nameEn`/`partyEn`.

**i18n keys:** add `curator.candidateEdit.fields.needAffidavit` = "Add this candidate's affidavit below before changing a value: every value is checked against it." and `curator.candidateEdit.field.submit` (existing) is reused as "Save and publish" if it does not already say so. Remove `curator.candidateEdit.field.trackRecord`, `.approachability`, `.valueEnLabel`, `.valueKnLabel`, `curator.candidateEdit.error.sourceRequired`, `.valueRequired`, and (from the edit page only) the uses of `core.nameEnLabel`/`core.partyEnLabel` (keep the keys: `/curator/candidate/new` still uses them).

- [ ] **Step 1: Write the failing tests**

Create `tests/routes/curator-candidate-fields.test.ts`:

```ts
/** `/curator/candidate/{id}`: the seven affidavit fields and the ward, each saved on its own against the affidavit. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { t } from '../../src/i18n';
import CandidateRoute from '../../src/pages/curator/candidate/[id].astro';

// This suite owns ward ids 99421 and 99422.
const WARD_A = ward(99421, 'Editor Fields Test Ward A');
const WARD_B = ward(99422, 'Editor Fields Test Ward B');
const fx = new Fixtures('curator-candidate-fields-test-');
let curator: Auth;

const page = (id: number, form?: FormData) => run(CandidateRoute, `/curator/candidate/${id}`, { auth: curator, form, params: { id: String(id) } });
const save = (formAction: string, fields: Record<string, string>) => tokenForm(curator, { formAction, confirmPublish: 'on', ...fields });
const candidateRow = async (id: number) => (await db.select().from(schema.candidates).where(eq(schema.candidates.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD_A, WARD_B);
  curator = await fx.person('curator');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

it('shows the affidavit beside all seven fields and the ward, pre-filled', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  const html = await (await page(c.candidateId)).text();
  expect(html).toContain(`src="${c.pdfUrl}#navpanes=0&amp;view=FitH"`);
  for (const action of ['field:full_name', 'field:party', 'field:gender', 'field:age', 'field:education', 'field:assets', 'field:cases', 'ward']) {
    expect(html).toContain(`name="formAction" value="${action}"`);
  }
  expect(html).toContain('name="age" value="52"');
  expect(html).not.toContain('track_record');
  expect(html).not.toContain('name="nameEn"');
});

it('saves one field as a structured, person-checked value and leaves the others alone', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  const res = await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(`/curator/candidate/${c.candidateId}`);
  const age = (await fieldRow(c.candidateId, 'age'))!;
  expect(age.valueData).toEqual({ key: 'age', status: 'value', years: 47 });
  expect(age.checkedBy).toBe(curator.userId);
  expect(age.sourceUrl).toBe(c.pdfUrl);
  expect((await fieldRow(c.candidateId, 'cases'))!.checkedBy).toBeNull();
});

it('renames the candidate through the name field', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  expect((await page(c.candidateId, save('field:full_name', { 'status.full_name': 'value', name: 'Corrected Name (FICTIONAL)' }))).status).toBe(302);
  expect((await candidateRow(c.candidateId)).nameEn).toBe('Corrected Name (FICTIONAL)');
});

it('moves the candidate to another ward', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  expect((await page(c.candidateId, save('ward', { wardId: String(WARD_B.id) }))).status).toBe(302);
  expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_B.id);
});

it.each([
  ['an unchanged value', 'field:age', { 'status.age': 'value', age: '52' }, 'curator.fix.error.unchanged'],
  ['an invalid value', 'field:age', { 'status.age': 'value', age: '7' }, 'transcribe.error.age_range'],
  ['the same ward', 'ward', { wardId: String(99421) }, 'curator.fix.error.unchanged'],
] as const)('refuses %s', async (_label, action, fields, key) => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  const res = await page(c.candidateId, save(action, fields));
  expect(res.status).toBe(400);
  expect(await res.text()).toContain(t('en', key));
  expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
  expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_A.id);
});

it('refuses a save without the confirmation tick', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  const res = await page(c.candidateId, tokenForm(curator, { formAction: 'field:age', 'status.age': 'value', age: '47' }));
  expect(res.status).toBe(400);
  expect(await res.text()).toContain(t('en', 'curator.fix.error.confirmRequired'));
});

it('refuses a field name that is not an affidavit field', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  expect((await page(c.candidateId, save('field:track_record', { valueEn: 'x' }))).status).toBe(400);
});

it('asks for the affidavit first when the candidate has none, and refuses a field save', async () => {
  const candidateId = await fx.bareCandidate(WARD_A.id);
  const html = await (await page(candidateId)).text();
  expect(html).toContain(t('en', 'curator.candidateEdit.fields.needAffidavit'));
  expect(html).not.toContain('value="field:age"');
  expect(html).toContain('value="affidavit"');
  const res = await page(candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
  expect(res.status).toBe(400);
  expect(await fieldRow(candidateId, 'age')).toBeUndefined();
});

it('keeps the English name when the core card is saved', async () => {
  const c = await fx.candidateWithAffidavit(WARD_A.id);
  const before = (await candidateRow(c.candidateId)).nameEn;
  const res = await page(c.candidateId, tokenForm(curator, { formAction: 'core', status: 'contesting', nameKn: 'ಹೆಸರು', partyKn: '', nameEn: 'Smuggled Name' }));
  expect(res.status).toBe(302);
  const row = await candidateRow(c.candidateId);
  expect(row.nameEn).toBe(before);
  expect(row.nameKn).toBe('ಹೆಸರು');
  expect(row.status).toBe('contesting');
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `TEST tests/routes/curator-candidate-fields.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the library changes in `src/lib/curator.ts`**

- Delete `REPORT_CARD_FIELD_KEYS`, `ReportCardFieldKey`, `ReportCardFieldEditRow`, `CandidateFieldOutcome`, `handleCandidateFieldPublish`, and `isHttpUrl` if now unused.
- `loadCandidateForEdit`: drop the `candidateFields` query and the `fields` record. After the core row, call `const fixCandidate = await loadFixCandidate(candidateId)` and set `pdfUrl: fixCandidate!.pdfUrl` and `fields: await loadFixFields(fixCandidate!)`.
- `handleCandidateCorePublish`: keep the status check first. Replace the `parseCandidateCoreForm` call with a parse of only `nameKn`, `partyKn` and the photo (extract the photo branch of `parseCandidateCoreForm` into `storePhotoFrom(actor, form): Promise<{ ok: true; photoMediaId?: number } | { ok: false; key: string }>` and have `parseCandidateCoreForm` call it too). Call `publishCandidateCore` without `nameEn`/`partyEn`. Rewrite the docstring: English name and party are the `full_name` and `party` fields, which have one writer.
- Add:

```ts
export type EditFixOutcome = { kind: 'saved' } | { kind: 'refused'; key: string; error?: FieldError; raw?: RawField };

/** Saves one affidavit field from the editor: the same rules as a flag fix, with no flag involved. */
export async function handleCandidateFieldFix(actor: CuratorActor, candidate: CandidateEditData, key: AffidavitFieldKey, form: FormData): Promise<EditFixOutcome> {
  if (!candidate.pdfUrl) return { kind: 'refused', key: 'curator.fix.error.noAffidavit' };
  const fixCandidate = (await loadFixCandidate(candidate.id))!;
  const parsed = parseFieldFix(form, key, await publishedFieldData(fixCandidate, key));
  if (!parsed.ok) return { kind: 'refused', key: parsed.key, error: parsed.error, raw: parsed.raw };
  await saveFieldFix(actor, candidate.id, parsed.data, candidate.pdfUrl);
  return { kind: 'saved' };
}

/** Moves the candidate to another ward from the editor. */
export async function handleCandidateWardFix(candidate: CandidateEditData, form: FormData): Promise<EditFixOutcome> {
  if (!candidate.pdfUrl) return { kind: 'refused', key: 'curator.fix.error.noAffidavit' };
  const parsed = await parseWardFix(form, candidate.wardId);
  if (!parsed.ok) return { kind: 'refused', key: parsed.key };
  await saveWardFix(candidate.id, parsed.wardId, candidate.pdfUrl);
  return { kind: 'saved' };
}
```

- [ ] **Step 4: Route twin and page**

`src/pages/curator/candidate/[id].astro`: the `field:` branch checks the key against `AFFIDAVIT_FIELD_KEYS` (bare 400 otherwise) and calls `handleCandidateFieldFix`; add a `ward` branch calling `handleCandidateWardFix`. On `refused`: `message = { kind: 'error', key }`, `responseStatus = 400`, and remember `refused = { formAction, error, raw }` to pass to the page. Load `wards` with `loadWardOptions()`.

`src/features/pages/curator/CandidateEdit.astro` (the edit mode; leave the create mode, which the same component renders for `/curator/candidate/new`, as it is, in a single column): wrap in `<CuratorSplit lang={lang} pdfUrl={candidate.pdfUrl}>` and render heading and ward line; message banner; the **core card** with photo, status, `nameKn`, `partyKn` (no English name or party inputs); then, when `candidate.pdfUrl`, a `fields.heading` section with one `<CuratorFieldForm formAction={`field:${field.key}`} field={field} label={t(lang, CANDIDATE_PROFILE_LABEL_KEYS[field.key])} confirmPath={`/ward/${candidate.wardId}`} submitLabel={t(lang, 'curator.candidateEdit.field.submit')} error={…} raw={…} />` per field (pass `error`/`raw` only to the form whose `formAction` was refused) and a `<CuratorWardForm formAction="ward" wards={wards} wardId={candidate.wardId} … submitLabel={t(lang, 'curator.fix.wardSubmit')} />`; when there is no `pdfUrl`, the single line `curator.candidateEdit.fields.needAffidavit`; then the **affidavit card**, unchanged.

- [ ] **Step 5: Remove the free-text publish path**

Run `grep -rnE "publishCandidateField\b|publishCandidateFieldTx" src scripts`. If the only remaining definitions are in `src/lib/publish.ts`, delete `publishCandidateField`, `publishCandidateFieldTx` and `PublishCandidateFieldInput` there, keeping `decideTranslationStatus`, `Actor`, the candidate core/create functions and `publishStance`. Then in the tests: delete the tests of those functions in `tests/unit/publish-candidate.test.ts`; in `tests/unit/translate-runtime.test.ts` and `tests/unit/affidavit-publish.test.ts` replace any use of them as set-up with a direct `db.insert(schema.candidateFields)` of the row the test needs, and delete tests whose subject was "a curator's free-text edit clears `value_data`" (that edit no longer exists). If something in `src` or `scripts` still calls them, leave them and say so in your report.

Update the comment above `candidateFields` in `src/db/schema.ts` and the `valueData` column comment only if they describe the removed path (comments only; no column changes).

- [ ] **Step 6: Update `tests/routes/curator-candidate.test.ts`**

Delete the tests of the five report-card field forms and of English name/party on the core form of the **edit** page; keep the create-page, photo, status and authorization tests, adjusting posted fields.

- [ ] **Step 7: Run the tests**

Run: `TEST tests/routes/curator-candidate-fields.test.ts tests/routes/curator-candidate.test.ts tests/routes/curator-candidate-affidavit.test.ts tests/unit/publish-candidate.test.ts tests/unit/translate-runtime.test.ts tests/unit/affidavit-publish.test.ts tests/unit/i18n.test.ts`, then `TYPECHECK`.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "Edit a candidate's affidavit fields and ward in the editor with the same structured forms as a flag fix"
```

---

### Task 7: Finding candidates

**Files:**
- Modify: `src/lib/curator.ts`, `src/pages/curator/index.astro`, `src/features/pages/curator/Dashboard.astro`, `src/pages/curator/ward/[id].astro`, `src/features/pages/curator/WardEdit.astro`, `src/layouts/CuratorLayout.astro`, `src/i18n/en.json`, `src/i18n/kn.json`
- Test: create `tests/routes/curator-search.test.ts`; modify `tests/routes/curator-ward.test.ts`

**Interfaces:**
- Produces, from `src/lib/curator.ts`:

```ts
export const SEARCH_CAP = 50;
export interface CandidateHit { id: number; nameEn: string; partyEn: string; status: CandidateStatus; wardId: number; wardNameEn: string; wardNameKn: string }
export interface CuratorSearch { candidates: CandidateHit[]; capped: boolean; wards: Array<{ id: number; nameEn: string; nameKn: string }> }
/** Null for a query under two characters. */
export async function searchCurator(q: string): Promise<CuratorSearch | null>;
export async function loadWardCandidates(wardId: number): Promise<Array<{ id: number; nameEn: string; partyEn: string; status: CandidateStatus }>>;
```

- `CuratorLayout.astro` gains a `<nav>` in the bar. This task adds the Queue link; Tasks 8 and 9 add theirs.

**i18n keys:**

| Key | English |
|---|---|
| `curator.layout.nav.label` | Curator sections |
| `curator.layout.nav.queue` | Flags |
| `curator.dashboard.search.heading` | Find a candidate or ward |
| `curator.dashboard.search.label` | Candidate name, ward name or ward number |
| `curator.dashboard.search.submit` | Search |
| `curator.dashboard.search.tooShort` | Type at least two characters. |
| `curator.dashboard.search.none` | Nothing matches "{q}". |
| `curator.dashboard.search.candidates` | Candidates |
| `curator.dashboard.search.wards` | Wards |
| `curator.dashboard.search.capped` | Showing the first {count}. Type more of the name to narrow it down. |
| `curator.dashboard.search.candidateLine` | {party} · {ward} · {status} |
| `curator.wardEdit.candidates.heading` | Candidates in this ward |
| `curator.wardEdit.candidates.none` | No candidates in this ward yet. |

Remove `curator.dashboard.quickLinks.*` and the unused `curator.dashboard.recentActivity.*` keys.

- [ ] **Step 1: Write the failing tests**

Create `tests/routes/curator-search.test.ts`:

```ts
/** `/curator?q=`: finding a candidate or a ward by name or number. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Fixtures, client, db, run, ward, type Auth } from './support/staff-harness';
import { SEARCH_CAP } from '../../src/lib/curator';
import { t } from '../../src/i18n';
import DashboardRoute from '../../src/pages/curator/index.astro';

// This suite owns ward id 99431.
const WARD = ward(99431, 'Zyxwv Search Test Ward');
const fx = new Fixtures('curator-search-test-');
let curator: Auth;
let alphaId: number;

const search = (q: string) => run(DashboardRoute, `/curator?q=${encodeURIComponent(q)}`, { auth: curator });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD);
  curator = await fx.person('curator');
  alphaId = await fx.bareCandidate(WARD.id, 'Qqsearch Alpha (FICTIONAL)');
  await fx.bareCandidate(WARD.id, 'Qqsearch 100%_Sure (FICTIONAL)');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

it('shows the search form and no results before a search', async () => {
  const html = await (await run(DashboardRoute, '/curator', { auth: curator })).text();
  expect(html).toContain('name="q"');
  expect(html).not.toContain(t('en', 'curator.dashboard.search.candidates'));
});

it('finds a candidate by part of the name, whatever the case, and links to the editor', async () => {
  const html = await (await search('qqSEARCH alp')).text();
  expect(html).toContain(`href="/curator/candidate/${alphaId}"`);
  expect(html).toContain('Qqsearch Alpha (FICTIONAL)');
  expect(html).not.toContain('100%_Sure');
});

it('finds a ward by name and by its id', async () => {
  expect(await (await search('Zyxwv Search')).text()).toContain(`href="/curator/ward/${WARD.id}"`);
  expect(await (await search(String(WARD.id))).text()).toContain(`href="/curator/ward/${WARD.id}"`);
});

it('treats % and _ as the characters they are', async () => {
  const hit = await (await search('100%_S')).text();
  expect(hit).toContain('100%_Sure');
  expect(hit).not.toContain('Qqsearch Alpha');
  expect(await (await search('Qqsearch A%a')).text()).toContain(t('en', 'curator.dashboard.search.none', { q: 'Qqsearch A%a' }));
});

it('asks for more than one character', async () => {
  expect(await (await search('q')).text()).toContain(t('en', 'curator.dashboard.search.tooShort'));
});

it('says so when nothing matches', async () => {
  expect(await (await search('zzznomatchzzz')).text()).toContain('zzznomatchzzz');
});

it('stops at the cap and says so', async () => {
  for (let i = 0; i < SEARCH_CAP + 1; i += 1) await fx.bareCandidate(WARD.id, `Capsearch Person ${String(i).padStart(2, '0')} (FICTIONAL)`);
  const html = await (await search('Capsearch')).text();
  expect(html.match(/Capsearch Person/g)).toHaveLength(SEARCH_CAP);
  expect(html).toContain(t('en', 'curator.dashboard.search.capped', { count: SEARCH_CAP }));
});

it('refuses a citizen', async () => {
  expect((await run(DashboardRoute, '/curator?q=alpha', { auth: await fx.person('citizen') })).status).toBe(403);
});
```

If the page HTML-escapes `%`, `"` or `&` in the echoed query, compare against the escaped form.

In `tests/routes/curator-ward.test.ts` add a test that `/curator/ward/{id}` lists each candidate of that ward with name, party and a link to `/curator/candidate/{id}`, lists no candidate of another ward, and shows `curator.wardEdit.candidates.none` for an empty ward, using that file's existing fixtures and `run` helper.

- [ ] **Step 2: Run and confirm they fail**

Run: `TEST tests/routes/curator-search.test.ts tests/routes/curator-ward.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the library**

In `src/lib/curator.ts` (import `ilike`, `or` from `drizzle-orm`):

```ts
export const SEARCH_CAP = 50;

/** `%`, `_` and `\` are what the person typed, not wildcards. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Candidates and wards whose name contains `q` (a ward also by its id). A
 * few thousand candidates and 369 wards: a sequential scan is enough.
 * Null for a query under two characters.
 */
export async function searchCurator(q: string): Promise<CuratorSearch | null> {
  const term = q.trim();
  if (term.length < 2) return null;
  const pattern = likePattern(term);

  const hits = await db
    .select({ id: candidates.id, nameEn: candidates.nameEn, partyEn: candidates.partyEn, status: candidates.status, wardId: wards.id, wardNameEn: wards.nameEn, wardNameKn: wards.nameKn })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(or(ilike(candidates.nameEn, pattern), ilike(candidates.nameKn, pattern)))
    .orderBy(candidates.nameEn, candidates.id)
    .limit(SEARCH_CAP + 1);

  const wardId = /^\d{1,9}$/.test(term) ? Number(term) : null;
  const wardHits = await db
    .select({ id: wards.id, nameEn: wards.nameEn, nameKn: wards.nameKn })
    .from(wards)
    .where(or(ilike(wards.nameEn, pattern), ilike(wards.nameKn, pattern), wardId === null ? undefined : eq(wards.id, wardId)))
    .orderBy(wards.id)
    .limit(SEARCH_CAP);

  return { candidates: hits.slice(0, SEARCH_CAP), capped: hits.length > SEARCH_CAP, wards: wardHits };
}

export async function loadWardCandidates(wardId: number) {
  return db
    .select({ id: candidates.id, nameEn: candidates.nameEn, partyEn: candidates.partyEn, status: candidates.status })
    .from(candidates)
    .where(eq(candidates.wardId, wardId))
    .orderBy(candidates.nameEn, candidates.id);
}
```

Postgres `ILIKE` uses backslash as its default escape character, so `likePattern` needs no `ESCAPE` clause.

- [ ] **Step 4: Pages**

`src/pages/curator/index.astro`: read `const q = Astro.url.searchParams.get('q') ?? ''`, `const search = q.trim() === '' ? undefined : await searchCurator(q)` (`undefined` = no search made, `null` = too short), pass `q` and `search` to `Dashboard`.

`Dashboard.astro`: replace the quick-links card with a search card: `<form method="get" action="/curator" role="search">` with a labelled `<input type="search" name="q" value={q} class="form-input">` and a submit button. Below it: `tooShort` when `search === null`; `none` (with `{q}`) when both lists are empty; otherwise a "Candidates" list (name linking to `/curator/candidate/{id}`, then `candidateLine` with party, ward name stripped of its number prefix, and the `curator.candidateEdit.core.status.{status}` label), the `capped` line when `search.capped`, and a "Wards" list linking to `/curator/ward/{id}`. Update the docstring: drop the "QUICK LINKS … coming soon" paragraph.

`src/pages/curator/ward/[id].astro` loads `loadWardCandidates(ward.id)` and passes it; `WardEdit.astro` renders a card `candidates.heading` with the list (name linking to the editor, party, status label) or `candidates.none`, placed above the card holding the issues and "add candidate" links.

`CuratorLayout.astro`: after the wordmark add

```astro
<nav class="curator-nav" aria-label={t(lang, 'curator.layout.nav.label')}>
  <a href="/curator/queue">{t(lang, 'curator.layout.nav.queue')}</a>
</nav>
```

with `.curator-bar { gap: var(--space-6); }` and `.curator-nav { display: flex; gap: var(--space-4); font-size: var(--text-sm); }`, links at least 44px tall (`display: inline-flex; align-items: center; min-height: 44px`). The bar must not overflow at 360px wide once Tasks 8 and 9 add two more links: let `.curator-nav` wrap (`flex-wrap: wrap`) and the bar grow (`min-height: 56px` instead of `height`). `CuratorSplit`'s `calc(100vh - 56px)` then assumes a one-line bar, which holds at 900px and above.

- [ ] **Step 5: Run the tests**

Run: `TEST tests/routes/curator-search.test.ts tests/routes/curator-ward.test.ts tests/routes/curator.test.ts tests/unit/i18n.test.ts`, then `TYPECHECK`.
Expected: PASS (fix any `curator.test.ts` dashboard assertion that looked for the removed quick links).

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "Let a curator search for a candidate or ward and see a ward's candidates"
```

---

### Task 8: Matching waiting affidavits

**Files:**
- Create: `src/lib/curator-matching.ts`, `src/pages/curator/matching/index.astro`, `src/pages/curator/matching/[id].astro`, `src/features/pages/curator/MatchList.astro`, `src/features/pages/curator/MatchItem.astro`, `tests/routes/curator-matching.test.ts`
- Modify: `src/lib/affidavit-queue.ts`, `src/lib/curator.ts` (`loadDashboard`), `src/features/pages/curator/Dashboard.astro`, `src/layouts/CuratorLayout.astro`, `src/i18n/en.json`, `src/i18n/kn.json`
- Guard: `tests/routes/admin-affidavits.test.ts` (unedited)

**Interfaces:**
- Consumes: `confirmMatch(actor: { userId; role }, id, input)` (Task 3), `CuratorSplit`, `loadWardOptions`, `WardOption`, `StaffActor`, the harness's `waitingAffidavit`.
- Produces, from `src/lib/affidavit-queue.ts`:
  - `loadMatchList(): Promise<MatchRow[]>` (every `needs_matching` affidavit, oldest first; `MatchRow` is the existing type)
  - `loadMatchItem(id: number): Promise<MatchRow | null>` (null unless that affidavit is `needs_matching`)
  - `countWaitingMatches(): Promise<number>`
  - `loadAffidavitAdmin()` unchanged in what it returns, rebuilt to call `loadMatchList()`.
- Produces, from `src/lib/curator-matching.ts`:
  - `type MatchOutcome = { kind: 'matched' } | { kind: 'gone' } | { kind: 'refused'; key: string }`
  - `handleMatchConfirm(actor: StaffActor, id: number, form: FormData): Promise<MatchOutcome>`
- `DashboardData` gains `matchCount: number`.

**i18n keys:**

| Key | English |
|---|---|
| `curator.layout.nav.matching` | Matching |
| `curator.dashboard.matchHeading` | Affidavits waiting for a match |
| `curator.dashboard.matchCount` | {count} waiting |
| `curator.dashboard.matchLink` | Open the matching list |
| `curator.matching.meta.title` | Matching · Curator |
| `curator.matching.meta.description` | Affidavits waiting to be matched to a candidate and ward |
| `curator.matching.heading` | Affidavits waiting for a match |
| `curator.matching.intro` | The AI read these but could not publish them, or a transcriber sent them back. Compare each with its PDF and confirm who it is and which ward they are contesting. |
| `curator.matching.none` | Nothing is waiting. |
| `curator.matching.colReason` | Why it is waiting |
| `curator.matching.colName` | Name as read |
| `curator.matching.colWard` | Ward as read |
| `curator.matching.colConfidence` | Confidence |
| `curator.matching.open` | Open |
| `curator.matching.reason.ward_unresolved` | Ward could not be worked out |
| `curator.matching.reason.possible_duplicate` | May be a candidate already here |
| `curator.matching.reason.reported_by_transcriber` | Sent back by a transcriber |
| `curator.matching.notice.matched` | Matched and published. |
| `curator.matching.notice.gone` | Someone else has already dealt with that affidavit. |
| `curator.matching.item.meta.title` | Match an affidavit · Curator |
| `curator.matching.item.heading` | Match affidavit #{id} |
| `curator.matching.item.back` | Back to the matching list |
| `curator.matching.item.read.heading` | What the AI read |
| `curator.matching.item.candidateLink` | The candidate it is published on |
| `curator.matching.item.form.heading` | Confirm who this is |
| `curator.matching.item.confirm` | I have checked this against the affidavit. It publishes immediately. |
| `curator.matching.item.unusable` | If this document is unusable or belongs to nobody standing, leave it waiting and tell the admin. |

Reuse the existing `admin.affidavits.match.*` keys for the field labels (`wardRead`, `wardNotRead`, `gender`, `confidence`, `transcriberNote`, `name`, `party`, `ward`, `wardChoose`, `attach`, `attachNew`, `submit`, `submitCorrection`, `stillPublished`) and `admin.affidavits.error.*` for refusals. `attachExisting` shows only name and id; add `curator.matching.item.attachExisting` = "Same person as {name} in {ward}" for the curator form.

- [ ] **Step 1: Write the failing tests**

Create `tests/routes/curator-matching.test.ts`:

```ts
/** `/curator/matching` and `/curator/matching/{id}`: a curator matches a waiting affidavit to a candidate and ward. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { t } from '../../src/i18n';
import ListRoute from '../../src/pages/curator/matching/index.astro';
import ItemRoute from '../../src/pages/curator/matching/[id].astro';

// This suite owns ward ids 99441 and 99442.
const WARD_A = ward(99441, 'Matching Test Ward A');
const WARD_B = ward(99442, 'Matching Test Ward B');
const fx = new Fixtures('curator-matching-test-');
let curator: Auth;

const list = (auth: Auth = curator) => run(ListRoute, '/curator/matching', { auth });
const item = (id: number | string, form?: FormData, auth: Auth = curator) => run(ItemRoute, `/curator/matching/${id}`, { auth, form, params: { id: String(id) } });
const confirm = (fields: Record<string, string>) => tokenForm(curator, { formAction: 'match', confirmPublish: 'on', ...fields });
const affidavitRow = async (id: number) => (await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD_A, WARD_B);
  curator = await fx.person('curator');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

describe('who may match', () => {
  it.each(['citizen', 'transcriber'] as const)('refuses a %s', async (role) => {
    expect((await list(await fx.person(role))).status).toBe(403);
  });

  it('admits an admin', async () => {
    expect((await list(await fx.person('admin'))).status).toBe(200);
  });
});

describe('the list', () => {
  it('shows every reason an affidavit waits, with what the AI read', async () => {
    const unresolved = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const duplicate = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'possible_duplicate' });
    const published = await fx.candidateWithAffidavit(WARD_A.id);
    const sentBack = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'reported_by_transcriber', candidateId: published.candidateId, note: 'This is ward B' });
    const res = await list();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    for (const a of [unresolved, duplicate, sentBack]) expect(html).toContain(`href="/curator/matching/${a.affidavitId}"`);
    for (const reason of ['ward_unresolved', 'possible_duplicate', 'reported_by_transcriber']) expect(html).toContain(t('en', `curator.matching.reason.${reason}`));
    expect(html).toContain(unresolved.extraction.identity.name.text!);
    expect(html).toContain('This is ward B');
  });
});

describe('one waiting affidavit', () => {
  it('shows the PDF beside the form, pre-filled with the name and party as read', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const html = await (await item(a.affidavitId)).text();
    expect(html).toContain(`src="${a.pdfUrl}#navpanes=0&amp;view=FitH"`);
    expect(html).toContain(`value="${a.extraction.identity.name.text}"`);
    expect(html).toContain('name="wardId"');
  });

  it('creates the candidate in the chosen ward, with the curator as the checker of the name', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId, confirm({ name: 'Matched Person (FICTIONAL)', party: 'Demo Party A', wardId: String(WARD_B.id) }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/curator/matching?notice=matched');
    const row = await affidavitRow(a.affidavitId);
    expect(row.state).toBe('published');
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, row.candidateId!));
    expect(candidate.wardId).toBe(WARD_B.id);
    expect(candidate.nameEn).toBe('Matched Person (FICTIONAL)');
    expect((await fieldRow(candidate.id, 'full_name'))!.checkedBy).toBe(curator.userId);
    expect((await fieldRow(candidate.id, 'age'))!.aiExtracted).toBe(true);
  });

  it('attaches a possible duplicate to the candidate it duplicates', async () => {
    const existing = await fx.candidateWithAffidavit(WARD_A.id);
    const name = existing.extraction.identity.name.text!;
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'possible_duplicate', name });
    const html = await (await item(a.affidavitId)).text();
    expect(html).toContain(`<option value="${existing.candidateId}"`);
    const res = await item(a.affidavitId, confirm({ name, party: 'Demo Party A', wardId: String(WARD_A.id), attachToCandidateId: String(existing.candidateId) }));
    expect(res.status).toBe(302);
    expect((await affidavitRow(a.affidavitId)).candidateId).toBe(existing.candidateId);
  });

  it('moves and renames the candidate of a sent-back affidavit', async () => {
    const published = await fx.candidateWithAffidavit(WARD_A.id);
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'reported_by_transcriber', candidateId: published.candidateId, note: 'Wrong ward' });
    const html = await (await item(a.affidavitId)).text();
    expect(html).toContain('Wrong ward');
    expect(html).toContain(`<option value="${WARD_A.id}" selected`);
    expect((await item(a.affidavitId, confirm({ name: 'Renamed Person (FICTIONAL)', party: 'Demo Party A', wardId: String(WARD_B.id) }))).status).toBe(302);
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, published.candidateId));
    expect(candidate.wardId).toBe(WARD_B.id);
    expect(candidate.nameEn).toBe('Renamed Person (FICTIONAL)');
  });

  it.each([
    ['no name', { name: ' ', party: 'P', wardId: '99441' }, 'admin.affidavits.error.nameRequired'],
    ['no party', { name: 'N', party: '', wardId: '99441' }, 'admin.affidavits.error.partyRequired'],
    ['no ward', { name: 'N', party: 'P', wardId: '' }, 'admin.affidavits.error.unknownWard'],
    ['a ward that does not exist', { name: 'N', party: 'P', wardId: '99999999' }, 'admin.affidavits.error.unknownWard'],
    ['a candidate that does not exist', { name: 'N', party: 'P', wardId: '99441', attachToCandidateId: '999999999' }, 'admin.affidavits.error.unknownCandidate'],
  ] as const)('refuses %s and leaves it waiting', async (_label, fields, key) => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId, confirm(fields));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', key));
    expect((await affidavitRow(a.affidavitId)).state).toBe('needs_matching');
  });

  it('refuses a confirm without the tick', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId, tokenForm(curator, { formAction: 'match', name: 'N', party: 'P', wardId: String(WARD_A.id) }));
    expect(res.status).toBe(400);
    expect((await affidavitRow(a.affidavitId)).state).toBe('needs_matching');
  });

  it.each(['retry', 'discard', 'upload'])('refuses the admin-only action %s', async (formAction) => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    expect((await item(a.affidavitId, tokenForm(curator, { formAction, affidavitId: String(a.affidavitId), confirm: 'on' }))).status).toBe(400);
    expect(await affidavitRow(a.affidavitId)).toBeDefined();
  });

  it('is not found once resolved, for an unknown id, and for a published affidavit', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    expect((await item(a.affidavitId, confirm({ name: 'Once (FICTIONAL)', party: 'P', wardId: String(WARD_A.id) }))).status).toBe(302);
    expect((await item(a.affidavitId)).status).toBe(404);
    expect((await item(999999999)).status).toBe(404);
    expect((await item('abc')).status).toBe(404);
    expect((await item((await fx.candidateWithAffidavit(WARD_A.id)).affidavitId)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `TEST tests/routes/curator-matching.test.ts`
Expected: FAIL, routes do not exist.

- [ ] **Step 3: Split the loaders in `src/lib/affidavit-queue.ts`**

Extract the body of `loadAffidavitAdmin` that builds `MatchRow`s into a private `matchRows(where: SQL): Promise<MatchRow[]>` that selects the `needs_matching` rows matching `where` (ordered by `candidateAffidavits.id`), reads every candidate's name once for the same-name suggestions only when there are rows, and maps each row exactly as today. Then:

```ts
/** Every affidavit waiting for a person to say who it is and where, oldest first. */
export async function loadMatchList(): Promise<MatchRow[]> {
  return matchRows(sql`true`);
}

/** One waiting affidavit, or null unless it is waiting (unknown, published, failed, or resolved a moment ago). */
export async function loadMatchItem(id: number): Promise<MatchRow | null> {
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
  return (await matchRows(eq(candidateAffidavits.id, id)))[0] ?? null;
}

export async function countWaitingMatches(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(candidateAffidavits).where(eq(candidateAffidavits.state, 'needs_matching'));
  return row?.n ?? 0;
}
```

`loadAffidavitAdmin` keeps its counts query, loads the failed rows with their own query (state `failed`, same columns and ordering as before), and sets `needsMatching: await loadMatchList()`. `MatchRow.sameName` entries already carry `wardId`.

- [ ] **Step 4: `src/lib/curator-matching.ts`**

```ts
/**
 * The curator's side of matching: confirming who a waiting affidavit
 * belongs to and which ward they are contesting. The work is
 * `confirmMatch` (src/lib/affidavit-queue.ts), shared with
 * `/admin/affidavits`; this module turns a posted form into that call and
 * its refusals into sentences. Upload, retry and discard are not here:
 * they are the admin's.
 */
import { confirmMatch, type AdminActionError } from './affidavit-queue';
import type { StaffActor } from './curator-fix';
import { logEvent } from './log';

export type MatchOutcome = { kind: 'matched' } | { kind: 'gone' } | { kind: 'refused'; key: string };

const ERROR_KEYS: Partial<Record<AdminActionError, string>> = {
  unknown_ward: 'admin.affidavits.error.unknownWard',
  name_required: 'admin.affidavits.error.nameRequired',
  party_required: 'admin.affidavits.error.partyRequired',
  unknown_candidate: 'admin.affidavits.error.unknownCandidate',
};

export async function handleMatchConfirm(actor: StaffActor, id: number, form: FormData): Promise<MatchOutcome> {
  if (form.get('confirmPublish') == null) return { kind: 'refused', key: 'curator.fix.error.confirmRequired' };
  const attachRaw = String(form.get('attachToCandidateId') ?? '').trim();
  try {
    await confirmMatch(actor, id, {
      wardId: Number(String(form.get('wardId') ?? '').trim() || NaN),
      name: String(form.get('name') ?? ''),
      party: String(form.get('party') ?? ''),
      attachToCandidateId: attachRaw === '' ? undefined : Number(attachRaw),
    });
  } catch (err) {
    const code = (err instanceof Error ? err.message : '') as AdminActionError;
    // Someone else confirmed it between this page loading and this save.
    if (code === 'not_waiting') return { kind: 'gone' };
    const key = ERROR_KEYS[code];
    if (!key) throw err;
    return { kind: 'refused', key };
  }
  logEvent('affidavit_matched', { affidavitId: id, by: actor.role });
  return { kind: 'matched' };
}
```

Check `confirmMatch` treats a non-integer or out-of-range `attachToCandidateId` (for example `NaN`, or `999999999`) as `unknown_candidate` rather than throwing a database error; if not, guard it in `confirmMatch` with the same integer-range check `loadMatchItem` uses. Use whichever event-logging call the neighbouring modules use (`logEvent` from `./log`), and never log the name.

- [ ] **Step 5: Routes and pages**

`src/pages/curator/matching/index.astro`: load `loadMatchList()` and the language; read `?notice=` against the fixed list `['matched', 'gone']` and pass `message`; `no-store`. GET only.

`src/pages/curator/matching/[id].astro`: 404 for a non-integer id or when `loadMatchItem` is null. On POST: `formAction !== 'match'` → bare 400 with `no-store`; otherwise `handleMatchConfirm`: `matched` → 302 to `/curator/matching?notice=matched`; `gone` → 302 to `/curator/matching?notice=gone`; `refused` → status 400, re-render with `message` and the posted `name`, `party`, `wardId`, `attachToCandidateId` shown back. Pass `wards` from `loadWardOptions()`.

`MatchList.astro`: `CuratorLayout`, heading, intro, banner for the notice, then a table (inside a horizontally scrollable wrapper so the page itself never scrolls sideways on a phone) with columns reason, name as read, ward as read (`row.wardRead ?? admin.affidavits.match.wardNotRead`), confidence (`{n}%` or `—`), and an Open link to `/curator/matching/{id}`. Under a sent-back row show the transcriber's note. `curator.matching.none` when empty.

`MatchItem.astro`: `<CuratorSplit lang={lang} pdfUrl={row.pdfUrl}>` containing: back link; `<h1>`; the reason; a "What the AI read" card (`<dl>`: ward as read, gender, confidence); for a row with `candidateId`, the transcriber's note, `admin.affidavits.match.stillPublished`, and a link to `/curator/candidate/{candidateId}`; the form card (`<form method="post">`, CSRF, `formAction=match`): name input, party input, ward select (`admin.affidavits.match.wardChoose` as the empty first option; `row.currentWardId` pre-selected), and, when `row.sameName.length > 0` and `row.candidateId === null`, a select `attachToCandidateId` with `admin.affidavits.match.attachNew` first and one option per same-name candidate labelled with `curator.matching.item.attachExisting` (`{name}`, `{ward}` from the ward options by id); the confirm checkbox (`curator.matching.item.confirm`, `name="confirmPublish"`, `required`); a primary submit (`admin.affidavits.match.submitCorrection` when `row.candidateId !== null`, else `admin.affidavits.match.submit`); and the `curator.matching.item.unusable` line.

Dashboard: `loadDashboard` adds `matchCount: await countWaitingMatches()`; `Dashboard.astro` gets a second card (heading, count, link to `/curator/matching`). `CuratorLayout.astro`: add `<a href="/curator/matching">{t(lang, 'curator.layout.nav.matching')}</a>` after the Flags link.

- [ ] **Step 6: Run the tests**

Run: `TEST tests/routes/curator-matching.test.ts tests/routes/admin-affidavits.test.ts tests/unit/affidavit-queue.test.ts tests/routes/curator.test.ts tests/routes/middleware.test.ts tests/unit/i18n.test.ts`, then `TYPECHECK`.
Expected: PASS, `admin-affidavits.test.ts` unedited.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Let curators match waiting affidavits to a candidate and ward"
```

---

### Task 9: The curator guide

**Files:**
- Create: `src/pages/curator/guide.astro`, `src/features/pages/curator/Guide.astro`
- Modify: `src/layouts/CuratorLayout.astro`, `src/features/pages/curator/Dashboard.astro`, `src/i18n/en.json`, `src/i18n/kn.json`
- Test: `tests/routes/curator.test.ts`

**Interfaces:**
- Consumes: `CuratorLayout`, `loadCuratorLang`. Model: `src/pages/transcribe/guide.astro` and `src/features/pages/transcribe/Guide.astro`.

**i18n keys:**

| Key | English |
|---|---|
| `curator.layout.nav.guide` | Guide |
| `curator.dashboard.guideLink` | Read the curator guide |
| `curator.guide.meta.title` | Curator guide |
| `curator.guide.meta.description` | What a curator is asked to do and the standard they work to |
| `curator.guide.back` | Back to the dashboard |
| `curator.guide.heading` | How to work as a curator |
| `curator.guide.lead` | Citizens tell us when something on a candidate's page looks wrong. You check what they say against the candidate's affidavit and either fix the page or explain why it stays as it is. |
| `curator.guide.flags.heading` | Answering a flag |
| `curator.guide.flags.1` | Open the flag from the Flags list. The affidavit is on the left; the citizen's comment and the published value are on the right. |
| `curator.guide.flags.2` | Find the value in the affidavit yourself. A citizen's suggestion or link is a lead, not a source. |
| `curator.guide.flags.3` | If the published value is wrong, type what the affidavit says and publish. The page changes within a minute. |
| `curator.guide.flags.4` | If the published value matches the affidavit, dismiss the flag and say why. |
| `curator.guide.reason.heading` | The reason is read by the person who flagged |
| `curator.guide.reason.body` | A dismissal reason appears on that citizen's own page. Write it to them, plainly: what the affidavit says and where. Never write a name, a phone number or a guess about their motives. |
| `curator.guide.never.heading` | Never guess |
| `curator.guide.never.body` | If you cannot read a value, choose "Could not be read". If the affidavit leaves it blank, choose "Not declared". Both are honest answers. A plausible number is not. |
| `curator.guide.ward.heading` | A candidate in the wrong ward |
| `curator.guide.ward.body` | A flag on the ward is fixed by moving the candidate to the ward the affidavit names. Their page, their place in the ward's list and any other open flags move with them. |
| `curator.guide.matching.heading` | Affidavits waiting for a match |
| `curator.guide.matching.body` | Some affidavits could not be published because the ward was unclear, the name matches a candidate already here, or a transcriber sent them back. Compare the name, party and ward the AI read with the PDF, choose the ward, and for a same-name candidate decide whether it is the same person. If you are not sure, leave it waiting: a wrong match overwrites another candidate's page and cannot be undone. |
| `curator.guide.notYours.heading` | What is not your job |
| `curator.guide.notYours.body` | You do not re-read affidavits nobody flagged, approve transcribers' work, upload affidavits or deal with ones the AI failed to read. If you come across a wrong value while working, you may correct it in the candidate editor. |
| `curator.guide.contact.heading` | When to tell the admin |
| `curator.guide.contact.body` | A document that is unusable, belongs to somebody who is not standing, or is missing altogether cannot be fixed from here. Leave it as it is and tell the admin which candidate or affidavit number it is. |

- [ ] **Step 1: Write the failing test**

In `tests/routes/curator.test.ts`, importing `GuideRoute from '../../src/pages/curator/guide.astro'` and using the file's `run` and session helpers:

```ts
describe('/curator/guide', () => {
  it('shows a curator the guide, uncached and unindexed', async () => {
    const res = await run(GuideRoute, '/curator/guide', { cookieValue: curatorSession.cookieValue });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain(t('en', 'curator.guide.heading'));
    expect(html).toContain(t('en', 'curator.guide.never.heading'));
    expect(html).toContain(t('en', 'curator.guide.matching.heading'));
    expect(html).toContain('<meta name="robots" content="noindex"');
  });

  it('refuses a citizen', async () => {
    expect((await run(GuideRoute, '/curator/guide', { cookieValue: citizenSession.cookieValue })).status).toBe(403);
  });

  it('links to every section from the bar', async () => {
    const html = await (await run(GuideRoute, '/curator/guide', { cookieValue: curatorSession.cookieValue })).text();
    for (const href of ['/curator/queue', '/curator/matching', '/curator/guide']) expect(html).toContain(`href="${href}"`);
  });
});
```

(`curatorSession` and `citizenSession` stand for however that file already holds its sessions.) Apostrophes and quotes in the strings may be HTML-escaped in the output; if an assertion fails for that reason, compare against the escaped form.

- [ ] **Step 2: Run and confirm it fails**

Run: `TEST tests/routes/curator.test.ts -t "/curator/guide"`
Expected: FAIL, cannot resolve the route.

- [ ] **Step 3: Implement**

`src/pages/curator/guide.astro`, following `src/pages/transcribe/guide.astro`: load the language, set `no-store`, render `<Guide lang={lang} />`.

`src/features/pages/curator/Guide.astro`:

```astro
---
/**
 * `/curator/guide` — what a curator is asked to do and the standard they
 * work to (docs/milestones.md §9, docs/candidate-data.md §4). Read once
 * before the first shift and again when a case is unclear.
 */
import CuratorLayout from '../../../layouts/CuratorLayout.astro';
import { t, type Lang } from '../../../i18n';

interface Props {
  lang: Lang;
}

const { lang } = Astro.props;
const STEPS = ['1', '2', '3', '4'];
const SECTIONS = ['reason', 'never', 'ward', 'matching', 'notYours', 'contact'];
---

<CuratorLayout lang={lang} title={t(lang, 'curator.guide.meta.title')} description={t(lang, 'curator.guide.meta.description')}>
  <article class="guide">
    <p><a href="/curator">{t(lang, 'curator.guide.back')}</a></p>
    <h1>{t(lang, 'curator.guide.heading')}</h1>
    <p class="lead">{t(lang, 'curator.guide.lead')}</p>

    <h2>{t(lang, 'curator.guide.flags.heading')}</h2>
    <ol>
      {STEPS.map((step) => <li>{t(lang, `curator.guide.flags.${step}`)}</li>)}
    </ol>

    {
      SECTIONS.map((section) => (
        <section class:list={{ never: section === 'never' }}>
          <h2>{t(lang, `curator.guide.${section}.heading`)}</h2>
          <p>{t(lang, `curator.guide.${section}.body`)}</p>
        </section>
      ))
    }
  </article>
</CuratorLayout>
```

Copy the `<style>` block from `src/features/pages/transcribe/Guide.astro` (`.guide`, `.lead`, list and `.never` rules) so the two guides look alike.

Add `<a href="/curator/guide">{t(lang, 'curator.layout.nav.guide')}</a>` to the bar in `CuratorLayout.astro`, and a `curator.dashboard.guideLink` link at the bottom of `Dashboard.astro`.

- [ ] **Step 4: Run the tests**

Run: `TEST tests/routes/curator.test.ts tests/unit/i18n.test.ts`, then `TYPECHECK`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "Add the curator guide and link every curator section from the bar"
```

---

### Task 10: Docs, seeds, E2E and the browser check

**Files:**
- Modify: `docs/candidate-data.md`, `docs/milestones.md`, `docs/architecture.md`, `AGENTS.md`, `scripts/seed-dev.ts`, `scripts/seed-e2e.ts`, `tests/e2e/flag.spec.ts`, `tests/unit/seeds.test.ts` (if it pins what the seeds write), `docs/superpowers/specs/2026-10-13-curator-functionality-design.md` (status line only)

- [ ] **Step 1: Bring the documents in line**

- `docs/candidate-data.md` §3: the sentence "Siva handles loading and source-file problems" becomes: loading, failed extractions and discarding unusable files are Siva's; curators match the affidavits that are waiting for a ward or a candidate. §4: the role statement becomes "Curators respond to user flags and match affidavits waiting for a candidate or ward"; in the "Curators do not routinely…" sentence remove "handle ingestion exceptions" and add that they do not upload, retry or discard affidavits. In "Workload and provision" add one sentence: the two-curator provision was sized on flags from 5% of candidates; matching volume depends on how often the AI cannot resolve a ward and is not in that estimate. Update the summary line near the top (item 4) and the sign-off note at the bottom so they do not contradict §4.
- `docs/milestones.md` §9: "The flag queue is the whole job" becomes the flag queue and the matching list; describe the flag fix as structured inputs beside the affidavit; add the matching list, the search and the guide to the list of what ships; in "Testable when", drop "mark the candidate complete" and move "Mark a candidate complete" to a line saying it was left out of this round (2026-10-13).
- `docs/architecture.md` §7 and `AGENTS.md`: where they say only an admin sets a ward or matches an affidavit, say a curator or an admin; where they say "a curator's free-text edit clears `value_data`", say curators now edit through the same structured inputs as transcribers and `publishAffidavitFields` is the only writer of field values; add `/curator/matching` and `/curator/guide` to the route descriptions; note that flags are accepted only on the eight fields in `FLAGGABLE_FIELD_KEYS`.
- The spec's status line becomes `**Status:** implemented 2026-10-13`.

Search for stragglers: `grep -rnE "free-text edit|track_record|approachability|ward_field|ward_issue|only an admin" docs AGENTS.md src --include=*.md --include=*.ts --include=*.astro` and fix prose that is now wrong (leave the DB enum and its comment).

- [ ] **Step 2: Make the dev seed exercise the new screens**

Read `scripts/seed-dev.ts`. Ensure that after `npm run seed:dev`:

- at least three seeded candidates have a `candidate_affidavits` row in state `published` pointing at the seeded PDF media, with their seven affidavit fields written through `publishAffidavitFields` (structured `value_data`), not as free-text rows. If the seed currently inserts `candidate_fields` directly, replace that insert for the seven affidavit keys with a `fieldsFromExtraction` + `publishAffidavitFields` call, keeping `ec_affidavit` and `ward` as they are;
- two pending flags exist on one of those candidates (one on `assets`, one on `ward`), from a seeded citizen, each with a comment;
- two `needs_matching` affidavits exist: one `ward_unresolved` with no candidate, one `reported_by_transcriber` attached to a seeded candidate with a note.

Each stored PDF needs its own `sha256` (`candidate_affidavits.sha256` is unique). Keep the seed idempotent in the way it already is. Update `tests/unit/seeds.test.ts` if it asserts the old shape. Run `TEST tests/unit/seeds.test.ts`.

- [ ] **Step 3: Update the E2E smoke spec**

`tests/e2e/flag.spec.ts` flags `track_record` and types into the old free-text accept form; both are gone. Change it to flag `age` (`targetRef = candidate:{id}:age`), and in the curator half to open the queue item, type a new age into the `age` input, tick the confirmation and press "Fix and publish", then assert the new age on the public candidate page. Make `scripts/seed-e2e.ts` give the flaggable candidate a `published` `candidate_affidavits` row and a structured `age` value (through `publishAffidavitFields`) so the fix form appears. Pick the new age so repeated local runs still change the value (for example alternate between two ages based on the current one read from the database). Run the three E2E steps from `AGENTS.md` ("E2E (Playwright)"); if the E2E environment cannot be brought up, say exactly which step failed and why in your report.

- [ ] **Step 4: Run the whole suite**

Run: `TEST` (no file argument), then `TYPECHECK`.
Expected: everything passes. A failure in a file this plan did not touch is still yours to explain: say whether it fails on `main` too.

- [ ] **Step 5: Check the screens in a browser**

`CLAUDE.md` requires this after any UI change. Bring the local stack up with the branch's code and the dev seed, sign in as a curator, and at **1440×900 and 390×844** look at each of: `/curator` (with and without `?q=`), `/curator/queue`, a queue item for a field flag, a queue item for a ward flag, `/curator/candidate/{id}` (with an affidavit and without), `/curator/ward/{id}`, `/curator/matching`, a matching item, `/curator/guide`, and `/transcribe/{id}` once more.

Check the rendered layout, not the CSS: column proportions and that the scan stays put while the form scrolls on desktop; on the phone that the panes stack, the PDF is a link, nothing overflows horizontally (`document.documentElement.scrollWidth <= window.innerWidth`), the nav bar wraps cleanly, controls are at least 44px tall, text wraps inside its card; focus rings on inputs, status pills and buttons; inputs greying out when the status is not "value"; the assets total updating. Fix what is wrong and re-check. The browser tooling may be attached to the user's real Chrome: reset any viewport emulation when you finish, and say in your report which screens you looked at and at which sizes.

- [ ] **Step 6: Commit**

```bash
git add -A docs AGENTS.md scripts tests src
git commit -m "Bring the docs, seeds and smoke test in line with what curators now do"
```
