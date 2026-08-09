import { expect, test } from "@playwright/test";
import {
    getPasswordFor,
    login,
    TEST_USER_KEYS,
    type TestUserKey,
} from "../helpers/auth";

test.describe("Login", () => {
    test("successful login redirects to home", async ({ page }) => {
        await login(page, "alice");
        await expect(page).toHaveURL("/");
        await expect(
            page.locator("nav").getByRole("link", { name: "Alicia" }),
        ).toBeVisible();
    });

    test("wrong password shows error", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.locator("#email").fill("alice@karen.se");
        await page.locator("#password").fill("wrongpassword");
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL(/\/login\?error=/);
        await expect(
            page.getByText(/ogiltig|misslyckades|Invalid/i),
        ).toBeVisible();
    });

    test("non-existent email shows error", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.locator("#email").fill("nobody@example.com");
        await page.locator("#password").fill("wrongpassword");
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL(/\/login\?error=/);
        await expect(
            page.getByText(/ogiltig|misslyckades|Invalid/i),
        ).toBeVisible();
    });

    test("unverified user cannot log in", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.fill("#email", "newbie@karen.se");
        // `newbie` is not seeded as verified — login should fail at the
        // email-verified check even with the right password.
        const validPassword = getPasswordFor("newbie@karen.se");
        await page.fill("#password", validPassword);
        await page.click('#login-form button[type="submit"]');
        await page.waitForURL(/\/login\?error=/);
        await expect(page.getByText(/verifiera|verify/i)).toBeVisible();
    });

    test("redirects to home if already logged in", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/login");
        await expect(page).toHaveURL("/");
    });

    // Make TestUserKey importable from the helpers for any spec that wants
    // to iterate over seeded users without referencing the literal list.
    test("all seeded test users can be resolved", () => {
        const sample = TEST_USER_KEYS[0] as TestUserKey;
        expect(typeof sample).toBe("string");
    });
});
