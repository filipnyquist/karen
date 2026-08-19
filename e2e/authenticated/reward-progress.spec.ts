// e2e/authenticated/reward-progress.spec.ts
//
// Verifies the Semester Rewards progress block on the profile page:
//   - Renders only on the *own* profile (isOwnProfile gate).
//   - Each of the three rewards (Lilla sittningen, Stora sittningen,
//     Battlepass) renders a labeled row.
//
// Threshold-fulfillment is unit-territory (the fillClassFor /
// unlocked logic in RewardProgress.astro) — these e2e checks
// guard the visibility & non-visibility invariants that would
// silently break if a future edit leaks the block onto the public
// profile or drops one of the rows.

import { expect, test } from "@playwright/test";
import { login } from "../helpers/auth";

test.describe("Reward progress bar", () => {
    test("own profile renders the three reward rows", async ({ page }) => {
        await login(page, "alice");
        // Alicia is alice's nickname — link is in the navbar.
        await page.locator("nav").getByRole("link", { name: "Alicia" }).click();
        await expect(page).toHaveURL(/\/profile\//);

        const rewardsHeading = page.getByRole("heading", {
            name: /Terminsbelöningar/i,
        });
        await expect(rewardsHeading).toBeVisible();

        await expect(
            page.getByRole("heading", { name: "Terminsbelöningar" }),
        ).toBeVisible();

        // All three reward labels must render, regardless of whether
        // the user's current points meet a threshold.
        await expect(page.getByText("Lilla sittningen").first()).toBeVisible();
        await expect(page.getByText("Stora sittningen").first()).toBeVisible();
        await expect(page.getByText("Battlepass").first()).toBeVisible();
    });

    test("another user's profile does NOT render the rewards block", async ({
        page,
    }) => {
        await login(page, "alice");
        // Navigate to bob's profile via the event workers list — bob
        // works at pub1 alongside alice.
        await page.goto("/event/list");
        await page.waitForLoadState("networkidle");
        // Pick the first event card whose name we know exists and
        // includes bob in the worker table.
        await page.goto("/event/list");
        const eventsRes = await page.request.get("/api/events");
        const events = (await eventsRes.json()) as Array<{
            id: string;
            name: string;
        }>;
        const spring = events.find((e) => e.name === "Vårpub 2026");
        if (!spring) test.skip(true, "Spring pub seed missing");
        await page.goto(`/event/${spring.id}`);
        await page.getByRole("link", { name: "Bobby" }).first().click();
        await expect(page).toHaveURL(/\/profile\//);

        // The rewards heading must NOT appear on someone else's profile.
        await expect(
            page.getByRole("heading", { name: "Terminsbelöningar" }),
        ).toHaveCount(0);
    });
});
