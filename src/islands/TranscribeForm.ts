/**
 * TranscribeForm — progressive enhancement for the transcriber's reading
 * screen (src/features/pages/transcribe/Reading.astro). The form posts and
 * validates entirely on the server; this only makes it harder to get wrong:
 *
 *   - choosing "Not declared" or "Cannot read" greys out that field's
 *     inputs, since no value goes with those answers;
 *   - the assets total is recomputed as the two parts are typed;
 *   - Save is disabled until the form-wide confirmation is ticked (the
 *     server still refuses an unticked save);
 *   - the time left on the hold counts down.
 *
 * A plain bundled module imported from the page's own `<script>` tag, like
 * the other islands: never an inline script, and it carries no data of its
 * own. Everything it needs is in `data-` attributes the server rendered.
 */

import { syncStatus, syncTotal } from './AffidavitFields';

function startCountdown(): void {
  const el = document.querySelector<HTMLElement>('[data-expires-at]');
  if (!el) return;
  const expires = Date.parse(el.dataset.expiresAt ?? '');
  const template = el.dataset.minutesTemplate ?? '{minutes}';
  if (Number.isNaN(expires)) return;
  const tick = () => {
    if (Date.now() >= expires) {
      window.location.replace('/transcribe?expired=1');
      return;
    }
    const minutes = Math.max(0, Math.ceil((expires - Date.now()) / 60000));
    el.textContent = template.replace('{minutes}', String(minutes));
    el.toggleAttribute('data-ending', minutes <= 5);
  };
  tick();
  window.setInterval(tick, 1000);
}

function syncSaveButton(form: HTMLFormElement): void {
  const tick = form.querySelector<HTMLInputElement>('[data-confirm-tick]');
  const save = form.querySelector<HTMLButtonElement>('[data-save-button]');
  const hint = form.querySelector<HTMLElement>('[data-save-hint]');
  if (!tick || !save) return;
  const sync = () => {
    save.disabled = !tick.checked;
    if (hint) hint.hidden = tick.checked;
  };
  tick.addEventListener('change', sync);
  sync();
}

export function initTranscribeForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-transcribe-form]');
  if (!form) return;

  form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-field]').forEach((field) => {
    syncStatus(field);

    field.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.type === 'radio') syncStatus(field);
    });
  });

  syncSaveButton(form);
  form.addEventListener('input', () => syncTotal(form));
  syncTotal(form);
  startCountdown();
}
