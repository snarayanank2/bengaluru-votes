CREATE TABLE "ward_candidate_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ward_id" integer NOT NULL,
	"position" integer NOT NULL,
	"question_en" text NOT NULL,
	"question_kn" text NOT NULL,
	CONSTRAINT "ward_candidate_questions_position_check" CHECK ("position" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "ward_candidate_questions" ADD CONSTRAINT "ward_candidate_questions_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ward_candidate_questions_ward_position_uq" ON "ward_candidate_questions" USING btree ("ward_id","position");
--> statement-breakpoint
CREATE INDEX "ward_candidate_questions_ward_idx" ON "ward_candidate_questions" USING btree ("ward_id");
