-- Cap existing oversized comments at the new 500-char policy.
-- Runs before the CHECK is added so a long row can never block the
-- ADD CONSTRAINT below. Both statements execute in one transaction
-- (drizzle-kit migrate wraps each .sql file by default).
--
-- Truncation is silent — no suffix marker. Rows ≤ 500 chars are untouched.
UPDATE "comments" SET "content" = LEFT("content", 500) WHERE char_length("content") > 500;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_length_chk" CHECK (char_length("comments"."content") <= 500);