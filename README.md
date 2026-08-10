# Karen

Student pub management system — event planning, worker scheduling, ticketing, scoring, team management, and legacy account migration.

Built with **Astro**, **Elysia**, **Drizzle ORM**, **Preact**, and **Bun**.

## Requirements

- [Bun](https://bun.sh/) >= 1.x
- Docker + Docker Compose (for the database and E2E tests)
- PostgreSQL 16

## Quick Start

```bash
bun install
cp .env.example .env             # fill in ENCRYPTION_KEY, ADMIN_PASSWORD, SUPERADMIN_PASSWORD
docker compose -f docker-compose.dev.yml up --build
```

App on `http://localhost:4321`. PostgreSQL on `localhost:5432`. Migrations and seed run automatically on first start.

## Project Structure

```
src/
├── api/                          # Elysia app — all /api/* route modules
│   ├── index.ts
│   ├── middleware/               # auth, error handling, rate limiting
│   └── routes/                   # auth, events, teams, tickets, …
├── components/                   # Static Astro components
├── db/
│   ├── schema.ts                 # Drizzle table definitions + relations
│   ├── migrations/               # Generated SQL migrations
│   ├── index.ts                  # DB client
│   ├── seed.ts                   # Production seed
│   └── seed-test.ts              # E2E test seed
├── i18n/                         # sv.ts (default) + en.ts
├── islands/                      # Preact interactive components
├── layouts/                      # Astro page layouts
├── lib/                          # Shared libs (encryption, login limiter)
├── pages/                        # Astro SSR pages (file-based routing)
│   └── [...slugs].ts             # Mounts Elysia under /api/*
├── services/                     # Business logic
├── styles/                       # Global CSS
├── utils/
└── middleware.ts                 # Astro middleware — auth + locale + security headers
scripts/                          # One-off scripts (SSN encryption migration)
e2e/                              # Playwright E2E specs
docker-compose.yml                # Production stack (app + db + migrate + Traefik labels)
docker-compose.dev.yml            # Dev stack (app + db + migrate, hot-reload mounts)
```

## Legacy Import

`docker-compose.yml` defines two **opt-in** services behind a `profiles: ["import"]` gate: `legacy-db` (MariaDB with the pykaren dump auto-loaded) and `legacy-import` (TypeScript importer that reads MySQL → writes Postgres). They do not start on a normal `up` — you invoke them explicitly:

### Against the dev stack (recommended first run, to validate)

```bash
# 1. Place `karen_dump.sql` at the project root (gitignored).
# 2. Bring up the dev db + migrate + app.
docker compose -f docker-compose.dev.yml up -d db migrate app
# 3. Run the importer. legacy-db cold-loads the dump (~30-60 s on a fresh
#    volume), then legacy-import runs once, exits 0 on success.
docker compose -f docker-compose.dev.yml --profile import up legacy-import
# 4. Tear down ONLY the import side (keeps the dev stack running).
docker compose -f docker-compose.dev.yml stop legacy-db legacy-import
docker compose -f docker-compose.dev.yml rm -f legacy-db legacy-import
```

### Against prod

```bash
docker compose up -d db app
docker compose --profile import up legacy-import
docker compose stop legacy-db legacy-import
docker compose rm -f legacy-db legacy-import
```

### Gotchas

- `docker compose --profile import down` is a foot-gun: compose's `down` ignores profile filters and tears down the **entire** project (app, db, network). Always use `stop` + `rm` on the two specific services.
- The importer reads `ENCRYPTION_KEY` from `.env` (via `env_file`) — guest SSNs in the dump get encrypted on the way into Postgres.
- A successful import from the prod dump typically yields ~1.5k placeholder users, ~1k events, ~7.5k worker registrations, ~2.5k guest registrations, ~1k tickets, ~1k reports. The `legacy_mappings` table records the old MySQL primary key for every imported row.

## Environment Variables

All vars live in `.env` (gitignored). See `.env.example` for a template.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `BASE_URL` | Yes (prod) | `http://localhost:4321` | App base URL; in production must point at the public origin (used in email links) |
| `ENCRYPTION_KEY` | Yes | — | 64-char hex key for SSN encryption. Generate with `openssl rand -hex 32`. Rotating this key invalidates all existing encrypted SSNs. |
| `ADMIN_PASSWORD` | Yes | — | Password for the seeded `admin@karen.se` user (consumed by `bun run db:seed`) |
| `SUPERADMIN_PASSWORD` | Yes | — | Same, for `superadmin@karen.se` |
| `SESSION_SECRET` | Yes (prod) | — | Used to derive session cookie keys |
| `SMTP_HOST` | No | — | SMTP server. Omit to log outgoing emails to the console instead. |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | `noreply@karen.se` | Sender address |
| `SESSION_MAX_AGE_MS` | No | `2592000000` | Session duration (30 days) |
| `DEFAULT_MAX_GUESTS` | No | `50` | Max guests per event |
| `DEFAULT_MAX_GUESTS_PER_USER` | No | `3` | Max guests per user per event |
| `TURNSTILE_SITEKEY` | No | — | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET` | No | — | Cloudflare Turnstile secret. When set, captcha is required for login/register. |
| `UPLOAD_DIR` | No | `./uploads` | Directory for uploaded files |

## Security

- **Authentication**: Session-based with HttpOnly, Secure, SameSite=Lax cookies. 256-bit random session tokens stored in PostgreSQL.
- **Password hashing**: bcrypt via `Bun.password.hash()`.
- **Password policy**: Min 8 chars with uppercase, lowercase, and digit.
- **CAPTCHA**: Cloudflare Turnstile on login/register (required when `TURNSTILE_SECRET` is set).
- **Rate limiting**: 5 login attempts per IP per 15 minutes.
- **Account lockout**: Progressive 15-minute lockout after 5 failed attempts (per email+IP).
- **SSN encryption**: Guest personnummer are encrypted at rest with AES-256-GCM. Only responsibles and admins can decrypt. HMAC-based hash column for fast duplicate detection.
- **Security headers**: HSTS, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy.
- **XSS prevention**: No `innerHTML` usage in source code. Profile pictures set via server-controlled upload endpoint only.
- **File uploads**: Extension whitelist (jpg/jpeg/png/gif/webp), 5 MB size limit, `path.basename()` against traversal.
- **SQL injection**: All queries use Drizzle ORM with parameterized queries.

## Architecture

```
Browser
  │
  ▼
Astro middleware (src/middleware.ts)
  ├── Reads session_token cookie  → sets Astro.locals.user
  └── Reads lang cookie           → sets Astro.locals.t + .lang
  │
  ├─► Astro page (SSR)            → Drizzle fetch → render HTML → Preact islands
  │
  └─► /api/* (Elysia)             → mounted via src/pages/[...slugs].ts
```

### Production server layout

```
Browser
  → Node HTTP server (src/server.ts)
       ├── /ws/report/*   → WebSocket (Yjs CRDT)
       ├── /uploads/*     → static file serving
       └── /*             → Astro SSR handler (dist/server/entry.mjs)
```

The dev server uses a Vite plugin (`src/integrations/ws-dev.ts`) to provide the same WebSocket support during `astro dev`.

## Database

Schema is defined in `src/db/schema.ts` using Drizzle ORM with PostgreSQL.

```bash
bun run db:generate    # Generate migration from schema changes
bun run db:migrate     # Apply pending migrations
bun run db:seed        # Seed production data (education types, event states, locations, admin + superadmin users)
```

**Workflow:** Edit `src/db/schema.ts` → `bun run db:generate` → review the generated SQL in `src/db/migrations/` → `bun run db:migrate`.

## i18n

Two languages: **Swedish** (default) and **English**.

- Translations live in `src/i18n/sv.ts` and `src/i18n/en.ts` as nested objects.
- Access via dot notation: `t('nav.home')`, `t('auth.loginButton')`.
- Language switching via `lang` cookie (`sv` or `en`).

**Adding a new language:**
1. Create `src/i18n/<lang>.ts` with the same key structure as `sv.ts`.
2. Register it in `src/i18n/index.ts`.
3. Add a language toggle button (see existing SV/EN buttons in the layout).

## Adding a New Feature

Follow the existing pattern (e.g. how events work):

1. **Schema** — Add table to `src/db/schema.ts`, then `bun run db:generate && bun run db:migrate`.
2. **Service** — Create `src/services/<feature>.ts` with business logic and DB queries.
3. **API routes** — Create `src/api/routes/<feature>.ts` with Elysia; mount in `src/api/index.ts`.
4. **Page** — Create `src/pages/<feature>/*.astro` for server-rendered views.
5. **Island** (if interactive) — Create `src/islands/<Feature>Form.tsx` with `client:load`.
6. **i18n** — Add keys to both `src/i18n/sv.ts` and `src/i18n/en.ts`.
7. **E2E test** — Add spec file in `e2e/`.

## E2E Testing

Tests are fully self-contained — no manual setup needed.

```bash
bun run test:e2e              # Spin up Docker DB + app, run tests, tear down
bun run test:e2e:ui           # Same, with Playwright UI
bun run test:e2e:debug        # Same, with step-through debugger
bun run test:e2e:cleanup      # Manually stop E2E containers
```

`docker-compose.e2e.yml` starts ephemeral PostgreSQL + app containers, runs migrations, loads `src/db/seed-test.ts` (11 users, 6 events, 3 teams, legacy migration data), warms up the Vite dev server, and runs Playwright against `http://localhost:4322`. Containers and volumes are removed on exit.

All test users get randomly generated passwords, written to `./uploads/.e2e-secrets` (mode 0600). `e2e/helpers/auth.ts` reads the secrets file automatically — never hardcode credentials in test specs.

**CI:** `.github/workflows/e2e.yml` runs on every push/PR to `main`.

## Docker / Deployment

The repo ships **two** compose files, each doing one purpose:

### `docker-compose.dev.yml` — dev stack

Hot-reload dev environment with source bind-mounted into the app container. Used standalone on a laptop; does not join the host Traefik.

```bash
docker compose -f docker-compose.dev.yml up --build
```

Starts `app` (port 4321), `db` (Postgres 16, port 5432), and `migrate` (runs `bun db:migrate && bun db:seed` once, then exits).

### `docker-compose.yml` — production stack

Multi-stage build with no source bind mounts. Set env vars in `.env` (see `.env.example`).

```bash
cp .env.example .env          # edit with production values
docker compose up --build -d
```

Starts `app` (port 3000, via Node HTTP + Bun), `db` (Postgres 16 with persistent `pgdata` volume), and `migrate` (runs once and exits).

**Running migrations on an existing database:**

```bash
docker compose up migrate
```

Pending migrations are applied; the app container picks up schema changes on restart.

**Encrypting existing plaintext SSNs** (one-time, for upgrades from a pre-encryption version):

```bash
# 1. Set ENCRYPTION_KEY in .env
# 2. Run the migration that adds the guest_ssn_hash column
docker compose up migrate
# 3. Encrypt the existing plaintext SSNs
docker compose exec app bun scripts/encrypt-ssns.ts
```

`docker-compose.import.yml` was folded into `docker-compose.yml` and `docker-compose.dev.yml` behind the `import` profile. See the [Legacy Import](#legacy-import) section above for the current workflow.

## Scripts

| Script | Description |
|---|---|
| `bun run dev` | Start Astro dev server (port 4321) |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build |
| `bun run start` | Start production server (port 3000) |
| `bun run db:generate` | Generate Drizzle migration from schema |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:seed` | Seed production data |
| `bun scripts/encrypt-ssns.ts` | Encrypt existing plaintext SSNs (one-time) |
| `bun run test:e2e` | Run E2E tests (self-contained) |
| `bun run test:e2e:ui` | Same, with Playwright UI |
| `bun run test:e2e:debug` | Same, with step-through debugger |
| `bun run test:e2e:cleanup` | Stop E2E Docker containers |
