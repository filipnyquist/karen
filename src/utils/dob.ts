// src/utils/dob.ts
//
// YYYY-MM-DD date-of-birth parser. Returns the input string if it
// matches the format AND represents a real calendar date; null
// otherwise. Validates that day is in range for the given month
// (e.g. rejects 2024-02-31) but does NOT enforce any upper or lower
// age bounds — the route layer can decide that.

const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDob(input: string): string | null {
    const match = DOB_RE.exec(input);
    if (!match) return null;

    const [, yearStr, monthStr, dayStr] = match;
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);
    const day = Number.parseInt(dayStr, 10);

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    // Date.UTC(year, monthIdx, day) rolls over to the next month on
    // overflow (e.g. Feb 31 → Mar 3), so checking that the resulting
    // date matches the input is the standard "is this a real date"
    // trick. Uses UTC to avoid local-DST off-by-ones.
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return input;
}
