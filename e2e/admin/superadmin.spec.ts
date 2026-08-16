// e2e/admin/superadmin.spec.ts
//
// Verifies the superadmin tier:
//   - Superadmin can change roles including to/from superadmin.
//   - Regular admin cannot change roles that target admin/superadmin.
//   - Regular admin cannot view the audit log (page redirects, API 403s).
//   - Superadmin CAN view the audit log.
//   - Superadmin can issue an invitation; the invitee can claim it.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

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

test.describe("Superadmin role", () => {
    test("superadmin can change another user's role to admin", async ({
        page,
    }) => {
        await login(page, "superadmin");
        await page.waitForURL("/");

        // Find bob's user id via the admin listing.
        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        expect(usersRes.ok).toBeTruthy();
        const users = usersRes.body as Array<{ id: string; email: string }>;
        const bob = users.find((u) => u.email === "bob@karen.se");
        expect(bob).toBeTruthy();

        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bob?.id}`,
            { role: "admin" },
        );
        expect(
            putRes.ok,
            `PUT failed: ${putRes.status} ${JSON.stringify(putRes.body)}`,
        ).toBeTruthy();

        // Reset for idempotency — leave bob as user again so the spec
        // doesn't leak state into other tests.
        const resetRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bob?.id}`,
            { role: "user" },
        );
        expect(resetRes.ok).toBeTruthy();
    });

    test("regular admin cannot promote another user to admin", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.waitForURL("/");

        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        const users = usersRes.body as Array<{ id: string; email: string }>;
        const charlie = users.find((u) => u.email === "charlie@karen.se");
        expect(charlie).toBeTruthy();

        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${charlie?.id}`,
            { role: "admin" },
        );
        expect(putRes.status).toBe(403);
    });

    test("regular admin cannot view the audit log (page redirect)", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin/audit-log");
        await page.waitForURL("/");
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("regular admin cannot fetch the audit log (403)", async ({ page }) => {
        await login(page, "admin");
        const res = await browserFetch(page, "GET", "/api/admin/audit-log");
        expect(res.status).toBe(403);
    });

    test("superadmin CAN view the audit log page", async ({ page }) => {
        await login(page, "superadmin");
        await page.goto("/admin/audit-log");
        // Don't redirect away.
        expect(new URL(page.url()).pathname).toBe("/admin/audit-log");
    });

    test("superadmin CAN fetch the audit log API", async ({ page }) => {
        await login(page, "superadmin");
        const res = await browserFetch(page, "GET", "/api/admin/audit-log");
        expect(res.ok).toBeTruthy();
        const entries = res.body as Array<{ action: string }>;
        expect(Array.isArray(entries)).toBeTruthy();
    });

    test("invitation flow: superadmin creates, invitee accepts", async ({
        page,
        context,
    }) => {
        await login(page, "superadmin");
        await page.waitForURL("/");

        // POST a new invitation. The dev-mode response carries an acceptUrl.
        const inviteRes = await browserFetch(page, "POST", "/api/invitations", {
            email: "e2e-invited@karen.se",
            role: "admin",
        });
        expect(
            inviteRes.ok,
            `invite failed: ${inviteRes.status} ${JSON.stringify(inviteRes.body)}`,
        ).toBeTruthy();
        const invite = inviteRes.body as {
            email: string;
            role: string;
            acceptUrl?: string;
        };
        expect(invite.email).toBe("e2e-invited@karen.se");
        expect(invite.acceptUrl).toBeTruthy();

        // Extract the token from acceptUrl and submit the accept form.
        const token = new URL(invite.acceptUrl as string).searchParams.get(
            "token",
        );
        expect(token).toBeTruthy();

        // Call the accept endpoint with CSRF disabled (it's CSRF-exempt).
        const acceptRes = await page.evaluate(
            async ([tk]) => {
                const res = await fetch("/api/invitations/accept", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify({
                        token: tk,
                        password: "e2einvitedpass1",
                        name: "E2E Invited",
                        nickname: "invited",
                    }),
                });
                return { status: res.status };
            },
            [token] as [string],
        );
        expect(acceptRes.status).toBe(200);

        // The new admin user should now have an admin role.
        await context.clearCookies();
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.locator("#email").fill("e2e-invited@karen.se");
        await page.locator("#password").fill("e2einvitedpass1");
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL("/");

        // Verify role by hitting /api/admin/users (admin-or-superadmin only)
        // — but a brand-new admin needs to be discovered, so just check the
        // session by hitting /api/profile/me. We don't expose role there, so
        // instead check that the admin nav link is present.
        await page.goto("/admin");
        await page.waitForLoadState("networkidle");
        expect(new URL(page.url()).pathname).toBe("/admin");
    });
});
