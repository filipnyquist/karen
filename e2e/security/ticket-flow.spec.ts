import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";
import { csrfFetch } from "./_helper";

/**
 * End-to-end QR redeem flow:
 *  1. Admin issues a ticket for a user at an event
 *  2. Admin (who can scan) calls /api/tickets/scan with the token
 *  3. Admin calls /api/tickets/redeem with the token
 *
 * Also verifies the body-schema relaxation: tokens of any length
 * 16–256 chars (not just the 64-char hex format) are accepted.
 *
 * Regression guard for the user-reported "422 validation error when
 * scanning a ticket" — the schema was minLength:64, maxLength:64 and
 * now accepts a wider range so any reasonable opaque token works.
 */

test.describe("Ticket scan + redeem flow", () => {
    test("admin issues, scans, and redeems a real ticket", async ({ page }) => {
        await login(page, "admin");

        // Find a target event + user.
        const events = (await (
            await page.request.get("/api/events")
        ).json()) as Array<{ id: string; name: string }>;
        const event = events.find((e) => e.name === "Midsommarpub")!;

        const users = (await (
            await page.request.get("/api/admin/users")
        ).json()) as Array<{ id: string; email: string }>;
        const target = users.find((u) => u.email === "erik@karen.se")!;

        // Issue.
        const issue = await page.request.post("/api/tickets/issue", {
            data: { userId: target.id, eventId: event.id },
        });
        expect(issue.ok(), `issue should succeed: ${issue.status()}`).toBe(
            true,
        );
        const issued = (await issue.json()) as { token: string };
        expect(issued.token.length).toBe(64);

        // Scan (use csrfFetch so we go through the page's CSRF interceptor).
        const scan = await csrfFetch(page, "POST", "/api/tickets/scan", {
            token: issued.token,
            eventId: event.id,
        });
        expect(scan.status, `scan status: ${scan.status}`).toBe(200);
        expect(scan.ok).toBe(true);
        const scanned = scan.body as {
            user: { name: string; nickname: string | null };
        };
        expect(scanned.user.name).toBe("Erik Eriksson");

        // Redeem.
        const redeem = await csrfFetch(page, "POST", "/api/tickets/redeem", {
            token: issued.token,
            eventId: event.id,
        });
        expect(redeem.status, `redeem status: ${redeem.status}`).toBe(200);
        expect(redeem.ok).toBe(true);
    });

    test("scan accepts tokens of any reasonable length (16-256 chars)", async ({
        page,
    }) => {
        await login(page, "admin");

        const events = (await (
            await page.request.get("/api/events")
        ).json()) as Array<{ id: string; name: string }>;
        const event = events.find((e) => e.name === "Midsommarpub")!;

        // Test with a 36-char UUID-style token (not yet a real ticket —
        // we just check that the schema doesn't reject the length).
        const fakeUuidLike = "a".repeat(36);
        const scan = await csrfFetch(page, "POST", "/api/tickets/scan", {
            token: fakeUuidLike,
            eventId: event.id,
        });
        // Should NOT be a schema-rejection 400 — it should be a 404
        // (ticket not found) since the token doesn't exist.
        expect(scan.status).toBe(404);
        expect((scan.body as { code: string }).code).toBe("TICKET_NOT_FOUND");
    });

    test("scan rejects tokens shorter than 16 chars", async ({ page }) => {
        await login(page, "admin");
        const events = (await (
            await page.request.get("/api/events")
        ).json()) as Array<{ id: string; name: string }>;
        const event = events.find((e) => e.name === "Midsommarpub")!;

        const scan = await csrfFetch(page, "POST", "/api/tickets/scan", {
            token: "tooshort",
            eventId: event.id,
        });
        expect(scan.status).toBe(400);
        expect((scan.body as { code: string }).code).toBe("VALIDATION_ERROR");
    });

    test("scan rejects tokens longer than 256 chars", async ({ page }) => {
        await login(page, "admin");
        const events = (await (
            await page.request.get("/api/events")
        ).json()) as Array<{ id: string; name: string }>;
        const event = events.find((e) => e.name === "Midsommarpub")!;

        const scan = await csrfFetch(page, "POST", "/api/tickets/scan", {
            token: "a".repeat(257),
            eventId: event.id,
        });
        expect(scan.status).toBe(400);
        expect((scan.body as { code: string }).code).toBe("VALIDATION_ERROR");
    });
});
