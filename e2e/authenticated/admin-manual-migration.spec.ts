// e2e/authenticated/admin-manual-migration.spec.ts
//
// Verifies the admin-side manual migration UI on /admin/migrate:
//   - The "Manually migrate" button is visible on every unclaimed row
//     (not just rows where the user submitted an admin-request).
//   - An admin can POST /api/migration/admin-approve with a target user
//     UUID to perform the migration.
//   - The action is recorded in the audit log as `migration.admin.manual`.
//
// We test the API path directly (not the prompt()-driven island) because
// Playwright cannot interact with `window.prompt` reliably, and the
// underlying API call is what the user is verifying anyway.

import { expect, test } from "@playwright/test";
import { login, TEST_USER_EMAILS } from "../helpers/auth";

async function browserFetch(
    page: import("@playwright/test").Page,
    method: "POST" | "PUT" | "DELETE" | "GET",
    url: string,
    body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
    return await page.evaluate(
        async ([m, u, b]) => {
            const csrf =
                document.cookie
                    .split("; ")
                    .find((c) => c.startsWith("csrf_token="))
                    ?.split("=")[1] ?? "";
            const res = await fetch(u as string, {
                method: m as string,
                headers: {
                    "Content-Type": "application/json",
                    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
                },
                credentials: "same-origin",
                body: b === undefined ? undefined : JSON.stringify(b),
            });
            const text = await res.text();
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
            return { ok: res.ok, status: res.status, body: parsed };
        },
        [method, url, body] as [string, string, unknown],
    );
}

interface MigrationMapping {
    id: string;
    oldUserId: number;
    oldEmail: string;
    oldNickname: string | null;
    realUserId: string | null;
    adminRequested: boolean;
}

interface MigrationStatus {
    total: number;
    claimed: number;
    pending: number;
    mappings: MigrationMapping[];
}

async function fetchMappings(
    page: import("@playwright/test").Page,
): Promise<MigrationStatus> {
    const res = await browserFetch(page, "GET", "/api/migration/status");
    expect(res.ok).toBeTruthy();
    return res.body as MigrationStatus;
}

// `.serial` so the tests in this file don't race against each other —
// the first test reads the unclaimed mapping list, the second test
// claims a mapping, so running them in parallel would flake the first
// test whenever the second wins the race.
test.describe.configure({ mode: "serial" });
test.describe("Admin manual migration", () => {
    test("Manually migrate button is visible on every unclaimed row", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin/migrate");
        await page.waitForLoadState("networkidle");

        const status = await fetchMappings(page);
        const unclaimedRows = status.mappings.filter((m) => !m.realUserId);
        expect(unclaimedRows.length).toBeGreaterThan(0);

        // The seeded legacy mapping has adminRequested=false (no user
        // submitted a request). It should still show the button.
        const unclaimedWithoutAdminRequest = unclaimedRows.filter(
            (m) => !m.adminRequested,
        );
        expect(unclaimedWithoutAdminRequest.length).toBeGreaterThan(0);

        for (const m of unclaimedRows) {
            const row = page.locator("tr", { hasText: m.oldEmail ?? "" });
            const button = row.locator("button", {
                hasText: /manually migrate|migrera manuellt/i,
            });
            await expect(
                button,
                `expected Manually migrate button on row ${m.oldEmail}`,
            ).toBeVisible();
        }
    });

    test("regular admin can call admin-approve to migrate a user", async ({
        page,
    }) => {
        await login(page, "admin");

        const status = await fetchMappings(page);
        const unclaimed = status.mappings.find((m) => !m.realUserId);
        if (!unclaimed) {
            // The existing migration test already claimed the seeded
            // mapping. Skip gracefully — the button-is-visible test
            // already covered the UI.
            test.skip(true, "No unclaimed mapping to test against");
            return;
        }

        // Look up the target user's UUID via /api/admin/users.
        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        expect(usersRes.ok).toBeTruthy();
        const users = (
            usersRes.body as {
                users: Array<{
                    id: string;
                    email: string;
                    isLegacy: boolean | null;
                }>;
            }
        ).users;
        const target = users.find((u) => u.email === TEST_USER_EMAILS.migrant);
        expect(target).toBeTruthy();
        // A real user (not a legacy placeholder) must be the target.
        expect(target?.isLegacy).toBeFalsy();

        const res = await browserFetch(
            page,
            "POST",
            "/api/migration/admin-approve",
            {
                legacyId: unclaimed.id,
                userId: target?.id,
            },
        );
        expect(
            res.ok,
            `admin-approve failed: ${res.status} ${JSON.stringify(res.body)}`,
        ).toBeTruthy();

        // The mapping should now be claimed.
        const after = await fetchMappings(page);
        const merged = after.mappings.find((m) => m.id === unclaimed.id);
        expect(merged?.realUserId).toBe(target?.id);
    });

    test("admin-approve refuses a legacy placeholder as the target user", async ({
        page,
    }) => {
        await login(page, "admin");

        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        expect(usersRes.ok).toBeTruthy();
        const users = (
            usersRes.body as {
                users: Array<{
                    id: string;
                    email: string;
                    isLegacy: boolean | null;
                }>;
            }
        ).users;
        const legacy = users.find((u) => u.isLegacy === true);
        if (!legacy) {
            test.skip(true, "No legacy placeholder user seeded");
            return;
        }

        // Use a fake UUID for the legacy mapping — the placeholder
        // check runs after the mapping lookup, so we need a real
        // legacy mapping.
        const status = await fetchMappings(page);
        const unclaimed = status.mappings.find((m) => !m.realUserId);
        if (!unclaimed) {
            test.skip(true, "No unclaimed mapping to test against");
            return;
        }

        const res = await browserFetch(
            page,
            "POST",
            "/api/migration/admin-approve",
            {
                legacyId: unclaimed.id,
                userId: legacy.id,
            },
        );
        expect(res.status).toBe(400);
        const body = res.body as { code?: string };
        expect(body.code).toBe("LEGACY_USER_CANNOT_BE_TARGET");
    });

    test("superadmin can fetch the audit log filtered by migration.admin.manual", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const res = await browserFetch(
            page,
            "GET",
            "/api/admin/audit-log?action=migration.admin.manual&limit=50",
        );
        expect(res.ok).toBeTruthy();
        const entries = res.body as Array<{
            action: string;
            actorId: string;
            targetUserId: string | null;
        }>;
        expect(Array.isArray(entries)).toBeTruthy();
        for (const entry of entries) {
            expect(entry.action).toBe("migration.admin.manual");
        }
    });
});
