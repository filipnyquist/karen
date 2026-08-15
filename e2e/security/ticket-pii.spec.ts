import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

/**
 * P1-6 — verify the ticket scan PII surface.
 *
 * Per pentest plan: POST /api/tickets/scan returns the full users row
 * (including encrypted SSN + email) to any worker on the same event
 * during the scan window (src/api/routes/tickets.ts:54-91 →
 * src/services/tickets.ts:71 scanTicket projection).
 *
 * The scanner UI only needs the holder's name + verified flag.
 */

test.describe("Ticket scan PII surface", () => {
    test("P1-6: /api/tickets/scan response is already projected (no email / SSN leak)", async ({
        browser,
    }) => {
        // scanTicket (src/services/tickets.ts:100-110) explicitly projects
        // to {id, name, nickname, profilePic} only. We assert this so a
        // future change that drops the projection is caught.
        //
        // Use admin to issue + scan — the auth gate (`canScanTickets`) is a
        // separate concern.

        const adminCtx = await browser.newContext();
        const adminPage = await adminCtx.newPage();
        await login(adminPage, "admin");

        const eventId = await findEventId(adminPage, "Midsommarpub");
        expect(eventId).toBeTruthy();

        const usersRes = await adminPage.request.get("/api/admin/users");
        const users = (await usersRes.json()) as Array<{
            id: string;
            email: string;
        }>;
        const erikRow = users.find((u) => u.email === "erik@karen.se");
        expect(erikRow?.id, "erik row in /api/admin/users").toBeTruthy();

        const issue = await adminPage.request.post("/api/tickets/issue", {
            data: { userId: erikRow?.id ?? "", eventId },
        });
        expect(
            issue.ok(),
            `admin issue ticket should succeed: ${issue.status()} ${await issue.text()}`,
        ).toBe(true);
        const issued = (await issue.json()) as { token: string };
        expect(issued.token).toBeTruthy();

        const scan = await adminPage.request.post("/api/tickets/scan", {
            data: { token: issued.token, eventId },
        });
        expect(
            scan.ok(),
            `scan should currently succeed for an authorized caller: ${scan.status()}`,
        ).toBe(true);
        const body = (await scan.json()) as Record<string, unknown>;

        const user = body.user as Record<string, unknown> | undefined;
        test.info().annotations.push({
            type: "info",
            description: `scan user-row keys: ${user ? Object.keys(user).sort().join(", ") : "no user field"}`,
        });

        // Sanity: the projection only includes the documented safe fields.
        expect(user, "scan response should include `user`").toBeTruthy();
        expect(user && "email" in user, "scan must NOT leak email").toBe(false);
        expect(user && "ssn" in user, "scan must NOT include SSN field").toBe(
            false,
        );
        expect(user && "ssnHash" in user, "scan must NOT include ssnHash").toBe(
            false,
        );
        expect(user && "role" in user, "scan must NOT include role").toBe(false);

        await adminCtx.close();
    });
});
