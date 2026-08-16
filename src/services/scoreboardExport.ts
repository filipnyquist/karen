// src/services/scoreboardExport.ts
//
// Renders a semester scoreboard as a plain-text download for admins. The
// format is intentionally human-readable (not CSV) so the admin can paste
// it into an email or read it directly. Columns are space-padded to align.

import type { SemesterPeriod } from "./scoring";

export interface ScoreboardRow {
    userId: string;
    name: string | null;
    nickname: string | null;
    email: string;
    points: number;
}

/**
 * Render the scoreboard as a plain-text block. Returns a string the
 * caller can wrap in a Response with Content-Type: text/plain.
 *
 * `minPoints` (default 1) is reflected in the header so the file
 * self-describes the filter that produced it. Set `minPoints` to the
 * same value the caller passed to the SQL filter so the column count
 * matches the actual contents of the row list.
 */
export function buildScoreboardText(
    rows: ScoreboardRow[],
    period: SemesterPeriod,
    minPoints: number = 1,
    generatedAt: Date = new Date(),
): string {
    const title =
        period.semester === "fall"
            ? `Fall semester ${period.year}`
            : `Spring semester ${period.year}`;

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const generated = generatedAt.toISOString().replace("T", " ").slice(0, 19);

    const lines: string[] = [];
    lines.push(`Karen — ${title} scoreboard`);
    lines.push(`Period: ${fmt(period.start)} → ${fmt(period.end)}`);
    lines.push(`Generated: ${generated} UTC`);
    if (minPoints > 1) {
        lines.push(`Filter: only users with at least ${minPoints} events`);
    }
    lines.push("");

    if (rows.length === 0) {
        lines.push("(no workers with points in this semester)");
        lines.push("");
        lines.push("Total workers: 0");
        return `${lines.join("\n")}\n`;
    }

    // Display name: nickname when present, otherwise name, otherwise email.
    const displayName = (r: ScoreboardRow) =>
        r.nickname?.trim() || r.name?.trim() || "(no name)";

    // Column widths derived from the actual data so the table stays
    // tight even with short names.
    const nameWidth = Math.max(4, ...rows.map((r) => displayName(r).length));
    const emailWidth = Math.max(5, ...rows.map((r) => r.email.length));
    const rankWidth = Math.max(4, String(rows.length).length);

    lines.push(
        "Rank".padEnd(rankWidth) +
            "  " +
            "Name".padEnd(nameWidth) +
            "  " +
            "Email".padEnd(emailWidth) +
            "  " +
            "Points",
    );
    lines.push(
        "-".repeat(rankWidth) +
            "  " +
            "-".repeat(nameWidth) +
            "  " +
            "-".repeat(emailWidth) +
            "  " +
            "-".repeat(6),
    );

    rows.forEach((r, i) => {
        const rank = String(i + 1);
        lines.push(
            rank.padEnd(rankWidth) +
                "  " +
                displayName(r).padEnd(nameWidth) +
                "  " +
                r.email.padEnd(emailWidth) +
                "  " +
                String(r.points),
        );
    });

    lines.push("");
    lines.push(`Total workers: ${rows.length}`);
    return `${lines.join("\n")}\n`;
}
