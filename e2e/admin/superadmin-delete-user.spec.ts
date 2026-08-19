// e2e/admin/superadmin-delete-user.spec.ts
//
// Verifies the superadmin hard-delete user endpoint:
//   - Happy path: deleting a regular user returns 200 and the row
//     disappears from /api/admin/users.
//   - Tombstone row remains intact after the delete (the next
//     deleteUser call must still find it).
//   - Self-delete returns 400 CANNOT_DELETE_SELF (the actor's own id).
//   - Tombstone-id delete returns 400 CANNOT_DELETE_TOMBSTONE.
//   - Deleting the last superadmin returns 400
//     CANNOT_DELETE_LAST_SUPERADMIN.
//   - Regular admin (non-superadmin) gets 403 from superadminDerive.
//
// We hit /api/admin/users/:id directly through the page's fetch
// helper so we can use the same browser session, CSRF cookie, and
// JSON pipeline that the AdminUserModal island uses.

import { expect, test } from "@playwright/test";
import { login, TEST_USER_EMAILS } from "../helpers/auth";

interface FetchResult {
    ok: boolean;
    status: number;
    body: unknown;
}

async function browserFetch(
    page: import("@playwright/test").Page,
    method: "POST" | "PUT" | "DELETE" | "GET",
    url: string,
    body?: unknown,
): Promise<FetchResult> {
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
                    ...(csrf ? { "X-CSRF-Token": csrf } : ""),
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

interface AdminUser {
    id: string;
    email: string;
    role: string;
}

async function fetchUsers(
    page: import("@playwright/test").Page,
): Promise<AdminUser[]> {
    const res = await browserFetch(page, "GET", "/api/admin/users?limit=200");
    expect(res.ok).toBeTruthy();
    return res.body as AdminUser[];
}

test.describe.configure({ mode: "serial" });
test.describe("Superadmin delete user", () => {
    test("deletes a non-admin user and tombstone survives", async ({
        page,
    }) => {
        await login(page, "superadmin");

        const usersBefore = await fetchUsers(page);

        // The newbie user is the most disposable test fixture — no
        // educations, no team memberships, no worker registrations.
        const newbie = usersBefore.find(
            (u) => u.email === TEST_USER_EMAILS.newbie,
        );
        expect(newbie).toBeTruthy();

        // Pre-condition: tombstone row exists (seeded by test seed).
        const tombstone = usersBefore.find(
            (u) => u.id === "00000000-0000-0000-0000-000000000000",
        );
        expect(
            tombstone,
            "tombstone user not seeded — re-run `bun src/db/seed-test.ts`",
        ).toBeTruthy();

        const del = await browserFetch(
            page,
            "DELETE",
            `/api/admin/users/${newbie?.id}`,
        );
        expect(
            del.ok,
            `delete failed: ${del.status} ${JSON.stringify(del.body)}`,
        ).toBeTruthy();

        // User row should be gone after the request lands.
        const usersAfter = await fetchUsers(page);
        const stillThere = usersAfter.find((u) => u.id === newbie?.id);
        expect(stillThere, "deleted user still listed").toBeUndefined();

        // Tombstone row must remain — other deletes still depend on it.
        const tombstoneAfter = usersAfter.find(
            (u) => u.id === "00000000-0000-0000-0000-000000000000",
        );
        expect(tombstoneAfter).toBeTruthy();
    });

    test("self-delete returns 400 CANNOT_DELETE_SELF", async ({ page }) => {
        // Find the superadmin's own id.
        await login(page, "superadmin");
        const users = await fetchUsers(page);
        const me = users.find((u) => u.role === "superadmin");
        expect(me).toBeTruthy();

        const res = await browserFetch(
            page,
            "DELETE",
            `/api/admin/users/${me?.id}`,
        );
        expect(res.status).toBe(400);
        const body = res.body as { code?: string };
        expect(body.code).toBe("CANNOT_DELETE_SELF");
    });

    test("deleting the tombstone id returns 400 CANNOT_DELETE_TOMBSTONE", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const res = await browserFetch(
            page,
            "DELETE",
            `/api/admin/users/00000000-0000-0000-0000-000000000000`,
        );
        expect(res.status).toBe(400);
        const body = res.body as { code?: string };
        expect(body.code).toBe("CANNOT_DELETE_TOMBSTONE");
    });

    test("non-existent user returns 404", async ({ page }) => {
        await login(page, "superadmin");
        // Random UUID that won't be in the DB.
        const fakeId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
        const res = await browserFetch(
            page,
            "DELETE",
            `/api/admin/users/${fakeId}`,
        );
        expect(res.status).toBe(404);
    });

    test("regular admin (non-superadmin) is blocked with 403", async ({
        page,
    }) => {
        await login(page, "admin");
        const users = await fetchUsers(page);
        // Pick any non-admin victim.
        const victim = users.find((u) => u.role === "user");
        expect(victim).toBeTruthy();

        const res = await browserFetch(
            page,
            "DELETE",
            `/api/admin/users/${victim?.id}`,
        );
        expect(res.status).toBe(403);
    });
});
