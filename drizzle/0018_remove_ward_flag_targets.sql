-- Ward-targeted flags are removed: only candidate fields can be flagged.
-- Old ward_field / ward_issue rows (curators could only dismiss them) are
-- deleted with their submissions, and the enum is rebuilt without those values.
DELETE FROM "flag_submissions" WHERE "flag_item_id" IN (SELECT "id" FROM "flag_items" WHERE "target_type" <> 'candidate_field');--> statement-breakpoint
DELETE FROM "flag_items" WHERE "target_type" <> 'candidate_field';--> statement-breakpoint
ALTER TYPE "public"."flag_target" RENAME TO "flag_target_old";--> statement-breakpoint
CREATE TYPE "public"."flag_target" AS ENUM ('candidate_field');--> statement-breakpoint
ALTER TABLE "flag_items" ALTER COLUMN "target_type" TYPE "public"."flag_target" USING "target_type"::text::"public"."flag_target";--> statement-breakpoint
DROP TYPE "public"."flag_target_old";
