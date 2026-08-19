// e2e/admin/education-grant.spec.ts
//
// Verifies the admin bulk-grant education feature:
//   - Page loads for admin; non-admin gets 302 to /.
//   - Event tab: pick Midsommarpub, the worker list renders after
//     on-demand fetch (5 workers from the seed).
//   - Users tab: search filter narrows the checkbox grid.
//   - POST /api/admin/education/bulk accepts a list of userIds and
//     grants in a single atomic upsert (event mode + users mode).
//   - Validation: empty userIds → 400 NO_USERS_SELECTED; invalid
//     educationTypeId → 404 EDUCATION_TYPE_NOT_FOUND.
//
// Note: e2e locale is sv-SE (per playwright.config.ts), so the
// rendered UI strings are Swedish. Matchers below match the SV
// values from src/i18n/sv.ts.
//
// The island exposes `data-hydrated="true"` on its root <div> after
// Preact's first useEffect fires. Tests wait for this before driving
// the events <select> — that avoids the selectOption-fires-onChange-
// before-hydration race we hit earlier.

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

async function waitForHydration(page: import("@playwright/test").Page) {
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({
        timeout: 10_000,
    });
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

    test("Event tab: selecting an event renders its 5 workers via on-demand fetch", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin/education-grant");
        await waitForHydration(page);

        await page.locator("select#event-select").selectOption({
            label: "Midsommarpub",
        });
        // After selectOption, the island fires onChange → fetches
        // /api/events/<uuid>/workers → renders 5 checkboxes. Wait
        // for the "Select all workers" header button which only
        // appears once the worker list is loaded.
        await page
            .getByRole("button", { name: /markera alla arbetare/i })
            .waitFor({ state: "visible", timeout: 15_000 });
        // Per seed-test.ts:pub4 has 5 (Erik, Alice, Bob, Charlie, Diana).
        await expect(page.getByRole("checkbox")).toHaveCount(5);
    });

    test("Users tab: typing a search filter narrows the user list", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin/education-grant");
        await waitForHydration(page);

        await page.getByRole("tab", { name: /per användare/i }).click();
        await page.getByRole("searchbox").fill("alice");
        // The seed has only one Alice. Filter should narrow the list.
        await expect(
            page.locator("#panel-users").getByRole("checkbox"),
        ).toHaveCount(1, { timeout: 10_000 });
    });

    test("POST /api/admin/education/bulk grants to all userIds", async ({
        page,
    }) => {
        await login(page, "superadmin");

        const list = await browserFetch(page, "GET", "/api/admin/users");
        expect(list.ok).toBeTruthy();
        const users = (
            list.body as { users: Array<{ id: string; email: string }> }
        ).users;
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
        expect(
            grant.ok,
            `bulk grant failed: ${grant.status} ${JSON.stringify(grant.body)}`,
        ).toBeTruthy();
        expect(grant.status).toBe(200);
        const grantBody = grant.body as {
            success?: boolean;
            granted?: number;
        };
        expect(grantBody.success).toBe(true);
        expect(grantBody.granted).toBe(2);

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
        const users = (
            list.body as { users: Array<{ id: string; email: string }> }
        ).users;
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
        // Find Midsommarpub via the public events list.
        const evRes = await browserFetch(page, "GET", "/api/events");
        expect(evRes.ok).toBeTruthy();
        const evList = evRes.body as Array<{
            id: string;
            name: string;
        }>;
        const event = evList.find((e) => e.name === "Midsommarpub");
        expect(event).toBeDefined();
        if (!event) return;

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
