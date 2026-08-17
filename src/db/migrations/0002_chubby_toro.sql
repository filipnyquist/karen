ALTER TABLE "invitations" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::text;--> statement-breakpoint
-- Backfill: any pre-existing role='responsible' users (from the
-- dead/manual-only tier) are migrated to role='user' AND granted the
-- 'responsible' education row, so the privilege survives. No-op when
-- the user table doesn't contain any such rows (which is the expected
-- state — see src/services/responsible-education.ts for the rationale).
DO $$
DECLARE
    edu_id integer;
    rec record;
BEGIN
    SELECT id INTO edu_id FROM education_types WHERE name = 'responsible';
    IF edu_id IS NULL THEN
        -- The 'responsible' education type isn't seeded yet. Either the
        -- seed hasn't run or the operator removed it; skip the grant so
        -- the rest of the migration can proceed and fail loudly later
        -- via the new column CHECK rather than nuking the whole change.
        RAISE NOTICE 'Skipping backfill: no education_types row named ''responsible'' exists';
        RETURN;
    END IF;
    FOR rec IN SELECT id FROM users WHERE role = 'responsible' LOOP
        INSERT INTO user_educations (user_id, education_type_id, completed_at, verified_by)
        VALUES (rec.id, edu_id, NOW(), NULL)
        ON CONFLICT (user_id, education_type_id) DO NOTHING;
        UPDATE users SET role = 'user', updated_at = NOW() WHERE id = rec.id;
    END LOOP;
END $$;--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'superadmin');--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";