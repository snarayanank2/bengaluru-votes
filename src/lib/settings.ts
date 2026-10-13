/**
 * app_settings reader — election anchors, wording versions (src/db/schema.ts:
 * `appSettings`, keyed `key text PK -> value text`).
 *
 * CACHE-SAFETY: these values are read at request time on SERVER-rendered
 * public pages (e.g. Home). That is safe under nginx's anonymous-page
 * micro-cache because the value is the SAME for every visitor — it's
 * global election state (notification date, roll deadline, ...), not
 * per-session/per-user data. This module must never read cookies/session;
 * doing so would make a page's HTML vary per-visitor while still being
 * served from a single cached variant (see layouts/Base.astro's own
 * cache-safety note for the same rule applied to auth state).
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Every key this platform currently reads/writes in app_settings. Keeping
 * this list in one place lets callers use `getKnownSetting` with
 * compiler-checked keys instead of a free-text string.
 */
export const SETTING_KEYS = [
  'notification_date',
  'election_date',
  'roll_deadline',
  'scrutiny_complete_date',
  'withdrawals_closed',
  'consent_wording_version',
  'data_page_live',
  'results_declared_at',
  // Task 21 guide pages' guided link-out URLs — dependency register §4.8,
  // "INPUT NEEDED" in the corresponding content/pages/en/*.md file until an
  // admin fills these in. Absent -> the page shows a pending-note
  // placeholder rather than inventing a URL (src/components/ExternalLinkOut.astro).
  'roll_lookup_url',
  'form6_url',
  'form8_url',
  'booth_lookup_url',
  // Task 54's F1 (booth/timings/what-to-carry) send needs a citywide poll
  // open/close time to fill its `{{2}}`/`{{3}}` placeholders (docs/messages.md
  // §10). No such fact exists anywhere else in this schema (booths carries
  // per-booth location, never per-booth hours, and poll hours are the same
  // for every booth on election day) — same "admin fills this in, page/send
  // defers gracefully until then" pattern as roll_lookup_url etc above.
  // Absent -> src/lib/send/calendar.ts defers F1 entirely for this run
  // rather than inventing a time (see that file's module docstring).
  'poll_open_time',
  'poll_close_time',
  // The transcriber queue hands out affidavits whose AI confidence is below
  // this (0-100) before the rest (src/lib/transcribe.ts). Absent -> 70, a
  // placeholder until the Kannada pilot sets it (docs/candidate-data.md §2).
  'low_confidence_threshold',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** A single setting's value, or `null` when the row is absent. */
export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

/**
 * Batch read. Every requested key is present in the result (as `null` when
 * the row doesn't exist), so callers can destructure without an `in` check.
 */
export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const key of keys) result[key] = null;
  if (keys.length === 0) return result;

  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  for (const row of rows) result[row.key] = row.value;
  return result;
}

/** Typed convenience wrapper over `getSetting` for the known settings keys above. */
export async function getKnownSetting(key: SettingKey): Promise<string | null> {
  return getSetting(key);
}
