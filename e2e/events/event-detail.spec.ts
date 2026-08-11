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

        // If already registered, unregister first. Check visible before
        // enabled: isVisible() returns false immediately for a missing
        // element, while isEnabled() would auto-wait out the test timeout.
        // The enabled check matters because a plain worker now sees this
        // button in a disabled state, and clicking it would hang.
        const unregisterBtn = page.getByRole("button", { name: "Avanmäl" });
        if (
            (await unregisterBtn.isVisible()) &&
            (await unregisterBtn.isEnabled())
        ) {
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

    test("plain worker cannot unregister themselves", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);

        // Alice is a non-responsible worker on Midsommarpub per seed data.
        // Dropping a shift needs a replacement, so the button is shown but
        // inert and the page explains who to talk to.
        const unregisterBtn = page.getByRole("button", { name: "Avanmäl" });
        await expect(unregisterBtn).toBeVisible();
        await expect(unregisterBtn).toBeDisabled();
        // Target the element, not the text: the same string also appears in
        // the serialized island props further down the page.
        await expect(page.locator("#unregister-blocked-reason")).toContainText(
            "KPS",
        );
    });

    test("plain worker is refused by the unregister API", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);

        // The disabled button is only half the guard — going straight at the
        // endpoint must fail too, or the rule is cosmetic. Issued from inside
        // the page so it carries the session and CSRF token exactly as the
        // app's own fetch does; only the button is bypassed.
        const result = await page.evaluate(async (id) => {
            const res = await fetch(`/api/workers/register/${id}`, {
                method: "DELETE",
                credentials: "same-origin",
            });
            return { status: res.status, body: await res.text() };
        }, eventId);
        expect(result.status).toBe(403);
        expect(JSON.parse(result.body).code).toBe("SELF_REMOVAL_FORBIDDEN");

        // And the registration survived.
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");
        await expect(
            page.getByRole("table").getByRole("link", { name: "Alicia" }),
        ).toBeVisible();
    });

    test("responsible can unregister themselves", async ({ page }) => {
        await login(page, "erik");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);

        // Erik is the responsible for Midsommarpub, so he can arrange his own
        // replacement and is allowed to leave.
        const unregisterBtn = page.getByRole("button", { name: "Avanmäl" });
        await expect(unregisterBtn).toBeEnabled();
        await unregisterBtn.click();
        await page.waitForTimeout(1000);
        await page.reload();
        await page.waitForLoadState("networkidle");

        await expect(
            page.getByRole("button", { name: "Anmäl dig" }),
        ).toBeVisible();

        // Restore seed state as responsible, not as a plain worker — coming
        // back without the flag would leave him unable to leave again.
        await page.getByRole("button", { name: "Anmäl som ansvarig" }).click();
        await page.waitForTimeout(1000);
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
