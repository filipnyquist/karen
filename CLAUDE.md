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
- `src/db/import-legacy.ts` reads MySQL via `LEGACY_DATABASE_URL` and writes to Postgres. Not wired into the compose files anymore; operators run it manually when needed.

## Subsystems

- **API mount**: Elysia is served under `/api/*` via `src/pages/[...slugs].ts` forwarding to the app assembled in `src/api/index.ts`.
- **Legacy migration flow**: `src/api/routes/migration.ts` plus the `legacyMappings` table. Superadmin-gated endpoints `/api/migration/admin-approve` and `/api/migration/status`. Marked-legacy users (`users.isLegacy`) see a one-time claim prompt.
- **Superadmin tier**: Created by `src/db/seed.ts` from `SUPERADMIN_PASSWORD`. Required for `/api/migration/admin-approve` and for role changes via `PUT /api/admin/users/:id` (`src/api/middleware/auth.ts:isSuperadmin`).
- **CSRF**: `src/api/middleware/csrf.ts` enforces a double-submit cookie — the `X-CSRF-Token` request header must match the `csrf_token` cookie. Unauthenticated routes exempt: `/api/auth/login`, `/api/auth/register`, `/api/auth/verify-email`, `/api/auth/verify-student`, `/api/invitations/accept`.
- **CSP (Astro 7)**: `'self'` is NOT auto-added to `script-src`. Pages with user-authored inline scripts (login, register, BaseLayout, event, pubteam) must call `Astro.csp?.insertScriptHash()` for each literal script. Turnstile iframe whitelisted via `allowedDomains` in `astro.config.mjs`. Don't pin SRI on Turnstile's `api.js` (Cloudflare rotates the bytes in place).
- **Yjs WebSocket**: `src/server.ts` uses byte-prefixed frames — `0x00` doc update, `0x01` awareness, `0x02` saved notification. The Vite dev server mirrors this handler via `src/integrations/ws-dev.ts`.

## Testing

- Unit tests: `bun test src/` (Bun auto-discovers `src/**/*.test.ts`; no `test` script in `package.json`).
- E2E: `bun run test:e2e`. Playwright spins up its own ephemeral stack via `docker-compose.e2e.yml`. `e2e/global-setup.ts` does cleanup → `docker compose -f docker-compose.e2e.yml up -d --wait` → `bun db:migrate` → `bun src/db/seed-test.ts` → wait-for-app → warm-up fetches. `playwright.config.ts` pins port `4322`, locale `sv-SE`, `chromium` project.

## Lint & format

Biome replaces Prettier/ESLint. Scripts in `package.json`: `lint`, `format`, `format:check`, `check`, `check:fix`. `biome.json` at repo root. CI runs `bun run check`.

## Runtime configuration

- **TZ**: pinned to `Europe/Stockholm` in all compose files. Without this, SSR-side `toLocaleTimeString` renders two hours behind wall-clock form input (CEST = UTC+2).
- **DATABASE_SSL**: `src/config.ts:databaseSslEnabled()` defaults to `require` in production, `disabled` in dev. Override via `DATABASE_SSL=disable|require` env or by appending `sslmode=require` to `DATABASE_URL`.
- **SESSION_SECRET**: currently a no-op. Set in all compose files but no code reads it — sessions are random opaque tokens stored server-side, not HMAC-signed. Leave the env in place as future-proofing, but don't rely on it today. If real session signing is ever added, gate it through `config.sessionSecret` and add a production guard mirroring `BASE_URL`.

## Compose files

Three files, each one purpose:

- `docker-compose.yml` — production stack (app + db + migrate).
- `docker-compose.dev.yml` — dev stack with hot reload; uses `Dockerfile.dev`.
- `docker-compose.e2e.yml` — ephemeral stack spun up by Playwright for E2E runs.

All stacks share the fixed `karen-net` network so a dev-stack `db` can be reached from the prod compose (and vice versa) regardless of cwd.