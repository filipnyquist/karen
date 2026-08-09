import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

test.describe("Event Detail", () => {
    test("shows event details", async ({ page }) => {
        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();
        await page.goto(`/event/${eventId}`);
        await expect(
            page.getByRole("heading", { name: "Midsommarpub" }),
        ).toBeVisible();
        await expect(page.getByText("Villan")).toBeVisible();
    });

    test("shows registered workers", async ({ page }) => {
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");
        // Workers table contains linked nicknames
        await expect(
            page.getByRole("table").getByRole("link", { name: "Alicia" }),
        ).toBeVisible();
    });

    test("register as worker", async ({ page }) => {
        await login(page, "gustav");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);

        // If already registered, unregister first
        const unregisterBtn = page.getByRole("button", { name: "Avanmäl" });
        if (await unregisterBtn.isVisible()) {
            await unregisterBtn.click();
            await page.waitForTimeout(1000);
            await page.reload();
            await page.waitForLoadState("networkidle");
        }

        await page.getByRole("button", { name: "Anmäl dig" }).click();
        await page.waitForTimeout(1000);
        await page.reload();
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("table").getByRole("link", { name: "Gurra" }),
        ).toBeVisible();
    });

    test("unregister as worker", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);

        // Alice is registered for Midsommarpub per seed data
        const unregisterBtn = page.getByRole("button", { name: "Avanmäl" });
        if (await unregisterBtn.isVisible()) {
            await unregisterBtn.click();
            await page.waitForTimeout(1000);
            await page.reload();
            await page.waitForLoadState("networkidle");

            // Now should see register button instead
            await expect(
                page.getByRole("button", { name: "Anmäl dig" }),
            ).toBeVisible();

            // Re-register to restore state
            await page.getByRole("button", { name: "Anmäl dig" }).click();
            await page.waitForTimeout(1000);
        }
    });

    test("past event shows no registration button", async ({ page }) => {
        const eventId = await findEventId(page, "Vårpub 2026");
        expect(eventId).toBeTruthy();
        await page.goto(`/event/${eventId}`);
        await expect(
            page.getByRole("button", { name: "Anmäl dig" }),
        ).not.toBeVisible();
        await expect(
            page.getByRole("button", { name: "Avanmäl" }),
        ).not.toBeVisible();
    });

    test("anonymous viewer sees truncated real names", async ({ browser }) => {
        // Fresh context = no session cookie = anonymous viewer.
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        // The seed creates an "Alice Andersson" user registered on
        // Midsommarpub. The full real name must NOT appear in the
        // workers table; the truncated form ("Ali…") must.
        const workersTable = page.getByRole("table");
        await expect(workersTable).toBeVisible();
        await expect(workersTable.getByText("Alice")).not.toBeVisible();
        await expect(workersTable.getByText("Ali...")).toBeVisible();
        // The nickname ("Alicia") is public and still appears.
        await expect(workersTable.getByText("Alicia")).toBeVisible();

        await ctx.close();
    });
});
