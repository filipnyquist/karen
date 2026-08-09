import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Ticket Instructions", () => {
    test("tickets page shows usage instructions", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/tickets");
        await expect(
            page.getByRole("heading", { name: "Hur du använder din biljett" }),
        ).toBeVisible();
        await expect(
            page.getByText("Visa QR-koden för personalen vid ingången.", {
                exact: true,
            }),
        ).toBeVisible();
    });

    test("tickets page does not use external QR API", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/tickets");
        await page.waitForTimeout(1000);
        // Page should not use external api.qrserver.com for QR codes
        const images = page.locator('img[src*="qrserver"]');
        expect(await images.count()).toBe(0);
    });
});
