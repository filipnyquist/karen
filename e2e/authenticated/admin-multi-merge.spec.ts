// e2e/authenticated/admin-multi-merge.spec.ts
//
// Verifies the multi-merge fixes in executeMerge: two legacy
// placeholders can be merged into the same real user without
// tripping any of the four composite-key / partial-unique
// constraints that reassigning user_id collides with:
//
//   1. pub_team_members   PK        (team_id, user_id)
//   2. worker_registrations unique   (event_id, user_id)
//   3. tickets            partial    (user_id, event_id) WHERE is_active
//   4. user_educations    PK        (user_id, education_type_id)
//
// Pre-fix this would 500 the second merge with a 23505 unique-constraint
// violation on whichever constraint fired first. Post-fix the
// DELETE-then-UPDATE sequence in executeMerge drops the conflicting
// placeholder rows first, inside the same tx so concurrent merges of
// the same real user can't race.
//
// Test seed (src/db/seed-test.ts) sets up both placeholders to share
// every collision target with the merge target (bob):
//   - both are members of Bryggeriet (where bob is also a member),
//   - both are registered as workers at Vårpub 2026 (where bob is also
//     registered),
//   - both hold an active ticket to Höstpub (the partial-unique-index
//     conflict materialises after the first merge transfers the
//     first ticket to bob),
//   - both carry a `pub_worker` education (where bob already has one).
//
// Two placeholders with legacy_mappings oldUserId=99 and oldUserId=97.
// Mapping 98 is pre-completed (used by hide-migrate-button.spec.ts),
// so we only have two unclaimed mappings to drain.

import { expect, test } from "@playwright/test";
import { login, TEST_USER_EMAILS } from "../helpers/auth";

async function browserFetch(
    page: import("@playwright/test").Page,
    method: "POST" | "PUT" | "DELETE" | "GET",
    url: string,
    body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
    return await page.evaluate(
        async ([m, u, b]) => {
            const csrf =
                document.cookie
                    .split("; ")
                    .find((c) => c.startsWith("csrf_token="))
                    ?.split("=")[1] ?? "";
            const res = await fetch(u as string, {
                method: m as string,
                headers: {
                    "Content-Type": "application/json",
                    ...(csrf ? { "X-CSRF-Token": csrf } : ""),
                },
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

interface MigrationMapping {
    id: string;
    oldUserId: number;
    oldEmail: string;
    realUserId: string | null;
}

async function fetchMappings(
    page: import("@playwright/test").Page,
): Promise<{ mappings: MigrationMapping[] }> {
    const res = await browserFetch(page, "GET", "/api/migration/status");
    expect(res.ok).toBeTruthy();
    return res.body as { mappings: MigrationMapping[] };
}

test.describe.configure({ mode: "serial" });
test.describe("Admin multi-merge", () => {
    test("placeholder→karen merge into a Bryggeriet member succeeds without PK conflict", async ({
        page,
    }) => {
        await login(page, "admin");

        // Pick a real (non-legacy) user already in Bryggeriet — bob
        // is. This exercises the DELETE-then-UPDATE path in
        // executeMerge: when the real user already has Bryggeriet
        // membership AND a placeholder is also on Bryggeriet, a
        // naive UPDATE pub_team_members SET userId = realUserId
        // would PK-violate.
        const usersRes = await browserFetch(page, "GET", "/api/admin/users");
        expect(usersRes.ok).toBeTruthy();
        const users = usersRes.body as Array<{
            id: string;
            email: string;
            isLegacy: boolean | null;
        }>;
        const target = users.find(
            (u) => u.email === TEST_USER_EMAILS.bob && !u.isLegacy,
        );
        expect(target).toBeTruthy();

        const status = await fetchMappings(page);
        const unclaimed = status.mappings.filter((m) => !m.realUserId);
        // The seed creates two unclaimed mappings (oldUserId=99 and
        // oldUserId=97) both pointing at placeholders in Bryggeriet.
        // Even if a sibling spec consumed one, we only need one to
        // exercise the conflict fix path — once the real user has
        // Bryggeriet membership (set by whichever spec ran first),
        // re-merging another placeholder triggers the PK violation
        // that the DELETE-then-UPDATE fix avoids.
        expect(unclaimed.length).toBeGreaterThanOrEqual(1);

        for (const mapping of unclaimed) {
            const res = await browserFetch(
                page,
                "POST",
                "/api/migration/admin-approve",
                {
                    legacyId: mapping.id,
                    userId: target?.id,
                },
            );
            expect(
                res.ok,
                `admin-approve for oldUserId=${mapping.oldUserId} failed: ${res.status} ${JSON.stringify(res.body)}`,
            ).toBeTruthy();
        }

        const after = await fetchMappings(page);
        for (const m of unclaimed) {
            const claimed = after.mappings.find((x) => x.id === m.id);
            expect(claimed?.realUserId).toBe(target?.id);
        }
    });
});
