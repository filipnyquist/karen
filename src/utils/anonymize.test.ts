// src/utils/anonymize.test.ts
//
// Pins the contract of `anonymizeName`: the only function protecting
// non-authenticated viewers from seeing full real names in API
// responses and SSR'd HTML. Any change here is a privacy regression.

import { describe, expect, test } from "bun:test";
import { anonymizeName } from "./anonymize";

describe("anonymizeName", () => {
    test("returns the name unchanged when the viewer is authenticated", () => {
        expect(anonymizeName("Alice Andersson", true)).toBe("Alice Andersson");
    });

    test("truncates to first 3 characters + ellipsis for non-authed viewers", () => {
        expect(anonymizeName("Alice Andersson", false)).toBe("Ali...");
    });

    test("returns short names as-is without an ellipsis", () => {
        // 2 chars — under the threshold, no ellipsis.
        expect(anonymizeName("Al", false)).toBe("Al");
        // 3 chars — at the threshold, no ellipsis.
        expect(anonymizeName("Ali", false)).toBe("Ali");
    });

    test("passes null and undefined through", () => {
        expect(anonymizeName(null, false)).toBeNull();
        expect(anonymizeName(null, true)).toBeNull();
        expect(anonymizeName(undefined, false)).toBeUndefined();
        expect(anonymizeName(undefined, true)).toBeUndefined();
    });

    test("treats empty string the same as null", () => {
        // The function returns the input untouched for falsy values,
        // so empty strings round-trip.
        expect(anonymizeName("", false)).toBe("");
    });
});
