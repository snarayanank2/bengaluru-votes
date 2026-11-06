/**
 * GatedSubmit — progressive enhancement for `PublishConfirm.astro`
 * (design-system §7.3, "Gated submit"). Keeps each form's gated submit
 * button disabled until that form's confirmation checkbox is ticked and
 * shows the hint while it is not. The server still refuses an unticked
 * submit, and without the script the button stays usable.
 */
export function initGatedSubmit(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-gated-submit]').forEach((submit) => {
    // The unit may sit outside its form's element (`form="id"`), so find it through the submit button.
    const unit = submit.closest<HTMLElement>('.confirm-unit') ?? submit.form;
    const tick = unit?.querySelector<HTMLInputElement>('[data-confirm-tick]');
    if (!tick) return;
    const hint = unit?.querySelector<HTMLElement>('[data-gated-hint]');

    const sync = () => {
      submit.disabled = !tick.checked;
      if (hint) hint.hidden = tick.checked;
    };
    tick.addEventListener('change', sync);
    sync();
  });
}
