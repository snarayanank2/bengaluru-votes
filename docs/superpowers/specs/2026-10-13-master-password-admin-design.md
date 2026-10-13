# Master-password login and admin user management

**Date:** 2026-10-13
**Status:** Approved in conversation; ready for an implementation plan
**Milestone:** M6 (admin functionality), plus a temporary replacement for the M4a login dependency

## 1. Why

Staff sign in by email OTP, and email sending is not available: there is no SendGrid or WhatsApp integration for now. With the vendor keys unset the OTP send is a no-op, so nobody, admin included, can sign in. M6, M7 and M8 are all blocked on that.

This design does two things:

1. Adds a **temporary** master-password login so staff can reach the platform without email.
2. Finishes the M6 gap: an admin can add a user with a role, including a new `transcriber` role.

**The master password is a stopgap. It exists only until email works for OTP, and is then removed.** Every part of it is built to be deleted cleanly: one module, one branch in the login flow, one environment variable.

## 2. Decisions

| Question | Decision |
|---|---|
| Who can the master password sign in as? | Any **existing, active** account, of any role. It never creates an account. |
| Where is the password kept? | Plaintext in the `MASTER_PASSWORD` environment variable (`.env.production` on the VPS). |
| How is the mode switched? | `MASTER_PASSWORD` set means password mode. Unset means today's OTP behaviour, unchanged. There is no second flag. |
| Citizen registration while password mode is on | Parked. The register-for-updates entry points are not rendered and the OTP endpoints return 404. |
| The "report an error" (flag) trigger | Stays visible. An anonymous visitor who clicks it is sent to `/login`. |
| Admin scope | Add a user by email with a role; add the `transcriber` role. |
| Session length | Unchanged: 1 hour sliding for everyone. The 24-hour staff session in `docs/milestones.md` §8 is not built here. |

## 3. Master-password login (temporary)

### 3.1 Module: `src/lib/master-login.ts`

The whole mechanism lives here so removal is one file.

- `masterLoginEnabled(): boolean` reads `process.env.MASTER_PASSWORD` at call time. Returns `false` when unset or empty.
- If the variable is set but shorter than 16 characters, it throws `MASTER_PASSWORD must be at least 16 characters`. The middleware calls `masterLoginEnabled()` on every request, so a weak password fails the deploy health check instead of silently running.
- `loginWithMasterPassword(destinationRaw, password)` returns `{ ok: true, setCookie }` or `{ ok: false }`:
  1. Compare `password` with the configured value in constant time. Both sides are SHA-256 hashed first so `timingSafeEqual` gets equal-length buffers.
  2. Normalize the contact with the existing `normalizeDestination` and look the user up by email or phone.
  3. Succeed only when the password matches **and** the user exists **and** `status` is `active`. Then call the existing `createSession`.
- All three failure causes (wrong password, unknown contact, banned or erased account) return the same `{ ok: false }`. The caller shows one message, so the form cannot be used to test who is registered.
- Each failure calls `logEvent('master_login_failed', { userId })` with the matched user id when there is one. The contact and the password are never logged. The client IP is in the nginx access log.

### 3.2 `/login` and `/kn/login`

- `LoginRenderState` gains `passwordMode: boolean`, set by `initialLoginState` from `masterLoginEnabled()`.
- In password mode `Login.astro` renders one form: email-or-phone, password (`type="password"`, `autocomplete="current-password"`), and the hidden `next`. The three OTP steps are untouched and render only in OTP mode.
- `handleLoginPost` gets one early branch: in password mode it calls `loginWithMasterPassword` and returns a redirect to the validated `next` on success, or re-renders with `auth.password.error.invalid` on failure.
- The page title and heading in password mode read "Sign in", not "Sign in or register".

### 3.3 OTP endpoints

In password mode the middleware answers everything under `/api/otp` with `404` before the route runs. The middleware evaluates `masterLoginEnabled()` once per request, which is also what makes a too-short password fail every request.

### 3.4 Brute-force protection

A new nginx rate zone, `login`, keyed on client IP for `POST` only (the same `map $request_method` pattern as the existing `vote` zone), at 5 requests per minute with a burst of 5, applied to `^/(kn/)?login(/|$)`.

No application-level lockout is added. Against a password of 16 or more characters, 5 guesses a minute per IP is enough, and an app-level lockout would let an attacker lock staff out.

### 3.5 Session and middleware

No change to sessions, CSRF, or the role guards. A master-password login produces an ordinary session for that user.

## 4. Parking citizen registration

In password mode:

- `Base.astro` does not render `RegisterLoginModal`.
- `Ward.astro`, `WardCandidates.astro` and `Compare.astro` do not render their register-for-updates section or button (`data-register-slot`).
- `FlagModal.ts`: when the visitor is anonymous and `window.bvOpenRegisterLogin` is not defined, the island navigates to `/login?next=<current path>` (locale-aware). Signed-in staff flag as normal.

Public pages are cached for about 60 seconds, and the mode is a process-wide constant, so cached and fresh responses always agree.

**Known gap, accepted:** adding or changing an account contact at `/account` also uses OTP and will not work while email is off.

## 5. Admin

### 5.1 Schema

Migration `0011` adds `'transcriber'` to the `role` enum: `ALTER TYPE "role" ADD VALUE 'transcriber'`. `roleEnum` in `src/db/schema.ts` becomes `['citizen', 'transcriber', 'curator', 'admin']`.

