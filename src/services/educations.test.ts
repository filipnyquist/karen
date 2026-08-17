// src/services/educations.test.ts
//
// Pure-function tests for the education expiry helper. Behaviour
// parity with the prior inline math (`validityMonths * 30 * 24 * 60 *
// 60 * 1000`) is locked here so the refactor can't silently change
// expiry semantics.

import { describe, expect, test } from "bun:test";
import { computeEducationExpiry } from "./educations";

describe("computeEducationExpiry", () => {
    test("returns null when validityMonths is null", () => {
        expect(computeEducationExpiry(null, new Date("2026-01-01"))).toBeNull();
    });

    test("returns null when validityMonths is 0 (treated as no validity)", () => {
        expect(computeEducationExpiry(0, new Date("2026-01-01"))).toBeNull();
    });

    test("adds exactly 30 days for 1 month (30-day-month approximation)", () => {
        const completedAt = new Date("2026-01-01T00:00:00Z");
        const expectedMs = completedAt.getTime() + 30 * 24 * 60 * 60 * 1000;
        expect(computeEducationExpiry(1, completedAt)?.getTime()).toBe(
            expectedMs,
        );
    });

    test("adds 24 * 30 days for 24 months (the 'responsible' education default)", () => {
        const completedAt = new Date("2026-01-01T00:00:00Z");
        const result = computeEducationExpiry(24, completedAt);
        expect(result).not.toBeNull();
        const diffDays = result
            ? (result.getTime() - completedAt.getTime()) / (24 * 60 * 60 * 1000)
            : -1;
        expect(diffDays).toBe(24 * 30);
    });

    test("does not mutate the input completedAt", () => {
        const completedAt = new Date("2026-01-01T00:00:00Z");
        const originalMs = completedAt.getTime();
        computeEducationExpiry(12, completedAt);
        expect(completedAt.getTime()).toBe(originalMs);
    });
});
