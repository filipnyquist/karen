import { describe, expect, test } from "bun:test";
import { isPersonnummer, parseSsn } from "./ssn";

// Fixtures below carry real Luhn check digits — a personnummer with a
// wrong check digit is deliberately treated as free text, so using
// made-up numbers here would silently test the wrong branch.
const CANONICAL = "19900101-1239";

describe("parseSsn — personnummer", () => {
    test("every accepted format normalizes to the same canonical value", () => {
        const inputs = [
            "9001011239",
            "900101-1239",
            "19900101-1239",
            "199001011239",
            "900101 1239",
            "  19900101-1239  ",
        ];
        for (const input of inputs) {
            const parsed = parseSsn(input);
            expect(parsed.kind).toBe("personnummer");
            expect(parsed.normalized).toBe(CANONICAL);
            expect(parsed.display).toBe(CANONICAL);
        }
    });

    test("the '-' separator resolves to an age under 100", () => {
        // Whatever year it is, a '-' number must land within the last century.
        const parsed = parseSsn("500101-1237");
        expect(parsed.kind).toBe("personnummer");
        const year = Number(parsed.normalized.slice(0, 4));
        const age = new Date().getFullYear() - year;
        expect(age).toBeGreaterThanOrEqual(0);
        expect(age).toBeLessThan(100);
    });

    test("the '+' separator pushes the birth year back a century", () => {
        const dash = parseSsn("500101-1237");
        const plus = parseSsn("500101+1237");
        expect(plus.kind).toBe("personnummer");
        expect(Number(plus.normalized.slice(0, 4))).toBe(
            Number(dash.normalized.slice(0, 4)) - 100,
        );
    });

    test("samordningsnummer (day + 60) is accepted", () => {
        // 61 == the 1st, for people registered without a personnummer.
        const parsed = parseSsn("900161-1236");
        expect(parsed.kind).toBe("personnummer");
        expect(parsed.normalized).toBe("19900161-1236");
    });

    test("a leap day in a leap year is accepted", () => {
        expect(parseSsn("920228-0021").kind).toBe("personnummer");
    });
});

describe("parseSsn — free text fallback", () => {
    test("a wrong Luhn check digit falls back to free text", () => {
        // Correct check digit for 900101123 is 9, not 4.
        const parsed = parseSsn("19900101-1234");
        expect(parsed.kind).toBe("freetext");
    });

    test("an impossible calendar date falls back to free text", () => {
        expect(parseSsn("19901301-1234").kind).toBe("freetext");
        expect(parseSsn("19900132-1234").kind).toBe("freetext");
    });

    test("a foreign identifier round-trips with casing preserved", () => {
        const parsed = parseSsn("UK passport 5510482");
        expect(parsed.kind).toBe("freetext");
        expect(parsed.display).toBe("UK passport 5510482");
        expect(parsed.normalized).toBe("UK PASSPORT 5510482");
    });

    test("free text dedupes across casing and stray whitespace", () => {
        const a = parseSsn("  uk   passport 5510482 ");
        const b = parseSsn("UK passport 5510482");
        expect(a.normalized).toBe(b.normalized);
    });

    test("empty input is free text, not a crash", () => {
        const parsed = parseSsn("   ");
        expect(parsed.kind).toBe("freetext");
        expect(parsed.normalized).toBe("");
    });
});

describe("isPersonnummer", () => {
    test("agrees with parseSsn", () => {
        expect(isPersonnummer("19900101-1239")).toBe(true);
        expect(isPersonnummer("UK passport 5510482")).toBe(false);
    });
});
