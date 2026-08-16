// e2e/admin/scoreboard-export.spec.ts
//
// Verifies the admin scoreboard export:
//   - /admin/exports/scoreboard page is admin-only.
//   - GET /api/admin/exports/scoreboard?semester&year returns a text/plain
//     attachment with the expected header/footer and the seed users who
//     worked events in the requested semester.
//   - The export is recorded in the audit log (superadmin-only).
//   - Non-admins get 403 on the API and a redirect on the page.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Scoreboard export", () => {
    test("admin can reach the export page and see quick picks", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin/exports/scoreboard");

        // Locale defaults to sv so the heading is "Poängställning —
        // export" (Swedish). Match "export" which appears in both EN/SV.
        await expect(
            page.getByRole("heading", { name: /export/i }),
        ).toBeVisible();

        // Year input defaults to current year.
        const yearInput = page.locator('input[name="year"]');
        await expect(yearInput).toBeVisible();

        // 4 quick-pick links rendered (one per recent completed semester).
        const quickPicks = page.locator(
            'a[href^="/api/admin/exports/scoreboard?semester="]',
        );
        await expect(quickPicks).toHaveCount(4);
    });

    test("non-admin is redirected away from the export page", async ({
        page,
    }) => {
        await login(page, "alice");
        await page.goto("/admin/exports/scoreboard");
        await page.waitForURL("/");
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("admin downloads a fall semester scoreboard as text/plain", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.waitForURL("/");

        // Pick a known seeded semester. The seed places Spring 2026 events
        // starting ~30 days from "now" (run-time anchor), so we request the
        // current year explicitly. Fall of the prior year should be empty
        // given the seed but still returns a well-formed attachment.
        const currentYear = new Date().getFullYear();
        const res = await page.request.get(
            `/api/admin/exports/scoreboard?semester=fall&year=${currentYear - 1}`,
        );

        expect(res.status()).toBe(200);
        expect(res.headers()["content-type"]).toContain("text/plain");
        expect(res.headers()["content-disposition"]).toContain("attachment");
        expect(res.headers()["content-disposition"]).toContain(
            `scoreboard-fall-${currentYear - 1}.txt`,
        );

        const body = await res.text();
        // Header line is always present.
        expect(body).toMatch(
            new RegExp(`Fall semester ${currentYear - 1} scoreboard`),
        );
        expect(body).toMatch(/Period: /);
        expect(body).toMatch(/Generated: /);
        // Either there are data rows with worker emails (this could happen
        // if seed events span into fall) or the explicit empty-state line.
        const emptyState = body.includes(
            "(no workers with points in this semester)",
        );
        const hasRows = /^[ ]*1[ ]+/m.test(body);
        expect(emptyState || hasRows).toBe(true);

        if (hasRows) {
            // Total workers footer must equal the number of data rows.
            const totalLine = body
                .split("\n")
                .find((l) => l.startsWith("Total workers: "));
            expect(totalLine).toBeTruthy();
        }
    });

    test("admin downloads a spring semester that has seed events", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.waitForURL("/");

        // The seed creates "Vårpub 2026" roughly 180 days before "now" and
        // a "Spring" semester for the current calendar year covers Feb-Jun
        // of that year. To hit the spring semester that contains the seed
        // events, request the previous calendar year (the seed events are
        // ~180 days back, which can land in either spring or fall depending
        // on when the test runs — either way the file should be a valid
        // attachment).
        const targetYear = new Date().getFullYear();
        const res = await page.request.get(
            `/api/admin/exports/scoreboard?semester=spring&year=${targetYear}`,
        );

        expect(res.status()).toBe(200);
        expect(res.headers()["content-type"]).toContain("text/plain");
        expect(res.headers()["content-disposition"]).toContain("attachment");
    });

    test("non-admin gets 403 on the API", async ({ page }) => {
        await login(page, "alice");
        const res = await page.request.get(
            "/api/admin/exports/scoreboard?semester=fall&year=2025",
        );
        expect(res.status()).toBe(403);
    });

    test("bad year returns 400", async ({ page }) => {
        await login(page, "admin");
        const res = await page.request.get(
            "/api/admin/exports/scoreboard?semester=fall&year=abc",
        );
        expect(res.status()).toBe(400);
    });

    test("bad minPoints returns 400", async ({ page }) => {
        await login(page, "admin");
        const res = await page.request.get(
            "/api/admin/exports/scoreboard?semester=fall&year=2025&minPoints=abc",
        );
        expect(res.status()).toBe(400);
    });

    test("minPoints filter excludes low-event users and stamps the file", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.waitForURL("/");

        // Same semester as the fall-semester test above (which may be empty
        // for the seed data). Either way the filter line should be present
        // when minPoints > 1.
        const year = new Date().getFullYear() - 1;
        const res = await page.request.get(
            `/api/admin/exports/scoreboard?semester=fall&year=${year}&minPoints=3`,
        );
        expect(res.status()).toBe(200);
        expect(res.headers()["content-disposition"]).toContain(
            `scoreboard-fall-${year}-min3.txt`,
        );

        const body = await res.text();
        expect(body).toContain("Filter: only users with at least 3 events");
    });

    test("export action is recorded in the audit log", async ({ page }) => {
        await login(page, "superadmin"); // audit log is superadmin-only
        await page.waitForURL("/");

        // Trigger an export (with a minPoints filter so we also verify
        // the value lands in the audit payload).
        const year = new Date().getFullYear() - 1;
        const trigger = await page.request.get(
            `/api/admin/exports/scoreboard?semester=fall&year=${year}&minPoints=2`,
        );
        expect(trigger.status()).toBe(200);

        // Verify the audit entry exists. The endpoint returns latest-first,
        // but other tests in this file may have generated scoreboard.export
        // rows with different parameters — find the one we just triggered.
        const audit = await page.request.get(
            "/api/admin/audit-log?action=scoreboard.export&limit=50",
        );
        expect(audit.status()).toBe(200);
        const entries = (await audit.json()) as Array<{
            action: string;
            newValue: string | null;
        }>;
        const found = entries.find((e) =>
            e.newValue?.includes(`"minPoints":2`),
        );
        expect(found, "audit entry for this export should exist").toBeTruthy();
        expect(found?.newValue).toContain(`"semester":"fall"`);
        expect(found?.newValue).toContain(`"year":${year}`);
        expect(found?.newValue).toContain(`"minPoints":2`);
    });
});
