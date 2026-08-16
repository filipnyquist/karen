// src/db/import-legacy.ts
// Import data from old pykaren (Django/MySQL) database into karen.
//
// Usage:
//   LEGACY_DATABASE_URL="mysql://user:pass@host:3306/karen" \
//   DATABASE_URL="postgresql://karen:karen@db:5432/karen" \
//   bun src/db/import-legacy.ts
//
// Reads from LEGACY_DATABASE_URL (old MySQL DB), writes to DATABASE_URL (new karen PostgreSQL).

import { eq } from "drizzle-orm";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { generateJoinCode } from "../utils/joinCode";
import { db } from "./index";
import {
    comments,
    educationTypes,
    eventStates,
    events,
    guestRegistrations,
    legacyMappings,
    locations,
    pubTeamMembers,
    pubTeams,
    reports,
    tickets,
    userEducations,
    users,
    workerRegistrations,
} from "./schema";

const legacyUrl = process.env.LEGACY_DATABASE_URL;
/**
 * Pure dedup used by the tickets-import loop. Exported for unit testing
 * (and stable enough that we can reuse it if the dump's shape ever
 * changes again). Pure: just maps (userId, eventId) to a single row
 * with the pick rules documented at the call site.
 *
 * Rules:
 *   - At most one row per (userId, eventId).
 *   - Active rows beat inactive rows.
 *   - On tie (both active or both inactive), higher ticketId wins.
 *   - Rows whose userId or eventId doesn't resolve are returned in
 *     `skipped` so the caller can log them.
 */
export function dedupeTickets<
    T extends {
        ticket_key: string;
        is_active: unknown;
        user_id: string | number;
        event_id: string | number;
        ticket_id: string | number;
    },
>(
    oldTickets: T[],
    oldToNewEventId: ReadonlyMap<unknown, string>,
    authUserToPlaceholderId: ReadonlyMap<unknown, string>,
): {
    winners: Array<{
        userId: string;
        eventId: string;
        token: string;
        isActive: boolean;
        ticketId: number;
    }>;
    skipped: number;
} {
    type Winner = {
        userId: string;
        eventId: string;
        token: string;
        isActive: boolean;
        ticketId: number;
    };
    const winnersByKey = new Map<string, Winner>();
    let skipped = 0;
    for (const t of oldTickets) {
        const newEventId = oldToNewEventId.get(t.event_id);
        const placeholderId = authUserToPlaceholderId.get(t.user_id);
        if (!newEventId || !placeholderId) {
            skipped++;
            continue;
        }
        const isActive = Boolean(t.is_active);
        const ticketId = Number(t.ticket_id);
        const key = `${placeholderId} ${newEventId}`;
        const existing = winnersByKey.get(key);
        const candidateShouldWin =
            !existing ||
            // Prefer an active row over an inactive one.
            (isActive && !existing.isActive) ||
            // On tie (both active or both inactive), prefer higher ticket_id.
            (isActive === existing.isActive && ticketId > existing.ticketId);
        if (candidateShouldWin) {
            winnersByKey.set(key, {
                userId: placeholderId,
                eventId: newEventId,
                token: t.ticket_key,
                isActive,
                ticketId,
            });
        }
    }
    return {
        winners: [...winnersByKey.values()],
        skipped,
    };
}

