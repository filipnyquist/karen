// src/lib/ssn.ts
//
// Parsing and normalization for the SSN fields on guests and users.
//
// Two things depend on getting this right:
//
//  1. Deduplication. `guest_ssn_hash` is an HMAC blind index and the
//     `guest_ssn_event_unique` index is what stops the same person being
//     signed in twice for one event. HMAC is exact-match, so
//     "900101-1234" and "19900101-1234" only collide if both are reduced
//     to the same canonical string *before* hashing.
//
//  2. Foreign guests. Not everyone has a personnummer, so anything that
//     fails the Swedish rules is kept verbatim as free text rather than
//     rejected — still normalized enough (whitespace, case) that obvious
//     re-entries of the same passport number collide.
//
// This module is isomorphic: no Node/Bun-only APIs, so the Preact island
// can import it for live input hints and the API can import it for the
// authoritative normalization.

export type SsnKind = "personnummer" | "freetext";

export interface ParsedSsn {
    /** Whether the input parsed as a valid Swedish personnummer. */
    kind: SsnKind;
    /**
     * The value to hash for uniqueness. Case-folded for free text, so
     * "AB123" and "ab123" are treated as the same person.
     */
    normalized: string;
    /**
     * The value to store and show. For a personnummer this is the
     * canonical `YYYYMMDD-XXXX`; for free text it is what the user typed
     * with surrounding and repeated whitespace tidied, casing preserved.
     */
    display: string;
}

/** Collapse runs of whitespace and trim. */
function tidy(input: string): string {
    return input.trim().replace(/\s+/g, " ");
}

/**
 * Luhn checksum over the 10-digit `YYMMDDNNNC` form, weighting 2,1,2,1…
 * from the left. Returns true when the trailing check digit is correct.
 */
function luhnValid(tenDigits: string): boolean {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        let digit = tenDigits.charCodeAt(i) - 48;
        if (i % 2 === 0) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
    }
    return sum % 10 === 0;
}

/**
 * Validate a calendar date, accepting samordningsnummer — coordination
 * numbers for people without a personnummer, which encode day + 60.
 */
function validDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12) return false;

    // Samordningsnummer: 61..91 maps back onto a real 1..31.
    const realDay = day > 60 ? day - 60 : day;
    if (realDay < 1) return false;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return realDay <= daysInMonth;
}

/**
 * Expand a two-digit year to four digits. A `-` separator means the
 * person is under 100, `+` means 100 or over — the only reason the two
 * separators exist.
 */
function expandYear(yy: number, separator: string): number {
    const currentYear = new Date().getFullYear();
    let year = Math.floor(currentYear / 100) * 100 + yy;
    if (year > currentYear) year -= 100;
    if (separator === "+") year -= 100;
    return year;
}

/**
 * Parse an SSN input into something safe to store, display and hash.
 * Never throws — unparseable input comes back as `kind: "freetext"`.
 */
export function parseSsn(input: string): ParsedSsn {
    const tidied = tidy(input);
    const freetext: ParsedSsn = {
        kind: "freetext",
        normalized: tidied.toUpperCase(),
        display: tidied,
    };

    if (tidied === "") return freetext;

    // Strip internal spaces so "900101 1234" is still recognised, but keep
    // the separator: it carries the century for the 10-digit form.
    const compact = tidied.replace(/\s+/g, "");

    let year: number;
    let month: number;
    let day: number;
    let last4: string;

    const twelve = /^(\d{4})(\d{2})(\d{2})[-+]?(\d{4})$/.exec(compact);
    const ten = /^(\d{2})(\d{2})(\d{2})([-+]?)(\d{4})$/.exec(compact);

    if (twelve) {
        year = Number(twelve[1]);
        month = Number(twelve[2]);
        day = Number(twelve[3]);
        last4 = twelve[4];
    } else if (ten) {
        year = expandYear(Number(ten[1]), ten[4]);
        month = Number(ten[2]);
        day = Number(ten[3]);
        last4 = ten[5];
    } else {
        return freetext;
    }

    if (!validDate(year, month, day)) return freetext;

    const pad = (n: number) => String(n).padStart(2, "0");
    const yy = pad(year % 100);
    const mm = pad(month);
    const dd = pad(day);

    if (!luhnValid(`${yy}${mm}${dd}${last4}`)) return freetext;

    const canonical = `${year}${mm}${dd}-${last4}`;
    return {
        kind: "personnummer",
        normalized: canonical,
        display: canonical,
    };
}

/** Convenience predicate for rendering decisions (monospace, hints). */
export function isPersonnummer(input: string): boolean {
    return parseSsn(input).kind === "personnummer";
}
