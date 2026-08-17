import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

test.describe("Admin Event CRUD", () => {
    test("admin can create event", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/event/create");

        // EventForm island (Preact) — wait for hydration
        const nameInput = page.locator("input#name");
        await nameInput.waitFor({ state: "visible", timeout: 10000 });

        const eventName = `Test Pub ${Date.now()}`;
        await nameInput.fill(eventName);

        await page
            .locator("textarea#description")
            .fill("A test event created by Playwright");

        // Fill required fields
        await page.locator("select#locationId").selectOption({ index: 1 }); // Villan
        await page.locator("input#startDate").fill("2026-06-20T18:00");
        await page.locator("input#endDate").fill("2026-06-20T23:00");
        // EventForm switched to a segmented native-radio control
        // (Change 4) — pick by value rather than by label so the
        // assertion is stable across the localised picker copy.
        // "yes" is seeded as id=1.
        await page.locator('input[name="willOccur"][value="1"]').check();

        await page
            .getByRole("button", { name: /skapa evenemang|create event/i })
            .click();

        await page.waitForURL(/\/event\/[a-f0-9-]+$/, { timeout: 10000 });
        await expect(page.getByText(eventName)).toBeVisible();
    });

    test("admin can edit event", async ({ page }) => {
        await login(page, "admin");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/edit/${eventId}`);

        const nameInput = page.locator("input#name");
        await nameInput.waitFor({ state: "visible", timeout: 10000 });
        await nameInput.clear();
        await nameInput.fill("Midsommarpub Edited");

        await page.getByRole("button", { name: /uppdatera|update/i }).click();
        await page.waitForURL(/\/event\/[a-f0-9-]+$/, { timeout: 10000 });
        await expect(page.getByText("Midsommarpub Edited")).toBeVisible();

        // Revert
        await page.goto(`/event/edit/${eventId}`);
        await page
            .locator("input#name")
            .waitFor({ state: "visible", timeout: 10000 });
        await page.locator("input#name").clear();
        await page.locator("input#name").fill("Midsommarpub");
        await page.getByRole("button", { name: /uppdatera|update/i }).click();
    });

    test("non-admin cannot access create page", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/event/create");
        await expect(page).not.toHaveURL(/\/event\/create/);
    });

    test("non-admin cannot access admin dashboard", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/admin");
        await expect(page).toHaveURL("/");
    });
});
