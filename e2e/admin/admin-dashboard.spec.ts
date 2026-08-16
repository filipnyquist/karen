import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Admin Dashboard", () => {
    test("admin can view user list", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/admin");

        // AdminDashboard island needs to hydrate
        await page.waitForLoadState("networkidle");

        // Should show user table with seed users
        await expect(
            page.getByRole("cell", { name: "alice@karen.se" }),
        ).toBeVisible();
        await expect(
            page.getByRole("cell", { name: "bob@karen.se" }),
        ).toBeVisible();
    });

    test("non-admin cannot access admin page", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/admin");
        await expect(page).toHaveURL("/");
    });
});
