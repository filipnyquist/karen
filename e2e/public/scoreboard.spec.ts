import { expect, test } from "@playwright/test";

test.describe("Scoreboard", () => {
    test("shows all-time and semester rankings", async ({ page }) => {
        await page.goto("/scoreboard");
        await expect(page.getByText(/Topp 10 genom tiderna/i)).toBeVisible();
        await expect(page.getByText(/Topp 10 denna termin/i)).toBeVisible();
    });

    test("rankings contain seed users", async ({ page }) => {
        await page.goto("/scoreboard");
        // Alice has the most event registrations
        const tables = page.getByRole("table");
        await expect(
            tables.first().getByRole("link", { name: "Alicia" }),
        ).toBeVisible();
    });

    test("user names link to profiles", async ({ page }) => {
        await page.goto("/scoreboard");
        const profileLink = page
            .getByRole("table")
            .getByRole("link", { name: "Alicia" })
            .first();
        if (await profileLink.isVisible()) {
            await profileLink.click();
            await expect(page).toHaveURL(/\/profile\//);
        }
    });
});
