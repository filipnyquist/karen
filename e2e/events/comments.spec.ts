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

    test("input enforces maxLength and shows counter", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        const input = page.locator("#comment-input");
        await expect(input).toHaveAttribute("maxlength", "500");

        await input.fill("hello");
        await expect(page.getByText("5/500")).toBeVisible();
    });

    test("accepts a comment at exactly the limit", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        // 500 chars (the boundary) must succeed.
        const atLimit = "a".repeat(500);
        await page.fill("#comment-input", atLimit);
        await page.click('#comment-form button[type="submit"]');
        // The new comment body is rendered; the first 60 chars are enough
        // to find it in the list. The counter and full body take more space
        // than the viewport, so we match on a prefix.
        await expect(page.getByText(atLimit.slice(0, 60))).toBeVisible();
    });

    test("rejects an overlong comment via the API", async ({ page }) => {
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        // The input's maxLength=500 truncates at 500 in the browser, so
        // exercise the server-side cap directly via fetch with a 501-char
        // body and the CSRF cookie.
        const tooLong = "a".repeat(501);
        const csrf = await page.evaluate(
            () =>
                document.cookie
                    .split("; ")
                    .find((c) => c.startsWith("csrf_token="))
                    ?.split("=")[1] ?? "",
        );
        const result = await page.evaluate(
            async ({ eventId, content, csrf }) => {
                const r = await fetch("/api/comments", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": csrf,
                    },
                    body: JSON.stringify({ eventId, content }),
                });
                return { status: r.status, body: await r.json() };
            },
            { eventId, content: tooLong, csrf },
        );
        expect(result.status).toBe(400);
        expect(result.body.code).toBe("COMMENT_TOO_LONG");
    });
});
