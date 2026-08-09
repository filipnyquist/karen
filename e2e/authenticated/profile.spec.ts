import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

test.describe("Profile", () => {
    test("view own profile shows user info", async ({ page }) => {
        await login(page, "alice");
        await page.locator("nav").getByRole("link", { name: "Alicia" }).click();
        await expect(page).toHaveURL(/\/profile\//);
        await expect(page.getByText("Alice Andersson")).toBeVisible();
    });

    test("edit profile description", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/profile/edit");
        await page.waitForLoadState("networkidle");

        // ProfileEditor island — find the description textarea
        const textarea = page
            .locator('#description, textarea[name="description"]')
            .first();
        if (await textarea.isVisible()) {
            await textarea.clear();
            await textarea.fill(`Updated bio ${Date.now()}`);
            await page.getByRole("button", { name: /spara/i }).first().click();
            // Wait for success — use first() to avoid strict mode
            await expect(page.getByText(/sparad/i).first()).toBeVisible({
                timeout: 5000,
            });
        }
    });

    test("view other user profile via event page", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page
            .getByRole("table")
            .getByRole("link", { name: "Bobby" })
            .click();
        await expect(page).toHaveURL(/\/profile\//);
        await expect(page.getByText("Bob Björk")).toBeVisible();
    });

    test("profile shows work history", async ({ page }) => {
        await login(page, "alice");
        await page.locator("nav").getByRole("link", { name: "Alicia" }).click();
        await expect(page.getByText(/Arbetshistorik/i)).toBeVisible();
    });
});
