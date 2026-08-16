ALTER TABLE "education_types" ADD COLUMN "name_sv" text;--> statement-breakpoint
ALTER TABLE "education_types" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "education_types" ADD COLUMN "description_sv" text;--> statement-breakpoint
ALTER TABLE "education_types" ADD COLUMN "description_en" text;--> statement-breakpoint
-- Backfill: existing rows were authored in Swedish; copy the
-- canonical name / description into name_sv / description_sv so the
-- profile render picks them up for sv viewers.
UPDATE "education_types" SET "name_sv" = "name" WHERE "name_sv" IS NULL;--> statement-breakpoint
UPDATE "education_types" SET "description_sv" = "description" WHERE "description_sv" IS NULL;
