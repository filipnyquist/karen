// src/e2e/tickets/audit-log.spec.ts
//
// Verifies that ticket lifecycle mutations write audit_log entries that
// are observable via GET /api/admin/audit-log.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

interface AuditEntry {
    id: string;
    actorId: string;
    action: string;
    targetUserId: string | null;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
}

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

test.describe("Ticket audit log", () => {
    test("revoke writes ticket.revoke audit entry", async ({ page }) => {
        // 1. Login as superadmin (audit log is now superadmin-only).
        await login(page, "superadmin");
        await page.waitForURL("/");

        // 2. Find Midsommarpub.
        const eventsRes = await browserGet(page, "/api/events");
        const allEvents = eventsRes.body as Array<{
            id: string;
            name: string;
        }>;
        const pub4 = allEvents.find((e) => e.name === "Midsommarpub");
        expect(pub4, "Midsommarpub must be seeded").toBeTruthy();

        // 3. Lock the event to issue tickets.
        const lockRes = await browserFetch(
            page,
            "POST",
            `/api/events/${pub4?.id}/lock`,
            { locked: true, issueTickets: true },
        );
        expect(lockRes.ok).toBeTruthy();

        // 4. Find bob's ticket. (Alice may have had her ticket redeemed
        //    by the cross-event-redeem test running in parallel, so we
        //    use a different user to keep this test isolated.)
        const usersRes = await browserGet(page, "/api/admin/users");
        const users = usersRes.body as Array<{
            id: string;
            email: string;
        }>;
        const bob = users.find((u) => u.email === "bob@karen.se");
        expect(bob).toBeTruthy();

        // Bob logs in to fetch his tickets.
        await page.context().clearCookies();
        const { getPasswordFor } = await import("../helpers/auth");
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.locator("#email").fill("bob@karen.se");
        await page.locator("#password").fill(getPasswordFor("bob@karen.se"));
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL("/");

        const bobTicketsRes = await browserGet(page, "/api/tickets/mine");
        const bobTickets = bobTicketsRes.body as Array<{
            id: string;
            isActive: boolean;
            eventId: string;
        }>;
        const bobPub4Ticket = bobTickets.find(
            (t) => t.eventId === pub4?.id && t.isActive,
        );
        expect(
            bobPub4Ticket,
            "Bob should have an active pub4 ticket",
        ).toBeTruthy();

        // Admin logs back in to revoke.
        await page.context().clearCookies();
        await login(page, "superadmin");

        const revokeRes = await browserFetch(
            page,
            "DELETE",
            `/api/tickets/${bobPub4Ticket?.id}`,
        );
        expect(
            revokeRes.ok,
            `revoke failed: ${revokeRes.status} ${JSON.stringify(revokeRes.body)}`,
        ).toBeTruthy();

        // 5. Read the audit log filtered by action.
        const auditRes = await browserGet(
            page,
            "/api/admin/audit-log?action=ticket.revoke&limit=50",
        );
        expect(auditRes.ok).toBeTruthy();
        const entries = auditRes.body as AuditEntry[];
        const revokeEntry = entries.find(
            (e) => e.targetUserId === bob?.id && e.action === "ticket.revoke",
        );
        expect(
            revokeEntry,
            "ticket.revoke audit entry must exist for bob's ticket",
        ).toBeTruthy();
        expect(revokeEntry?.oldValue).toContain("true");
        expect(revokeEntry?.newValue).toContain("false");

        // 6. Also verify ticket.issue.bulk entry from the lock.
        const bulkRes = await browserGet(
            page,
            "/api/admin/audit-log?action=ticket.issue.bulk&limit=5",
        );
        expect(bulkRes.ok).toBeTruthy();
        const bulkEntries = bulkRes.body as AuditEntry[];
        expect(bulkEntries.length).toBeGreaterThan(0);
        expect(
            bulkEntries[0].newValue,
            "ticket.issue.bulk payload should include issued count",
        ).toContain("issued");
    });
});
