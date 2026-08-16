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
cp .env.example .env             # fill in ADMIN_PASSWORD, SUPERADMIN_PASSWORD
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
├── lib/                          # Shared libs (login limiter, guards, CSP)
├── pages/                        # Astro SSR pages (file-based routing)
│   └── [...slugs].ts             # Mounts Elysia under /api/*
├── services/                     # Business logic
├── styles/                       # Global CSS
├── utils/
└── middleware.ts                 # Astro middleware — auth + locale + security headers

e2e/                              # Playwright E2E specs
docker-compose.yml                # Production stack (app + db + migrate + Traefik labels)
docker-compose.dev.yml            # Dev stack (app + db + migrate, hot-reload mounts)
```

## Legacy Import

`src/db/import-legacy.ts` reads from a MySQL database (configured via `LEGACY_DATABASE_URL`) and writes into the Postgres `db` service. The importer is not wired into the compose files; when a legacy migration is needed, run it manually with the dump available locally. Output goes to the `legacyMappings` table so old primary keys can be reconciled with new users.

## Environment Variables

All vars live in `.env` (gitignored). See `.env.example` for a template.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `BASE_URL` | Yes (prod) | `http://localhost:4321` | App base URL; in production must point at the public origin (used in email links) |
| `ADMIN_PASSWORD` | Yes | — | Password for the seeded `admin@karen.se` user (consumed by `bun run db:seed`) |
| `SUPERADMIN_PASSWORD` | Yes | — | Same, for `superadmin@karen.se` |
| `SESSION_SECRET` | No | — | Reserved for future session signing. Not currently read by code; sessions are random opaque tokens stored server-side. |
| `SMTP_HOST` | No | — | SMTP server. Omit to log outgoing emails to the console instead. |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | `noreply@karen.se` | Sender address |
| `SESSION_MAX_AGE_MS` | No | `2592000000` | Session duration (30 days) |
| `DEFAULT_MAX_GUESTS` | No | `35` | Max guests per event |
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
- **Date-of-birth storage**: Plaintext YYYY-MM-DD, used for the legal-drinking-age check at events. Stored only after the user opts in to registering guests; not collected at signup.
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

`docker-compose.import.yml` was previously folded into `docker-compose.yml` and `docker-compose.dev.yml` behind the `import` profile. Those services have been removed; the importer is now run manually. See the [Legacy Import](#legacy-import) section above.

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
| `bun run test:e2e` | Run E2E tests (self-contained) |
| `bun run test:e2e:ui` | Same, with Playwright UI |
| `bun run test:e2e:debug` | Same, with step-through debugger |
| `bun run test:e2e:cleanup` | Stop E2E Docker containers |
