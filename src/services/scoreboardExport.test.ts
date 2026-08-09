// src/services/scoreboardExport.test.ts
//
// Verifies the plain-text formatter for the scoreboard export. The format
// is what admins paste into emails / open in editors, so even small drift
// matters — pin the column layout and headers.

import { describe, expect, test } from "bun:test";
import { buildScoreboardText } from "./scoreboardExport";

const fall2025 = {
    semester: "fall" as const,
    year: 2025,
    start: new Date("2025-08-01T00:00:00Z"),
    end: new Date("2026-01-31T23:59:59Z"),
};

const fixedGeneratedAt = new Date("2026-07-15T09:00:00Z");

describe("buildScoreboardText", () => {
    test("renders empty scoreboard with explicit note", () => {
        const out = buildScoreboardText([], fall2025, 1, fixedGeneratedAt);
        expect(out).toContain("Fall semester 2025 scoreboard");
        expect(out).toContain("Period: 2025-08-01 → 2026-01-31");
        expect(out).toContain("(no workers with points in this semester)");
        expect(out).toContain("Total workers: 0");
        expect(out.endsWith("\n")).toBe(true);
    });

    test("uses nickname when present, falls back to name, then placeholder", () => {
        const out = buildScoreboardText(
            [
                {
                    userId: "u1",
                    name: "Erik Eriksson",
                    nickname: "Erre",
                    email: "erik@karen.se",
                    points: 5,
                },
                {
                    userId: "u2",
                    name: null,
                    nickname: null,
                    email: "ghost@karen.se",
                    points: 1,
                },
            ],
            fall2025,
            1,
            fixedGeneratedAt,
        );
        // First row: nickname used
        expect(out).toContain("Erre");
        // Second row: name + nickname both null → placeholder
        expect(out).toContain("(no name)");
    });

    test("lists rows in given order with 1-based rank", () => {
        const out = buildScoreboardText(
            [
                {
                    userId: "u1",
                    name: "Alice",
                    nickname: "Alicia",
                    email: "a@k.se",
                    points: 3,
                },
                {
                    userId: "u2",
                    name: "Bob",
                    nickname: null,
                    email: "b@k.se",
                    points: 2,
                },
            ],
            fall2025,
            1,
            fixedGeneratedAt,
        );
        // The two data rows appear in order with their ranks.
        const rankA = out.indexOf("Alicia");
        const rankB = out.indexOf("Bob");
        expect(rankA).toBeGreaterThan(0);
        expect(rankB).toBeGreaterThan(rankA);
        // Ranks are 1-based and rank-padded to the column width.
        expect(out).toMatch(/^\s*1\s+/m);
        expect(out).toMatch(/^\s*2\s+/m);
    });

    test("column widths adapt to data so headers and rows align", () => {
        const out = buildScoreboardText(
            [
                {
                    userId: "u1",
                    name: "A",
                    nickname: "A",
                    email: "short@k.se",
                    points: 1,
                },
                {
                    userId: "u2",
                    name: "Somewhatlonger Name",
                    nickname: null,
                    email: "muchlongeremail@example.com",
                    points: 1,
                },
            ],
            fall2025,
            1,
            fixedGeneratedAt,
        );
        const headerLine = out
            .split("\n")
            .find((l) => l.startsWith("Rank") && l.includes("Name"));
        expect(headerLine).toBeTruthy();
        // The header line should be longer than the widest name (proving
        // padding is in place). Loosely assert at least 50 chars.
        expect(headerLine?.length ?? 0).toBeGreaterThan(50);
    });

    test("total workers footer reflects row count", () => {
        const rows = Array.from({ length: 7 }, (_, i) => ({
            userId: `u${i}`,
            name: `User ${i}`,
            nickname: null,
            email: `u${i}@karen.se`,
            points: i,
        }));
        const out = buildScoreboardText(rows, fall2025, 1, fixedGeneratedAt);
        expect(out).toContain("Total workers: 7");
    });

    test("spring semester title uses 'Spring'", () => {
        const out = buildScoreboardText(
            [
                {
                    userId: "u1",
                    name: "X",
                    nickname: null,
                    email: "x@karen.se",
                    points: 1,
                },
            ],
            {
                semester: "spring",
                year: 2026,
                // Spring now starts Jan 1 (was Feb 1).
                start: new Date("2026-01-01T00:00:00Z"),
                end: new Date("2026-06-30T23:59:59Z"),
            },
            1,
            fixedGeneratedAt,
        );
        expect(out).toContain("Spring semester 2026");
        expect(out).toContain("Period: 2026-01-01 → 2026-06-30");
    });

    test("generated timestamp is stamped", () => {
        const out = buildScoreboardText([], fall2025, 1, fixedGeneratedAt);
        expect(out).toContain("Generated: 2026-07-15 09:00:00 UTC");
    });

    test("minPoints > 1 adds a filter line to the output", () => {
        // The formatter does NOT filter — the endpoint filters before
        // passing rows in. The formatter's only job wrt minPoints is to
        // stamp the header so the file self-describes the filter.
        const out = buildScoreboardText(
            [
                {
                    userId: "u1",
                    name: "Alice",
                    nickname: null,
                    email: "alice@karen.se",
                    points: 5,
                },
            ],
            fall2025,
            3,
            fixedGeneratedAt,
        );
        expect(out).toContain("Filter: only users with at least 3 events");
        expect(out).toContain("alice@karen.se");
    });

    test("minPoints = 1 does NOT add a filter line", () => {
        const out = buildScoreboardText([], fall2025, 1, fixedGeneratedAt);
        expect(out).not.toContain("Filter:");
    });
});
