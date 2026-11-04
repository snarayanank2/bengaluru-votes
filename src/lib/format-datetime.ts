import type { Lang } from '../i18n';

/**
 * A moment as staff read it: "4 Nov 2026, 6:46 pm" (India time, the
 * operators' clock), in the page's language. Curator screens use this
 * instead of `toISOString()`, which printed `2026-11-04T13:16:41.954Z`.
 */
export function formatDateTime(lang: Lang, date: Date): string {
  return new Intl.DateTimeFormat(lang === 'kn' ? 'kn-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
