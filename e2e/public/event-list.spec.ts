import { devices, expect, test } from "@playwright/test";

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

    test("event rows navigate to detail via the row link", async ({ page }) => {
        // Each row contains a real <a href="/event/{id}"> stretched
        // over the whole <tr>. Clicking the link (or anywhere on the
        // row) opens the event detail page.
        const link = page
            .locator('table tbody tr a[href^="/event/"]')
            .filter({ hasText: "" })
            .first();
        await expect(link).toBeVisible();
        const href = await link.getAttribute("href");
        await link.click();
        await expect(page).toHaveURL(/\/event\/[a-f0-9-]+/);
        expect(href).toMatch(/^\/event\/[a-f0-9-]+$/);
    });

    test("no create event button for anonymous user", async ({ page }) => {
        await expect(
            page.getByRole("link", { name: /Skapa evenemang/i }),
        ).not.toBeVisible();
    });
});

// Regression test for the mobile-only bug: rows used to be clickable
// only via a body-level JS click delegator listening for
// `data-action="open-event"`. On real iOS Safari / Android Chrome,
// the JS click never fired when the user's finger drifted slightly
// during a tap inside the horizontally-scrollable table — the browser
// classified the gesture as the start of a scroll and cancelled the
// click. Rows are now real <a> links stretched across each <tr>, so
// the browser handles taps natively. This test exercises a real touch
// input on a phone-shaped viewport to lock the fix in.
test.describe("Event List (mobile)", () => {
    test.use({ ...devices["iPhone 13"] });

    test("tapping a row navigates to the event on a phone viewport", async ({
        page,
    }) => {
        await page.goto("/event/list?filter=all");
        const link = page.locator('table tbody tr a[href^="/event/"]').first();
        await expect(link).toBeVisible();
        // tap() sends a real touch event sequence (touchstart → touchend
        // → click) — closer to a finger tap than locator.click() which
        // synthesizes a mouse click.
        await link.tap();
        await expect(page).toHaveURL(/\/event\/[a-f0-9-]+/);
    });
});
