import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Logout", () => {
    test("logout clears session", async ({ page }) => {
        await login(page, "alice");
        await expect(
            page.locator("nav").getByRole("link", { name: "Alicia" }),
        ).toBeVisible();

        // Click logout button in navbar
        await page
            .locator("nav")
            .getByRole("button", { name: "Logga ut" })
            .click();
        await page.waitForURL("/");
        await expect(
            page.locator("nav").getByRole("link", { name: "Logga in" }),
        ).toBeVisible();
    });

    test("cannot access protected pages after logout", async ({ page }) => {
        await login(page, "alice");
        await page
            .locator("nav")
            .getByRole("button", { name: "Logga ut" })
            .click();
        await page.waitForURL("/");
        // Wait for redirect to complete before navigating
        await page.waitForLoadState("networkidle");
        await page.goto("/profile/edit");
        await expect(page).toHaveURL(/\/login/);
    });
});
