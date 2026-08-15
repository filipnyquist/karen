import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";
import { csrfFetch } from "./_helper";

/**
 * P1 findings — verify secondary auth / PII surface.
 *
 * Per pentest plan (2026-08-15):
 *  - P1-1: PUT /api/events/:id body `locked:false` from a responsible
 *    bypasses the dedicated /lock endpoint's "only admins can unlock" rule
 *    (src/api/routes/events.ts:89-113).
 *  - P1-2: src/pages/report/[eventId].astro has only requireAuth, not
 *    requireResponsibleOrAdmin — any logged-in user can read any event's
 *    report and worker names.
 *  - P1-3: POST /api/teams/:id/join has no membership gate — any logged-in
 *    user can join any team.
 *  - P1-4: POST /api/auth/request-verify lets the caller specify the
 *    recipient email (body.email is sent, not user.email) — email-bomb
 *    surface (src/api/routes/auth.ts:159-172).
 *  - P1-6 (resolved): scanTicket's projection already excludes email /
 *    role. The original SSN-in-scan finding is moot since the SSN
 *    storage is gone; the test still asserts no role/email leak.
 */

test.describe("P1 auth / PII surface findings", () => {
    test("P1-1: PUT /api/events/:id no longer accepts `locked` (must use /lock endpoint)", async ({
        browser,
    }) => {
        // Regression guard for the fix that removed `locked` from the PUT
        // body schema. The dedicated POST /:id/lock endpoint still enforces
        // the admin-only-unlock rule.

        // Admin context: lock the event first via the dedicated endpoint.
        const adminCtx = await browser.newContext();
        const adminPage = await adminCtx.newPage();
        await login(adminPage, "admin");

        const eventId = await findEventId(adminPage, "Midsommarpub");
        expect(eventId).toBeTruthy();

        const lockRes = await adminPage.request.post(
            `/api/events/${eventId}/lock`,
            { data: { locked: true } },
        );
        expect(
            lockRes.ok(),
            `admin lock should succeed: ${lockRes.status()}`,
        ).toBe(true);

        const getAfterLock = await adminPage.request.get(
            `/api/events/${eventId}`,
        );
        const lockedBody = (await getAfterLock.json()) as { locked?: boolean };
        expect(lockedBody.locked).toBe(true);

        await adminCtx.close();

        // Erik (responsible for Midsommarpub) tries to PUT `locked: false`.
        // The PUT body schema no longer accepts `locked`, so this must fail.
        const erikCtx = await browser.newContext();
        const erikPage = await erikCtx.newPage();
        await login(erikPage, "erik");

        const putRes = await erikPage.request.put(`/api/events/${eventId}`, {
            data: { locked: false },
        });
        expect(
            putRes.ok(),
            `PUT must no longer accept \`locked\` — got ${putRes.status()}`,
        ).toBe(false);

        // Verify the event is still locked.
        const getAfterPut = await erikPage.request.get(
            `/api/events/${eventId}`,
        );
        const stillLocked = (await getAfterPut.json()) as {
            locked?: boolean;
        };
        expect(
            stillLocked.locked,
            "event must remain locked; PUT should not have unlocked it",
        ).toBe(true);

        await erikCtx.close();
    });

    test("P1-2: regular user is redirected away from /report/:eventId", async ({
        page,
    }) => {
        // Regression guard: the page now requires responsible-or-admin,
        // mirroring the API gate. A regular user (alice) is not
        // responsible for Midsommarpub, so she should be redirected to /.

        await login(page, "alice");

        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();

        await page.goto(`/report/${eventId}`);
        await page.waitForLoadState("networkidle");

        // Must have been redirected away from /report.
        const url = new URL(page.url());
        expect(
            url.pathname,
            "regular user must NOT be able to view /report/:eventId",
        ).not.toContain("/report/");
        // Redirect target is "/" (the home page).
        expect(url.pathname).toBe("/");
    });

    test("P1-3: team join requires a valid 8-char code (no blind enrollment)", async ({
        page,
    }) => {
        // Regression guard: after the fix, the POST /api/teams/:id/join
        // endpoint must require a valid 8-char join code. Three sub-cases:
        //   1) No code in body → 400/422
        //   2) Wrong code → 403
        //   3) Right code → 200/409 (alice is admin of Bryggeriet so 409)

        await login(page, "alice");

        // Find a team that alice is NOT already a member of, so we can
        // exercise the 200 path. Bob is a member of Bryggeriet but not
        // admin — but alice is admin of Bryggeriet. Use a different team
        // that alice is not in.
        const list = await page.request.get("/api/teams");
        expect(list.ok()).toBe(true);
        const teams = (await list.json()) as Array<{
            id: string;
            name: string;
        }>;
        expect(teams.length, "at least one team seeded").toBeGreaterThan(0);

        // Fetch Bryggeriet specifically (alice is admin there → 409
        // when joining, which is what we want for case 3).
        const target = teams[0];

        // 1) No code in body → must fail (400 from Elysia schema
        // validation, or 422). Pass an empty object so the request
        // actually has a JSON body — csrfFetch otherwise omits the body
        // entirely, which Elysia treats differently from `{}`.
        const noCode = await csrfFetch(
            page,
            "POST",
            `/api/teams/${target.id}/join`,
            {},
        );
        expect(
            [400, 422],
            `no-code join must fail; got ${noCode.status}: ${JSON.stringify(noCode.body)}`,
        ).toContain(noCode.status);

        // 2) Wrong code → 403 INVALID_CODE.
        const wrongCode = await csrfFetch(
            page,
            "POST",
            `/api/teams/${target.id}/join`,
            {
                code: "ZZZZZZZZ",
            },
        );
        expect(wrongCode.status, "wrong-code join must be 403").toBe(403);

        // 3) Right code → 200 (joined) or 409 (already a member). Read
        // the team's actual joinCode from the GET /:id endpoint.
        const teamRes = await page.request.get(`/api/teams/${target.id}`);
        const teamBody = (await teamRes.json()) as {
            joinCode?: string;
        };
        expect(
            teamBody.joinCode,
            "team should expose its joinCode in /api/teams/:id",
        ).toBeTruthy();

        const rightCode = await csrfFetch(
            page,
            "POST",
            `/api/teams/${target.id}/join`,
            { code: teamBody.joinCode },
        );
        // alice is admin of Bryggeriet (per seed) so this is 409
        // ALREADY_MEMBER, not 200.
        expect(
            [200, 409],
            `valid-code join must succeed or be already-a-member; got ${rightCode.status}: ${JSON.stringify(rightCode.body)}`,
        ).toContain(rightCode.status);
    });

    test("P1-4: /api/auth/request-verify refuses to send to a non-matching email", async ({
        page,
    }) => {
        await login(page, "alice");

        // Send to a different BTH address — should be refused because the
        // service enforces `user.email === body.email`
        // (src/services/auth.ts:217 EMAIL_MISMATCH).
        const result = await csrfFetch(
            page,
            "POST",
            "/api/auth/request-verify",
            {
                email: "victim@student.bth.se",
            },
        );
        expect(
            result.ok,
            `request-verify should refuse mismatched email (status=${result.status}, body=${JSON.stringify(result.body)})`,
        ).toBe(false);
        expect(result.status).toBe(403);
    });
});
