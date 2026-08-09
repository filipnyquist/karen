// src/services/scoring.ts
// Only the date / semester-period helpers remain — the two dead
// scoreboard DB queries were removed in Phase 3.

export type Semester = "fall" | "spring";

export interface SemesterPeriod {
    semester: Semester;
    year: number;
    start: Date;
    end: Date;
}

/**
 * Get the semester period for a given date.
 * Fall semester: August 1 - January 31 (spans two calendar years).
 * Spring semester: January 1 - June 30.
 * July is part of the spring semester for simplicity (the academic
 * calendar treats July as a quiet month between spring and fall terms,
 * so spring is the closer fit). This means January 1 - 31 is the
 * *end* of the fall semester (year-spanning) AND the *start* of the
 * spring semester (same calendar year) — fall wins to avoid double-
 * counting the same window. Practically, this only affects how we
 * label the semester in UI; the scoreboard query groups by the
 * semester the *event start date* falls into.
 */
export function getSemesterForDate(date: Date): SemesterPeriod {
    const month = date.getMonth(); // 0-indexed
    const year = date.getFullYear();

    if (month >= 7) {
        // August (7) through December (11) -> Fall semester of this year
        return {
            semester: "fall",
            year,
            start: new Date(year, 7, 1), // Aug 1
            end: new Date(year + 1, 0, 31, 23, 59, 59, 999), // Jan 31 next year
        };
    } else if (month >= 1) {
        // February (1) through June (5) -> Spring semester
        return {
            semester: "spring",
            year,
            start: new Date(year, 0, 1), // Jan 1
            end: new Date(year, 5, 30, 23, 59, 59, 999), // Jun 30
        };
    } else {
        // January (0) belongs to the fall semester of the prior year,
        // which ends on Jan 31 of the current calendar year.
        return {
            semester: "fall",
            year: year - 1,
            start: new Date(year - 1, 7, 1),
            end: new Date(year, 0, 31, 23, 59, 59, 999),
        };
    }
}

/**
 * Calculate the current semester.
 */
export function getCurrentSemester(): SemesterPeriod {
    return getSemesterForDate(new Date());
}

/**
 * Build a SemesterPeriod from explicit semester/year. Exported so the
 * admin export endpoint (and tests) can resolve a {semester, year} pair
 * without round-tripping through a date.
 */
export function getSemesterForSemester(
    semester: Semester,
    year: number,
): SemesterPeriod {
    if (semester === "fall") {
        return {
            semester: "fall",
            year,
            start: new Date(year, 7, 1),
            end: new Date(year + 1, 0, 31, 23, 59, 59, 999),
        };
    } else {
        return {
            semester: "spring",
            year,
            start: new Date(year, 0, 1), // Jan 1 — was Feb 1
            end: new Date(year, 5, 30, 23, 59, 59, 999),
        };
    }
}
