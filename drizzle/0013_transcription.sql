CREATE TYPE "public"."assignment_state" AS ENUM('open', 'submitted', 'abandoned');--> statement-breakpoint
CREATE TABLE "transcription_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"affidavit_id" integer NOT NULL,
	"transcriber_id" integer NOT NULL,
	"state" "assignment_state" DEFAULT 'open' NOT NULL,
	"drawn_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"closed_at" timestamp
);--> statement-breakpoint
ALTER TABLE "transcription_assignments" ADD CONSTRAINT "transcription_assignments_affidavit_id_candidate_affidavits_id_fk" FOREIGN KEY ("affidavit_id") REFERENCES "public"."candidate_affidavits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_assignments" ADD CONSTRAINT "transcription_assignments_transcriber_id_users_id_fk" FOREIGN KEY ("transcriber_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- At most one person holds an affidavit at a time. Deliberately NOT unique on
-- (affidavit, transcriber): a transcriber may take up an affidavit whose
-- earlier assignment of theirs expired.
CREATE UNIQUE INDEX "transcription_open_affidavit_uq" ON "transcription_assignments" USING btree ("affidavit_id") WHERE state = 'open';--> statement-breakpoint
CREATE INDEX "transcription_transcriber_idx" ON "transcription_assignments" USING btree ("transcriber_id","state");--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "transcribed_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_affidavits" ADD COLUMN "match_note" text;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "checked_by" integer;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_fields" ADD COLUMN "confirmed_ai" boolean;
