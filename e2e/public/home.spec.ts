import { expect, test } from "@playwright/test";

test.describe("Homepage", () => {
    test("loads and shows site title", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveTitle(/Karen/);
        await expect(
            page.getByRole("heading", { name: "Karen" }),
        ).toBeVisible();
    });

    test("shows upcoming events", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.getByRole("heading", { name: "Evenemang" }),
        ).toBeVisible();
        // Event cards are inside the grid, not in the nav
        const eventCards = page.locator('.grid a[href^="/event/"]');
        await expect(eventCards.first()).toBeVisible();
    });

    test("event cards link to detail page", async ({ page }) => {
        await page.goto("/");
        // Skip nav links — target event cards in the grid section
        const card = page.locator('.grid a[href^="/event/"]').first();
        const href = await card.getAttribute("href");
        expect(href).toMatch(/\/event\/[a-f0-9-]+/);
        await card.click();
        await expect(page).toHaveURL(/\/event\/[a-f0-9-]+/);
    });

    test("shows login and register links when anonymous", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.locator("nav").getByRole("link", { name: "Logga in" }).first(),
        ).toBeVisible();
        await expect(
            page
                .locator("nav")
                .getByRole("link", { name: "Registrera" })
                .first(),
        ).toBeVisible();
    });
});
