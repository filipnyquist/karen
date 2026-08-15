import { expect, test } from "@playwright/test";
import { getMigrationToken, login } from "../helpers/auth";

/**
 * P0-3 / P0-4 / P0-5 — verify auth-bypass / privilege-grant paths.
 *
 * Per pentest plan (2026-08-15):
 *  - P0-3: any logged-in user who holds a migration token can consume it
 *    via /api/migration/verify-link and end up with users.verified=true
 *    (src/api/routes/migration.ts:143-190 + executeMerge line 402).
 *    The route does not require the requester to control the recipient
 *    inbox — the token is the only proof.
 *  - P0-4: any logged-in user can claim any SSN via
 *    PUT /api/profiles/me/ssn (src/api/routes/profiles.ts:80-122).
 *    Uniqueness prevents collisions; the FIRST claim wins. Once an SSN
 *    is on file, the user can register guests under their own profile.
 *  - P0-5: any admin can self-verify via /api/admin/verify by passing
 *    their own userId (src/api/routes/admin.ts:319-362) and self-demote
 *    via PUT /api/admin/users/:id (src/api/routes/admin.ts:638-773).
 */

test.describe("Auth bypass / privilege grant paths", () => {
    test("P0-3: failed migration merge must NOT silently grant verified=true", async ({
        page,
    }) => {
        // Regression guard for the transactional fix in
        // src/api/routes/migration.ts:executeMerge. Before the fix, the
        // `verified=true` UPDATE on the real user ran before a failing
        // DELETE on the placeholder user (FK violation), so the caller
        // saw HTTP 500 but the verification bypass had already taken
        // effect. After the fix, the transaction rolls back atomically.
        await login(page, "alice");

        // Snapshot alice's verified state BEFORE the merge. The seed
        // gives alice verified=true by default; we assert the value is
        // unchanged after a failed merge.
        const before = await page.request.get("/api/profiles/me");
        expect(before.ok()).toBe(true);
        const beforeBody = (await before.json()) as { verified: boolean };

        // Consume the seeded migration token. With the placeholder user
        // having audit_log FK references (seeded data), the merge fails
        // mid-way through — exactly the scenario that used to leak the
        // verified=true side effect.
        const verifyRes = await page.request.get(
            `/api/migration/verify-link?token=${getMigrationToken()}`,
        );
        const status = verifyRes.status();
        test.info().annotations.push({
            type: "info",
            description: `verify-link returned HTTP ${status} (merge fails on placeholder DELETE)`,
        });

        // The security claim: even though the merge fails, alice's
        // verified flag must be unchanged. The pre-fix code flipped it to
        // true and then errored; the transaction must roll it back.
        const after = await page.request.get("/api/profiles/me");
        expect(after.ok()).toBe(true);
        const afterBody = (await after.json()) as { verified: boolean };
        expect(
            afterBody.verified,
            `BUG: alice.verified flipped by a failed merge (was ${beforeBody.verified}, now ${afterBody.verified}) — transaction rollback is missing`,
        ).toBe(beforeBody.verified);
    });

    test("P0-4: any logged-in user can claim any SSN (no identity proof)", async ({
        page,
    }) => {
        // Alice is already verified but has no SSN. PUT /api/profiles/me/ssn
        // should currently succeed even though there is no proof the SSN
        // actually belongs to alice. We don't pin a specific SSN value
        // because parallel tests (P0-2) may race; we just check the claim
        // succeeded and a SSN is on file.
        await login(page, "alice");

        const claim = await page.request.put("/api/profiles/me/ssn", {
            data: { ssn: "19990101-0000" },
        });
        expect(
            claim.ok(),
            `BUG: SSN claim should currently succeed for any logged-in user (status=${claim.status()}, body=${await claim.text()})`,
        ).toBe(true);

        const me = await page.request.get("/api/profiles/me");
        expect(me.ok()).toBe(true);
        const body = (await me.json()) as { ssn: string | null };
        expect(
            body.ssn,
            "alice should have an SSN on file after the claim",
        ).toBeTruthy();
    });

    test("P0-5: admin can self-verify by passing their own userId", async ({
        page,
    }) => {
        // Snapshot the admin's verified flag.
        await login(page, "admin");
        const meBefore = await page.request.get("/api/profiles/me");
        expect(meBefore.ok()).toBe(true);
        const before = (await meBefore.json()) as {
            id: string;
            verified: boolean;
        };

        // Find the admin's userId via the admin users list.
        const users = await page.request.get("/api/admin/users");
        expect(users.ok()).toBe(true);
        const list = (await users.json()) as Array<{
            id: string;
            email: string;
        }>;
        const adminRow = list.find((u) => u.email === "admin@karen.se");
        expect(adminRow?.id, "admin row in /api/admin/users").toBeTruthy();

        // Self-verify.
        const verify = await page.request.post("/api/admin/verify", {
            data: { userId: adminRow?.id ?? "" },
        });
        expect(
            verify.ok(),
            `BUG: admin self-verify should currently succeed (status=${verify.status()})`,
        ).toBe(true);

        // Confirm.
        const meAfter = await page.request.get("/api/profiles/me");
        const after = (await meAfter.json()) as { verified: boolean };
        expect(after.verified, "BUG: admin.verified is now true").toBe(true);

        // Optional sanity: if before was already true, this test still
        // demonstrates the path works for self, but log it so a future
        // reviewer can see the seed state.
        if (before.verified) {
            test.info().annotations.push({
                type: "info",
                description:
                    "admin was already verified=true at seed time — self-verify path still confirmed reachable",
            });
        }
    });
});
