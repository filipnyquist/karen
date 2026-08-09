import { expect, test } from "@playwright/test";

test.describe("Event List", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/event/list");
    });

    test("shows event list with at least one event", async ({ page }) => {
        const rows = page.locator("table tbody tr");
        await expect(rows.first()).toBeVisible();
    });

    test("filter: upcoming events", async ({ page }) => {
        await page.getByRole("link", { name: "Kommande" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Midsommarpub")).toBeVisible();
    });

    test("filter: past events", async ({ page }) => {
        await page.getByRole("link", { name: "Tidigare" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Vårpub 2026")).toBeVisible();
    });

    test("filter: all events", async ({ page }) => {
        await page.getByRole("link", { name: "Alla" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Midsommarpub")).toBeVisible();
        await expect(page.getByText("Vårpub 2026")).toBeVisible();
    });

    test("event rows navigate to detail via onclick", async ({ page }) => {
        // Rows use onclick, not <a> links. Click the row containing Midsommarpub.
        const row = page
            .locator("table tbody tr")
            .filter({ hasText: "Midsommarpub" })
            .first();
        await row.click();
        await expect(page).toHaveURL(/\/event\/[a-f0-9-]+/);
    });

    test("no create event button for anonymous user", async ({ page }) => {
        await expect(
            page.getByRole("link", { name: /Skapa evenemang/i }),
        ).not.toBeVisible();
    });
});
