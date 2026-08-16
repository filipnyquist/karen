// src/services/teamScoring.ts

import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
    events,
    pubTeamMembers,
    pubTeams,
    users,
    workerRegistrations,
} from "../db/schema";
import {
    getCurrentSemester,
    type Semester,
    type SemesterPeriod,
} from "./scoring";

export interface TeamScoreEntry {
    id: string;
    name: string;
    description: string | null;
    teamColor: string | null;
    teamPic: string | null;
    memberCount: number;
    points: number;
}

const memberCountSubquery = sql<number>`(
    SELECT count(*)::int FROM pub_team_members
    WHERE pub_team_members.team_id = ${pubTeams.id}
)`;

const baseTeamSelect = {
    id: pubTeams.id,
    name: pubTeams.name,
    description: pubTeams.description,
    teamColor: pubTeams.teamColor,
    teamPic: pubTeams.teamPic,
    memberCount: memberCountSubquery,
    points: count(events.id),
};

function buildTeamQuery(dateFilter?: { start: Date; end: Date }) {
    // `locked` is a sign-up-close flag, not a "has happened" flag, so we
    // additionally require end_date <= now to keep future events from
    // inflating team points.
    const conditions = [
        eq(events.givesPoints, true),
        eq(events.locked, true),
        lte(events.endDate, new Date()),
    ];
    if (dateFilter) {
        conditions.push(gte(events.startDate, dateFilter.start));
        conditions.push(lte(events.startDate, dateFilter.end));
    }

    return db
        .select(baseTeamSelect)
        .from(pubTeams)
        .leftJoin(pubTeamMembers, eq(pubTeamMembers.teamId, pubTeams.id))
        .leftJoin(users, eq(users.id, pubTeamMembers.userId))
        .leftJoin(workerRegistrations, eq(workerRegistrations.userId, users.id))
        .leftJoin(
            events,
            and(eq(workerRegistrations.eventId, events.id), ...conditions),
        )
        .groupBy(
            pubTeams.id,
            pubTeams.name,
            pubTeams.description,
            pubTeams.teamColor,
            pubTeams.teamPic,
        )
        .orderBy(sql`count(${events.id}) DESC`);
}

export async function getTeamScoreboard(limit = 50): Promise<TeamScoreEntry[]> {
    return buildTeamQuery().limit(limit);
}

export async function getTeamPoints(teamId: string): Promise<number> {
    const [result] = await buildTeamQuery().having(eq(pubTeams.id, teamId));
    return result?.points ?? 0;
}

export async function getSemesterTeamScoreboard(
    semester?: Semester,
    year?: number,
): Promise<{ semester: SemesterPeriod; entries: TeamScoreEntry[] }> {
    const period =
        semester && year
            ? getSemesterForSemester(semester, year)
            : getCurrentSemester();

    const entries = await buildTeamQuery(period);
    return { semester: period, entries };
}

function getSemesterForSemester(
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
    }
    return {
        semester: "spring",
        year,
        start: new Date(year, 0, 1), // Jan 1 — was Feb 1
        end: new Date(year, 5, 30, 23, 59, 59, 999),
    };
}
