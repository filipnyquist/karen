// src/api/routes/exports.ts
//
// Admin-only exports. Mounted into adminRoutes via `.use()` so it inherits
// the `adminDerive` gate. Today: a plain-text scoreboard download for a
// specific semester, intended for the annual dinner invitation committee.
//
// Query params:
//   - semester: "fall" | "spring" (default "fall")
//   - year: 4-digit year (default current year)
//   - minPoints: only include users who worked at least this many events
//                (default 1, i.e. everyone with any points in the period).

import { sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { events, users, workerRegistrations } from "../../db/schema";
import { recordAdminAction } from "../../services/auditLog";
import {
    buildScoreboardText,
    type ScoreboardRow,
} from "../../services/scoreboardExport";
import { getSemesterForSemester, type Semester } from "../../services/scoring";
import { adminDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const exportRoutes = new Elysia({ prefix: "/exports" })
    .derive(adminDerive)
    .get(
        "/scoreboard",
        async ({ query, user: actor, set }) => {
            const semester = (query.semester ?? "fall") as Semester;
            if (semester !== "fall" && semester !== "spring") {
                throw new AppError(
                    "semester must be 'fall' or 'spring'",
                    400,
                    "INVALID_SEMESTER",
                );
            }
            const yearParam = query.year
                ? Number.parseInt(query.year, 10)
                : new Date().getFullYear();
            if (!Number.isFinite(yearParam) || yearParam < 2000) {
                throw new AppError(
                    "year must be a 4-digit number",
                    400,
                    "INVALID_YEAR",
                );
            }
            const minPointsParam = query.minPoints
                ? Number.parseInt(query.minPoints, 10)
                : 1;
            if (
                !Number.isFinite(minPointsParam) ||
                minPointsParam < 1 ||
                minPointsParam > 1000
            ) {
                throw new AppError(
                    "minPoints must be a positive integer",
                    400,
                    "INVALID_MIN_POINTS",
                );
            }

            const period = getSemesterForSemester(semester, yearParam);
            // Bind the boundary dates as ISO strings. Drizzle's raw `sql`
            // template doesn't type-infer column types the way `gte/lte`
            // do, so it ends up passing the Date object to the driver
            // directly, which rejects it.
            const startIso = period.start.toISOString();
            const endIso = period.end.toISOString();

            let rows = (await db
                .select({
                    userId: users.id,
                    name: users.name,
                    nickname: users.nickname,
                    email: users.email,
                    points: sql<number>`count(${workerRegistrations.id})::int`,
                })
                .from(users)
                .innerJoin(
                    workerRegistrations,
                    sql`${workerRegistrations.userId} = ${users.id}`,
                )
                .innerJoin(
                    events,
                    sql`${workerRegistrations.eventId} = ${events.id}
                        AND ${events.givesPoints} = true
                        AND ${events.locked} = true
                        AND ${events.endDate} <= now()`,
                )
                .where(
                    sql`${events.startDate} >= ${startIso}
                        AND ${events.startDate} <= ${endIso}`,
                )
                .groupBy(users.id, users.name, users.nickname, users.email)
                .orderBy(
                    sql`count(${workerRegistrations.id}) DESC`,
                )) as ScoreboardRow[];

            if (minPointsParam > 1) {
                rows = rows.filter((r) => r.points >= minPointsParam);
            }

            const body = buildScoreboardText(rows, period, minPointsParam);

            await recordAdminAction(actor.id, "scoreboard.export", null, {
                newValue: {
                    semester,
                    year: yearParam,
                    minPoints: minPointsParam,
                    rows: rows.length,
                },
            });

            // Set Content-Type + Content-Disposition explicitly. Elysia doesn't
            // auto-set Content-Type for string returns in this configuration,
            // so a plain `return body` produces a header-less response.
            const minPointsSuffix =
                minPointsParam > 1 ? `-min${minPointsParam}` : "";
            set.headers["content-type"] = "text/plain; charset=utf-8";
            set.headers["content-disposition"] =
                `attachment; filename="scoreboard-${semester}-${yearParam}${minPointsSuffix}.txt"`;
            return body;
        },
        {
            query: t.Object({
                semester: t.Optional(
                    t.Union([t.Literal("fall"), t.Literal("spring")]),
                ),
                year: t.Optional(t.String()),
                minPoints: t.Optional(t.String()),
            }),
        },
    );
