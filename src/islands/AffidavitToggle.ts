/**
 * AffidavitToggle — progressive enhancement for `CuratorSplit` with
 * `collapsible`. Reveals the "Hide affidavit" control (rendered hidden, so
 * a page without the script keeps the affidavit open and shows no dead
 * button) and toggles the `split--scan-hidden` class on the split. The
 * button's label and `aria-expanded` follow the state; the labels come from
 * `data-` attributes the server rendered in the page's language.
 */

export function initAffidavitToggle(): void {
  document.querySelectorAll<HTMLElement>('[data-affidavit-tools]').forEach((tools) => {
    const split = tools.closest<HTMLElement>('.split');
    const button = tools.querySelector<HTMLButtonElement>('[data-affidavit-toggle]');
    if (!split || !button) return;

    const label = button.querySelector<HTMLElement>('.btn-label');
    button.setAttribute('aria-expanded', 'true');
    if (button.dataset.controls) button.setAttribute('aria-controls', button.dataset.controls);

    button.addEventListener('click', () => {
      const hidden = split.classList.toggle('split--scan-hidden');
      button.setAttribute('aria-expanded', String(!hidden));
      if (label) label.textContent = (hidden ? button.dataset.showLabel : button.dataset.hideLabel) ?? '';
    });

    tools.hidden = false;
  });
}
