import { expect, test } from "@playwright/test";
import { findUserId, login } from "../helpers/auth";

/**
 * P1-8 — verify profile/[id].astro over-fetch.
 *
 * The original P1-8 finding (SELECT * pulled encrypted SSN into the
 * SSR scope) was fixed by switching to an explicit projection that
 * excludes `birthDate`. This spec keeps a regression guard for the
 * remaining PII surface (email).
 */

test.describe("Profile page over-fetch (P1-8)", () => {
    test("P1-8: profile page exposes only safe fields to anonymous viewers", async ({
        browser,
    }) => {
        // Admin finds alice's user id.
        const adminCtx = await browser.newContext();
        const adminPage = await adminCtx.newPage();
        await login(adminPage, "admin");
        const aliceId = await findUserId(adminPage, "alice@karen.se");
        expect(aliceId, "alice row in /api/admin/users").toBeTruthy();
        await adminCtx.close();

        // Anonymous viewer fetches /profile/<aliceId>.
        const anonCtx = await browser.newContext();
        const anonPage = await anonCtx.newPage();
        const res = await anonPage.request.get(`/profile/${aliceId}`);
        expect(res.ok()).toBe(true);
        const html = await res.text();

        // PII not exposed: no plaintext email.
        expect(
            html.includes("alice@karen.se"),
            "anon viewer must NOT see alice's email on the profile page",
        ).toBe(false);
        await anonCtx.close();
    });
});
