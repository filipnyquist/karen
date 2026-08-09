import { defineConfig } from "drizzle-kit";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} must be set in the environment (see .env.example)`,
        );
    }
    return value;
}

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./src/db/migrations",
    dialect: "postgresql",
    dbCredentials: {
        // Lazy lookup so `drizzle-kit generate` works in environments
        // without DATABASE_URL — it's only required when applying migrations.
        get url() {
            return requireEnv("DATABASE_URL");
        },
    },
});
