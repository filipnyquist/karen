// e2e/authenticated/hide-migrate-button.spec.ts
//
// Verifies that the Migrate nav link disappears once the signed-in
// user has at least one completed legacy migration. Renders once for
// desktop (sm:+) and once for mobile (<sm); both breakpoints must
// respect the gate, otherwise the button leaks on one viewport.
//
// Seed prerequisite: migrant@karen.se has a seeded legacy_mappings
// row with realUserId = migrantUser.id AND migratedAt NOT NULL
// (see src/db/seed-test.ts). newbie@karen.se has no such row.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

async function migrateLinkVisibility(page: import("@playwright/test").Page) {
    // Both desktop and mobile nav blocks render the Migrate link with
    // the same text "Migrera" / "Migrate". Look at the page-wide
    // count so the assertion catches both desktop+mobile leakage
    // (mobile menu is hidden by default but still in the DOM).
    return await page
        .locator('a[href="/migrate"]')
        .evaluateAll(
            (els) =>
                els.filter((el) => (el as HTMLElement).offsetParent !== null)
                    .length,
        );
}

test.describe("Hide Migrate button", () => {
    test("user with no completed migration sees the Migrate link", async ({
        page,
    }) => {
        await login(page, "newbie");
        // Land on any page that renders BaseLayout (the nav bar).
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        const visible = await migrateLinkVisibility(page);
        expect(visible).toBeGreaterThan(0);
    });

    test("user with a completed migration does NOT see the Migrate link", async ({
        page,
    }) => {
        await login(page, "migrant");
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        const visible = await migrateLinkVisibility(page);
        expect(visible).toBe(0);
    });
});
