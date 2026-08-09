// src/e2e/tickets/cross-event-redeem.spec.ts
//
// Verifies the queue-skip ticket model: a ticket earned at one event
// can be redeemed at any OTHER event where the scanner has permission.
// Admin acts as the scanner so the test doesn't depend on the scan
// window timing.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

/**
 * Hit a JSON endpoint via the browser's fetch shim, which automatically
 * stamps X-CSRF-Token on every state-changing request. This is
 * preferable to `request.fetch()` because the latter doesn't share
 * the cookie context cleanly with Playwright's `request.storageState`.
 */
async function browserFetch(
    page: import("@playwright/test").Page,
    method: "POST" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
    return await page.evaluate(
        async ([m, u, b]) => {
            const res = await fetch(u as string, {
                method: m as string,
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: b === undefined ? undefined : JSON.stringify(b),
            });
            const text = await res.text();
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
            return { ok: res.ok, status: res.status, body: parsed };
        },
        [method, url, body] as [string, string, unknown],
    );
}

async function browserGet(
    page: import("@playwright/test").Page,
    url: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
    return await page.evaluate(
        async ([u]) => {
            const res = await fetch(u as string, {
                credentials: "same-origin",
            });
            const text = await res.text();
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
            return { ok: res.ok, status: res.status, body: parsed };
        },
        [url] as [string],
    );
}

test.describe("Cross-event ticket redemption", () => {
    test("alice's pub4 queue-skip can be redeemed at pub3", async ({
        page,
    }) => {
        // 1. Admin locks pub4 (Midsommarpub) — issues tickets to its
        //    workers including alice. Need to be admin to do this.
        await login(page, "admin");
        await page.waitForURL("/");

        const eventsRes = await browserGet(page, "/api/events");
        expect(eventsRes.ok).toBeTruthy();
        const allEvents = eventsRes.body as Array<{
            id: string;
            name: string;
        }>;
        const pub4 = allEvents.find((e) => e.name === "Midsommarpub");
        expect(pub4, "Midsommarpub must be seeded").toBeTruthy();

        const lockRes = await browserFetch(
            page,
            "POST",
            `/api/events/${pub4?.id}/lock`,
            { locked: true, issueTickets: true },
        );
        expect(
            lockRes.ok,
            `lock failed: ${lockRes.status} ${JSON.stringify(lockRes.body)}`,
        ).toBeTruthy();

        // 2. Alice logs in and fetches her ticket for pub4.
        await page.context().clearCookies();
        const { getPasswordFor } = await import("../helpers/auth");
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.locator("#email").fill("alice@karen.se");
        await page.locator("#password").fill(getPasswordFor("alice@karen.se"));
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL("/");

        const aliceTicketsRes = await browserGet(page, "/api/tickets/mine");
        expect(aliceTicketsRes.ok).toBeTruthy();
        const aliceTickets = aliceTicketsRes.body as Array<{
            token: string;
            eventId: string;
            isActive: boolean;
        }>;
        const alicePub4Ticket = aliceTickets.find(
            (t) => t.eventId === pub4?.id && t.isActive,
        );
        expect(
            alicePub4Ticket,
            "Alice should have an active pub4 ticket after lock-with-issuance",
        ).toBeTruthy();

        // 3. Admin redeems alice's pub4 ticket at pub3 — a different
        //    event. This is the cross-event redeem scenario.
        await page.context().clearCookies();
        await login(page, "admin");

        const pub3 = allEvents.find((e) => e.name === "Sjöpuben");
        expect(pub3, "Sjöpuben must be seeded").toBeTruthy();

        const redeemRes = await browserFetch(
            page,
            "POST",
            "/api/tickets/redeem",
            {
                token: alicePub4Ticket?.token,
                eventId: pub3?.id,
            },
        );
        expect(
            redeemRes.ok,
            `redeem failed: ${redeemRes.status} ${JSON.stringify(redeemRes.body)}`,
        ).toBeTruthy();
        const redeemed = redeemRes.body as {
            redeemedAtEventId: string;
            isActive: boolean;
            redeemedAt: string;
        };
        expect(redeemed.redeemedAtEventId).toBe(pub3?.id);
        expect(redeemed.isActive).toBe(false);
        expect(redeemed.redeemedAt).toBeTruthy();

        // 4. Subsequent redeems of the same token fail.
        const doubleRedeem = await browserFetch(
            page,
            "POST",
            "/api/tickets/redeem",
            {
                token: alicePub4Ticket?.token,
                eventId: pub3?.id,
            },
        );
        expect(doubleRedeem.ok).toBeFalsy();
    });
});
