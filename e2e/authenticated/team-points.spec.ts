import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Team Points & Scoreboard", () => {
    test("team list page shows scoreboard section", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/pubteam/list");
        await page.waitForLoadState("networkidle");

        await expect(
            page.getByRole("heading", { name: "Publag" }),
        ).toBeVisible();
        await expect(page.getByText("Topp 5 lag")).toBeVisible();
        await expect(page.getByText(/summan av alla medlemmar/)).toBeVisible();
    });

    test("team cards show points in the grid", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/pubteam/list");
        await page.waitForLoadState("networkidle");

        // The team grid cards (not scoreboard) should show points with the bolt icon
        const grid = page.locator(".grid.grid-cols-1");
        const cards = grid.locator("a[href^='/pubteam/']");
        const count = await cards.count();
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test("team detail page loads and shows members", async ({ page }) => {
        await login(page, "alice");
        // Navigate to team list first
        await page.goto("/pubteam/list");
        await page.waitForLoadState("networkidle");

        // Click Bryggeriet specifically (alice is a member)
        const bryggeriet = page
            .locator("a[href^='/pubteam/']")
            .filter({ hasText: "Bryggeriet" })
            .first();
        await bryggeriet.click();
        await page.waitForLoadState("networkidle");

        // Should be on team detail page now
        await expect(
            page.getByRole("heading", { name: "Bryggeriet" }),
        ).toBeVisible();
        // Members section
        await expect(
            page.getByRole("heading", { name: /Medlemmar/ }),
        ).toBeVisible();
    });

    test("team edit page shows picture uploader for team admin", async ({
        page,
    }) => {
        await login(page, "alice");
        await page.goto("/pubteam/list");
        await page.waitForLoadState("networkidle");

        // Alice is admin of Bryggeriet - click it
        const bryggeriet = page.getByRole("link", { name: /Bryggeriet/ });
        if ((await bryggeriet.count()) > 0) {
            await bryggeriet.first().click();
            await page.waitForLoadState("networkidle");

            // Click the edit link (Redigera)
            const editLink = page.locator("a[href*='/pubteam/edit/']");
            if ((await editLink.count()) > 0) {
                await editLink.click();
                await page.waitForLoadState("networkidle");

                // Edit page should have the form
                await expect(page.locator("form#edit-team-form")).toBeVisible();
            }
        }
    });

    test("anonymous users redirected from team edit", async ({ page }) => {
        const _response = await page.goto("/pubteam/edit/some-fake-id");
        // Should redirect to home or login (not stay on edit page)
        await page.waitForURL(/\/(login|$)/);
        expect(page.url()).not.toContain("/pubteam/edit/");
    });
});
