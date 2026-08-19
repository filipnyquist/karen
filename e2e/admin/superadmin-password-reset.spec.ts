// e2e/admin/superadmin-password-reset.spec.ts
//
// Verifies the superadmin-only password reset:
//   - Superadmin can set a new password on another user via the API.
//   - The target user can log in with the new password.
//   - The target user's sessions are wiped (verified by trying the old
//     session and finding it dead).
//   - Regular admin cannot use the same endpoint (403).
//   - The UI surfaces a "Change password" button only for superadmins.

import { expect, test } from "@playwright/test";
import { login, logout, TEST_USER_EMAILS } from "../helpers/auth";

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

// `.serial` because every test in this file rotates bob's password.
// Running them in parallel causes one test's reset to overwrite another's
// password, leaving the `login(page, "bob", newPassword)` assertions
// racing against a stale value.
test.describe.configure({ mode: "serial" });
test.describe("Superadmin password reset", () => {
    // Bob's password gets rotated by every test in this file. Pin it
    // back to a known value before each test so the helpers below can
    // reliably log bob in without a previous run having changed it.
    test.beforeEach(async ({ page }) => {
        await login(page, "superadmin");
        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        const users = (
            usersRes.body as {
                users: Array<{
                    id: string;
                    email: string;
                }>;
            }
        ).users;
        const bob = users.find((u) => u.email === TEST_USER_EMAILS.bob);
        const seedPassword = "BobSeedPass1";
        await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bob?.id}/password`,
            { password: seedPassword, confirmPassword: seedPassword },
        );
        await page.context().clearCookies();
    });
    test("superadmin can reset a user's password via the API", async ({
        page,
    }) => {
        await login(page, "superadmin");

        // Look up bob's user id.
        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        expect(usersRes.ok).toBeTruthy();
        const users = (
            usersRes.body as {
                users: Array<{
                    id: string;
                    email: string;
                }>;
            }
        ).users;
        const bob = users.find((u) => u.email === TEST_USER_EMAILS.bob);
        expect(bob).toBeTruthy();
        const bobId = bob?.id as string;

        const newPassword = "ResetPass123";
        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bobId}/password`,
            { password: newPassword, confirmPassword: newPassword },
        );
        expect(
            putRes.ok,
            `reset failed: ${putRes.status} ${JSON.stringify(putRes.body)}`,
        ).toBeTruthy();

        // Bob should now be able to log in with the new password.
        await logout(page);
        await login(page, "bob", newPassword);
        // If we reached here, login succeeded.
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("reset wipes all sessions for the target user", async ({
        page,
        context,
    }) => {
        // First, log bob in so he has a session. Bob's password was
        // pinned by the describe-level beforeEach.
        await login(page, "bob", "BobSeedPass1");
        const bobSession = await page
            .context()
            .cookies()
            .then((cookies) => cookies.find((c) => c.name === "session_token"));
        expect(bobSession).toBeTruthy();

        // Switch to superadmin and reset bob's password.
        await context.clearCookies();
        await login(page, "superadmin");

        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        const users = (
            usersRes.body as { users: Array<{ id: string; email: string }> }
        ).users;
        const bob = users.find((u) => u.email === TEST_USER_EMAILS.bob);
        expect(bob).toBeTruthy();
        const bobId = bob?.id as string;

        const newPassword = "ResetPass456";
        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bobId}/password`,
            { password: newPassword, confirmPassword: newPassword },
        );
        expect(putRes.ok).toBeTruthy();

        // The old session token should now be invalid. Try to use it
        // by re-injecting the cookie and visiting /api/profile/me.
        await context.clearCookies();
        if (bobSession) {
            await context.addCookies([
                {
                    name: bobSession.name,
                    value: bobSession.value,
                    domain: bobSession.domain,
                    path: bobSession.path,
                    httpOnly: bobSession.httpOnly,
                    secure: bobSession.secure,
                    sameSite: bobSession.sameSite,
                },
            ]);
        }
        const meRes = await browserFetch(page, "GET", "/api/profiles/me");
        expect(meRes.status).toBe(401);
    });

    test("regular admin cannot use the password reset endpoint", async ({
        page,
    }) => {
        await login(page, "admin");

        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        const users = (
            usersRes.body as { users: Array<{ id: string; email: string }> }
        ).users;
        const bob = users.find((u) => u.email === TEST_USER_EMAILS.bob);
        expect(bob).toBeTruthy();
        const bobId = bob?.id as string;

        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bobId}/password`,
            {
                password: "AttemptReset123",
                confirmPassword: "AttemptReset123",
            },
        );
        expect(putRes.status).toBe(403);
    });

    test("superadmin sees the Change password button in the user's modal", async ({
        page,
        context,
    }) => {
        await login(page, "superadmin");
        await page.goto("/admin");
        // Wait for Preact to wire the row onClick handlers — clicking
        // before hydration is a silent no-op and the modal never opens.
        await expect(page.locator('[data-hydrated="true"]')).toBeAttached({
            timeout: 10_000,
        });

        // Find bob's row and click it to open the modal.
        const bobRow = page.locator("tr", { hasText: TEST_USER_EMAILS.bob });
        await bobRow.click();
        // `sv-SE` locale is pinned in playwright.config.ts — the modal
        // renders "Användarinfo" / "Byt lösenord" (not the English
        // fallbacks the component uses).
        await page.waitForSelector("text=Användarinfo", { state: "visible" });

        // The Change password button should be visible.
        const pwButton = page.locator("button", {
            hasText: /byt lösenord/i,
        });
        await expect(pwButton).toBeVisible();

        // Click to open the pane, fill in a strong password, save.
        await pwButton.click();
        const newPassword = "E2EPanePass1";
        await page.locator('input[type="password"]').first().fill(newPassword);
        await page.locator('input[type="password"]').nth(1).fill(newPassword);
        await page.locator("button", { hasText: /^spara$/i }).click();

        // Wait for the success message.
        await page.waitForSelector("text=/lösenord uppdaterat|uppdaterat/i", {
            state: "visible",
        });

        // Clear cookies directly — the modal's fixed overlay intercepts
        // clicks on the navbar "Logga ut" button.
        await context.clearCookies();
        await login(page, "bob", newPassword);
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("regular admin does NOT see the Change password button", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin");
        await expect(page.locator('[data-hydrated="true"]')).toBeAttached({
            timeout: 10_000,
        });

        const bobRow = page.locator("tr", { hasText: TEST_USER_EMAILS.bob });
        await bobRow.click();
        await page.waitForSelector("text=Användarinfo", { state: "visible" });

        const pwButton = page.locator("button", {
            hasText: /byt lösenord/i,
        });
        await expect(pwButton).toHaveCount(0);
    });

    // Reproduction for the production 500 we couldn't reproduce
    // locally: superadmin resets bob's password to a 19-char ASCII
    // value with mixed case + digits, the exact shape sent against
    // karen.bthstudent.se. If this passes in CI/dev but the prod
    // container still 500s, the bug is environment-specific.
    test("production-shaped reset: 19-char mixed-case/digit password succeeds", async ({
        page,
    }) => {
        await login(page, "superadmin");

        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        expect(usersRes.ok).toBeTruthy();
        const users = (
            usersRes.body as {
                users: Array<{
                    id: string;
                    email: string;
                }>;
            }
        ).users;
        const bob = users.find((u) => u.email === TEST_USER_EMAILS.bob);
        expect(bob).toBeTruthy();
        const bobId = bob?.id as string;

        // Same shape as the production failure: 19 ASCII chars,
        // uppercase + lowercase + digit, well under bcrypt's 72-byte
        // limit, strong enough to pass `isStrongPassword`.
        const prodShapedPassword = "TempLosenord467588";

        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/users/${bobId}/password`,
            {
                password: prodShapedPassword,
                confirmPassword: prodShapedPassword,
            },
        );
        expect(
            putRes.ok,
            `reset failed: ${putRes.status} ${JSON.stringify(putRes.body)}`,
        ).toBeTruthy();

        // Bob can log in with the new password — proves the hash
        // actually landed.
        await logout(page);
        await login(page, "bob", prodShapedPassword);
        expect(new URL(page.url()).pathname).toBe("/");
    });
});
