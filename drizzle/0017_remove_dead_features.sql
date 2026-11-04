-- Dormant features are removed (architecture §15): the partner kit and
-- expression-of-interest form, the EC-link affidavit fetch, the local booths
-- table (booth lookup uses the BBMP electoral API), candidate stances and
-- photos, and the legacy candidate Kannada name/party columns. Migration 0014
-- already copied name_kn/party_kn into candidate_fields (full_name/party
-- value_kn); display and search read only those. Media is now affidavit
-- PDFs only, so old non-PDF rows (candidate photos) that no affidavit
-- references are deleted.
DROP TABLE IF EXISTS "partner_wards" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "partners" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "eoi_submissions" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."eoi_path";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."eoi_status";--> statement-breakpoint
DROP TABLE IF EXISTS "booths" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "candidate_stances" CASCADE;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" DROP COLUMN IF EXISTS "origin_url";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "photo_media_id";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "name_kn";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "party_kn";--> statement-breakpoint
DELETE FROM "media" WHERE "content_type" <> 'application/pdf' AND "id" NOT IN (SELECT "media_id" FROM "candidate_affidavits");