### 5.2 `src/lib/admin.ts`

- `type StaffRole = 'transcriber' | 'curator' | 'admin'`.
- `isValidEmail` moves from `scripts/seed-admin.ts` to a dependency-free `src/lib/email.ts`; the script re-exports it. (It cannot live in `admin.ts`, which opens the app's database pool on import.)
- New `addUser(actor, emailRaw, role: StaffRole): Promise<number>`:
  - asserts the actor is an admin;
  - trims and lower-cases the email, throws `invalid_email` if it fails `isValidEmail`;
  - inserts `{ email, role }` (status defaults to `active`) and returns the new id;
  - on a unique violation throws `user_exists`. It does **not** change an existing account's role; that stays an explicit action on `/admin/roles`.
- `grantRole` accepts `StaffRole`. The existing guard already covers demoting an admin to any lower role.
- `listCuratorsAndAdmins` is renamed `listStaff` and includes transcribers. `StaffRow.role` becomes `StaffRole`.
- `ConsoleStats` gains `transcriberCount`.

Staff are email-only, so `addUser` takes no phone number.

### 5.3 Screens

- **`/admin/users`:** a new "Add a user" card above search, with email, a role select (transcriber, curator, admin), the confirm checkbox used by every other admin action, and a submit button. The route handles `formAction=add` before the existing `targetUserId` validation. On success it redirects to `/admin/users?q=<email>`, which shows the new row. `invalid_email` and `user_exists` re-render with a 400 and a specific message.
- **`/admin/roles`:** the grant select offers transcriber; the list and manage rows label all three roles.
- **`/admin`:** the overview shows a transcriber count.
- Search by id, email or phone already exists and needs no work.

### 5.4 What a transcriber can do

Sign in and reach `/account`. The middleware returns 403 on `/curator` and `/admin` because neither guard lists the role. Transcriber routes and assignment-based authorization are M8.

## 6. Configuration

| Variable | Where | Meaning |
|---|---|---|
| `MASTER_PASSWORD` | `.env.production` on the VPS; `deploy/compose.local.yml` for local | Set (16+ characters): password mode. Unset: OTP mode. **Temporary.** |

Rotation is edit-and-restart. `deploy/compose.local.yml` gets a fixed local-only value so the local stack finally has a working login.

Bootstrap on production: `npm run seed:admin -- <email>`, set `MASTER_PASSWORD`, restart `app`.

## 7. Documentation

- **`docs/architecture.md` §7 (auth) and §13 (security):** a dated note that master-password login is temporary and in place only until email works for OTP, with the accepted limitations and the removal steps below.
- **`AGENTS.md`:** the auth bullet, the roles line, and the `seed:admin` comment.
- **`docs/overview.md`:** the two "one simple login" rows.
- **`docs/milestones.md` §8:** note what shipped and that the 24-hour session is still open.
- **`deploy/runbook.md`:** the environment table row and the rotation step.

### Accepted limitations (recorded in architecture §13)

- One credential shared by everyone who has it. No per-person accountability, and there is no audit log to fall back on.
- Anyone holding it can enter any account, citizens included.
- It sits in plaintext in `.env.production`. Anyone with shell access to the box can read it.
- Removing one person's access means rotating it for everyone.

### Removal, when email works

1. Unset `MASTER_PASSWORD` and restart. OTP mode is back, with registration.
2. Delete `src/lib/master-login.ts`, the password branch in `login-flow.ts` and `Login.astro`, the `/api/otp` 404 in `src/middleware.ts`, the `masterLoginEnabled()` conditionals in the four page files and `Base.astro`, the `auth.password.*` strings, and the tests for them.
3. Keep the nginx `login` zone; it is useful for OTP too.
4. Remove the temporary notes from the docs.

## 8. Testing

**Unit**

- `tests/unit/master-login.test.ts`: disabled when unset; throws when shorter than 16; correct password with an active user creates a session; wrong password, unknown contact, banned user and erased user all return `{ ok: false }`; phone and mixed-case email are normalized.
- `tests/unit/admin.test.ts`: `addUser` for each role; `invalid_email`; `user_exists` leaves the existing row unchanged; non-admin actor rejected; `grantRole` to transcriber; `listStaff` includes transcribers.

**Routes**

- `tests/routes/login.test.ts`: in password mode the page renders the password form and no OTP step; a correct login returns 302 with a session cookie and honours `next`; a wrong one re-renders with the error and no cookie. Existing OTP-mode cases keep passing with the variable unset.
- `tests/routes/admin-users.test.ts`: add-user success, duplicate, invalid email, missing confirm, CSRF.
- `tests/routes/middleware.test.ts`: `/api/otp/*` returns 404 in password mode and passes through otherwise; a too-short password rejects the request; a transcriber session gets 403 on `/curator` and `/admin` and passes on `/account`.
- `tests/routes/ward.test.ts`: no `data-register-slot` in password mode.

**Browser:** `/login`, `/admin/users` and `/admin/roles` inspected live at desktop and mobile widths, per the project's UI verification rule.

## 9. Out of scope

- The 24-hour staff session.
- Transcriber routes, assignments and authorization (M8).
- Admin analytics.
- Per-user passwords, password reset, 2FA.
- Collecting citizen registrations without verification.
