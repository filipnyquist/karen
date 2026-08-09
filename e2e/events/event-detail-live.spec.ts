// e2e/events/event-detail-live.spec.ts
//
// Verifies "live-ish" polling refreshes on the event detail page:
// when one user makes a change, another user's open page should
// reflect it within one polling cycle (~10s + buffer). Uses two
// browser contexts so each side keeps its own session/cookies.

import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

const POLL_BUFFER_MS = 12_000; // 10s poll + 2s slack

test.describe("Event Detail live polling", () => {
    test("comment posted in one tab appears in another within ~12s", async ({
        browser,
    }) => {
        const eventId = await (async () => {
            const ctx = await browser.newContext();
            const page = await ctx.newPage();
            await login(page, "admin");
            const id = await findEventId(page, "Vårpub 2026");
            expect(id).toBeTruthy();
            await ctx.close();
            if (!id) throw new Error("Vårpub 2026 not found");
            return id;
        })();

        // Context A: admin (poster)
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        await login(pageA, "admin");
        await pageA.goto(`/event/${eventId}`);

        // Context B: alice (reader) — same event page.
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        await login(pageB, "alice");
        await pageB.goto(`/event/${eventId}`);

        // A unique marker so we know we're seeing the new comment.
        const marker = `e2e-live-${Date.now()}`;

        // Wait for context B to settle on its initial paint.
        await pageB.waitForLoadState("networkidle");
        await pageA.waitForLoadState("networkidle");

        // A posts the comment via the island's form.
        await pageA.locator("#comment-input").fill(marker);
        await pageA.locator("#comment-form button[type='submit']").click();

        // B should see the new comment via polling (next interval
        // tick within ~10s of B's mount, plus a buffer).
        await expect(pageB.getByText(marker, { exact: false })).toBeVisible({
            timeout: POLL_BUFFER_MS,
        });

        await ctxA.close();
        await ctxB.close();
    });
});
