-- A citizen can report something that is not one of the eight fields (a
-- wrong-person affidavit, an unreadable scan, details no field summarises).
-- Curators can only dismiss or mark such a report as spam. Idempotent.
ALTER TYPE "public"."flag_target" ADD VALUE IF NOT EXISTS 'candidate_other';
