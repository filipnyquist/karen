import { describe, expect, test } from "bun:test";
import { parseDob } from "./dob";

describe("parseDob", () => {
    test("accepts a valid YYYY-MM-DD date", () => {
        expect(parseDob("2000-01-01")).toBe("2000-01-01");
        expect(parseDob("1999-12-31")).toBe("1999-12-31");
    });

    test("accepts leap-day in a leap year", () => {
        expect(parseDob("2024-02-29")).toBe("2024-02-29");
    });

    test("rejects a non-leap-year Feb 29", () => {
        expect(parseDob("2023-02-29")).toBeNull();
    });

    test("rejects Feb 30 / Feb 31", () => {
        expect(parseDob("2024-02-30")).toBeNull();
        expect(parseDob("2024-02-31")).toBeNull();
    });

    test("rejects month 00 and month 13", () => {
        expect(parseDob("2000-00-15")).toBeNull();
        expect(parseDob("2000-13-01")).toBeNull();
    });

    test("rejects day 00 and day 32", () => {
        expect(parseDob("2000-01-00")).toBeNull();
        expect(parseDob("2000-01-32")).toBeNull();
    });

    test("rejects April 31 (April has 30 days)", () => {
        expect(parseDob("2000-04-31")).toBeNull();
    });

    test("rejects wrong separator", () => {
        expect(parseDob("2000/01/01")).toBeNull();
        expect(parseDob("2000.01.01")).toBeNull();
        expect(parseDob("20000101")).toBeNull();
    });

    test("rejects non-numeric components", () => {
        expect(parseDob("abcd-ef-gh")).toBeNull();
    });

    test("rejects empty / whitespace", () => {
        expect(parseDob("")).toBeNull();
        expect(parseDob(" ")).toBeNull();
    });
});
