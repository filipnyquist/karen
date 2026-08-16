// src/config.ts

/**
 * Throw a clear error if a required environment variable is missing.
 * Use this for secrets that must never silently fall back to a default.
 */
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} must be set in the environment (see .env.example)`,
        );
    }
    return value;
}

/**
 * Whether to require TLS when connecting to Postgres. Defaults to on in
 * production and off in dev/test so local plain-postgres containers work.
 * Override via DATABASE_SSL=require|disable or by including `sslmode=require`
 * in the DATABASE_URL.
 */
function databaseSslEnabled(): boolean {
    if (process.env.DATABASE_SSL === "disable") return false;
    if (process.env.DATABASE_SSL === "require") return true;
    if (process.env.DATABASE_URL?.includes("sslmode=require")) return true;
    return process.env.NODE_ENV === "production";
}

/**
 * DATABASE_URL — required at runtime when the DB driver is invoked, but
 * kept as a lazy getter so `bun run build` / `bun run check` (which load
 * this module without connecting) don't crash on developer machines.
 */
function getDatabaseUrl(): string {
    return process.env.DATABASE_URL ?? "postgresql://localhost:5432/karen";
}

export const config = {
    /** Lazy: only throws at access if empty when used by the DB driver. */
    get databaseUrl(): string {
        const url = getDatabaseUrl();
        if (!url) requireEnv("DATABASE_URL");
        return url;
    },
    databaseSsl: databaseSslEnabled(),
    smtp: {
        host: process.env.SMTP_HOST ?? "",
        port: Number.parseInt(process.env.SMTP_PORT ?? "587", 10),
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
        from: process.env.SMTP_FROM ?? "noreply@karen.se",
    },
    turnstile: {
        sitekey: process.env.TURNSTILE_SITEKEY ?? "",
        secret: process.env.TURNSTILE_SECRET ?? "",
    },
    get baseUrl(): string {
        if (process.env.BASE_URL) return process.env.BASE_URL;
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "BASE_URL must be set in the environment in production (see .env.example) — refusing to default to http://localhost:4321 which would link invitation emails to a non-routable host",
            );
        }
        return "http://localhost:4321";
    },
    adminPassword: () => requireEnv("ADMIN_PASSWORD"),
    superadminPassword: () => requireEnv("SUPERADMIN_PASSWORD"),
    sessionMaxAgeMs: Number.parseInt(
        process.env.SESSION_MAX_AGE_MS ?? "2592000000",
        10,
    ),
    defaultMaxGuests: Number.parseInt(
        process.env.DEFAULT_MAX_GUESTS ?? "35",
        10,
    ),
    defaultMaxGuestsPerUser: Number.parseInt(
        process.env.DEFAULT_MAX_GUESTS_PER_USER ?? "3",
        10,
    ),
};
