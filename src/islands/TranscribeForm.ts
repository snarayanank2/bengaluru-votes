/**
 * TranscribeForm — progressive enhancement for the transcriber's reading
 * screen (src/features/pages/transcribe/Reading.astro). The form posts and
 * validates entirely on the server; this only makes it harder to get wrong:
 *
 *   - choosing "Not declared" or "Cannot read" greys out that field's
 *     inputs, since no value goes with those answers;
 *   - the assets total is recomputed as the two parts are typed;
 *   - the time left on the hold counts down, warns visibly at five minutes
 *     and announces itself to assistive technology at five and at one minute
 *     (design-system §7.13, "Hold timer"); when it runs out the page returns
 *     to Start, where the expiry is explained.
 *
 * (Save gated on the confirmation is src/islands/GatedSubmit.ts.)
 *
 * A plain bundled module imported from the page's own `<script>` tag, like
 * the other islands: never an inline script, and it carries no data of its
 * own. Everything it needs is in `data-` attributes the server rendered.
 */

import { focusFirstInvalid, syncStatus, syncTotal } from './AffidavitFields';

/** Minutes left at which the warning is announced; the visible warning shows from the first. */
const ANNOUNCE_AT = [5, 1];

export interface CountdownEnv {
  /** The clock; tests pass a fake one. */
  now?: () => number;
  /** Where the page goes when the hold runs out. */
  redirect?: (url: string) => void;
}

/** Starts the hold countdown on the page's `[data-expires-at]` element. Exported so the timer logic can be tested. */
export function startCountdown(env: CountdownEnv = {}): void {
  const now = env.now ?? Date.now;
  const redirect = env.redirect ?? ((url: string) => window.location.replace(url));
  const el = document.querySelector<HTMLElement>('[data-expires-at]');
  if (!el) return;
  const expires = Date.parse(el.dataset.expiresAt ?? '');
  const template = el.dataset.minutesTemplate ?? '{minutes}';
  if (Number.isNaN(expires)) return;

  const warning = document.querySelector<HTMLElement>('[data-timer-warning]');
  const live = document.querySelector<HTMLElement>('[data-timer-announce]');
  const warningTemplate = warning?.dataset.warningTemplate ?? '{minutes}';
  const announced = new Set<number>();

  const tick = () => {
    if (now() >= expires) {
      redirect('/transcribe?expired=1');
      return;
    }
    const minutes = Math.max(0, Math.ceil((expires - now()) / 60000));
    el.textContent = template.replace('{minutes}', String(minutes));
    const ending = minutes <= ANNOUNCE_AT[0]!;
    el.toggleAttribute('data-ending', ending);

    if (warning) {
      warning.hidden = !ending;
      if (ending) warning.textContent = warningTemplate.replace('{minutes}', template.replace('{minutes}', String(minutes)));
    }
    const mark = ANNOUNCE_AT.find((at) => minutes <= at && !announced.has(at));
    if (mark !== undefined && live) {
      ANNOUNCE_AT.filter((at) => at >= mark).forEach((at) => announced.add(at));
      live.textContent = warningTemplate.replace('{minutes}', template.replace('{minutes}', String(minutes)));
    }
  };
  tick();
  window.setInterval(tick, 1000);
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

  form.addEventListener('input', () => syncTotal(form));
  syncTotal(form);
  startCountdown();
  focusFirstInvalid();
}
