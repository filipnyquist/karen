import { expect, test } from "@playwright/test";
import { getMigrationToken, login } from "../helpers/auth";

test.describe("Migration", () => {
    test("no match for unknown email", async ({ page }) => {
        await login(page, "alice");
        await page.goto("/migrate");
        await page.waitForLoadState("networkidle");

        const emailInput = page.locator("#email");
        await emailInput.waitFor({ state: "visible", timeout: 10000 });
        await emailInput.click();
        await emailInput.type("nonexistent@example.com");

        await page.getByRole("button", { name: /sök/i }).click();

        await expect(
            page.locator(".bg-red-50").getByText(/Inget konto hittades/i),
        ).toBeVisible();
    });

    test("lookup, verify token, and already migrated notice", async ({
        page,
    }) => {
        await login(page, "migrant");
        await page.goto("/migrate");
        await page.waitForLoadState("networkidle");

        // Check if migration form is available (token not yet consumed)
        const emailInput = page.locator("#email");
        const hasForm = await emailInput.isVisible().catch(() => false);

        if (hasForm) {
            // Step 1: Lookup
            await emailInput.click();
            await emailInput.type("legacy-old@example.com");

            // Wait for Preact to enable the button after onInput fires
            const searchBtn = page.getByRole("button", { name: /sök/i });
            await expect(searchBtn).toBeEnabled({ timeout: 5_000 });
            await searchBtn.click();
            await expect(page.getByText(/LegacyUser/i)).toBeVisible();

            // Step 2: Verify with the random token seeded into the DB.
            await page.goto(`/migrate?verify=${getMigrationToken()}`);
            await page.waitForTimeout(2000);

            const successBox = page.locator(".bg-green-50").first();
            await expect(successBox.getByText(/Migrering klar/i)).toBeVisible({
                timeout: 10000,
            });

            // Stats
            await expect(
                page.getByText(/2\s*jobbade evenemang/i),
            ).toBeVisible();
            await expect(page.getByText(/2\s*kommentarer/i)).toBeVisible();
            await expect(page.getByText(/1\s*lagmedlemskap/i)).toBeVisible();
        }

        // Already migrated notice (always reachable — either just migrated or was already)
        await page.goto("/migrate");
        await page.waitForLoadState("networkidle");
        await expect(
            page.locator(".bg-green-50").getByText(/redan migrerat/i),
        ).toBeVisible({ timeout: 10000 });
    });

    test("admin migration page loads with stats", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/admin/migrate");

        await expect(
            page.getByRole("table").getByText(/LegacyUser/i),
        ).toBeVisible({
            timeout: 10000,
        });

        const statCells = page.locator(".text-2xl.font-bold");
        await expect(statCells.first()).toBeVisible();
    });

    test("admin can filter mappings", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/admin/migrate");

        await expect(
            page.getByRole("table").getByText(/LegacyUser/i),
        ).toBeVisible({
            timeout: 10000,
        });

        // Filter to "Alla" — should still show
        await page.getByRole("button", { name: "Alla", exact: true }).click();
        await expect(
            page.getByRole("table").getByText(/legacy-old@example.com/),
        ).toBeVisible();
    });

    test("invalid migration input returns a structured 400 (not opaque 500)", async ({
        page,
    }) => {
        await login(page, "alice");
        // POST without a body — the API should respond with a
        // structured `{ error, code: "EMAIL_REQUIRED" }` payload,
        // not a generic 500.
        const res = await page.request.post("/api/migration/lookup", {
            data: {},
            headers: { "Content-Type": "application/json" },
        });
        expect(res.status()).toBe(400);
        const body = (await res.json()) as {
            error: string;
            code: string;
        };
        expect(body.code).toBeTruthy();
        expect(typeof body.error).toBe("string");
    });
});
