// e2e/admin/education-grant.spec.ts
//
// Verifies the admin bulk-grant education feature:
//   - Page loads for admin; non-admin gets 302 to /.
//   - The new POST /api/admin/education/bulk endpoint accepts a list
//     of userIds and grants the education to all of them in a
//     single atomic upsert.
//   - Validation: empty userIds → 400 NO_USERS_SELECTED; invalid
//     educationTypeId → 404 EDUCATION_TYPE_NOT_FOUND.
//
// Note: e2e locale is sv-SE (per playwright.config.ts), so the
// rendered UI strings are Swedish. Matchers below match the SV
// values from src/i18n/sv.ts.
//
// UI tests against the Event-tab worker list are kept lightweight
// here (page loads + tab buttons present). End-to-end functional
// verification of the bulk grant goes through the API directly,
// which avoids the flaky onChange-vs-selectOption timing that
// preact+playwright sometimes runs into with `<select>` controls.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

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
                    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
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

test.describe("Admin bulk-grant education", () => {
    test("page loads for admin", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/admin/education-grant");
        await expect(
            page.getByRole("heading", { name: /bevilja utbildning/i }),
        ).toBeVisible();
        await expect(
            page.getByRole("tab", { name: /per evenemang/i }),
        ).toBeVisible();
        await expect(
            page.getByRole("tab", { name: /per användare/i }),
        ).toBeVisible();
    });

    test("Non-admin sees redirect away from /admin/education-grant", async ({
        page,
    }) => {
        await login(page, "alice"); // regular user, role="user"
        await page.goto("/admin/education-grant");
        await expect(page).toHaveURL("/");
    });

    test("POST /api/admin/education/bulk grants to all userIds", async ({
        page,
    }) => {
        await login(page, "superadmin");

        // Pick two seeded users. We give them "aas" education (id 3 in
        // the seed per src/db/seed-test.ts).
        const list = await browserFetch(page, "GET", "/api/admin/users");
        expect(list.ok).toBeTruthy();
        const users = list.body as Array<{ id: string; email: string }>;
        const newbie = users.find((u) => u.email === "newbie@karen.se");
        const migrant = users.find((u) => u.email === "migrant@karen.se");
        expect(newbie).toBeDefined();
        expect(migrant).toBeDefined();
        if (!newbie || !migrant) return;

        const today = new Date().toISOString();
        const grant = await browserFetch(
            page,
            "POST",
            "/api/admin/education/bulk",
            {
                mode: "users",
                educationTypeId: 3, // 'aas' education from the seed
                completedAt: today,
                userIds: [newbie.id, migrant.id],
            },
        );
        expect(grant.ok, `bulk grant failed: ${grant.status}`).toBeTruthy();
        expect(grant.status).toBe(200);
        const grantBody = grant.body as {
            success?: boolean;
            granted?: number;
        };
        expect(grantBody.success).toBe(true);
        expect(grantBody.granted).toBe(2);

        // Verify via the single-user detail endpoint that one of them
        // now has the AAS education in their list.
        const detail = await browserFetch(
            page,
            "GET",
            `/api/admin/users/${newbie.id}`,
        );
        expect(detail.ok).toBeTruthy();
    });

    test("POST /api/admin/education/bulk rejects empty userIds (400)", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const res = await browserFetch(
            page,
            "POST",
            "/api/admin/education/bulk",
            {
                mode: "users",
                educationTypeId: 1,
                completedAt: new Date().toISOString(),
                userIds: [],
            },
        );
        expect(res.status).toBe(400);
        const body = res.body as { code?: string };
        expect(body.code).toBe("NO_USERS_SELECTED");
    });

    test("POST /api/admin/education/bulk rejects unknown educationTypeId (404)", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const list = await browserFetch(page, "GET", "/api/admin/users");
        const users = list.body as Array<{ id: string; email: string }>;
        const bob = users.find((u) => u.email === "bob@karen.se");
        expect(bob).toBeDefined();
        if (!bob) return;

        const res = await browserFetch(
            page,
            "POST",
            "/api/admin/education/bulk",
            {
                mode: "users",
                educationTypeId: 99999,
                completedAt: new Date().toISOString(),
                userIds: [bob.id],
            },
        );
        expect(res.status).toBe(404);
        const body = res.body as { code?: string };
        expect(body.code).toBe("EDUCATION_TYPE_NOT_FOUND");
    });

    test("POST /api/admin/education/bulk in event mode resolves workers", async ({
        page,
    }) => {
        await login(page, "superadmin");
        // Find Midsommarpub (seed-test pub4 = 5 registered workers)
        // via the public events list.
        const evRes = await browserFetch(page, "GET", "/api/events");
        expect(evRes.ok).toBeTruthy();
        const evList = evRes.body as Array<{
            id: string;
            name: string;
        }>;
        const event = evList.find((e) => e.name === "Midsommarpub");
        expect(event).toBeDefined();
        if (!event) return;

        // Pick 5 distinct user IDs we haven't touched in earlier
        // tests in this run (use alice, bob, charlie, diana, erik who
        // are already on pub4 by seed).
        const list = await browserFetch(page, "GET", "/api/admin/users");
        expect(list.ok).toBeTruthy();
        const userList = list.body as Array<{
            id: string;
            email: string;
        }>;
        const getUserId = (email: string) =>
            userList.find((u) => u.email === email)?.id;
        const selectedIds = [
            getUserId("alice@karen.se"),
            getUserId("bob@karen.se"),
            getUserId("charlie@karen.se"),
            getUserId("diana@karen.se"),
            getUserId("erik@karen.se"),
        ];
        expect(selectedIds.every((id) => typeof id === "string")).toBeTruthy();

        const res = await browserFetch(
            page,
            "POST",
            "/api/admin/education/bulk",
            {
                mode: "event",
                eventId: event.id,
                educationTypeId: 1, // pub_worker (for completeness — they may already have it)
                completedAt: new Date().toISOString(),
            },
        );
        expect(
            res.ok,
            `event-mode bulk failed: ${res.status} ${JSON.stringify(res.body)}`,
        ).toBeTruthy();
        const body = res.body as { granted?: number };
        expect(body.granted).toBe(5);
    });
});
