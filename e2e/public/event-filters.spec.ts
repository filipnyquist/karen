import { expect, test } from "@playwright/test";

test.describe("Event List - Search & Filters", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/event/list");
        const filtersPanel = page.locator("details");
        await expect(filtersPanel).toBeVisible();
        if (!(await filtersPanel.getAttribute("open"))) {
            await page.locator("summary").click();
        }
    });

    test("filter section is visible", async ({ page }) => {
        await expect(page.locator("summary")).toBeVisible();
    });

    test("keyword search filters events", async ({ page }) => {
        const searchInput = page.locator('input[name="search"]');
        await searchInput.fill("Midsommar");
        await page.getByRole("button", { name: "Filter" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Midsommarpub")).toBeVisible();
    });

    test("keyword search with no results shows message", async ({ page }) => {
        const searchInput = page.locator('input[name="search"]');
        await searchInput.fill("xyznonexistent123");
        await page.getByRole("button", { name: "Filter" }).click();
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByText("Inga evenemang matchar dina filter"),
        ).toBeVisible();
    });

    test("location filter dropdown is populated", async ({ page }) => {
        const locationSelect = page.locator('select[name="location"]');
        await expect(locationSelect).toBeVisible();
        const options = locationSelect.locator("option");
        expect(await options.count()).toBeGreaterThan(1);
    });

    test("state filter dropdown is populated", async ({ page }) => {
        const stateSelect = page.locator('select[name="state"]');
        await expect(stateSelect).toBeVisible();
    });

    test("date range inputs are present", async ({ page }) => {
        await expect(page.locator('input[name="dateFrom"]')).toBeVisible();
        await expect(page.locator('input[name="dateTo"]')).toBeVisible();
    });

    test("clear filters link appears when filters are active", async ({
        page,
    }) => {
        const searchInput = page.locator('input[name="search"]');
        await searchInput.fill("test");
        await page.getByRole("button", { name: "Filter" }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Rensa filter")).toBeVisible();
    });

    test("clear filters removes all filter params", async ({ page }) => {
        const searchInput = page.locator('input[name="search"]');
        await searchInput.fill("test");
        await page.getByRole("button", { name: "Filter" }).click();
        await page.waitForLoadState("networkidle");
        await page.getByText("Rensa filter").click();
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveURL(
            "/event/list?filter=upcoming&sort=startDate&dir=asc&view=table",
        );
    });
});