async function main() {
    if (!legacyUrl) {
        console.error("LEGACY_DATABASE_URL env var is required");
        process.exit(1);
    }
    const legacyConn = await mysql.createConnection({
        uri: legacyUrl,
        // Tell mysql2 to interpret DATETIME columns as Europe/Stockholm
        // wall-clock time instead of the Node process's local timezone.
        // Without this, the importer reads "10:00" as 10:00 UTC (because
        // mysql2's default `timezone: "local"` is whatever the container
        // says) and we display it as 12:00 CEST — two hours ahead of what
        // the user entered into the legacy DB. Pinning to Europe/Stockholm
        // is safe even when the host TZ is already set: the explicit
        // value wins over the env-derived local fallback.
        timezone: "Europe/Stockholm",
    });
    console.log("=== Legacy Data Import (MySQL → PostgreSQL) ===\n");

    // Helpers for cleaning up imported names
    function extractNickname(raw: string | null): string | null {
        if (!raw) return null;
        const match = raw.match(
            /["\u201D\u201C]([^"\u201D\u201C]+)["\u201D\u201C]/,
        );
        return match ? match[1] : raw;
    }

    function titleCase(str: string): string {
        return str
            .toLowerCase()
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    }

    // ─── 1. Import Locations ───
    console.log("Importing locations...");
    const [oldLocations] = await legacyConn.execute<RowDataPacket[]>(
        "SELECT id, name, description FROM karen_location",
    );
    let locationsImported = 0;
    for (const loc of oldLocations) {
        const existing = await db
            .select()
            .from(locations)
            .where(eq(locations.name, loc.name))
            .limit(1);
        if (existing.length === 0) {
            await db.insert(locations).values({
                name: loc.name,
                description: loc.description || null,
            });
            locationsImported++;
        }
    }
    console.log(
        `  ${locationsImported} new locations imported (skipped ${oldLocations.length - locationsImported} duplicates)`,
    );

    // Build a mapping: old location id → new location id
    const allLocations = await db.select().from(locations);
    const [oldLocationRows] = await legacyConn.execute<RowDataPacket[]>(
        "SELECT id, name FROM karen_location",
    );
    const locationMap = new Map<number, number>();
    for (const oldLoc of oldLocationRows) {
        const newLoc = allLocations.find((l) => l.name === oldLoc.name);
        if (newLoc) locationMap.set(oldLoc.id, newLoc.id);
    }

    // ─── 2. Import Placeholder Users ───
    // IMPORTANT: All person references in the old DB (worker_id, commenter_id,
    // person_id) are FKs to karen_person.id, NOT auth_user.id. So we iterate
    // over karen_person and key our mapping by karen_person.id.
    console.log("Importing placeholder users...");
    const [oldUsers] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT
      kp.id AS person_id, kp.nickname, kp.name AS person_name,
      au.id AS auth_user_id, au.email, au.first_name, au.last_name,
      kp.has_aas, kp.has_pub, kp.responsibility_education_date
    FROM karen_person kp
    LEFT JOIN auth_user au ON au.id = kp.account_id
    ORDER BY kp.id
  `);

    // Track legacy education data per person for later import
    const oldPersonEducations = new Map<
        number,
        {
            hasPub: boolean;
            hasAas: boolean;
            respDate: Date | null;
        }
    >();

    let usersImported = 0;
    const oldToPlaceholderId = new Map<number, string>();

    for (const oldUser of oldUsers) {
        const personId = oldUser.person_id;
        const oldEmail = oldUser.email || "";

        oldPersonEducations.set(personId, {
            hasPub: Boolean(oldUser.has_pub),
            hasAas: Boolean(oldUser.has_aas),
            respDate: oldUser.responsibility_education_date
                ? new Date(oldUser.responsibility_education_date)
                : null,
        });
        const rawNickname = oldUser.nickname || null;
        const personName = oldUser.person_name || null;
        const firstName = oldUser.first_name || "";
        const lastName = oldUser.last_name || "";
        const nickname = extractNickname(rawNickname);
        const displayName = titleCase(
            personName ||
                (firstName || lastName
                    ? `${firstName} ${lastName}`.trim()
                    : null) ||
                rawNickname ||
                `Old User ${personId}`,
        );

        const placeholderEmail = oldEmail
            ? `legacy-${personId}@imported.pykaren`
            : `legacy-${personId}@no-email.pykaren`;

        // Check if already imported
        const existingMapping = await db
            .select()
            .from(legacyMappings)
            .where(eq(legacyMappings.oldUserId, personId))
            .limit(1);
        if (existingMapping.length > 0) {
            oldToPlaceholderId.set(
                personId,
                existingMapping[0].placeholderUserId as string,
            );
            continue;
        }

        const [placeholderUser] = await db
            .insert(users)
            .values({
                email: placeholderEmail,
                passwordHash: null,
                nickname: nickname || displayName,
                name: displayName,
                verified: false,
                emailVerified: false,
                role: "user",
                isLegacy: true,
            })
            .returning({ id: users.id });

        await db.insert(legacyMappings).values({
            oldUserId: personId,
            oldEmail: oldEmail,
            oldNickname: rawNickname,
            placeholderUserId: placeholderUser.id,
        });

        oldToPlaceholderId.set(personId, placeholderUser.id);
        usersImported++;
    }
    console.log(
        `  ${usersImported} placeholder users imported (total: ${oldToPlaceholderId.size})`,
    );

    // Build auth_user.id → placeholder mapping (needed for tickets which ref auth_user)
    const authUserToPlaceholderId = new Map<number, string>();
    for (const oldUser of oldUsers) {
        const personId = oldUser.person_id as number;
        const authUserId = oldUser.auth_user_id as number | null;
        const placeholderId = oldToPlaceholderId.get(personId);
        if (authUserId && placeholderId) {
            authUserToPlaceholderId.set(authUserId, placeholderId);
        }
    }

    // Handle auth_users without karen_person (they can have tickets)
    const [orphanAuthUsers] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT au.id, au.email, au.first_name, au.last_name
    FROM auth_user au
    LEFT JOIN karen_person kp ON kp.account_id = au.id
    WHERE kp.id IS NULL
  `);
    for (const oau of orphanAuthUsers) {
        const placeholderEmail = oau.email
            ? `legacy-auth${oau.id}@imported.pykaren`
            : `legacy-auth${oau.id}@no-email.pykaren`;
        const displayName = titleCase(
            (oau.first_name || oau.last_name
                ? `${oau.first_name || ""} ${oau.last_name || ""}`.trim()
                : null) || `Old Auth User ${oau.id}`,
        );

        const [placeholder] = await db
            .insert(users)
            .values({
                email: placeholderEmail,
                passwordHash: null,
                nickname: displayName,
                name: displayName,
                verified: false,
                emailVerified: false,
                role: "user",
                isLegacy: true,
            })
            .returning({ id: users.id });

        await db.insert(legacyMappings).values({
            oldUserId: oau.id,
            oldEmail: oau.email || "",
            oldNickname: null,
            placeholderUserId: placeholder.id,
        });
        authUserToPlaceholderId.set(oau.id, placeholder.id);
    }
    if (orphanAuthUsers.length > 0) {
        console.log(
            `  ${orphanAuthUsers.length} orphaned auth_user accounts imported`,
        );
    }

    // Resolve admin user for verifiedBy in education imports and event creation
    let systemUserId: string;
    const [adminUser] = await db
        .select()
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);
    if (adminUser) {
        systemUserId = adminUser.id;
    } else {
        throw new Error(
            "No admin user found — create one before running import",
        );
    }

    // ─── 2b. Import Educations ───
    console.log("Importing educations...");
    const allEduTypes = await db.select().from(educationTypes);
    const eduNameToId = new Map<string, number>();
    for (const et of allEduTypes) eduNameToId.set(et.name, et.id);

    let educationsImported = 0;
    for (const [personId, edu] of oldPersonEducations) {
        const placeholderId = oldToPlaceholderId.get(personId);
        if (!placeholderId) continue;

        if (edu.hasPub) {
            const typeId = eduNameToId.get("pub_worker");
            if (typeId) {
                await db
                    .insert(userEducations)
                    .values({
                        userId: placeholderId,
                        educationTypeId: typeId,
                        completedAt: new Date(),
                        expiresAt: null,
                        verifiedBy: systemUserId,
                    })
                    .onConflictDoNothing();
                educationsImported++;
            }
        }

        if (edu.hasAas) {
            const typeId = eduNameToId.get("aas");
            if (typeId) {
                await db
                    .insert(userEducations)
                    .values({
                        userId: placeholderId,
                        educationTypeId: typeId,
                        completedAt: new Date(),
                        expiresAt: null,
                        verifiedBy: systemUserId,
                    })
                    .onConflictDoNothing();
                educationsImported++;
            }
        }

        if (edu.respDate && edu.respDate >= new Date("2014-01-01")) {
            const typeId = eduNameToId.get("responsible");
            if (typeId) {
                const expiresAt = new Date(
                    edu.respDate.getTime() + 24 * 30 * 24 * 60 * 60 * 1000,
                );
                await db
                    .insert(userEducations)
                    .values({
                        userId: placeholderId,
                        educationTypeId: typeId,
                        completedAt: edu.respDate,
                        expiresAt,
                        verifiedBy: systemUserId,
                    })
                    .onConflictDoNothing();
                educationsImported++;
            }
        }
    }
    console.log(`  ${educationsImported} educations imported`);

    // ─── 3. Import Events ───
    console.log("Importing events...");

    const allStates = await db.select().from(eventStates);
    const stateMap = new Map<string, number>();
    for (const s of allStates) stateMap.set(s.name, s.id);

    const [oldEvents] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT e.id, e.name, e.description, e.location_id, e.start_date, e.end_date,
           e.max_guests, e.max_responsibles, e.max_workers, e.min_responsibles,
           e.min_workers, e.gives_points,
           es.value AS state_name
    FROM karen_event e
    LEFT JOIN karen_eventstate es ON es.id = e.will_occur_id
    ORDER BY e.start_date
  `);

    let eventsImported = 0;
    const oldToNewEventId = new Map<number, string>();

    for (const oldEvent of oldEvents) {
        const oldEventId = oldEvent.id;

        const existingEvents = await db
            .select()
            .from(events)
            .where(eq(events.name, oldEvent.name))
            .limit(1);

        const alreadyImported = existingEvents.find(
            (e) =>
                e.name === oldEvent.name &&
                Math.abs(
                    e.startDate.getTime() -
                        new Date(oldEvent.start_date).getTime(),
                ) < 86400000,
        );
        if (alreadyImported) {
            oldToNewEventId.set(oldEventId, alreadyImported.id);
            continue;
        }

        const locationId = oldEvent.location_id
            ? locationMap.get(oldEvent.location_id)
            : null;
        const stateName = oldEvent.state_name || "yes";
        const stateId =
            stateMap.get(stateName) || (stateMap.get("yes") as number);

        const [newEvent] = await db
            .insert(events)
            .values({
                name: oldEvent.name,
                description: oldEvent.description || null,
                locationId: locationId || 1,
                startDate: new Date(oldEvent.start_date),
                endDate: new Date(oldEvent.end_date),
                maxGuests: oldEvent.max_guests || 0,
                maxResponsibles: oldEvent.max_responsibles || 0,
                maxWorkers: oldEvent.max_workers || 0,
                minResponsibles: oldEvent.min_responsibles || 0,
                minWorkers: oldEvent.min_workers || 0,
                willOccur: stateId,
                givesPoints: Boolean(oldEvent.gives_points),
                locked: new Date(oldEvent.end_date) < new Date(),
                createdBy: systemUserId,
            })
            .returning({ id: events.id });

        oldToNewEventId.set(oldEventId, newEvent.id);
        eventsImported++;
    }
    console.log(
        `  ${eventsImported} events imported (total: ${oldToNewEventId.size})`,
    );

    // ─── 4. Import Worker Registrations ───
    console.log("Importing worker registrations...");
    const [oldWorkers] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT wr.id, wr.event_id, wr.worker_id, wr.responsible
    FROM karen_workerregistration wr
    WHERE wr.event_id IS NOT NULL AND wr.worker_id IS NOT NULL
  `);

    let workersImported = 0;
    let workersSkipped = 0;
    for (const wr of oldWorkers) {
        const newEventId = oldToNewEventId.get(wr.event_id);
        const placeholderId = oldToPlaceholderId.get(wr.worker_id);
        if (!newEventId || !placeholderId) {
            workersSkipped++;
            continue;
        }

        const existing = await db
            .select()
            .from(workerRegistrations)
            .where(eq(workerRegistrations.eventId, newEventId))
            .limit(100);
        if (existing.some((r) => r.userId === placeholderId)) {
            continue;
        }

        await db.insert(workerRegistrations).values({
            eventId: newEventId,
            userId: placeholderId,
            responsible: Boolean(wr.responsible),
        });
        workersImported++;
    }
    console.log(
        `  ${workersImported} worker registrations imported (${workersSkipped} skipped)`,
    );

    // ─── 5. Import Comments ───
    console.log("Importing comments...");
    const [oldComments] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT c.id, c.at_id, c.commenter_id, c.content, c.time
    FROM karen_comment c
    WHERE c.at_id IS NOT NULL AND c.commenter_id IS NOT NULL
  `);

    let commentsImported = 0;
    let commentsSkipped = 0;
    for (const c of oldComments) {
        const newEventId = oldToNewEventId.get(c.at_id);
        const placeholderId = oldToPlaceholderId.get(c.commenter_id);
        if (!newEventId || !placeholderId) {
            commentsSkipped++;
            continue;
        }

        await db.insert(comments).values({
            eventId: newEventId,
            userId: placeholderId,
            content: c.content || "",
            createdAt: c.time ? new Date(c.time) : new Date(),
        });
        commentsImported++;
    }
    console.log(
        `  ${commentsImported} comments imported (${commentsSkipped} skipped)`,
    );

    // ─── 6. Import Pub Teams ───
    console.log("Importing pub teams...");
    const [oldTeams] = await legacyConn.execute<RowDataPacket[]>(
        "SELECT id, name, description, team_color FROM karen_pubteam",
    );

    let teamsImported = 0;
    const oldToNewTeamId = new Map<number, string>();

    for (const t of oldTeams) {
        const oldTeamId = t.id;

        const existing = await db
            .select()
            .from(pubTeams)
            .where(eq(pubTeams.name, t.name))
            .limit(1);
        if (existing.length > 0) {
            oldToNewTeamId.set(oldTeamId, existing[0].id);
            continue;
        }

        const [newTeam] = await db
            .insert(pubTeams)
            .values({
                name: t.name,
                description: t.description || null,
                teamColor: t.team_color || "#000000",
                joinCode: generateJoinCode(),
                createdBy: systemUserId,
            })
            .returning({ id: pubTeams.id });

        oldToNewTeamId.set(oldTeamId, newTeam.id);
        teamsImported++;
    }
    console.log(
        `  ${teamsImported} pub teams imported (total: ${oldToNewTeamId.size})`,
    );

    // Import pub team members
    console.log("Importing pub team members...");
    const [oldTeamMembers] = await legacyConn.execute<RowDataPacket[]>(
        "SELECT pubteam_id, person_id FROM karen_pubteam_members",
    );
    const [oldTeamAdmins] = await legacyConn.execute<RowDataPacket[]>(
        "SELECT pubteam_id, person_id FROM karen_pubteam_team_admins",
    );
    const adminSet = new Set(
        oldTeamAdmins.map((a) => `${a.pubteam_id}-${a.person_id}`),
    );

    let membersImported = 0;
    for (const m of oldTeamMembers) {
        const newTeamId = oldToNewTeamId.get(m.pubteam_id);
        const placeholderId = oldToPlaceholderId.get(m.person_id);
        if (!newTeamId || !placeholderId) continue;

        const isAdmin = adminSet.has(`${m.pubteam_id}-${m.person_id}`);

        const existing = await db
            .select()
            .from(pubTeamMembers)
            .where(eq(pubTeamMembers.teamId, newTeamId))
            .limit(100);
        if (existing.some((pm) => pm.userId === placeholderId)) continue;

        await db.insert(pubTeamMembers).values({
            teamId: newTeamId,
            userId: placeholderId,
            isAdmin,
        });
        membersImported++;
    }
    console.log(`  ${membersImported} pub team members imported`);

    // ─── 7. Import Guest Registrations ───
    console.log("Importing guest registrations...");
    const [oldGuestRegs] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT gr.id, gr.event_id, gr.reporter_id, gr.guest_name, gr.guest_email, gr.guest_ssn
    FROM karen_guestregistration gr
    WHERE gr.event_id IS NOT NULL AND gr.reporter_id IS NOT NULL
  `);

    // Note: the legacy dump may or may not include a date of birth
    // column. We don't import a `guest_birth_date` here — the legacy
    // schema predates DOB tracking. If you need DOB for legacy
    // guests, add a `guest_birth_date` SELECT here.

    let guestRegsImported = 0;
    let guestRegsSkipped = 0;
    for (const gr of oldGuestRegs) {
        const newEventId = oldToNewEventId.get(gr.event_id);
        const placeholderId = oldToPlaceholderId.get(gr.reporter_id);
        if (!newEventId || !placeholderId) {
            guestRegsSkipped++;
            continue;
        }

        // Deduplicate by (eventId, guestName) so the same legacy guest
        // isn't imported twice if they appear multiple times in the
        // dump. (The old SSN-hash dedup is gone with the SSN.)
        const guestName = gr.guest_name || "";
        const existing = await db
            .select()
            .from(guestRegistrations)
            .where(eq(guestRegistrations.eventId, newEventId))
            .limit(500);
        if (existing.some((r) => r.guestName === guestName)) {
            continue;
        }

        await db.insert(guestRegistrations).values({
            eventId: newEventId,
            reporterId: placeholderId,
            guestName,
            guestEmail: gr.guest_email || null,
        });
        guestRegsImported++;
    }
    console.log(
        `  ${guestRegsImported} guest registrations imported (${guestRegsSkipped} skipped)`,
    );

    // ─── 8. Import Tickets ───
    // The legacy pykaren dump frequently contains multiple active tickets
    // per (user, event) pair, which would violate the partial unique index
    // `tickets_one_active_per_user_event` on the new schema. We dedup
    // here: at most one active ticket per (user, event); if multiple
    // active rows exist, the one with the highest `ticket_id` (latest)
    // wins. Inactive rows are dropped entirely — they're useless in the
    // new system where scans rely on a single active row per worker.
    console.log("Importing tickets...");
    const [oldTickets] = await legacyConn.execute<RowDataPacket[]>(`
    SELECT t.ticket_id, t.ticket_key, t.is_active, t.user_id, t.event_id
    FROM karen_ticket t
    WHERE t.event_id IS NOT NULL
  `);

    const { winners, skipped: ticketsSkipped } = dedupeTickets(
        oldTickets as unknown as Parameters<typeof dedupeTickets>[0],
        oldToNewEventId,
        authUserToPlaceholderId,
    );
    let ticketsImported = 0;
    let ticketsDroppedInactive = 0;
    for (const winner of winners) {
        if (!winner.isActive) {
            // Inactive duplicates are collapsed into nothing — the new
            // system doesn't have a use for them, and keeping an
            // is_active=false row would block adding a future active
            // ticket via the partial unique index.
            ticketsDroppedInactive++;
            continue;
        }
        await db.insert(tickets).values({
            userId: winner.userId,
            eventId: winner.eventId,
            token: winner.token,
            isActive: winner.isActive,
        });
        ticketsImported++;
    }
    console.log(
        `  ${ticketsImported} tickets imported (${ticketsSkipped} skipped, ${ticketsDroppedInactive} inactive duplicates dropped)`,
    );

    // ─── 9. Import Reports ───
    console.log("Importing reports...");
    const [oldReports] = await legacyConn.execute<RowDataPacket[]>(`
      SELECT r.event_id, r.who_worked, r.summary, r.need_to_resupply, r.economy, r.other
      FROM karen_report r
      WHERE r.event_id IS NOT NULL
    `);

    let reportsImported = 0;
    let reportsSkipped = 0;
    for (const r of oldReports) {
        const newEventId = oldToNewEventId.get(r.event_id);
        if (!newEventId) {
            reportsSkipped++;
            continue;
        }

        // Skip if report already exists for this event
        const existing = await db
            .select()
            .from(reports)
            .where(eq(reports.eventId, newEventId))
            .limit(1);
        if (existing.length > 0) continue;

        await db.insert(reports).values({
            eventId: newEventId,
            whoWorked: r.who_worked || null,
            summary: r.summary || null,
            needToResupply: r.need_to_resupply || null,
            economy: r.economy || null,
            other: r.other || null,
        });
        reportsImported++;
    }
    console.log(
        `  ${reportsImported} reports imported (${reportsSkipped} skipped)`,
    );

    // ─── Summary ───
    console.log("\n=== Import Complete ===");
    console.log(`Locations:        ${locationsImported} new`);
    console.log(`Users:            ${usersImported} placeholder`);
    console.log(`Events:           ${eventsImported}`);
    console.log(`Workers:          ${workersImported}`);
    console.log(`Comments:         ${commentsImported}`);
    console.log(`Pub Teams:        ${teamsImported}`);
    console.log(`Team Members:     ${membersImported}`);
    console.log(`Guest Regs:       ${guestRegsImported}`);
    console.log(`Tickets:          ${ticketsImported}`);
    console.log(`Reports:          ${reportsImported}`);

    await legacyConn.end();
    process.exit(0);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Only run the script when invoked directly (`bun src/db/import-legacy.ts`).
// When this file is imported from a unit test, the export is read but
// main() is not called, so we don't need LEGACY_DATABASE_URL just to
// import the module.
import { fileURLToPath } from "node:url";

if (
    typeof process !== "undefined" &&
    process.argv[1] &&
    fileURLToPath(import.meta.url) === process.argv[1]
) {
    main().catch((err) => {
        console.error("Import failed:", err);
        process.exit(1);
    });
}
