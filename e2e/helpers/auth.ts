import { existsSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

interface SeedSecret {
    password: string;
}

interface SecretsFile {
    users: Record<string, SeedSecret>;
    migrationToken: string;
}

const SECRETS_PATH = "./uploads/.e2e-secrets";

/** Read and cache the secrets file. */
let cachedSecrets: SecretsFile | null = null;
function loadSecrets(): SecretsFile {
    if (cachedSecrets) return cachedSecrets;
    if (!existsSync(SECRETS_PATH)) {
        throw new Error(
            `Missing ${SECRETS_PATH} — run \`bun src/db/seed-test.ts\` first.`,
        );
    }
    const raw = readFileSync(SECRETS_PATH, "utf-8");
    cachedSecrets = JSON.parse(raw) as SecretsFile;
    return cachedSecrets;
}

/** Users with their e2e-only passwords (auto-generated per seed run). */
export const TEST_USER_KEYS = [
    "admin",
    "superadmin",
    "alice",
    "bob",
    "charlie",
    "diana",
    "erik",
    "freja",
    "gustav",
    "hanna",
    "newbie",
    "migrant",
] as const;
export type TestUserKey = (typeof TEST_USER_KEYS)[number];

const TEST_USER_EMAILS: Record<TestUserKey, string> = {
    admin: "admin@karen.se",
    superadmin: "superadmin@karen.se",
    alice: "alice@karen.se",
    bob: "bob@karen.se",
    charlie: "charlie@karen.se",
    diana: "diana@karen.se",
    erik: "erik@karen.se",
    freja: "freja@karen.se",
    gustav: "gustav@karen.se",
    hanna: "hanna@karen.se",
    newbie: "newbie@karen.se",
    migrant: "migrant@karen.se",
};

/** Get the password for a seeded test user by email. */
export function getPasswordFor(email: string): string {
    const secrets = loadSecrets();
    const secret = secrets.users[email];
    if (!secret) {
        throw new Error(
            `No password for ${email} in ${SECRETS_PATH}. Re-run \`bun src/db/seed-test.ts\`.`,
        );
    }
    return secret.password;
}

/** The migration token currently in the DB (matches `legacyMappings.migrationToken`). */
export function getMigrationToken(): string {
    const secrets = loadSecrets();
    return secrets.migrationToken;
}

export async function login(page: Page, userKey: TestUserKey = "alice") {
    const email = TEST_USER_EMAILS[userKey];
    const password = getPasswordFor(email);
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForURL("/");
}

export async function logout(page: Page) {
    await page.click('button:has-text("Logga ut")');
    await page.waitForURL("/");
}

/** Find an event ID by name via the API (with retry) */
export async function findEventId(
    page: Page,
    name: string,
): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await page.request.get("/api/events");
        const events = (await res.json()) as Array<{
            id: string;
            name: string;
        }>;
        const event = events.find((e) => e.name === name);
        if (event?.id) return event.id;
        await page.waitForTimeout(500);
    }
    return null;
}

/** Find a user ID by email via the API (admin only) */
export async function findUserId(
    page: Page,
    email: string,
): Promise<string | null> {
    const res = await page.request.get("/api/admin/users");
    if (!res.ok) return null;
    const users = (await res.json()) as Array<{ id: string; email: string }>;
    const user = users.find((u) => u.email === email);
    return user?.id ?? null;
}

/** Confirm the custom app modal */
export async function confirmModal(page: Page) {
    await page.waitForSelector("#app-modal:not(.hidden)", { state: "visible" });
    await page.click("#app-modal-confirm");
}
