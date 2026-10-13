CREATE TYPE "public"."affidavit_state" AS ENUM('queued', 'extracting', 'needs_matching', 'published', 'failed');--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "state" "affidavit_state" DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "extraction" jsonb;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "match_reason" text;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "sha256" text;--> statement-breakpoint
-- Affidavits stored before the queue existed were extracted in-request (or
-- not at all). None of them is waiting for the worker, so none is 'queued'.
UPDATE "candidate_affidavits" SET "state" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_affidavits_sha256_uq" ON "candidate_affidavits" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "candidate_affidavits_state_idx" ON "candidate_affidavits" USING btree ("state");--> statement-breakpoint
ALTER TABLE "candidate_affidavits" DROP COLUMN "extraction_status";--> statement-breakpoint
DROP TYPE "public"."extraction_status";--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "value_data" jsonb;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "unreadable" boolean DEFAULT false NOT NULL;
