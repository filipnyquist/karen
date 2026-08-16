# Security Policy

## Supported Versions

The latest commit on `main` is the only supported version. There are no
tagged releases or LTS branches; security fixes ship directly to `main`.

## Reporting a Vulnerability

Please report security issues by email to **fnyquist@pm.me** (PGP key on
request). Include a description of the issue, reproduction steps, and the
impact you believe it has.

I aim to acknowledge new reports within 72 hours and to publish a fix
(or a clear mitigation) within 30 days for issues rated High or Critical.
I will coordinate disclosure timing with you before any public write-up.

## Scope

In scope:

- Authentication, session handling, CSRF, CSP
- Authorization checks on `/api/*` routes
- User-data projection (PII leakage in SSR HTML or API responses)
- Upload handling, file storage, SSRF, SQL/NoSQL injection
- Yjs WebSocket protocol in `src/server.ts`
- Secrets handling (`.env`, compose env, `ENCRYPTION_KEY`, session
  signing material)

Out of scope:

- Vulnerabilities in `node_modules` / upstream packages (report upstream)
- Rate-limiting / DoS against the public deployment
- Reports against forks or downstream deployments that diverge from
  `main`

## Disclosure Contact

Same address as `public/.well-known/security.txt`:

- `mailto:fnyquist@pm.me`
- Preferred languages: English, Swedish
- Disclosure policy endpoint: <https://karen.nyqui.st/.well-known/security.txt>