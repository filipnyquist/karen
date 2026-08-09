Never add Co-Authored-By lines to commits.

## Stack

Astro SSR + Preact islands, Elysia API mounted under `/api/*`, Postgres via the `postgres` driver and Drizzle ORM, Yjs for the live report collab, Bun as the runtime and package manager.

- Use `bun <file>` instead of `node <file>`, `bun test`, `bun install`, `bun run <script>`, `bunx <pkg>`.
- Bun auto-loads `.env`. Do not use `dotenv`.
- The web framework is Astro, not Bun.serve. Do not introduce `Bun.serve()`, `bun:sqlite`, `Bun.sql`, or `Bun.redis` — the project uses Astro's HTTP server with `postgres-js` for the database.

## Database

- Schema lives in `src/db/schema.ts`; migrations in `src/db/migrations/`.
- Edit schema → `bun run db:generate` → review the SQL → `bun run db:migrate`.
- Tests use `src/db/seed-test.ts`; production uses `src/db/seed.ts`.

## Encryption

`ENCRYPTION_KEY` is a 64-char hex string (32 bytes). All AES-256-GCM and HMAC subkeys are derived from it via HKDF-SHA-256 with domain-separation `info` strings defined in `src/lib/encryption.ts`. Changing the HKDF info strings invalidates all existing encrypted data — only change them on a fresh database.

## Testing

`bun test` for unit tests, `bun run test:e2e` for Playwright (self-contained via `docker-compose.e2e.yml`).

## Compose files

Three files, each one purpose:

- `docker-compose.yml` — production stack (app + db + migrate).
- `docker-compose.dev.yml` — dev stack with hot reload; uses `Dockerfile.dev`.
- `docker-compose.import.yml` — opt-in flow for importing legacy pykaren (MySQL) data; the operator runs this manually after placing `karen_dump.sql` in the project root.

All three share the fixed `karen-net` network so the import stack can reach the dev/prod `db` regardless of cwd.
