/**
 * The signed-in staff member's own account page (`/account`): what to show
 * and the one thing they can change, the language the staff screens render
 * in (`users.language`, read everywhere by `loadCuratorLang`).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import type { Lang } from '../i18n';
import type { Role } from './session';

export interface AccountView {
  email: string | null;
  role: Role;
  language: Lang;
}

/** `null` when the user row no longer resolves (the route twin then sends them to sign in again). */
export async function loadAccount(userId: number): Promise<AccountView | null> {
  const [row] = await db.select({ email: users.email, role: users.role, language: users.language }).from(users).where(eq(users.id, userId));
  return row ?? null;
}

/** Parses the posted language; anything but `en` or `kn` is refused. */
export function parseLanguage(value: FormDataEntryValue | null): Lang | null {
  return value === 'en' || value === 'kn' ? value : null;
}

export async function saveLanguage(userId: number, language: Lang): Promise<void> {
  await db.update(users).set({ language }).where(eq(users.id, userId));
}
