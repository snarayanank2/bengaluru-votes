# Master-Password Login and Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff sign in with a temporary shared master password while email OTP is unavailable, and let an admin add users with a role, including a new `transcriber` role.

**Architecture:** One new module, `src/lib/master-login.ts`, owns the whole password mechanism; it is switched on by the `MASTER_PASSWORD` environment variable and read at call time. The login flow, the middleware and five page files each gain a single conditional on `masterLoginEnabled()`, so removal is mechanical. Admin work extends the existing `src/lib/admin.ts` and the `/admin/users`, `/admin/roles` and `/admin` screens.

**Tech Stack:** Astro 5 SSR (Node adapter), TypeScript, Drizzle ORM on Postgres 16, Vitest with Astro's container API, nginx.

**Spec:** `docs/superpowers/specs/2026-10-13-master-password-admin-design.md`

## Global Constraints

- **The master password is temporary: it exists only until email works for OTP.** Every code comment and doc note that introduces it says so.
- `MASTER_PASSWORD` set means password mode; unset or empty means OTP mode, with behaviour identical to today. No second flag.
- A set `MASTER_PASSWORD` shorter than 16 characters throws `MASTER_PASSWORD must be at least 16 characters`.
- The master password signs in an **existing, active** account only. It never creates a user.
- Wrong password, unknown contact and non-active account are indistinguishable to the caller: one result, one message.
- Never log a contact (email or phone) or the password. Log opaque user ids only.
- Sessions stay at 1 hour sliding. Do not build the 24-hour staff session.
- No new npm dependencies.
- New UI strings go in `src/i18n/en.json` with a `__hints` entry, and in `src/i18n/kn.json` with a `__hashes` entry. `npm run translate -- --check` must pass.
- Work on a branch, not `main`: `git switch -c master-password-admin` before Task 1.
- Tests need their own database. Use this prefix for every Vitest command in this plan (start Postgres first with `docker compose -f deploy/compose.local.yml up -d postgres`):

  ```sh
  DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run <file>
  ```

- After any UI change, inspect the live page at desktop and mobile widths (project `CLAUDE.md`). Task 8 does this.

## Review Focus

