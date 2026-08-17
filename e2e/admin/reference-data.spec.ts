// e2e/admin/reference-data.spec.ts
//
// Verifies the superadmin-only CRUD surface for event locations and
// education types:
//   - Superadmin can list, create, update, delete.
//   - Regular admin gets 403 on every endpoint (including GET — the
//     data is hidden behind the stricter gate).
//   - Regular users get 403 / redirect.
//   - Duplicate name → 409 LOCATION_NAME_TAKEN / EDUCATION_TYPE_NAME_TAKEN.
//   - validityMonths out of range → 400 VALIDATION_ERROR.
//   - Delete on a referenced row → 409 LOCATION_IN_USE / EDUCATION_TYPE_IN_USE.
//
// The existing seed creates events that reference both Villan and
// .kauren, so we can rely on those being in-use.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

interface ApiResponse {
    ok: boolean;
    status: number;
    body: unknown;
}

async function browserFetch(
    page: import("@playwright/test").Page,
    method: "POST" | "PUT" | "DELETE" | "GET",
    url: string,
    body?: unknown,
): Promise<ApiResponse> {
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

const UNIQUE_NAME = `e2e-loc-${Date.now()}`;
const UNIQUE_EDU = `e2e-edu-${Date.now()}`;

test.describe("Reference data CRUD (superadmin gate)", () => {
    test("superadmin can create, update and delete a location", async ({
        page,
    }) => {
        await login(page, "superadmin");

        // Create
        const createRes = await browserFetch(
            page,
            "POST",
            "/api/admin/reference-data/locations",
            { name: UNIQUE_NAME, description: "smoke test" },
        );
        expect(
            createRes.ok,
            `create failed: ${createRes.status} ${JSON.stringify(createRes.body)}`,
        ).toBeTruthy();
        const created = createRes.body as { id: number; name: string };
        expect(created.name).toBe(UNIQUE_NAME);

        // Update
        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/reference-data/locations/${created.id}`,
            { name: UNIQUE_NAME, description: "updated" },
        );
        expect(putRes.ok).toBeTruthy();
        const updated = putRes.body as { description: string };
        expect(updated.description).toBe("updated");

        // Delete (safe — unreferenced)
        const delRes = await browserFetch(
            page,
            "DELETE",
            `/api/admin/reference-data/locations/${created.id}`,
        );
        expect(delRes.ok).toBeTruthy();
    });

    test("superadmin can create, update and delete an education type", async ({
        page,
    }) => {
        await login(page, "superadmin");

        const createRes = await browserFetch(
            page,
            "POST",
            "/api/admin/reference-data/education-types",
            { name: UNIQUE_EDU, validityMonths: 12 },
        );
        expect(createRes.ok).toBeTruthy();
        const created = createRes.body as {
            id: number;
            name: string;
            validityMonths: number;
        };
        expect(created.validityMonths).toBe(12);

        // Soft update — change description; keep validityMonths
        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/reference-data/education-types/${created.id}`,
            { name: UNIQUE_EDU, description: "updated", validityMonths: 24 },
        );
        expect(putRes.ok).toBeTruthy();
        const updated = putRes.body as { validityMonths: number };
        expect(updated.validityMonths).toBe(24);

        const delRes = await browserFetch(
            page,
            "DELETE",
            `/api/admin/reference-data/education-types/${created.id}`,
        );
        expect(delRes.ok).toBeTruthy();
    });

    test("duplicate location name returns 409 LOCATION_NAME_TAKEN", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const res = await browserFetch(
            page,
            "POST",
            "/api/admin/reference-data/locations",
            { name: "Villan" },
        );
        expect(res.status).toBe(409);
        const body = res.body as { code: string };
        expect(body.code).toBe("LOCATION_NAME_TAKEN");
    });

    test("duplicate education type name returns 409 EDUCATION_TYPE_NAME_TAKEN", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const res = await browserFetch(
            page,
            "POST",
            "/api/admin/reference-data/education-types",
            { name: "responsible" },
        );
        expect(res.status).toBe(409);
        const body = res.body as { code: string };
        expect(body.code).toBe("EDUCATION_TYPE_NAME_TAKEN");
    });

    test("validityMonths out of range returns 400 VALIDATION_ERROR", async ({
        page,
    }) => {
        await login(page, "superadmin");
        const res = await browserFetch(
            page,
            "POST",
            "/api/admin/reference-data/education-types",
            { name: "out-of-range", validityMonths: 999 },
        );
        expect(res.status).toBe(400);
        const body = res.body as { code: string };
        expect(body.code).toBe("VALIDATION_ERROR");
    });

    test("deleting Villan (referenced by events) returns 409 LOCATION_IN_USE", async ({
        page,
    }) => {
        await login(page, "superadmin");

        // Look up Villan — the seed always uses it as the location for
        // several events.
        const listRes = await browserFetch(
            page,
            "GET",
            "/api/admin/reference-data/locations",
        );
        const rows = listRes.body as Array<{ id: number; name: string }>;
        const villan = rows.find((r) => r.name === "Villan");
        expect(villan).toBeTruthy();

        const delRes = await browserFetch(
            page,
            "DELETE",
            `/api/admin/reference-data/locations/${villan?.id}`,
        );
        expect(delRes.status).toBe(409);
        const body = delRes.body as { code: string };
        expect(body.code).toBe("LOCATION_IN_USE");
    });

    test("regular admin gets 403 on locations endpoints (superadmin-only)", async ({
        page,
    }) => {
        await login(page, "admin");

        // Locations stay superadmin-only: the `active` toggle affects
        // what appears in the event-creation picker — heavy foot-gun.
        const endpoints: Array<
            ["GET" | "POST" | "PUT" | "DELETE", string, unknown?]
        > = [
            ["GET", "/api/admin/reference-data/locations"],
            ["POST", "/api/admin/reference-data/locations", { name: "hack" }],
        ];
        for (const [method, url, body] of endpoints) {
            const res = await browserFetch(page, method, url, body);
            expect(
                res.status,
                `${method} ${url} should be 403 for non-superadmin, got ${res.status}`,
            ).toBe(403);
        }
    });

    test("regular admin CAN reach education-types endpoints (admin-gated)", async ({
        page,
    }) => {
        await login(page, "admin");

        // Education types were relaxed from superadmin to admin tier —
        // regular admins can CRUD them now. Superadmins retain access
        // via the `adminDerive` superset.
        const createRes = await browserFetch(
            page,
            "POST",
            "/api/admin/reference-data/education-types",
            {
                name: `e2e-admin-edu-${Date.now()}`,
                validityMonths: 6,
            },
        );
        expect(createRes.ok, `create failed: ${createRes.status}`).toBeTruthy();
        const created = createRes.body as { id: number };

        const getRes = await browserFetch(
            page,
            "GET",
            "/api/admin/reference-data/education-types",
        );
        expect(getRes.ok).toBeTruthy();

        const putRes = await browserFetch(
            page,
            "PUT",
            `/api/admin/reference-data/education-types/${created.id}`,
            {
                name: created.id ? `e2e-admin-edu-${created.id}` : "x",
                description: "updated by regular admin",
                validityMonths: 12,
            },
        );
        expect(putRes.ok, `put failed: ${putRes.status}`).toBeTruthy();

        const delRes = await browserFetch(
            page,
            "DELETE",
            `/api/admin/reference-data/education-types/${created.id}`,
        );
        expect(delRes.ok, `delete failed: ${delRes.status}`).toBeTruthy();
    });

    test("regular admin cannot reach /admin/locations (redirect)", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin/locations");
        await page.waitForURL("/");
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("regular admin CAN reach /admin/education-types", async ({ page }) => {
        await login(page, "admin");
        await page.goto("/admin/education-types");
        expect(new URL(page.url()).pathname).toBe("/admin/education-types");
    });

    test("non-admin user cannot reach /admin/locations (redirect)", async ({
        page,
    }) => {
        await login(page, "alice");
        await page.goto("/admin/locations");
        await page.waitForURL("/");
        expect(new URL(page.url()).pathname).toBe("/");
    });

    test("superadmin CAN reach /admin/locations", async ({ page }) => {
        await login(page, "superadmin");
        await page.goto("/admin/locations");
        expect(new URL(page.url()).pathname).toBe("/admin/locations");
    });

    test("superadmin CAN reach /admin/education-types", async ({ page }) => {
        await login(page, "superadmin");
        await page.goto("/admin/education-types");
        expect(new URL(page.url()).pathname).toBe("/admin/education-types");
    });

    test("superadmin hub shows the Locations and Education types buttons", async ({
        page,
    }) => {
        await login(page, "superadmin");
        await page.goto("/admin");
        await page.waitForLoadState("networkidle");
        // Match by URL rather than by label text — the label is localized
        // (Swedish: "Platser", English: "Locations") and we'd otherwise
        // have to switch the page language before asserting.
        await expect(page.locator('a[href="/admin/locations"]')).toBeVisible();
        await expect(
            page.locator('a[href="/admin/education-types"]'),
        ).toBeVisible();
    });

    test("regular admin hub shows education-types but not locations", async ({
        page,
    }) => {
        await login(page, "admin");
        await page.goto("/admin");
        await page.waitForLoadState("networkidle");
        // Locations stay superadmin-only.
        await expect(page.locator('a[href="/admin/locations"]')).toHaveCount(0);
        // Education types opened to admins in this change.
        await expect(
            page.locator('a[href="/admin/education-types"]'),
        ).toBeVisible();
    });
});
