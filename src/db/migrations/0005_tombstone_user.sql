-- Tombstone system user: absorbs FK reassignments when a real user is
-- hard-deleted (see src/api/routes/superadminUsers.ts / deleteUser).
-- The fixed zero-UUID keeps the seed idempotent across envs: re-running
-- the migration is a no-op via ON CONFLICT DO NOTHING. The row is also
-- appended with onConflictDoNothing() in src/db/seed.ts and
-- src/db/seed-test.ts so the four-layer safety net covers every code
-- path into deleteUser (migration + prod seed + test seed +
-- runtime TOMBSTONE_NOT_FOUND guard). Cannot log in: password_hash is
-- NULL and email lives on the reserved .invalid TLD.
INSERT INTO "users" (
    "id", "email", "password_hash", "nickname", "name",
    "email_verified", "verified", "role", "is_legacy",
    "seen_migration_prompt", "created_at", "updated_at"
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'deleted@karen.invalid',
    NULL,
    'Deleted User',
    NULL,
    false,
    false,
    'user',
    false,
    true,
    now(),
    now()
)
ON CONFLICT ("id") DO NOTHING;
