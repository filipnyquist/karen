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

    test("event rows navigate to detail via the row click", async ({
        page,
    }) => {
        // Rows carry data-action="open-event" + data-event-id; the global
        // delegator in BaseLayout.astro navigates on click (desktop) and
        // touchend (mobile). Click the row containing Midsommarpub.
        const row = page
            .locator('table tbody tr[data-action="open-event"]')
            .filter({ hasText: "Midsommarpub" })
            .first();
        const id = await row.getAttribute("data-event-id");
        await row.click();
        await expect(page).toHaveURL(new RegExp(`/event/${id}`));
    });

    test("no create event button for anonymous user", async ({ page }) => {
        await expect(
            page.getByRole("link", { name: /Skapa evenemang/i }),
        ).not.toBeVisible();
    });
});

// Regression test: rows are clickable on a phone viewport. iOS Safari
// can suppress `click` on `<tr>` taps inside a horizontally-scrollable
// container when the finger drifts slightly during the tap (it
// classifies the gesture as the start of a scroll and never delivers
// click). This test exercises a real touch sequence on a phone-shaped
// viewport to make sure the row click still navigates there.
test.describe("Event List (mobile)", () => {
    test.use({ ...devices["iPhone 13"] });

    test("tapping a row navigates to the event on a phone viewport", async ({
        page,
    }) => {
        await page.goto("/event/list?filter=all");
        const row = page
            .locator('table tbody tr[data-action="open-event"]')
            .first();
        await expect(row).toBeVisible();
        const id = await row.getAttribute("data-event-id");
        await row.tap();
        await expect(page).toHaveURL(new RegExp(`/event/${id}`));
    });
});
