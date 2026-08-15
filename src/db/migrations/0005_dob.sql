-- ─── Replace personnummer with date of birth ───
--
-- Drops the encrypted SSN columns + their blind-index uniqueness keys,
-- and adds a single plaintext date column to both users and
-- guest_registrations. DOB is not identity, so no encryption, no
-- blind index, no uniqueness constraint.

ALTER TABLE "users" DROP COLUMN IF EXISTS "ssn";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "ssn_hash";--> statement-breakpoint
DROP INDEX IF EXISTS "users_ssn_hash_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_date" date;--> statement-breakpoint

ALTER TABLE "guest_registrations" DROP COLUMN IF EXISTS "guest_ssn";--> statement-breakpoint
ALTER TABLE "guest_registrations" DROP COLUMN IF EXISTS "guest_ssn_hash";--> statement-breakpoint
DROP INDEX IF EXISTS "guest_ssn_event_unique";--> statement-breakpoint
ALTER TABLE "guest_registrations" ADD COLUMN "guest_birth_date" date;
