/**
 * Client behaviour for affidavit field groups (`fieldset[data-field]`)
 * wherever they are rendered: inputs are disabled unless the status is
 * "value", and an assets group shows its running total. Each fieldset is
 * handled on its own, so a page may hold several, in one form or many.
 */

/** Whole rupees in Indian digit grouping, matching the server's `formatInr`. */
function formatInr(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
}

function parseWhole(text: string): number | null {
  const digits = text.replace(/[,\s]/g, '');
  return /^\d{1,15}$/.test(digits) ? Number(digits) : null;
}

export function syncStatus(field: HTMLFieldSetElement): void {
  const chosen = field.querySelector<HTMLInputElement>('input[type="radio"]:checked');
  const hasValue = !chosen || chosen.value === 'value';
  field.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-inputs] input, [data-inputs] select').forEach((input) => {
    input.disabled = !hasValue;
  });
}

export function syncTotal(root: ParentNode): void {
  const total = root.querySelector<HTMLElement>('[data-assets-total]');
  if (!total) return;
  const parts = Array.from(root.querySelectorAll<HTMLInputElement>('[data-assets-part]')).map((input) => parseWhole(input.value));
  total.textContent = parts.length === 2 && parts.every((part) => part !== null) ? formatInr(parts[0]! + parts[1]!) : '—';
}

/**
 * After a refused save the page comes back with the error summary at the top
 * and the offending fields far below it, so focus goes to the first control
 * marked invalid (design-system §7.10): a keyboard or screen-reader user lands
 * where the problem is and hears its error through `aria-describedby`.
 */
export function focusFirstInvalid(): void {
  document.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
}

export function initAffidavitFields(): void {
  document.querySelectorAll<HTMLFieldSetElement>('fieldset[data-field]').forEach((field) => {
    syncStatus(field);
    syncTotal(field);
    field.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'radio') syncStatus(field);
    });
    field.addEventListener('input', () => syncTotal(field));
  });
  focusFirstInvalid();
}
