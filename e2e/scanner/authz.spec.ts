// src/e2e/scanner/authz.spec.ts
//
// Verifies the server-side authorization gate on /scanner/[eventId]:
// anonymous users get redirected to /login, logged-in users without
// scanner permission get redirected to /scanner.

import { expect, test } from "@playwright/test";
import { findEventId, login } from "../helpers/auth";

test.describe("Scanner page authz", () => {
    test("anonymous user is redirected to /login", async ({ page }) => {
        // Find any event — Midsommarpub is always present.
        await login(page, "alice");
        const eventId = await findEventId(page, "Midsommarpub");
        expect(eventId).toBeTruthy();

        // Clear cookies to become anonymous.
        await page.context().clearCookies();

        await page.goto(`/scanner/${eventId}`);
        await page.waitForURL(/\/login/);
    });

    test("logged-in non-worker is redirected to /scanner", async ({ page }) => {
        // Login as alice. She's a worker at pub4 (Midsommarpub), but
        // isn't a worker/responsible for pub1/past events. Hit one of
        // those and verify she gets bounced to the landing page.
        await login(page, "alice");
        await page.waitForURL("/");

        // Find a past event alice is NOT registered at.
        // pub1 has alice as responsible. pub2 has erik as responsible
        // (alice is just a worker? checking the seed). pub6 has bob +
        // hanna, no alice. Use pub6 — alice has no registration there.
        const eventsRes = await page.request.get("/api/events");
        const allEvents = (await eventsRes.json()) as Array<{
            id: string;
            name: string;
        }>;
        const avlystPub = allEvents.find((e) => e.name === "Avlyst Pub");
        expect(avlystPub, "Avlyst Pub must be seeded").toBeTruthy();

        await page.goto(`/scanner/${avlystPub?.id}`);
        // The server-side authz redirects unauthorized users to /scanner.
        await page.waitForURL(/\/scanner$/);
    });
});
