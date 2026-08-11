ALTER TABLE "users" ADD COLUMN "ssn" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ssn_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_ssn_hash_unique" ON "users" USING btree ("ssn_hash") WHERE "users"."ssn_hash" IS NOT NULL;