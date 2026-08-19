ALTER TABLE "wards" ADD COLUMN "assembly_number" integer;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "assembly_name_en" text;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "assembly_name_kn" text;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "population_total" integer;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "population_male" integer;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "population_female" integer;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "reservation_en" text;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "reservation_kn" text;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "facts_source_url" text;
--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "facts_source_date" date;
--> statement-breakpoint
CREATE TABLE "ward_old_ward_overlaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"ward_id" integer NOT NULL,
	"position" integer NOT NULL,
	"old_ward_number" integer,
	"old_ward_name_en" text NOT NULL,
	"old_ward_name_kn" text NOT NULL,
	"published_overlap_basis_points" integer NOT NULL,
	CONSTRAINT "ward_old_ward_overlaps_position_check" CHECK ("ward_old_ward_overlaps"."position" > 0),
	CONSTRAINT "ward_old_ward_overlaps_percentage_check" CHECK ("ward_old_ward_overlaps"."published_overlap_basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "ward_key_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"ward_id" integer NOT NULL,
	"position" integer NOT NULL,
	"name_en" text NOT NULL,
	"name_kn" text NOT NULL,
	CONSTRAINT "ward_key_areas_position_check" CHECK ("ward_key_areas"."position" > 0)
);
--> statement-breakpoint
ALTER TABLE "ward_old_ward_overlaps" ADD CONSTRAINT "ward_old_ward_overlaps_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ward_key_areas" ADD CONSTRAINT "ward_key_areas_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ward_old_ward_overlaps_ward_position_uq" ON "ward_old_ward_overlaps" USING btree ("ward_id","position");
--> statement-breakpoint
CREATE INDEX "ward_old_ward_overlaps_ward_idx" ON "ward_old_ward_overlaps" USING btree ("ward_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ward_key_areas_ward_position_uq" ON "ward_key_areas" USING btree ("ward_id","position");
--> statement-breakpoint
CREATE INDEX "ward_key_areas_ward_idx" ON "ward_key_areas" USING btree ("ward_id");
