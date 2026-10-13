// @vitest-environment jsdom
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
