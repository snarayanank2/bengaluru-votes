ALTER TYPE "public"."budget_kind" ADD VALUE IF NOT EXISTS 'anonymous_vote';
--> statement-breakpoint
ALTER TABLE "ward_issues" ADD COLUMN "catalog_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "ward_issues_catalog_uq" ON "ward_issues" USING btree ("ward_id","catalog_key") WHERE "catalog_key" is not null;
--> statement-breakpoint
CREATE TABLE "anonymous_issue_vote_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"voter_hash" text NOT NULL,
	"ward_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "anonymous_issue_vote_sets_voter_hash_unique" UNIQUE("voter_hash")
);
--> statement-breakpoint
CREATE TABLE "anonymous_issue_vote_selections" (
	"set_id" integer NOT NULL,
	"ward_issue_id" integer NOT NULL,
	CONSTRAINT "anonymous_issue_vote_selections_set_id_ward_issue_id_pk" PRIMARY KEY("set_id","ward_issue_id")
);
--> statement-breakpoint
ALTER TABLE "anonymous_issue_vote_sets" ADD CONSTRAINT "anonymous_issue_vote_sets_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "anonymous_issue_vote_selections" ADD CONSTRAINT "anonymous_issue_vote_selections_set_id_anonymous_issue_vote_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."anonymous_issue_vote_sets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "anonymous_issue_vote_selections" ADD CONSTRAINT "anonymous_issue_vote_selections_ward_issue_id_ward_issues_id_fk" FOREIGN KEY ("ward_issue_id") REFERENCES "public"."ward_issues"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "anonymous_issue_vote_sets_ward_idx" ON "anonymous_issue_vote_sets" USING btree ("ward_id");
