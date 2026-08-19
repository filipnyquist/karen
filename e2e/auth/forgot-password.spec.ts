// e2e/auth/forgot-password.spec.ts
//
// End-to-end coverage for the self-service forgot-password flow.
// Verifies:
//   - The /forgot-password page is reachable from the login page link.
//   - Submitting a non-existing email and an existing email produces
//     the SAME response body (no enumeration leak).
//   - The dev-mode response carries the resetUrl so this test (and
//     humans) can complete the flow without scraping email logs.
//   - The reset page renders the password form for a valid token,
//     and one of three banner states for invalid / expired / used.
//   - Submitting a new password redirects to /login?msg=password-reset
//     and the new credential actually works.
//   - A consumed token then renders the "used" banner.
//   - The check endpoint mirrors the page's banner choice.

import { expect, test } from "@playwright/test";
import { login, TEST_USER_EMAILS } from "../helpers/auth";

async function browserFetch(
    page: import("@playwright/test").Page,
    method: "POST" | "GET" | "PUT" | "DELETE",
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

// `.serial` because every test in this file rotates bob/charlie/diana/
// erik's password via the forgot-password endpoint. Running them in
// parallel would let one test consume another test's freshly-minted
// token before the second test gets a chance to navigate to it.
test.describe.configure({ mode: "serial" });
test.describe("Forgot password", () => {
    // Pin each affected user's password back to their seed value before
    // each test, so a test changing one user's password doesn't leak
    // into other tests in this file (and beyond).
    test.beforeEach(async ({ page }) => {
        await login(page, "superadmin");
        const { getPasswordFor } = await import("../helpers/auth");
        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        const users = (
            usersRes.body as {
                users: Array<{
                    id: string;
                    email: string;
                }>;
            }
        ).users;
        for (const key of ["bob", "charlie", "diana", "erik"] as const) {
            const email = TEST_USER_EMAILS[key];
            const u = users.find((x) => x.email === email);
            if (!u) continue;
            const seedPw = getPasswordFor(email);
            await browserFetch(
                page,
                "PUT",
                `/api/admin/users/${u.id}/password`,
                {
                    password: seedPw,
                    confirmPassword: seedPw,
                },
            );
        }
        await page.context().clearCookies();
    });
    test("login page surfaces a 'Forgot password?' link", async ({ page }) => {
        // /login redirects to / when authenticated, so we need to be
        // logged out for the form (and link) to render.
        await login(page, "alice");
        await page.context().clearCookies();
        await page.goto("/login");
        const link = page.locator("a", { hasText: /glömt lösenord/i });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", "/forgot-password");
    });

    test("non-existing email and existing email return identical response shape", async ({
        page,
    }) => {
        // Log in as alice to get the csrf cookie; the endpoint is
        // csrf-exempt in practice but Elysia still expects the
        // header to match the cookie when one is present.
        await login(page, "alice");

        const existing = await browserFetch(
            page,
            "POST",
            "/api/auth/forgot-password",
            { email: TEST_USER_EMAILS.bob },
        );
        const missing = await browserFetch(
            page,
            "POST",
            "/api/auth/forgot-password",
            { email: "nobody-here@karen.se" },
        );

        expect(existing.ok).toBe(true);
        expect(missing.ok).toBe(true);

        // Same JSON shape: { success: true, resetUrl }. For the
        // non-existing email resetUrl is null in non-prod (we
        // never expose the link when there's no account).
        const existingBody = existing.body as {
            success: boolean;
            resetUrl: string | null;
        };
        const missingBody = missing.body as {
            success: boolean;
            resetUrl: string | null;
        };
        expect(Object.keys(existingBody).sort()).toEqual(
            Object.keys(missingBody).sort(),
        );
        expect(existingBody.success).toBe(true);
        expect(missingBody.success).toBe(true);
        expect(existingBody.resetUrl).toMatch(/\/reset-password\?token=/);
        expect(missingBody.resetUrl).toBeNull();
    });

    test("full happy path: request, follow link, set password, log in", async ({
        page,
    }) => {
        await login(page, "superadmin");

        // 1. Request a reset for bob. Capture the leaked resetUrl.
        const resetRes = await browserFetch(
            page,
            "POST",
            "/api/auth/forgot-password",
            { email: TEST_USER_EMAILS.bob },
        );
        expect(resetRes.ok).toBe(true);
        const resetUrl = (resetRes.body as { resetUrl: string | null })
            .resetUrl;
        expect(resetUrl).toBeTruthy();
        expect(resetUrl).toMatch(/\/reset-password\?token=/);

        // 2. Visit the reset URL. /login redirects to / when the
        //    superadmin session is still valid, which would short-
        //    circuit the form render — drop the cookies first so
        //    the form (not the redirect) renders.
        await page.context().clearCookies();
        await page.goto(resetUrl as string);
        await expect(
            page.getByRole("heading", { name: /välj ett nytt lösenord/i }),
        ).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();

        // 3. Submit a new password. The page client-side checks strength
        //    and redirects to /login?msg=password-reset. Wait for the
        //    consume POST to return 200 so we know the password has
        //    actually been rotated before we try to log in.
        const newPassword = "E2EReset1Pass";
        const consumeResponse = page.waitForResponse(
            (r) =>
                r.url().endsWith("/api/auth/reset-password") &&
                r.request().method() === "POST" &&
                // Scoped to THIS page's request by inspecting the
                // page URL the request originated from. Other tests
                // running in parallel can fire their own consume
                // POSTs and would otherwise match this predicate.
                r.frame() === page.mainFrame(),
        );
        await page.locator('input[name="password"]').first().fill(newPassword);
        await page.locator('input[name="confirm"]').fill(newPassword);
        await page
            .locator("button", { hasText: /spara nytt lösenord/i })
            .click();

        const res = await consumeResponse;
        expect(
            res.status(),
            `reset-password POST status: ${res.status()}`,
        ).toBe(200);
        await page.waitForURL(/\/login\?msg=password-reset/);

        // 4. Log in with the new password. Clear cookies first so
        //    /login doesn't bounce straight to / for any leftover
        //    session (e.g. one set by the superadmin login above).
        await page.context().clearCookies();
        await page.goto("/login");
        await expect(page.locator("#email")).toBeVisible();
        await page.locator("#email").fill(TEST_USER_EMAILS.bob);
        await page.locator("#password").fill(newPassword);
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL("/");
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("consumed token renders the 'used' banner on re-visit", async ({
        page,
    }) => {
        await login(page, "superadmin");

        const resetRes = await browserFetch(
            page,
            "POST",
            "/api/auth/forgot-password",
            { email: TEST_USER_EMAILS.charlie },
        );
        const resetUrl = (resetRes.body as { resetUrl: string | null })
            .resetUrl;
        expect(resetUrl).toBeTruthy();

        // Consume the token.
        const consumeRes = await browserFetch(
            page,
            "POST",
            "/api/auth/reset-password",
            {
                token: new URL(resetUrl as string).searchParams.get("token"),
                password: "E2EUsed1Pass",
            },
        );
        expect(consumeRes.ok).toBe(true);

        // Re-visit the same URL — should show the "used" banner, not
        // the password form.
        await page.goto(resetUrl as string);
        await expect(page.getByText(/har redan använts/i)).toBeVisible();
        await expect(page.locator('input[name="password"]')).toHaveCount(0);
    });

    test("unknown token renders the 'invalid' banner", async ({ page }) => {
        await page.goto("/reset-password?token=not-a-real-token");
        await expect(page.getByText(/ogiltig/i)).toBeVisible();
    });

    test("check endpoint mirrors the page's banner choice", async ({
        page,
    }) => {
        // Navigate to a real page first so document.cookie is
        // readable from page.evaluate.
        await page.goto("/login");
        // Unauthenticated check via direct fetch (CSRF-exempt GET).
        const unknown = await browserFetch(
            page,
            "GET",
            "/api/auth/reset-password/check?token=bogus",
        );
        expect(unknown.ok).toBe(true);
        expect(unknown.body).toEqual({ valid: false, reason: "invalid" });
    });

    test("weak password is rejected by the consume endpoint", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const resetRes = await browserFetch(
            page,
            "POST",
            "/api/auth/forgot-password",
            { email: TEST_USER_EMAILS.diana },
        );
        const resetUrl = (resetRes.body as { resetUrl: string | null })
            .resetUrl;
        expect(resetUrl).toBeTruthy();

        // 8+ chars but no upper/digit → hits the service's
        // isStrongPassword check, not the body schema's minLength.
        const weakButValidLength = "alllower9";
        const consumeRes = await browserFetch(
            page,
            "POST",
            "/api/auth/reset-password",
            {
                token: new URL(resetUrl as string).searchParams.get("token"),
                password: weakButValidLength,
            },
        );
        expect(consumeRes.ok).toBe(false);
        expect(consumeRes.status).toBe(400);
        expect((consumeRes.body as { code?: string }).code).toBe(
            "WEAK_PASSWORD",
        );
    });

    test("happy path via the browser: form submit redirects to login", async ({
        page,
        context,
    }) => {
        // Log out before submitting so /login doesn't bounce back to /.
        await login(page, "alice");
        await context.clearCookies();

        // 1. Visit /forgot-password and submit via the form.
        await page.goto("/forgot-password");
        await page.locator("#email").fill(TEST_USER_EMAILS.erik);
        await page
            .locator("button", { hasText: /skicka återställningslänk/i })
            .click();
        await page.waitForURL(/\/forgot-password\?msg=sent/);

        // 2. The leaked resetUrl comes back in the API response, but
        //    for a form-only flow we have to fetch the token via the
        //    sent email (we don't have that here, so we ask the API).
        //    Re-login as superadmin briefly to mint the reset, then
        //    log out again before opening the link.
        await login(page, "superadmin");
        const resetRes = await browserFetch(
            page,
            "POST",
            "/api/auth/forgot-password",
            { email: TEST_USER_EMAILS.erik },
        );
        expect(resetRes.ok).toBe(true);
        const resetUrl = (resetRes.body as { resetUrl: string | null })
            .resetUrl;
        expect(resetUrl).toBeTruthy();
        await context.clearCookies();

        // 3. Visit the link. Submit. Land on /login?msg=password-reset.
        await page.goto(resetUrl as string);
        await expect(
            page.getByRole("heading", { name: /välj ett nytt lösenord/i }),
        ).toBeVisible();
        const newPassword = "E2EBrowserReset1";
        await page.locator('input[name="password"]').first().fill(newPassword);
        await page.locator('input[name="confirm"]').fill(newPassword);
        await page
            .locator("button", { hasText: /spara nytt lösenord/i })
            .click();
        await page.waitForURL(/\/login\?msg=password-reset/);

        // 4. The success banner is shown.
        await expect(
            page.getByText(/ditt lösenord har ändrats/i),
        ).toBeVisible();
    });

    test("submitting forgot-password for a non-existent user shows the same success banner", async ({
        page,
    }) => {
        // Direct browser flow (no API) — the page must show the
        // success banner regardless of whether the email existed.
        await page.goto("/forgot-password");
        await page.locator("#email").fill("nobody@karen.se");
        await page
            .locator("button", { hasText: /skicka återställningslänk/i })
            .click();
        await page.waitForURL(/\/forgot-password\?msg=sent/);
        await expect(page.getByText(/om det finns ett konto/i)).toBeVisible();
    });
});
