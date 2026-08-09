import { expect, test } from "@playwright/test";

test.describe("Pub Team List", () => {
    test("shows seed teams", async ({ page }) => {
        await page.goto("/pubteam/list");
        await expect(
            page.getByRole("heading", { level: 3, name: "Bryggeriet" }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", { level: 3, name: "Barcrew" }),
        ).toBeVisible();
        await expect(
            page.getByRole("heading", { level: 3, name: "Nattgubbarna" }),
        ).toBeVisible();
    });

    test("team links to detail page", async ({ page }) => {
        await page.goto("/pubteam/list");
        await page
            .locator('a[href^="/pubteam/"]')
            .filter({
                has: page.getByRole("heading", {
                    level: 3,
                    name: "Bryggeriet",
                }),
            })
            .first()
            .click();
        await expect(page).toHaveURL(/\/pubteam\//);
        await expect(page.getByText("Bryggeriet")).toBeVisible();
    });
});
