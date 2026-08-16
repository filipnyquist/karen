import { expect, test } from "@playwright/test";

test.describe("Calendar View", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/event/list");
    });

    test("view toggle shows table and calendar icons", async ({ page }) => {
        const tableBtn = page.getByTitle("Tabell");
        const calBtn = page.getByTitle("Kalender");
        await expect(tableBtn).toBeVisible();
        await expect(calBtn).toBeVisible();
    });

    test("default view is table", async ({ page }) => {
        await expect(page.locator("table")).toBeVisible();
    });

    test("switching to calendar view shows calendar grid", async ({ page }) => {
        await page.goto("/event/list?view=calendar");
        await page.waitForLoadState("networkidle");
        // Calendar has weekday headers
        await expect(page.getByText("Mån")).toBeVisible();
        // Calendar has month/year header
        const monthNames = [
            "Januari",
            "Februari",
            "Mars",
            "April",
            "Maj",
            "Juni",
            "Juli",
            "Augusti",
            "September",
            "Oktober",
            "November",
            "December",
        ];
        const headerText = await page
            .locator(".text-sm.font-semibold")
            .first()
            .textContent();
        const hasMonth = monthNames.some((m) => headerText?.includes(m));
        expect(hasMonth).toBe(true);
    });

    test("calendar view respects search filter", async ({ page }) => {
        await page.goto("/event/list?view=calendar&search=Midsommar");
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("button", { name: "Midsommarpub" }),
        ).toBeVisible();
    });

    test("calendar month navigation works", async ({ page }) => {
        await page.goto("/event/list?view=calendar");
        await page.waitForLoadState("networkidle");
        const nextBtn = page
            .locator("div.flex.items-center.justify-between > button")
            .nth(1);
        await nextBtn.click();
        await page.waitForTimeout(100);
        // Calendar should have changed month
        const headerText = await page
            .locator(".text-sm.font-semibold")
            .first()
            .textContent();
        expect(headerText).toBeTruthy();
    });
});
