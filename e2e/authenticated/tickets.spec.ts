import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Tickets", () => {
    test("tickets page loads for authenticated user", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/tickets");
        await expect(
            page.getByRole("heading", { name: "Mina biljetter" }),
        ).toBeVisible();
    });

    test("redirect to login when anonymous", async ({ page }) => {
        await page.goto("/tickets");
        await expect(page).toHaveURL(/\/login/);
    });
});