1. **A contact typed with different case or surrounding spaces** (`  Admin@Example.COM `) should sign in to the same account. Pinned in Task 1.
2. **A password that differs only by trailing whitespace** (a paste that picked up a space) should be rejected like any wrong password, and an empty or missing password field should fail cleanly without a 500. Pinned in Tasks 1 and 2.
3. **A hostile `next` value on the password form** (`https://evil.example`, `//evil.example`) should land on `/`, never off-site. Pinned in Task 2.
4. **Adding a user whose email already exists**, including as a citizen or in different case, should report "already exists" and leave that account's role untouched. Pinned in Tasks 6 and 7.
5. **An anonymous visitor clicking "report an error" in password mode** should reach `/login` (or `/kn/login` on a Kannada page) with a `next` back to where they were, not a dead click. Pinned in Task 4.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/master-login.ts` | Create | The temporary password mechanism: enabled check, constant-time compare, session creation |
| `src/lib/login-flow.ts` | Modify | One early branch to the password path; `passwordMode` on the render state |
| `src/features/pages/Login.astro` | Modify | Render the password form in password mode |
| `src/middleware.ts` | Modify | Evaluate the mode per request; 404 `/api/otp` in password mode |
| `src/layouts/Base.astro` | Modify | Omit the Register/Login modal in password mode |
| `src/features/pages/Ward.astro`, `WardCandidates.astro`, `Compare.astro` | Modify | Omit register-for-updates slots in password mode |
| `src/islands/FlagModal.ts` | Modify | Fall back to `/login` when the Register/Login modal is absent |
| `src/db/schema.ts`, `drizzle/0011_add_transcriber_role.sql` | Modify / Create | `transcriber` enum value |
| `src/lib/email.ts` | Create | `isValidEmail`, dependency-free |
| `scripts/seed-admin.ts` | Modify | Re-export `isValidEmail` from the lib |
| `src/lib/admin.ts` | Modify | `StaffRole`, `addUser`, `listStaff`, transcriber count |
| `src/pages/admin/users.astro`, `src/features/pages/admin/Users.astro` | Modify | Add-user action and card |
| `src/pages/admin/roles.astro`, `src/features/pages/admin/Roles.astro` | Modify | Transcriber in grant select and lists |
| `src/features/pages/admin/Console.astro` | Modify | Transcriber count |
| `src/i18n/en.json`, `src/i18n/kn.json` | Modify | New strings |
| `deploy/nginx/snippets/rate-limits.conf`, `deploy/nginx/conf.d/site.conf` | Modify | `login` rate zone |
| `deploy/compose.local.yml`, `deploy/runbook.md` | Modify | The variable, locally and documented |
| `docs/architecture.md`, `AGENTS.md`, `docs/overview.md`, `docs/milestones.md` | Modify | Record the temporary mechanism and what M6 shipped |

---

### Task 1: The master-login module

**Files:**
- Create: `src/lib/master-login.ts`
- Test: `tests/unit/master-login.test.ts`

**Interfaces:**
- Consumes: `normalizeDestination(destination: string): string` from `src/lib/otp.ts`; `createSession(userId: number): Promise<{ id: string; cookieValue: string; setCookie: string }>` from `src/lib/session.ts`; `logEvent(event: string, fields?: Record<string, unknown>): void` from `src/lib/log.ts`.
- Produces:
  - `MASTER_PASSWORD_MIN_LENGTH = 16`
  - `masterLoginEnabled(): boolean` (throws if the variable is set but too short)
  - `type MasterLoginResult = { ok: true; setCookie: string } | { ok: false }`
  - `loginWithMasterPassword(destinationRaw: string, password: string): Promise<MasterLoginResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/master-login.test.ts`:

```ts
/**
 * src/lib/master-login.ts — the TEMPORARY master-password login, in place
 * only until email works for OTP. Real Postgres, no mocks: the module's
 * whole job is "right password + existing active user -> a real session".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/lib/session';
import { masterLoginEnabled, loginWithMasterPassword } from '../../src/lib/master-login';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const PASSWORD = 'unit-test-master-password-0001';
const EMAILS = {
  admin: 'master-login-test-admin@example.com',
  banned: 'master-login-test-banned@example.com',
};
const CITIZEN_PHONE = '+919900055501';

let adminId: number;
let bannedId: number;
let phoneCitizenId: number;

async function sessionCount(userId: number): Promise<number> {
  const rows = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(inArray(schema.sessions.userId, [userId]));
  return rows.length;
}

describe('src/lib/master-login.ts (temporary)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    const upsert = async (values: typeof schema.users.$inferInsert, target: 'email' | 'phone') => {
      const [row] = await db
        .insert(schema.users)
        .values(values)
        .onConflictDoUpdate({ target: schema.users[target], set: values })
        .returning({ id: schema.users.id });
      return row!.id;
    };
    adminId = await upsert({ email: EMAILS.admin, role: 'admin', status: 'active' }, 'email');
    bannedId = await upsert({ email: EMAILS.banned, role: 'curator', status: 'banned' }, 'email');
    phoneCitizenId = await upsert({ phone: CITIZEN_PHONE, role: 'citizen', status: 'active' }, 'phone');
  });

  afterEach(async () => {
    delete process.env.MASTER_PASSWORD;
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, bannedId, phoneCitizenId]));
  });

  afterAll(async () => {
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, bannedId, phoneCitizenId]));
    await client.end();
  });

  describe('masterLoginEnabled', () => {
    it('is false when MASTER_PASSWORD is unset', () => {
      expect(masterLoginEnabled()).toBe(false);
    });

    it('is false when MASTER_PASSWORD is empty', () => {
      process.env.MASTER_PASSWORD = '';
      expect(masterLoginEnabled()).toBe(false);
    });

    it('is true for a password of 16 or more characters', () => {
      process.env.MASTER_PASSWORD = 'x'.repeat(16);
      expect(masterLoginEnabled()).toBe(true);
    });

    it('throws for a password shorter than 16 characters', () => {
      process.env.MASTER_PASSWORD = 'x'.repeat(15);
      expect(() => masterLoginEnabled()).toThrow('MASTER_PASSWORD must be at least 16 characters');
    });
  });

  describe('loginWithMasterPassword', () => {
    it('returns ok:false when password mode is off, even with a matching string', async () => {
      const result = await loginWithMasterPassword(EMAILS.admin, PASSWORD);
      expect(result.ok).toBe(false);
      expect(await sessionCount(adminId)).toBe(0);
    });

    it('right password + active user -> a session cookie and a sessions row', async () => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword(EMAILS.admin, PASSWORD);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.setCookie).toContain(`${SESSION_COOKIE}=`);
      expect(await sessionCount(adminId)).toBe(1);
    });

    it('normalizes the contact: mixed case and surrounding spaces still match', async () => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword('  Master-Login-Test-Admin@Example.COM ', PASSWORD);
      expect(result.ok).toBe(true);
    });

    it('signs in a citizen by phone number', async () => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword(` ${CITIZEN_PHONE} `, PASSWORD);
      expect(result.ok).toBe(true);
      expect(await sessionCount(phoneCitizenId)).toBe(1);
    });

    it.each([
      ['a wrong password', EMAILS.admin, 'not-the-master-password-0001'],
      ['the right password plus a trailing space', EMAILS.admin, `${PASSWORD} `],
      ['an empty password', EMAILS.admin, ''],
      ['an unknown contact', 'master-login-test-nobody@example.com', PASSWORD],
      ['an empty contact', '', PASSWORD],
      ['a banned account', EMAILS.banned, PASSWORD],
    ])('%s -> ok:false and no session', async (_label, destination, password) => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword(destination, password);
      expect(result).toEqual({ ok: false });
      expect(await sessionCount(adminId)).toBe(0);
      expect(await sessionCount(bannedId)).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/unit/master-login.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/master-login`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/master-login.ts`:

```ts
/**
 * TEMPORARY master-password login. In place ONLY until email works for
 * OTP (docs/architecture.md §7, §13) — then this file is deleted, along
 * with its one branch in src/lib/login-flow.ts.
 *
 * `MASTER_PASSWORD` set -> password mode: anyone holding the password can
 * sign in as any EXISTING, ACTIVE account, of any role. It never creates
 * a user. Unset or empty -> OTP mode, exactly as before.
 *
 * The variable is read at call time rather than at module load, so the
 * mode can be flipped per test and so a too-short value throws on the very
 * next request (src/middleware.ts calls `masterLoginEnabled()` on every
 * one) instead of running silently with a guessable password.
 *
 * NON-DISCLOSURE: a wrong password, an unknown contact and a banned or
 * erased account all return the same `{ ok: false }`.
 *
 * PRIVACY: logs carry an opaque user id only — never the contact, never
 * the password.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { logEvent } from './log';
import { normalizeDestination } from './otp';
import { createSession } from './session';

export const MASTER_PASSWORD_MIN_LENGTH = 16;

export type MasterLoginResult = { ok: true; setCookie: string } | { ok: false };

function configuredPassword(): string | null {
  const value = process.env.MASTER_PASSWORD ?? '';
  if (value === '') return null;
  if (value.length < MASTER_PASSWORD_MIN_LENGTH) {
    throw new Error(`MASTER_PASSWORD must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters`);
  }
  return value;
}

export function masterLoginEnabled(): boolean {
  return configuredPassword() !== null;
}

/** SHA-256 first, so `timingSafeEqual` always gets two equal-length buffers. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export async function loginWithMasterPassword(destinationRaw: string, password: string): Promise<MasterLoginResult> {
  const configured = configuredPassword();
  if (configured === null) return { ok: false };

  const passwordOk = timingSafeEqual(digest(password), digest(configured));

  const destination = normalizeDestination(destinationRaw);
  const [user] =
    destination === ''
      ? []
      : await db
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(or(eq(users.email, destination), eq(users.phone, destination)));

  if (!passwordOk || !user || user.status !== 'active') {
    logEvent('master_login_failed', { userId: user?.id ?? null });
    return { ok: false };
  }

  const session = await createSession(user.id);
  logEvent('master_login_succeeded', { userId: user.id });
  return { ok: true, setCookie: session.setCookie };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/unit/master-login.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/master-login.ts tests/unit/master-login.test.ts
git commit -m "Add temporary master-password login module"
```

---

### Task 2: Password mode on `/login`

**Files:**
- Modify: `src/lib/login-flow.ts`
- Modify: `src/features/pages/Login.astro`
- Modify: `src/i18n/en.json`, `src/i18n/kn.json`
- Test: `tests/routes/login.test.ts`

**Interfaces:**
- Consumes: `masterLoginEnabled()`, `loginWithMasterPassword(destinationRaw, password)` from Task 1.
- Produces: `LoginRenderState.passwordMode?: boolean`. The route twins `src/pages/login.astro` and `src/pages/kn/login.astro` need no change: they already pass `state` through and redirect on `outcome.kind === 'redirect'`.

- [ ] **Step 1: Write the failing tests**

In `tests/routes/login.test.ts`, add `afterEach` to the vitest import, and add this block inside the top-level `describe`, after the existing `GET renders step 1` block:

```ts
  describe('password mode (temporary, until email works for OTP)', () => {
    const PASSWORD = 'route-test-master-password-0001';

    beforeEach(() => {
      process.env.MASTER_PASSWORD = PASSWORD;
    });

    afterEach(() => {
      delete process.env.MASTER_PASSWORD;
    });

    it.each(['en', 'kn'] as const)('%s: GET renders the password form and no OTP step', async (lang) => {
      const res = await get(lang);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain('name="destination"');
      expect(html).toContain('name="password"');
      expect(html).toContain('type="password"');
      expect(html).toContain('autocomplete="current-password"');
      expect(html).not.toContain('name="step"');
      expect(html).toContain(t(lang, 'auth.password.heading'));
    });

    it('right password for a known user -> 302 to next with a session cookie, no OTP sent', async () => {
      await db.insert(schema.users).values({ email: KNOWN_EMAIL, homeWardId: WARD.id, role: 'citizen', status: 'active' });
      const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/admin/users' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/admin/users');
      expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it.each(['https://evil.example/x', '//evil.example/x'])('a hostile next (%s) collapses to /', async (next) => {
      await db.insert(schema.users).values({ email: KNOWN_EMAIL, homeWardId: WARD.id, role: 'citizen', status: 'active' });
      const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    });

    it('wrong password -> re-renders with the error, keeps the contact, sets no cookie', async () => {
      await db.insert(schema.users).values({ email: KNOWN_EMAIL, homeWardId: WARD.id, role: 'citizen', status: 'active' });
      const res = await post('en', { destination: KNOWN_EMAIL, password: 'wrong-password-wrong-password', next: '/' });
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
      const html = normalize(await res.text());
      expect(html).toContain(t('en', 'auth.password.error.invalid'));
      expect(html).toContain(`value="${KNOWN_EMAIL}"`);
      expect(html).not.toContain('wrong-password-wrong-password');
    });

    it('an unknown contact with the right password gets the SAME error and creates no user', async () => {
      const res = await post('en', { destination: NEW_EMAIL, password: PASSWORD, next: '/' });
      expect(res.status).toBe(200);
      expect(normalize(await res.text())).toContain(t('en', 'auth.password.error.invalid'));
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, NEW_EMAIL));
      expect(rows).toHaveLength(0);
    });

    it('a POST with no password field at all fails cleanly (no 500)', async () => {
      const res = await post('en', { destination: KNOWN_EMAIL, next: '/' });
      expect(res.status).toBe(200);
      expect(normalize(await res.text())).toContain(t('en', 'auth.password.error.invalid'));
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/login.test.ts`
Expected: the new block FAILS (`name="password"` not found; the POST renders OTP step 2). The existing cases still PASS.

- [ ] **Step 3: Add the strings**

In `src/i18n/en.json`, after the `"auth.modal.close"` line:

```json
  "auth.password.meta.title": "Sign in — Bengaluru Votes",
  "auth.password.meta.description": "Sign in to Bengaluru Votes.",
  "auth.password.heading": "Sign in",
  "auth.password.contactLabel": "Email or phone number",
  "auth.password.passwordLabel": "Password",
  "auth.password.submit": "Sign in",
  "auth.password.error.invalid": "That email or password is not right. Check both and try again.",
```

In the same file's `"__hints"` object:

```json
    "auth.password.meta.title": "Browser tab title for /login while the TEMPORARY master-password sign-in is on (until email works for OTP).",
    "auth.password.meta.description": "Meta description for /login in temporary password mode.",
    "auth.password.heading": "Page heading on /login in temporary password mode. 'Sign in' only — registration is unavailable in this mode.",
    "auth.password.contactLabel": "Label on the contact input in password mode: the account's email address or phone number.",
    "auth.password.passwordLabel": "Label on the password input.",
    "auth.password.submit": "Submit button on the password sign-in form.",
    "auth.password.error.invalid": "Deliberately generic sign-in failure: must NOT reveal whether the account exists or which of the two fields was wrong.",
```

In `src/i18n/kn.json`, add the Kannada values beside the other `auth.*` keys. Use the brand-name spelling already used by `auth.meta.title` in that file:

```json
  "auth.password.meta.title": "ಸೈನ್ ಇನ್ — ಬೆಂಗಳೂರು ವೋಟ್ಸ್",
  "auth.password.meta.description": "ಬೆಂಗಳೂರು ವೋಟ್ಸ್‌ಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.",
  "auth.password.heading": "ಸೈನ್ ಇನ್",
  "auth.password.contactLabel": "ಇಮೇಲ್ ಅಥವಾ ಫೋನ್ ಸಂಖ್ಯೆ",
  "auth.password.passwordLabel": "ಪಾಸ್‌ವರ್ಡ್",
  "auth.password.submit": "ಸೈನ್ ಇನ್",
  "auth.password.error.invalid": "ಆ ಇಮೇಲ್ ಅಥವಾ ಪಾಸ್‌ವರ್ಡ್ ಸರಿಯಾಗಿಲ್ಲ. ಎರಡನ್ನೂ ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
```

Add a `__hashes` entry for each of the seven keys. The hash function is the one `scripts/translate.ts` uses for existing entries (read it; do not guess). Then run:

Run: `npm run translate -- --check`
Expected: exits 0 with no missing or stale keys.

- [ ] **Step 4: Add the password branch to the login flow**

In `src/lib/login-flow.ts`, add the import:

```ts
import { loginWithMasterPassword, masterLoginEnabled } from './master-login';
```

Add the field to `LoginRenderState`:

```ts
export interface LoginRenderState {
  step: LoginStep;
  next: string;
  /** TEMPORARY (until email works for OTP): render the master-password form instead of the OTP steps. */
  passwordMode?: boolean;
  destination?: string;
  channel?: OtpChannel;
  code?: string;
  error?: string;
}
```

Replace `initialLoginState`:

```ts
export function initialLoginState(nextRaw: unknown, error?: string): LoginRenderState {
  return { step: 1, next: isSameOriginRelative(nextRaw), error, passwordMode: masterLoginEnabled() };
}
```

Add this function above `handleLoginPost`:

```ts
/** TEMPORARY master-password path (src/lib/master-login.ts) — deleted when email works for OTP. */
async function handlePasswordLogin(form: FormData, next: string): Promise<LoginPostOutcome> {
  const destination = String(form.get('destination') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const result = await loginWithMasterPassword(destination, password);
  if (result.ok) {
    return { kind: 'redirect', location: next, setCookie: result.setCookie };
  }
  return {
    kind: 'render',
    state: { step: 1, next, passwordMode: true, destination, error: 'auth.password.error.invalid' },
  };
}
```

Replace `handleLoginPost`:

```ts
export async function handleLoginPost(form: FormData, srcAttribution: string | null): Promise<LoginPostOutcome> {
  const next = isSameOriginRelative(form.get('next'));
  if (masterLoginEnabled()) return handlePasswordLogin(form, next);
  const step = String(form.get('step') ?? '1');
  if (step === '2') return handleStep2(form, next, srcAttribution);
  if (step === '3') return handleStep3(form, next, srcAttribution);
  return handleStep1(form, next);
}
```

- [ ] **Step 5: Render the password form**

In `src/features/pages/Login.astro` frontmatter, after `const errorText = ...`:

```ts
// TEMPORARY (until email works for OTP): one email-or-phone + password form.
const passwordMode = state.passwordMode === true;
```

Change the `<Base>` props and the heading:

```astro
<Base
  lang={lang}
  title={t(lang, passwordMode ? 'auth.password.meta.title' : 'auth.meta.title')}
  description={t(lang, passwordMode ? 'auth.password.meta.description' : 'auth.meta.description')}
  path="/login"
  noindex={true}
>
  <div class="login-page">
    <h1>{t(lang, passwordMode ? 'auth.password.heading' : 'auth.modal.title')}</h1>
```

Directly after the error `Banner` block, add:

```astro
    {
      passwordMode && (
        <form method="post" novalidate>
          <input type="hidden" name="next" value={state.next} />
          <div class="form-field">
            <label class="form-label" for="login-destination">
              {t(lang, 'auth.password.contactLabel')}
            </label>
            <input
              id="login-destination"
              class="form-input"
              name="destination"
              type="text"
              autocomplete="username"
              value={state.destination ?? ''}
              required
            />
          </div>
          <div class="form-field">
            <label class="form-label" for="login-password">
              {t(lang, 'auth.password.passwordLabel')}
            </label>
            <input
              id="login-password"
              class="form-input"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <Button type="submit" variant="primary" lang={lang}>
            {t(lang, 'auth.password.submit')}
          </Button>
        </form>
      )
    }
```

Change the three existing step conditions so they render only in OTP mode:

- `state.step === 1 && (` becomes `!passwordMode && state.step === 1 && (`
- `state.step === 2 && (` becomes `!passwordMode && state.step === 2 && (`
- `state.step === 3 && (` becomes `!passwordMode && state.step === 3 && (`

- [ ] **Step 6: Run to verify everything passes**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/login.test.ts tests/unit/auth-flow.test.ts`
Expected: PASS, including every pre-existing OTP-mode case.

- [ ] **Step 7: Commit**

```bash
git add src/lib/login-flow.ts src/features/pages/Login.astro src/i18n/en.json src/i18n/kn.json tests/routes/login.test.ts
git commit -m "Render a master-password form on /login in temporary password mode"
```

---

### Task 3: Middleware turns off the OTP endpoints in password mode

**Files:**
- Modify: `src/middleware.ts`
- Test: `tests/routes/middleware.test.ts`

**Interfaces:**
- Consumes: `masterLoginEnabled()` from Task 1.
- Produces: in password mode every request under `/api/otp` gets `404`; a too-short `MASTER_PASSWORD` makes every request throw.

- [ ] **Step 1: Write the failing tests**

In `tests/routes/middleware.test.ts`, add `afterEach` to the vitest import and add this block inside `describe('src/middleware.ts', ...)`:

```ts
  describe('temporary master-password mode', () => {
    afterEach(() => {
      delete process.env.MASTER_PASSWORD;
    });

    it.each(['/api/otp/request', '/api/otp/verify'])('POST %s -> 404 in password mode, route never runs', async (path) => {
      process.env.MASTER_PASSWORD = 'middleware-test-master-password';
      const next = nextStub();
      const ctx = makeContext({
        method: 'POST',
        path,
        headers: { 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ destination: 'x@example.com' }),
        contentType: 'application/json',
      });
      const res = await run(ctx, next);
      expect(res.status).toBe(404);
      expect(next).not.toHaveBeenCalled();
    });

    it('POST /api/otp/request passes through when MASTER_PASSWORD is unset', async () => {
      const next = nextStub();
      const ctx = makeContext({
        method: 'POST',
        path: '/api/otp/request',
        headers: { 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ destination: 'x@example.com' }),
        contentType: 'application/json',
      });
      const res = await run(ctx, next);
      expect(res.status).toBe(200);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('a too-short MASTER_PASSWORD rejects every request, public pages included', async () => {
      process.env.MASTER_PASSWORD = 'too-short';
      const ctx = makeContext({ path: '/' });
      await expect(run(ctx, nextStub())).rejects.toThrow('MASTER_PASSWORD must be at least 16 characters');
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/middleware.test.ts -t 'temporary master-password mode'`
Expected: the two 404 cases FAIL with status 200; the too-short case FAILS because nothing throws.

- [ ] **Step 3: Implement**

In `src/middleware.ts`, add the import beside the other `./lib/*` imports:

```ts
import { masterLoginEnabled } from './lib/master-login';
```

Inside `onRequest`, immediately after the `const respond = (response: Response): Response => { ... };` block and before `const isWebhook = ...`, add:

```ts
  // TEMPORARY (until email works for OTP — src/lib/master-login.ts):
  // evaluated on EVERY request so a too-short MASTER_PASSWORD throws at
  // once, health check included, instead of running with a guessable
  // password. In password mode the OTP endpoints do not exist.
  const passwordMode = masterLoginEnabled();
  if (passwordMode && isUnder(pathname, '/api/otp')) {
    return respond(new Response('Not found', { status: 404 }));
  }
```

Add one line to the route-class list in the file's docstring, under the `/api/otp/*` entry:

```ts
 *    TEMPORARY: while MASTER_PASSWORD is set (src/lib/master-login.ts)
 *    this whole class answers 404 — sign-in is the password form on /login.
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/middleware.test.ts tests/routes/otp.test.ts tests/routes/cache-invariant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts tests/routes/middleware.test.ts
git commit -m "Answer /api/otp with 404 while temporary password mode is on"
```

---

### Task 4: Park citizen registration in password mode

**Files:**
- Modify: `src/layouts/Base.astro`
- Modify: `src/features/pages/Ward.astro`, `src/features/pages/WardCandidates.astro`, `src/features/pages/Compare.astro`
- Modify: `src/islands/FlagModal.ts`
- Test: `tests/routes/ward.test.ts`, `tests/routes/ward-candidates.test.ts`, `tests/routes/compare.test.ts`, `tests/unit/flag-modal.test.ts`

**Interfaces:**
- Consumes: `masterLoginEnabled()` from Task 1.
- Produces: `loginRedirectUrl(pathname: string, search: string): string`, exported from `src/islands/FlagModal.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/routes/ward.test.ts`, inside the existing `describe('register-for-updates slot ...')` block, add:

```ts
    describe('temporary password mode', () => {
      beforeEach(() => {
        process.env.MASTER_PASSWORD = 'ward-test-master-password-0001';
      });

      afterEach(() => {
        delete process.env.MASTER_PASSWORD;
      });

      it.each(['en', 'kn'] as const)('%s: renders no register slot and no Register/Login modal', async (lang) => {
        const res = await renderWard(lang, WARD.id);
        expect(res.status).toBe(200);
        const html = normalize(await res.text());
        expect(html).not.toContain('data-register-slot');
        expect(html).not.toContain(t(lang, 'common.registerForUpdates'));
        expect(html).not.toContain('data-register-login-modal');
        // The flag modal stays: staff still flag, and citizens are sent to /login.
        expect(html).toContain('data-flag-modal');
      });
    });
```

In `tests/routes/ward-candidates.test.ts` and `tests/routes/compare.test.ts`, add one case each. Use the render helper each file already defines for an anonymous GET of its page (in the same way its existing register-slot case does), with these exact assertions:

```ts
  it('temporary password mode: renders no register slot', async () => {
    process.env.MASTER_PASSWORD = 'slot-test-master-password-0001';
    try {
      const res = /* this file's existing anonymous render call for WARD.id, lang 'en' */;
      const html = normalize(await res.text());
      expect(res.status).toBe(200);
      expect(html).not.toContain('data-register-slot');
      expect(html).not.toContain('data-register-login-modal');
    } finally {
      delete process.env.MASTER_PASSWORD;
    }
  });
```

For `ward-candidates.test.ts`, add the case twice: once against the fixture with candidates and once against the empty-ward fixture, because `WardCandidates.astro` has a register slot in each branch.

In `tests/unit/flag-modal.test.ts`, add `loginRedirectUrl` to the import from `../../src/islands/FlagModal`, and add:

```ts
  describe('temporary password mode: Register/Login modal absent', () => {
    it('loginRedirectUrl sends an English page to /login with next', () => {
      expect(loginRedirectUrl('/candidate/some-slug', '?x=1')).toBe(
        `/login?next=${encodeURIComponent('/candidate/some-slug?x=1')}`,
      );
    });

    it('loginRedirectUrl sends a Kannada page to /kn/login with next', () => {
      expect(loginRedirectUrl('/kn/ward/12', '')).toBe(`/kn/login?next=${encodeURIComponent('/kn/ward/12')}`);
      expect(loginRedirectUrl('/kn', '')).toBe(`/kn/login?next=${encodeURIComponent('/kn')}`);
    });

    it('a path that merely starts with "kn" is not treated as Kannada', () => {
      expect(loginRedirectUrl('/knowledge', '')).toBe(`/login?next=${encodeURIComponent('/knowledge')}`);
    });

    it('ANONYMOUS with no bvOpenRegisterLogin: the flag form does not open', async () => {
      delete (window as { bvOpenRegisterLogin?: unknown }).bvOpenRegisterLogin;
      fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: true }));
      openFlagModal({ wardId: 1, targets: SINGLE_TARGET });
      await flush();
      expect(dialog().open).toBe(false);
      expect(registerLoginSpy).not.toHaveBeenCalled();
    });
  });
```

(`fetchMock`, `jsonResponse`, `flush`, `dialog`, `registerLoginSpy`, `SINGLE_TARGET` and `openFlagModal` are the helpers this test file already defines. jsdom logs a "navigation not implemented" notice for the redirect; that is expected and does not fail the test.)

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/ward.test.ts tests/routes/ward-candidates.test.ts tests/routes/compare.test.ts tests/unit/flag-modal.test.ts`
Expected: the new cases FAIL (`data-register-slot` present; `loginRedirectUrl` is not exported).

- [ ] **Step 3: Omit the modal in `Base.astro`**

In `src/layouts/Base.astro` frontmatter, add:

```ts
import { masterLoginEnabled } from '../lib/master-login';

// TEMPORARY (until email works for OTP): registration is parked in
// password mode, so the Register/Login modal is not rendered at all.
const passwordMode = masterLoginEnabled();
```

Replace `<RegisterLoginModal lang={lang} />` with:

```astro
    {!passwordMode && <RegisterLoginModal lang={lang} />}
```

- [ ] **Step 4: Omit the register slots**

In each of `src/features/pages/Ward.astro`, `src/features/pages/WardCandidates.astro` and `src/features/pages/Compare.astro`, add to the frontmatter:

```ts
import { masterLoginEnabled } from '../../lib/master-login';

// TEMPORARY (until email works for OTP): no register-for-updates slot in password mode.
const passwordMode = masterLoginEnabled();
```

Then wrap each register slot so nothing of it renders in password mode. A page that has no slot must also leave no empty wrapper behind:

- **`Ward.astro`:** wrap the whole `<section class="register-slot" aria-labelledby="ward-updates-heading"> ... </section>` in `{!passwordMode && ( ... )}`.
- **`WardCandidates.astro`, empty-ward branch:** wrap the `<Button ... data-register-slot ...> ... </Button>` that is the child of `<EmptyState fact={emptyFact}>` in `{!passwordMode && ( ... )}`.
- **`WardCandidates.astro`, candidates branch:** wrap the whole `<section class="register-slot"> ... </section>` in `{!passwordMode && ( ... )}`.
- **`Compare.astro`:** find the element that contains both `<h2 id="updates-heading">` and the `data-register-slot` button, and wrap that whole element in `{!passwordMode && ( ... )}`.

- [ ] **Step 5: Add the flag fallback**

In `src/islands/FlagModal.ts`, add above `openFlagModal`:

```ts
/**
 * Where an anonymous visitor goes when the Register/Login modal is not on
 * the page. TEMPORARY: that only happens in master-password mode
 * (src/lib/master-login.ts), which parks registration until email works
 * for OTP. Locale-aware, and carries the current page as `next`.
 */
export function loginRedirectUrl(pathname: string, search: string): string {
  const isKannada = pathname === '/kn' || pathname.startsWith('/kn/');
  return `${isKannada ? '/kn/login' : '/login'}?next=${encodeURIComponent(pathname + search)}`;
}
```

Replace the anonymous branch inside `openFlagModal`:

```ts
    if (!me || me.anonymous) {
      if (window.bvOpenRegisterLogin) {
        window.bvOpenRegisterLogin({
          onSuccess: () => openFlagModal(opts, opener),
        });
      } else {
        location.assign(loginRedirectUrl(location.pathname, location.search));
      }
      return;
    }
```

- [ ] **Step 6: Run to verify it passes**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/ward.test.ts tests/routes/ward-candidates.test.ts tests/routes/compare.test.ts tests/routes/layout.test.ts tests/routes/cache-invariant.test.ts tests/unit/flag-modal.test.ts tests/unit/me-slot.test.ts tests/unit/register-modal.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/layouts/Base.astro src/features/pages/Ward.astro src/features/pages/WardCandidates.astro src/features/pages/Compare.astro src/islands/FlagModal.ts tests/routes/ward.test.ts tests/routes/ward-candidates.test.ts tests/routes/compare.test.ts tests/unit/flag-modal.test.ts
git commit -m "Park citizen registration while temporary password mode is on"
```

---

### Task 5: The `transcriber` role

**Files:**
- Modify: `src/db/schema.ts:11`
- Create: `drizzle/0011_add_transcriber_role.sql` (generated), `drizzle/meta/0011_snapshot.json` (generated)
- Modify: `drizzle/meta/_journal.json` (generated)
- Test: `tests/routes/middleware.test.ts`

**Interfaces:**
- Produces: `roleEnum.enumValues` is `['citizen', 'transcriber', 'curator', 'admin']`; `Role` from `src/lib/session.ts` includes `'transcriber'`.

- [ ] **Step 1: Write the failing tests**

In `tests/routes/middleware.test.ts`:

Widen the helper's role type:

```ts
async function upsertUser(email: string, role: 'citizen' | 'transcriber' | 'curator' | 'admin'): Promise<number> {
```

Add `transcriber: 'middleware-transcriber@example.com'` to `EMAILS`, declare `let transcriberId: number;`, create it in `beforeAll` with `transcriberId = await upsertUser(EMAILS.transcriber, 'transcriber');`, and add `transcriberId` to the `userIds` array in `afterAll`.

Add inside `describe('route guards', ...)`:

```ts
    it('transcriber GET /account -> passes through', async () => {
      const { cookieValue } = await sessionFor(transcriberId);
      const next = nextStub();
      const ctx = makeContext({ path: '/account', cookieValue });
      const res = await run(ctx, next);
      expect(res.status).toBe(200);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it.each(['/curator', '/admin', '/admin/users'])('transcriber GET %s -> 403', async (path) => {
      const { cookieValue } = await sessionFor(transcriberId);
      const ctx = makeContext({ path, cookieValue });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/middleware.test.ts`
Expected: FAIL in `beforeAll` with `invalid input value for enum role: "transcriber"`.

- [ ] **Step 3: Change the schema and generate the migration**

In `src/db/schema.ts`, replace line 11:

```ts
export const roleEnum = pgEnum('role', ['citizen', 'transcriber', 'curator', 'admin']);
```

Generate:

```sh
DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx drizzle-kit generate --name add_transcriber_role
```

Expected: creates `drizzle/0011_add_transcriber_role.sql` containing exactly one statement:

```sql
ALTER TYPE "public"."role" ADD VALUE 'transcriber' BEFORE 'curator';
```

plus `drizzle/meta/0011_snapshot.json` and a new entry in `drizzle/meta/_journal.json`. If the generated SQL contains anything else, stop: the schema file and the last snapshot have drifted, and that needs resolving before continuing.

- [ ] **Step 4: Run to verify it passes, and typecheck**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/middleware.test.ts tests/unit/schema.test.ts tests/unit/session.test.ts`
Expected: PASS. If `tests/unit/schema.test.ts` asserts the exact list of role values, update that assertion to `['citizen', 'transcriber', 'curator', 'admin']`.

Run: `npm run typecheck`
Expected: 0 errors. If a `Record<Role, ...>` or an exhaustive `switch` on `Role` now fails, add the `transcriber` case with the same treatment as `citizen` (no staff privileges) and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/0011_add_transcriber_role.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json tests/routes/middleware.test.ts
git commit -m "Add the transcriber role"
```

---

### Task 6: `addUser` and staff roles in the admin library

**Files:**
- Create: `src/lib/email.ts`
- Modify: `scripts/seed-admin.ts`
- Modify: `src/lib/admin.ts`
- Modify: `src/pages/admin/roles.astro` (rename of one import only)
- Test: `tests/unit/admin.test.ts`

**Interfaces:**
- Consumes: `isUniqueViolation(err: unknown): boolean` from `src/lib/db-errors.ts`; the `transcriber` enum value from Task 5.
- Produces, all from `src/lib/admin.ts` unless noted:
  - `isValidEmail(email: string): boolean` from `src/lib/email.ts`
  - `type StaffRole = 'transcriber' | 'curator' | 'admin'`
  - `STAFF_ROLES: readonly StaffRole[]`
  - `isStaffRole(value: string): value is StaffRole`
  - `addUser(actor: AdminActor, emailRaw: string, role: StaffRole): Promise<number>` — throws `Error('admin_only' | 'invalid_email' | 'user_exists')`
  - `grantRole(actor: AdminActor, targetUserId: number, role: StaffRole): Promise<void>`
  - `listStaff(): Promise<StaffRow[]>` (replaces `listCuratorsAndAdmins`); `StaffRow.role` is `StaffRole`
  - `ConsoleStats` gains `transcriberCount: number`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/admin.test.ts`:

Change the import to:

```ts
import {
  addUser,
  grantRole,
  revokeRole,
  listStaff,
  loadConsoleStats,
  findUserIdByLookup,
  isStaffRole,
  type AdminActor,
} from '../../src/lib/admin';
```

Replace every `listCuratorsAndAdmins(` call in the file with `listStaff(`.

Widen the helper: `async function upsertUser(email: string, role: 'citizen' | 'transcriber' | 'curator' | 'admin')`.

Add to `EMAILS`:

```ts
  addTranscriber: 'admin-lib-test-add-transcriber@example.com',
  addCurator: 'admin-lib-test-add-curator@example.com',
  addAdmin: 'admin-lib-test-add-admin@example.com',
  addExistingCitizen: 'admin-lib-test-add-existing-citizen@example.com',
  grantTranscriber: 'admin-lib-test-grant-transcriber@example.com',
```

Add inside the top-level `describe`:

```ts
  describe('addUser', () => {
    const ADDED = [EMAILS.addTranscriber, EMAILS.addCurator, EMAILS.addAdmin, EMAILS.addExistingCitizen];

    afterAll(async () => {
      await db.delete(schema.users).where(inArray(schema.users.email, ADDED));
    });

    it.each([
      ['transcriber', EMAILS.addTranscriber],
      ['curator', EMAILS.addCurator],
      ['admin', EMAILS.addAdmin],
    ] as const)('creates an active %s and returns its id', async (role, email) => {
      const id = await addUser(admin, email, role);
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      expect(row?.email).toBe(email);
      expect(row?.role).toBe(role);
      expect(row?.status).toBe('active');
      expect(row?.phone).toBeNull();
    });

    it('trims and lower-cases the email before storing it', async () => {
      await db.delete(schema.users).where(eq(schema.users.email, EMAILS.addCurator));
      const id = await addUser(admin, '  Admin-Lib-Test-Add-Curator@Example.COM  ', 'curator');
      const [row] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, id));
      expect(row?.email).toBe(EMAILS.addCurator);
    });

    it.each(['', 'not-an-email', 'two@@example.com', 'has space@example.com', `${'a'.repeat(250)}@example.com`])(
      'rejects %j with invalid_email and writes nothing',
      async (bad) => {
        await expect(addUser(admin, bad, 'curator')).rejects.toThrow('invalid_email');
      },
    );

    it('an email that already exists (as a citizen, typed in different case) -> user_exists, role untouched', async () => {
      const existingId = await upsertUser(EMAILS.addExistingCitizen, 'citizen');
      await expect(addUser(admin, EMAILS.addExistingCitizen.toUpperCase(), 'admin')).rejects.toThrow('user_exists');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, existingId));
      expect(row?.role).toBe('citizen');
    });

    it('rejects a non-admin actor and creates nothing', async () => {
      const curatorActor = { userId: curatorBId, role: 'curator' } as unknown as AdminActor;
      const email = 'admin-lib-test-add-by-non-admin@example.com';
      await expect(addUser(curatorActor, email, 'transcriber')).rejects.toThrow('admin_only');
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
      expect(rows).toHaveLength(0);
    });
  });

  describe('transcriber as a staff role', () => {
    let transcriberId: number;

    beforeAll(async () => {
      transcriberId = await upsertUser(EMAILS.grantTranscriber, 'citizen');
      extraFixtureIds.push(transcriberId);
    });

    it('isStaffRole accepts the three staff roles and nothing else', () => {
      expect(['transcriber', 'curator', 'admin'].every(isStaffRole)).toBe(true);
      expect(['citizen', '', 'ADMIN', 'superuser'].some(isStaffRole)).toBe(false);
    });

    it('grantRole promotes a citizen to transcriber', async () => {
      await grantRole(admin, transcriberId, 'transcriber');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, transcriberId));
      expect(row?.role).toBe('transcriber');
    });

    it('listStaff includes the transcriber and still excludes citizens', async () => {
      const rows = await listStaff();
      expect(rows.find((r) => r.id === transcriberId)?.role).toBe('transcriber');
      expect(rows.find((r) => r.id === plainCitizenId)).toBeUndefined();
    });

    it('loadConsoleStats counts transcribers', async () => {
      const stats = await loadConsoleStats();
      expect(stats.transcriberCount).toBeGreaterThanOrEqual(1);
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/unit/admin.test.ts`
Expected: FAIL, `addUser`, `listStaff` and `isStaffRole` are not exported.

- [ ] **Step 3: Move `isValidEmail` to a dependency-free module**

Create `src/lib/email.ts`:

```ts
/**
 * Shape check for an email address typed by an admin or passed to
 * `npm run seed:admin`. Deliberately loose (something@something.tld, no
 * whitespace) — delivery is the real test. Kept free of imports so
 * scripts/seed-admin.ts can use it without opening the app's database
 * pool (src/lib/admin.ts imports src/db/client.ts).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
```

In `scripts/seed-admin.ts`, delete the `EMAIL_RE` constant and the `isValidEmail` function, and add in their place:

```ts
import { isValidEmail } from '../src/lib/email';

export { isValidEmail };
```

- [ ] **Step 4: Extend `src/lib/admin.ts`**

Add the imports:

```ts
import { isUniqueViolation } from './db-errors';
import { isValidEmail } from './email';
```

Add below the `AdminActor` type:

```ts
/** Every role that is not `citizen`. Staff are email-only (docs/architecture.md §7). */
export type StaffRole = 'transcriber' | 'curator' | 'admin';

export const STAFF_ROLES: readonly StaffRole[] = ['transcriber', 'curator', 'admin'];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** RFC 5321's practical ceiling on a whole address. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Creates a NEW staff account by email. Throws `'invalid_email'`, or
 * `'user_exists'` when the address already has an account — it never
 * changes an existing account's role; that stays an explicit action on
 * /admin/roles (`grantRole`).
 */
export async function addUser(actor: AdminActor, emailRaw: string, role: StaffRole): Promise<number> {
  assertAdmin(actor);

  const email = emailRaw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
    throw new Error('invalid_email');
  }

  try {
    const [row] = await db.insert(users).values({ email, role }).returning({ id: users.id });
    return row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error('user_exists');
    throw err;
  }
}
```

Change the `grantRole` signature (body unchanged):

```ts
export async function grantRole(actor: AdminActor, targetUserId: number, role: StaffRole): Promise<void> {
```

Replace `StaffRow` and `listCuratorsAndAdmins`:

```ts
export interface StaffRow {
  id: number;
  email: string | null;
  role: StaffRole;
  status: string;
}

export async function listStaff(): Promise<StaffRow[]> {
  const userRows = await db
    .select({ id: users.id, email: users.email, role: users.role, status: users.status })
    .from(users)
    .where(inArray(users.role, [...STAFF_ROLES]))
    .orderBy(users.id);

  return userRows.filter((row): row is typeof row & { role: StaffRole } => isStaffRole(row.role));
}
```

Replace `ConsoleStats` and `loadConsoleStats`:

```ts
export interface ConsoleStats {
  transcriberCount: number;
  curatorCount: number;
  adminCount: number;
  pendingEoiCount: number;
}

export async function loadConsoleStats(): Promise<ConsoleStats> {
  const [roleCounts, [eoiRow]] = await Promise.all([
    db
      .select({ role: users.role, count: sql<number>`count(*)::int` })
      .from(users)
      .where(inArray(users.role, [...STAFF_ROLES]))
      .groupBy(users.role),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(eoiSubmissions)
      .where(eq(eoiSubmissions.status, 'new')),
  ]);

  const countFor = (role: StaffRole): number => Number(roleCounts.find((r) => r.role === role)?.count ?? 0);

  return {
    transcriberCount: countFor('transcriber'),
    curatorCount: countFor('curator'),
    adminCount: countFor('admin'),
    pendingEoiCount: Number(eoiRow?.count ?? 0),
  };
}
```

Keep any existing docstrings on these functions, updating "curators and admins" to "staff" where they describe the list.

- [ ] **Step 5: Fix the one renamed import**

In `src/pages/admin/roles.astro`, change `listCuratorsAndAdmins` to `listStaff` in the import and in the `Promise.all` call near the bottom. (Task 7 does the rest of this file.)

- [ ] **Step 6: Run to verify it passes**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/unit/admin.test.ts tests/unit/seeds.test.ts tests/routes/admin-roles.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors only in `src/features/pages/admin/Roles.astro` and `Console.astro` where `row.role` or `stats` now carry a wider type, if any. Task 7 resolves those; if there are none, even better.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email.ts src/lib/admin.ts scripts/seed-admin.ts src/pages/admin/roles.astro tests/unit/admin.test.ts
git commit -m "Add addUser and treat transcriber as a staff role in the admin library"
```

---

### Task 7: Admin screens

**Files:**
- Modify: `src/pages/admin/users.astro`, `src/features/pages/admin/Users.astro`
- Modify: `src/pages/admin/roles.astro`, `src/features/pages/admin/Roles.astro`
- Modify: `src/features/pages/admin/Console.astro`
- Modify: `src/i18n/en.json`, `src/i18n/kn.json`
- Test: `tests/routes/admin-users.test.ts`, `tests/routes/admin-roles.test.ts`

**Interfaces:**
- Consumes: `addUser`, `isStaffRole`, `STAFF_ROLES`, `StaffRole`, `listStaff`, `ConsoleStats.transcriberCount` from Task 6.
- Produces: `POST /admin/users` with `formAction=add`, fields `email`, `role`, `confirm`. `Users.astro` gains an optional `addEmail?: string` prop.

- [ ] **Step 1: Write the failing tests**

In `tests/routes/admin-users.test.ts`, add to `EMAILS`:

```ts
  addNew: 'admin-users-route-test-add-new@example.com',
  addNoConfirm: 'admin-users-route-test-add-no-confirm@example.com',
  addCsrf: 'admin-users-route-test-add-csrf@example.com',
```

Add this cleanup line at the top of the existing `afterAll`:

```ts
    await db.delete(schema.users).where(inArray(schema.users.email, [EMAILS.addNew, EMAILS.addNoConfirm, EMAILS.addCsrf]));
```

Add inside the top-level `describe`:

```ts
  describe('add a user', () => {
    it('GET shows the add-user card with all three staff roles', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('name="formAction" value="add"');
      expect(html).toContain('<option value="transcriber">');
      expect(html).toContain('<option value="curator">');
      expect(html).toContain('<option value="admin">');
    });

    it('POST add creates the account and redirects to a search for it', async () => {
      const form = formWithToken(
        { formAction: 'add', email: '  Admin-Users-Route-Test-Add-New@Example.com ', role: 'transcriber', confirm: 'on' },
        adminAuth.token,
      );
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/admin/users?q=${encodeURIComponent(EMAILS.addNew)}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const [row] = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addNew));
      expect(row?.role).toBe('transcriber');
      expect(row?.status).toBe('active');
    });

    it('POST add for an email that already exists -> 400 with the specific message, role untouched', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.citizen, role: 'admin', confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain('An account with that email already exists.');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(row?.role).toBe('citizen');
    });

    it('POST add with an invalid email -> 400, the typed value is kept in the field', async () => {
      const form = formWithToken({ formAction: 'add', email: 'not-an-email', role: 'curator', confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain('Enter a valid email address.');
      expect(html).toContain('value="not-an-email"');
    });

    it('POST add without the confirm checkbox -> 400, nothing created', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addNoConfirm, role: 'curator' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addNoConfirm));
      expect(rows).toHaveLength(0);
    });

    it.each(['citizen', 'superuser', ''])('POST add with role %j -> 400, nothing created', async (role) => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addNoConfirm, role, confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addNoConfirm));
      expect(rows).toHaveLength(0);
    });

    it('POST add without the CSRF token -> 403, nothing created', async () => {
      const form = new FormData();
      form.set('formAction', 'add');
      form.set('email', EMAILS.addCsrf);
      form.set('role', 'admin');
      form.set('confirm', 'on');
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(403);
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addCsrf));
      expect(rows).toHaveLength(0);
    });

    it('POST add as a curator -> 403', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addCsrf, role: 'admin', confirm: 'on' }, curatorAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: curatorAuth.cookieValue, form });
      expect(res.status).toBe(403);
    });
  });
```

In `tests/routes/admin-roles.test.ts`, add one case beside its existing GET-as-admin case, using that file's own `run` helper and admin cookie variable:

```ts
    it('the grant select offers transcriber', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('<option value="transcriber">');
    });
```

(If that file names its route import or admin-session variable differently, use its names.)

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/admin-users.test.ts tests/routes/admin-roles.test.ts`
Expected: the new cases FAIL (a `formAction=add` POST returns 400 for every input; no `transcriber` option).

- [ ] **Step 3: Add the strings**

In `src/i18n/en.json`, add beside the other `admin.users.*` keys:

```json
  "admin.users.add.heading": "Add a user",
  "admin.users.add.emailLabel": "Email",
  "admin.users.add.roleLabel": "Role",
  "admin.users.add.roleTranscriber": "Transcriber",
  "admin.users.add.roleCurator": "Curator",
  "admin.users.add.roleAdmin": "Admin",
  "admin.users.add.confirmLabel": "I understand this creates the account with the selected role immediately.",
  "admin.users.add.submit": "Add user",
  "admin.users.results.roleTranscriber": "Transcriber",
  "admin.users.error.invalidEmail": "Enter a valid email address.",
  "admin.users.error.userExists": "An account with that email already exists. Change its role under Roles & access.",
```

Add beside the `admin.roles.*` and `admin.console.*` keys:

```json
  "admin.roles.grant.roleTranscriber": "Transcriber",
  "admin.roles.list.roleTranscriber": "Transcriber",
  "admin.console.overview.transcribers": "Transcribers",
```

Change these five existing English values so they no longer say "curator/admin" only:

```json
  "admin.roles.meta.description": "Grant or revoke transcriber, curator and admin roles.",
  "admin.roles.grant.confirmLabel": "I understand this grants the selected role immediately.",
  "admin.roles.list.heading": "Staff",
  "admin.roles.list.empty": "No staff yet.",
  "admin.roles.manage.revoke.confirmLabel": "I understand this revokes {email}'s staff access immediately.",
```

Add a `__hints` entry for each of the fourteen new keys, one sentence each, saying where it appears (for example `"admin.users.add.heading": "Card heading on /admin/users above the form that creates a new staff account by email."`). For `admin.users.error.userExists`, the hint must say that "Roles & access" is the name of the `/admin/roles` screen and must match `admin.roles.heading`.

In `src/i18n/kn.json`, add the fourteen new keys and re-translate the five changed ones:

```json
  "admin.users.add.heading": "ಬಳಕೆದಾರರನ್ನು ಸೇರಿಸಿ",
  "admin.users.add.emailLabel": "ಇಮೇಲ್",
  "admin.users.add.roleLabel": "ಪಾತ್ರ",
  "admin.users.add.roleTranscriber": "ಪ್ರತಿಲೇಖಕ",
  "admin.users.add.roleCurator": "ಕ್ಯುರೇಟರ್",
  "admin.users.add.roleAdmin": "ನಿರ್ವಾಹಕ",
  "admin.users.add.confirmLabel": "ಇದು ಆಯ್ಕೆ ಮಾಡಿದ ಪಾತ್ರದೊಂದಿಗೆ ಖಾತೆಯನ್ನು ತಕ್ಷಣ ರಚಿಸುತ್ತದೆ ಎಂದು ನಾನು ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇನೆ.",
  "admin.users.add.submit": "ಬಳಕೆದಾರರನ್ನು ಸೇರಿಸಿ",
  "admin.users.results.roleTranscriber": "ಪ್ರತಿಲೇಖಕ",
  "admin.users.error.invalidEmail": "ಮಾನ್ಯವಾದ ಇಮೇಲ್ ವಿಳಾಸವನ್ನು ನಮೂದಿಸಿ.",
  "admin.users.error.userExists": "ಆ ಇಮೇಲ್‌ನೊಂದಿಗೆ ಖಾತೆ ಈಗಾಗಲೇ ಇದೆ. ಅದರ ಪಾತ್ರವನ್ನು ಪಾತ್ರಗಳು ಮತ್ತು ಪ್ರವೇಶದಲ್ಲಿ ಬದಲಾಯಿಸಿ.",
  "admin.roles.grant.roleTranscriber": "ಪ್ರತಿಲೇಖಕ",
  "admin.roles.list.roleTranscriber": "ಪ್ರತಿಲೇಖಕ",
  "admin.console.overview.transcribers": "ಪ್ರತಿಲೇಖಕರು",
  "admin.roles.meta.description": "ಪ್ರತಿಲೇಖಕ, ಕ್ಯುರೇಟರ್ ಮತ್ತು ನಿರ್ವಾಹಕ ಪಾತ್ರಗಳನ್ನು ನೀಡಿ ಅಥವಾ ಹಿಂಪಡೆಯಿರಿ.",
  "admin.roles.grant.confirmLabel": "ಇದು ಆಯ್ಕೆ ಮಾಡಿದ ಪಾತ್ರವನ್ನು ತಕ್ಷಣ ನೀಡುತ್ತದೆ ಎಂದು ನಾನು ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇನೆ.",
  "admin.roles.list.heading": "ಸಿಬ್ಬಂದಿ",
  "admin.roles.list.empty": "ಇನ್ನೂ ಸಿಬ್ಬಂದಿ ಇಲ್ಲ.",
  "admin.roles.manage.revoke.confirmLabel": "ಇದು {email} ಅವರ ಸಿಬ್ಬಂದಿ ಪ್ರವೇಶವನ್ನು ತಕ್ಷಣ ಹಿಂಪಡೆಯುತ್ತದೆ ಎಂದು ನಾನು ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇನೆ.",
```

Before saving, open `src/i18n/kn.json` and `src/i18n/glossary.json` and make these match the words the file already uses for "Curator", "Admin", "role" and "Roles & access" (`admin.roles.list.roleCurator`, `admin.roles.list.roleAdmin`, `admin.roles.grant.roleLabel`, `admin.roles.heading`). Where the existing file uses a different word, the existing word wins. Add or refresh the `__hashes` entry for all nineteen keys, then:

Run: `npm run translate -- --check`
Expected: exits 0.

- [ ] **Step 4: Handle `formAction=add` in the route**

In `src/pages/admin/users.astro`, add the import:

```ts
import { addUser, isStaffRole } from '../../lib/admin';
```

Add two cases to `errorKey`, above `return fallbackKey;`:

```ts
  if (msg === 'invalid_email') return 'admin.users.error.invalidEmail';
  if (msg === 'user_exists') return 'admin.users.error.userExists';
```

Add a variable beside `let query = ...`:

```ts
let addEmail = '';
```

Replace the body of `if (Astro.request.method === 'POST') { ... }` with:

```ts
  Astro.response.headers.set('cache-control', 'no-store');
  const form = await Astro.request.formData();
  const formAction = String(form.get('formAction') ?? '');
  const confirmed = form.get('confirm') != null;
  query = String(form.get('q') ?? '');

  if (formAction === 'add') {
    addEmail = String(form.get('email') ?? '').trim();
    const roleRaw = String(form.get('role') ?? '');
    if (!isStaffRole(roleRaw)) {
      return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    if (!confirmed) {
      message = { kind: 'error', key: 'admin.users.error.confirmRequired' };
      responseStatus = 400;
    } else {
      try {
        await addUser(actor, addEmail, roleRaw);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `/admin/users?q=${encodeURIComponent(addEmail.toLowerCase())}`,
            'cache-control': 'no-store',
          },
        });
      } catch (err) {
        message = { kind: 'error', key: errorKey(err, 'admin.users.error.invalidEmail') };
        responseStatus = 400;
      }
    }
  } else {
    const targetUserId = Number(form.get('targetUserId'));
    if (!Number.isInteger(targetUserId)) {
      return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    if (!['ban', 'reactivate', 'erase'].includes(formAction)) {
      return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } });
    }

    if (!confirmed) {
      message = { kind: 'error', key: 'admin.users.error.confirmRequired' };
      responseStatus = 400;
    } else {
      try {
        if (formAction === 'ban') {
          const reason = String(form.get('reason') ?? '').trim();
          await banUser(actor, targetUserId, reason || undefined);
        } else if (formAction === 'reactivate') {
          await reactivateUser(actor, targetUserId);
        } else {
          await eraseUser(actor, targetUserId);
        }
        return new Response(null, {
          status: 302,
          headers: {
            Location: query ? `/admin/users?q=${encodeURIComponent(query)}` : '/admin/users',
            'cache-control': 'no-store',
          },
        });
      } catch (err) {
        message = { kind: 'error', key: errorKey(err, 'admin.users.error.userNotFound') };
        responseStatus = 400;
      }
    }
  }
```

Change the last line of the file to pass the new prop:

```astro
<Users lang={lang} csrfToken={Astro.locals.csrfToken} query={query} results={results} message={message} addEmail={addEmail} />
```

Update the file's docstring: "the three POST form actions (`ban`, `reactivate`, `erase`)" becomes "the four POST form actions (`add`, `ban`, `reactivate`, `erase`)", and add that `add` goes to `src/lib/admin.ts`'s `addUser`.

- [ ] **Step 5: Add the card to `Users.astro`**

In `src/features/pages/admin/Users.astro` frontmatter, add `addEmail?: string;` to `Props`, destructure it (`const { lang, csrfToken, query, results, message, addEmail = '' } = Astro.props;`), and add the transcriber label:

```ts
const roleLabelKeys: Record<string, string> = {
  citizen: 'admin.users.results.roleCitizen',
  transcriber: 'admin.users.results.roleTranscriber',
  curator: 'admin.users.results.roleCurator',
  admin: 'admin.users.results.roleAdmin',
};
```

Insert this card directly above the search `<Card>`:

```astro
    <Card>
      <h2>{t(lang, 'admin.users.add.heading')}</h2>
      <form method="post" action="/admin/users" class="add-form">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="formAction" value="add" />
        <FormField label={t(lang, 'admin.users.add.emailLabel')} name="email" type="email" value={addEmail} required lang={lang} />
        <div class="form-field">
          <label class="form-label" for="add-role">
            {t(lang, 'admin.users.add.roleLabel')}
          </label>
          <select id="add-role" class="form-input" name="role">
            <option value="transcriber">{t(lang, 'admin.users.add.roleTranscriber')}</option>
            <option value="curator">{t(lang, 'admin.users.add.roleCurator')}</option>
            <option value="admin">{t(lang, 'admin.users.add.roleAdmin')}</option>
          </select>
        </div>
        <label class="checkbox">
          <input type="checkbox" name="confirm" required />
          {t(lang, 'admin.users.add.confirmLabel')}
        </label>
        <Button type="submit" variant="primary" lang={lang}>
          {t(lang, 'admin.users.add.submit')}
        </Button>
      </form>
    </Card>
```

`CSRF_FIELD_NAME` is already imported in this file (the ban form uses it). In the file's `<style>` block, add `.add-form` to whichever selector already styles `.search-form` (a comma-separated selector, not a copy of the rules), so the two forms lay out identically. If `FormField` does not accept `type="email"`, use `type="text"` with `inputmode="email"` passed the way the component supports; check its `Props`.

- [ ] **Step 6: Transcriber on `/admin/roles`**

In `src/pages/admin/roles.astro`, add `isStaffRole` to the import from `../../lib/admin`, and replace the line that derives `role` in the `grant` branch:

```ts
      const roleRaw = String(form.get('role') ?? '');
      if (!isStaffRole(roleRaw)) {
        return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
```

then pass `roleRaw` to `grantRole(actor, targetUserId, roleRaw)`. (Previously any unrecognized value silently became `curator`; an unknown role is now a 400.)

In `src/features/pages/admin/Roles.astro` frontmatter, add:

```ts
const roleLabelKey: Record<string, string> = {
  transcriber: 'admin.roles.list.roleTranscriber',
  curator: 'admin.roles.list.roleCurator',
  admin: 'admin.roles.list.roleAdmin',
};
```

Add the option at the top of the grant `<select>`:

```astro
            <option value="transcriber">{t(lang, 'admin.roles.grant.roleTranscriber')}</option>
```

Replace both occurrences of the ternary

```astro
row.role === 'admin' ? t(lang, 'admin.roles.list.roleAdmin') : t(lang, 'admin.roles.list.roleCurator')
```

(one in the list table, one in the manage row title) with:

```astro
t(lang, roleLabelKey[row.role] ?? 'admin.roles.list.roleCurator')
```

- [ ] **Step 7: Transcriber count on the console**

In `src/features/pages/admin/Console.astro`, add as the first entry inside `<dl class="stat-list">`:

```astro
        <div>
          <dt>{t(lang, 'admin.console.overview.transcribers')}</dt>
          <dd>{stats.transcriberCount}</dd>
        </div>
```

- [ ] **Step 8: Run to verify it passes**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npx vitest run tests/routes/admin-users.test.ts tests/routes/admin-roles.test.ts tests/unit/admin.test.ts tests/unit/i18n.test.ts`
Expected: PASS. If an existing `admin-roles` case asserted the old English text "Curators & admins" or relied on an unknown role falling back to curator, update it to the new behaviour stated in Steps 3 and 6.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/admin/users.astro src/pages/admin/roles.astro src/features/pages/admin/Users.astro src/features/pages/admin/Roles.astro src/features/pages/admin/Console.astro src/i18n/en.json src/i18n/kn.json tests/routes/admin-users.test.ts tests/routes/admin-roles.test.ts
git commit -m "Let admins add a user with a role, including transcriber"
```

---

### Task 8: Deployment config, documentation and live verification

**Files:**
- Modify: `deploy/nginx/snippets/rate-limits.conf`, `deploy/nginx/conf.d/site.conf`
- Modify: `deploy/compose.local.yml`
- Modify: `deploy/runbook.md`, `docs/architecture.md`, `AGENTS.md`, `docs/overview.md`, `docs/milestones.md`

**Interfaces:**
- Consumes: everything above. Produces no code interfaces.

- [ ] **Step 1: Add the nginx `login` rate zone**

Append to `deploy/nginx/snippets/rate-limits.conf`:

```nginx
# /login form posts: 5 per minute per client. Keyed on POST only (same
# pattern as $vote_limit_key above) so loading the page is never limited.
# Added for the TEMPORARY master-password sign-in (src/lib/master-login.ts)
# and worth keeping once OTP is back.
map $request_method $login_limit_key {
  default "";
  POST $binary_remote_addr;
}
limit_req_zone $login_limit_key zone=login:10m rate=5r/m;
```

In `deploy/nginx/conf.d/site.conf`, add this location **immediately above** the existing `location ~ ^/(kn/)?(account|curator|admin|login)(/|$) {` block. nginx uses the first matching regex location in file order, so position matters:

```nginx
  # --- /login: same no-cache, cookies-untouched treatment as the
  # authenticated form routes below, plus the POST-only `login` rate zone.
  # MUST stay above the combined regex location, which would otherwise
  # match /login first.
  location ~ ^/(kn/)?login(/|$) {
    limit_req zone=login burst=5 nodelay;
    proxy_pass http://app:4321;
  }
```

Validate the config in whichever local Compose service runs nginx (`grep -n 'nginx' deploy/compose.local.yml` to find it), for example:

Run: `docker compose -f deploy/compose.local.yml exec nginx nginx -t`
Expected: `syntax is ok` and `test is successful`. If the local stack has no nginx service, say so in the commit message and note that the config is first exercised on deploy.

- [ ] **Step 2: Give the local stack a working login**

In `deploy/compose.local.yml`, in the `app` service's `environment:` map, beside `OTP_TEST_SINK`:

```yaml
      # TEMPORARY master-password sign-in (src/lib/master-login.ts), in place
      # until email works for OTP. Local-only value; with it set, /login takes
      # any seeded account's email plus this password.
      MASTER_PASSWORD: local-dev-only-master-password
```

- [ ] **Step 3: Document the variable in the runbook**

In `deploy/runbook.md`, add a row to the environment table directly under the `SESSION_SECRET` row:

```markdown
| `MASTER_PASSWORD` | **temporary** — set until email works for OTP | `src/lib/master-login.ts`. When set (16+ characters, else the app throws on every request), `/login` becomes an email-or-phone plus password form, anyone holding the password can sign in as **any existing active account**, `/api/otp/*` answers 404 and citizen registration is hidden. Unset it to return to OTP. Generate with `openssl rand -hex 16`; avoid `#`, `$` and quotes, which env files can mangle. Shared by everyone who has it: removing one person means rotating it for all. |
```

Add a short subsection beside the other operational procedures:

```markdown
### Rotating or removing the master password (temporary)

The master password exists only until email works for OTP.

Rotate (also how you remove one person's access):

1. `openssl rand -hex 16`, and put the new value in `MASTER_PASSWORD` in `.env.production`.
2. Restart the app: `docker compose -f deploy/compose.production.yml up -d app`.
3. Share the new value out of band. Existing sessions stay valid for up to an hour of activity; to end them now, ban and reactivate the account at `/admin/users`, or rotate `SESSION_SECRET`, which signs everyone out.

Remove (when email OTP works): delete the `MASTER_PASSWORD` line, restart the app, and confirm `/login` asks for a code again.

First admin on a fresh box: `docker compose run --rm app npm run seed:admin -- <email>`, then sign in at `/login` with that email and the master password.
```

- [ ] **Step 4: Record it in the architecture document**

In `docs/architecture.md` §7, directly after the paragraph that begins "**One OTP mechanism, two session lengths.**", add:

```markdown
**Temporary exception — master-password sign-in (added 2026-10-13).** There is no email or WhatsApp sending yet, so nobody can receive a code. **Until email works for OTP, and only until then**, `MASTER_PASSWORD` switches `/login` to an email-or-phone plus password form: one shared password signs in as any existing, active account of any role (`src/lib/master-login.ts`). It never creates an account, so new staff are added by an admin at `/admin/users` and the first admin by `npm run seed:admin`. While it is on, `/api/otp/*` answers 404 and citizen registration is not offered: the register-for-updates slots and the Register/Login modal are not rendered, and an anonymous "report an error" goes to `/login`. Unsetting the variable restores the OTP flow above unchanged. §13 lists what this costs.
```

In §13, in the list of limitations accepted deliberately, add:

```markdown
  - **Temporary master password (2026-10-13; removed when email works for OTP).** One credential is shared by everyone who holds it, so there is no per-person accountability, and with no audit log there is nothing to reconstruct it from. Anyone holding it can enter any account, citizens' included. It sits in plaintext in `.env.production`, readable by anyone with a shell on the box. Removing one person's access means rotating it for all. Mitigations are deliberately few: a 16-character minimum enforced at request time, a constant-time comparison, one indistinguishable failure for wrong password, unknown contact and banned account, and an nginx limit of 5 sign-in posts a minute per client. **Removal:** unset `MASTER_PASSWORD`; then delete `src/lib/master-login.ts`, its branch in `src/lib/login-flow.ts` and `Login.astro`, the `/api/otp` 404 in `src/middleware.ts`, the `masterLoginEnabled()` conditionals in `Base.astro`, `Ward.astro`, `WardCandidates.astro` and `Compare.astro`, and the `auth.password.*` strings. Keep the nginx `login` zone.
```

In the §7 API table row for `POST /api/otp/request`, `POST /api/otp/verify`, append: `**Temporarily 404 while `MASTER_PASSWORD` is set** (see below).`

- [ ] **Step 5: Bring the other documents in line**

`AGENTS.md`:

- Line 53, the seed comment: change `# idempotent; the ONLY place a user becomes 'admin'` to `# idempotent; bootstraps the first admin (later ones: /admin/users or /admin/roles)`.
- The "Auth:" bullet (around line 178): append `**Temporary exception (2026-10-13): while there is no email sending, `MASTER_PASSWORD` turns `/login` into a shared-password form that signs in as any existing account, and parks citizen registration. It is removed when email works for OTP — `docs/architecture.md` §7, §13.** Sessions are 1h sliding for everyone in code today; the 24h staff session is not built.`
- The Roles paragraph (around lines 163–165): change the list to `Anonymous citizen · Registered citizen · Transcriber · Data curator · Admin`, and replace "A fifth role, **transcriber**, is planned but not built" with "**Transcriber** exists in `roleEnum` and can be assigned (2026-10-13), but has no routes yet: it can sign in and reach `/account` only. Its screens and its assignment-based authorization are still to build".

`docs/overview.md`: in §7's "One simple login for everyone" bullet and in the decisions-table "Authentication" row, append the sentence: `**Temporarily (from 2026-10-13, until email sending works) sign-in is by a shared master password instead, and citizen registration is paused.**`

`docs/milestones.md` §8 (M6), under "What ships", add:

```markdown
- **Shipped 2026-10-13:** add a user with a role at `/admin/users`; the `transcriber` role in the schema, assignable at `/admin/roles`. Search, ban, reactivate and erase were already there, and banning already ends live sessions (`readSession` rejects a non-active user on every request).
- **Still open:** the 24-hour staff session. Sessions are 1 hour sliding for every role.
- **Temporary:** M6 no longer waits on M4a to be usable. Until email works for OTP, staff sign in with a shared master password (`docs/architecture.md` §7, §13).
```

- [ ] **Step 6: Run the whole suite**

Run: `DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npm test`
Expected: all files PASS.

Run: `npm run typecheck && npm run translate -- --check`
Expected: both exit 0.

- [ ] **Step 7: Verify in a real browser, desktop and mobile**

Bring the stack up and seed it:

```sh
docker compose -f deploy/compose.local.yml up --build -d
docker compose -f deploy/compose.local.yml exec app npm run seed:wards
docker compose -f deploy/compose.local.yml exec app npm run seed:dev
docker compose -f deploy/compose.local.yml exec app npm run seed:admin -- admin@example.com
```

At 1280×800 and at 390×844, check each of the following on `http://localhost:4321`, looking at the rendered page rather than the DOM:

1. `/login` and `/kn/login`: one heading, two fields and a button; field widths and heights match each other and the button; labels do not wrap awkwardly; no horizontal scroll; focus rings visible on both inputs and the button.
2. Wrong password: the error banner appears, the email is kept, the password is empty.
3. `admin@example.com` + `local-dev-only-master-password`: lands on `/`, and `/admin` then loads.
4. `/login?next=/admin/users` signs in straight to `/admin/users`.
5. `/admin/users`: the "Add a user" card matches the search card's spacing, field widths and control heights; the role select is the same height as the email input; the checkbox label wraps cleanly on mobile.
6. Add `transcriber1@example.com` as Transcriber: redirected to the search showing that row with role "Transcriber". Add it again: the "already exists" message, with the email kept in the field.
7. `/admin/roles`: "Transcriber" in the select, and the new user listed with the right label. `/admin`: the transcriber count shows 1 and the stat row still lays out evenly with four items at both widths.
8. Sign out, sign in as `transcriber1@example.com`: `/account` loads, `/curator` and `/admin` return 403.
9. Signed out, a ward page, its candidates page and its compare page: no "Register for updates" button and **no leftover empty section or gap** where it was. Compare the spacing around the neighbouring sections with the same page before this change (`git stash` is not needed: load the production site at the same viewport for reference).
10. Signed out, a candidate page: "report an error" navigates to `/login?next=<that page>`; on a `/kn/` candidate page it navigates to `/kn/login`.
11. Browser console: no errors on any of the above.

Fix anything that fails and re-check at both widths before committing.

- [ ] **Step 8: Commit**

```bash
git add deploy/nginx/snippets/rate-limits.conf deploy/nginx/conf.d/site.conf deploy/compose.local.yml deploy/runbook.md docs/architecture.md AGENTS.md docs/overview.md docs/milestones.md
git commit -m "Document the temporary master password and rate-limit /login"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 → Task 1; §3.2 → Task 2; §3.3 and the per-request length check → Task 3; §3.4 → Task 8 Step 1; §3.5 needs no code; §4 → Task 4; §5.1 and §5.4 → Task 5; §5.2 → Task 6; §5.3 → Task 7; §6 → Task 8 Steps 2–3; §7 → Task 8 Steps 4–5; §8 → the test steps of Tasks 1–7 and Task 8 Step 7.
- **Deploying:** not part of this plan. When the branch is merged, deployment follows the `deploy-vps` skill, with `MASTER_PASSWORD` added to `.env.production` first and migration `0011` applied by the normal release flow.
