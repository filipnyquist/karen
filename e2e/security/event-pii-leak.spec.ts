import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

/**
 * P0-1 / P0-2 / P1-7 (anon-name audit) — verify PII handling on /event/[id].
 *
 * Per pentest plan (2026-08-15):
 *  - P0-1: anon must not see guestName / guestEmail in event-page SSR HTML.
 *  - P0-2: logged-in users must not have their decrypted SSN shipped in the
 *    event-page SSR HTML (src/pages/event/[id].astro:207-217 → reporterSsn
 *    prop on <GuestManager>).
 *  - P1-7: anon must see only nick + 3-char truncated real name for every
 *    worker / commenter on every page and API.
 *
 * Each test is named after the finding it confirms. If a finding is later
 * fixed, flip the assertion to `not.toContainText` / `not.toBeVisible` and
 * the test becomes the regression guard.
 */

const GUEST_FULL_NAMES = [
    "Mats Matsson",
    "Lena Larsson",
    "Per Persson",
    "Sara Svensson",
];
const GUEST_EMAILS = ["mats@email.se", "lena@email.se", "sara@email.se"];
const ALICE_FULL_NAME = "Alice Andersson";

test.describe("Event page PII leaks", () => {
    test("P0-1: anonymous event page does not leak guest names or emails", async ({
        browser,
    }) => {
        // Fresh context = no session cookie = anonymous viewer.
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();

        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        // Capture the entire SSR HTML body for grep-style assertions.
        const html = await page.content();

        for (const needle of GUEST_FULL_NAMES) {
            expect(
                html.includes(needle),
                `anonymous viewer should not see guest full-name fragment "${needle}"`,
            ).toBe(false);
        }
        for (const needle of GUEST_EMAILS) {
            expect(
                html.includes(needle),
                `anonymous viewer should not see guest email "${needle}"`,
            ).toBe(false);
        }

        await ctx.close();
    });

    test("P0-2: logged-in user's decrypted SSN must NOT ship in event page HTML", async ({
        browser,
    }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await login(page, "alice");

        // Claim a deterministic SSN.
        const SSN = "20000101-0000";
        await page.request.put("/api/profiles/me/ssn", { data: { ssn: SSN } });

        // Re-read alice's actual SSN (parallel tests may have raced).
        const me = await page.request.get("/api/profiles/me");
        const meBody = (await me.json()) as { ssn: string | null };
        const actualSsn = meBody.ssn;
        expect(
            actualSsn,
            "alice must have an SSN on file for this test to be meaningful",
        ).toBeTruthy();

        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();

        // Read the SSR HTML directly via request.get — this bypasses
        // hydration, so the page is what the server actually rendered.
        // `page.content()` would include client-side state after the
        // useEffect fetch resolves.
        const res = await page.request.get(`/event/${eventId}`);
        const html = await res.text();

        // Regression guard: the SSN used to ship in the SSR HTML.
        // After the fix, the SSR HTML must NOT contain the plaintext SSN;
        // <GuestManager> now fetches it client-side from /api/profiles/me/ssn.
        expect(
            actualSsn !== null && html.includes(actualSsn),
            "BUG: alice's decrypted SSN still ships in event-page SSR HTML",
        ).toBe(false);

        await ctx.close();
    });

    test("P1-7: anonymous viewer sees truncated real names + full nicks on event page", async ({
        browser,
    }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();

        await page.goto(`/event/${eventId}`);
        await page.waitForLoadState("networkidle");

        // Worker table: full name "Alice Andersson" must be truncated to
        // 3 chars + "..." ("Ali...") and the nickname ("Alicia") must remain
        // visible in full.
        const workersTable = page.getByRole("table");
        await expect(workersTable).toBeVisible();
        await expect(
            workersTable.getByText(ALICE_FULL_NAME, { exact: true }),
        ).not.toBeVisible();
        await expect(workersTable.getByText("Ali...")).toBeVisible();
        await expect(workersTable.getByText("Alicia")).toBeVisible();

        await ctx.close();
    });
});
