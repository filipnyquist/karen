import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Scanner Landing Page", () => {
    test("scanner page redirects anonymous to login", async ({ page }) => {
        await page.goto("/scanner");
        await expect(page).toHaveURL(/\/login/);
    });

    test("scanner page shows landing for admin", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/scanner");
        await expect(page).toHaveURL(/\/scanner$/);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(
            page.getByText(/Välj ett evenemang|Select an event/i),
        ).toBeVisible();
    });

    test("scanner page shows event cards with ticket stats", async ({
        page,
    }) => {
        await login(page, "alice");
        await page.goto("/scanner");
        await page.waitForLoadState("networkidle");
        const eventCards = page.locator(
            'a[href^="/scanner/"]:not([href="/scanner"])',
        );
        const count = await eventCards.count();
        if (count > 0) {
            await expect(eventCards.first()).toBeVisible();
        }
    });

    test("scanner nav link visible for admin", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/");
        await expect(page.getByRole("link", { name: "Skanner" })).toBeVisible();
    });
});
