import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

test.describe("Comments", () => {
    test("add a comment", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        const commentText = `Test comment ${Date.now()}`;
        await page.fill("#comment-input", commentText);
        await page.click('#comment-form button[type="submit"]');
        await expect(page.getByText(commentText)).toBeVisible();
    });

    test("delete own comment", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        // Wait for the BaseLayout's app modal element to be in the DOM —
        // data-action handlers and window.appConfirm are wired up by an
        // inline <script> that runs synchronously, but we wait anyway so
        // a slow dev-server compile doesn't race the click.
        await page.waitForSelector("#app-modal", { state: "attached" });

        // Add a comment to delete
        const commentText = `Delete me ${Date.now()}`;
        await page.fill("#comment-input", commentText);
        await page.click('#comment-form button[type="submit"]');
        await expect(page.getByText(commentText)).toBeVisible();

        // Each comment div has id="comment-{uuid}". Find our comment then click its delete button.
        const allComments = page.locator('div[id^="comment-"]');
        const count = await allComments.count();
        for (let i = 0; i < count; i++) {
            const comment = allComments.nth(i);
            const text = await comment.textContent();
            if (text?.includes(commentText)) {
                await comment
                    .locator('button[data-action="delete-comment"]')
                    .click();
                break;
            }
        }

        // Confirm in app modal
        await page.waitForSelector("#app-modal:not(.hidden)", {
            state: "visible",
            timeout: 5_000,
        });
        await page.click("#app-modal-confirm");

        await expect(page.getByText(commentText)).not.toBeVisible();
    });

    test("comment form only visible when logged in", async ({ page }) => {
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await expect(page.locator("#comment-form")).not.toBeVisible();
    });
});
