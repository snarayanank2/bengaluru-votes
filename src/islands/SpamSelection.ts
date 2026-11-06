/**
 * SpamSelection — progressive enhancement for the flag review page's spam
 * section (src/features/pages/curator/QueueItem.astro). The per-report
 * "Mark as spam" ticks live beside each report but belong to the spam form
 * (`form="flag-spam-form"`); this keeps that form's button disabled until at
 * least one is ticked. The server still refuses an empty selection, and
 * without the script the button stays usable.
 */

export function initSpamSelection(): void {
  const form = document.querySelector<HTMLFormElement>('[data-spam-form]');
  const submit = form?.querySelector<HTMLButtonElement>('[data-spam-submit]');
  if (!form || !submit) return;

  const hint = form.querySelector<HTMLElement>('[data-spam-hint]');
  const ticks = document.querySelectorAll<HTMLInputElement>('[data-spam-tick]');

  const sync = () => {
    const any = Array.from(ticks).some((tick) => tick.checked);
    submit.disabled = !any;
    if (hint) hint.hidden = any;
  };

  ticks.forEach((tick) => tick.addEventListener('change', sync));
  sync();
}
