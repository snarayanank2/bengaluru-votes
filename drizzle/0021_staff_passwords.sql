-- Per-staff passwords replace the shared MASTER_PASSWORD. NULL means "no
-- password set yet": that account cannot sign in until an admin sets one
-- (/admin/users, or `npm run set-password`). Idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp;
