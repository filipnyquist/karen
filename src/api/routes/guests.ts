// src/api/routes/guests.ts

import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { config } from "../../config";
import { db } from "../../db";
import {
    guestRegistrations,
    users,
    workerRegistrations,
} from "../../db/schema";
import { notifyEventChange } from "../../realtime/event-bus";
import {
    getEventById,
    getGuestCountForEvent,
    getGuestCountForUser,
} from "../../services/events";
import { parseDob } from "../../utils/dob";
import type { AuthUser } from "../middleware/auth";
import { authDerive, isAdmin, verifiedDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

const DOB_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

async function canSeeAllGuests(
    user: AuthUser,
    eventId: string,
): Promise<boolean> {
    if (isAdmin(user.role)) return true;

    const responsibleReg = await db
        .select()
        .from(workerRegistrations)
        .where(
            and(
                eq(workerRegistrations.eventId, eventId),
                eq(workerRegistrations.userId, user.id),
                eq(workerRegistrations.responsible, true),
            ),
        )
        .limit(1);

    return responsibleReg.length > 0;
}

export const guestRoutes = new Elysia()
    // POST /guests — add a guest (verified users only, with optional adminOverride)
    .use(
        new Elysia({ prefix: "/guests" }).derive(verifiedDerive).post(
            "/",
            async ({ body, user }) => {
                const { event } = await getEventById(body.eventId);

                const maxGuests = event.maxGuests ?? config.defaultMaxGuests;
                const maxGuestsPerUser =
                    event.maxGuestsPerUser ?? config.defaultMaxGuestsPerUser;
                const isAdminOverride =
                    body.adminOverride && isAdmin(user.role);

                // Check total event guest limit (always enforced)
                const totalGuests = await getGuestCountForEvent(body.eventId);
                if (totalGuests >= maxGuests && !isAdminOverride) {
                    throw new AppError(
                        "Event has reached the maximum number of guests",
                        400,
                        "MAX_GUESTS_REACHED",
                    );
                }

                // Check per-user limit (skipped if adminOverride)
                if (!isAdminOverride) {
                    const userGuests = await getGuestCountForUser(
                        body.eventId,
                        user.id,
                    );
                    if (userGuests >= maxGuestsPerUser) {
                        throw new AppError(
                            `You have reached the maximum of ${maxGuestsPerUser} guests for this event`,
                            400,
                            "MAX_GUESTS_PER_USER",
                        );
                    }
                }

                // The submitter must have set their own date of birth
                // before they can add anyone. The island disables the
                // button for this case; this is the server-side twin.
                const [reporter] = await db
                    .select({ birthDate: users.birthDate })
                    .from(users)
                    .where(eq(users.id, user.id))
                    .limit(1);
                if (!reporter?.birthDate) {
                    throw new AppError(
                        "You must register your own date of birth before adding guests",
                        409,
                        "REPORTER_BIRTH_DATE_REQUIRED",
                    );
                }

                const parsedDob = parseDob(body.guestBirthDate);
                if (parsedDob === null) {
                    throw new AppError(
                        "Invalid date of birth",
                        400,
                        "INVALID_DOB",
                    );
                }

                // No dedup probe — DOB is not unique per person, so
                // duplicates are accepted at the DB level. The UI can
                // warn on identical name+email+birthDate if needed.
                const [registration] = await db
                    .insert(guestRegistrations)
                    .values({
                        eventId: body.eventId,
                        reporterId: user.id,
                        guestName: body.guestName,
                        guestEmail: body.guestEmail ?? null,
                        guestBirthDate: parsedDob,
                    })
                    .returning();

                notifyEventChange(body.eventId, "guests");
                return registration;
            },
            {
                body: t.Object({
                    eventId: t.String(),
                    guestName: t.String({ minLength: 1 }),
                    guestEmail: t.Optional(t.String()),
                    guestBirthDate: t.String({ pattern: DOB_PATTERN }),
                    adminOverride: t.Optional(t.Boolean()),
                }),
            },
        ),
    )
    // GET /guests/event/:eventId — returns all guests (admin/responsible) or own guests
    // GET /guests/event/:eventId/mine — always returns only current user's guests
    .use(
        new Elysia({ prefix: "/guests" })
            .derive(authDerive)
            .get("/event/:eventId/mine", async ({ params, user }) => {
                await getEventById(params.eventId);

                const result = await db
                    .select()
                    .from(guestRegistrations)
                    .where(
                        and(
                            eq(guestRegistrations.eventId, params.eventId),
                            eq(guestRegistrations.reporterId, user.id),
                        ),
                    );
                return result.map((g) => ({
                    ...g,
                    guestBirthDate: g.guestBirthDate ?? null,
                }));
            })
            .get("/event/:eventId/all", async ({ params, user }) => {
                await getEventById(params.eventId);

                const allowed = await canSeeAllGuests(user, params.eventId);
                if (!allowed) {
                    throw new AppError(
                        "Not authorized to view all guests",
                        403,
                        "FORBIDDEN",
                    );
                }

                const rows = await db
                    .select({
                        id: guestRegistrations.id,
                        eventId: guestRegistrations.eventId,
                        reporterId: guestRegistrations.reporterId,
                        guestName: guestRegistrations.guestName,
                        guestEmail: guestRegistrations.guestEmail,
                        guestBirthDate: guestRegistrations.guestBirthDate,
                        createdAt: guestRegistrations.createdAt,
                        reporterName: users.name,
                        reporterNickname: users.nickname,
                    })
                    .from(guestRegistrations)
                    .innerJoin(
                        users,
                        eq(users.id, guestRegistrations.reporterId),
                    )
                    .where(eq(guestRegistrations.eventId, params.eventId));
                return rows;
            })
            .get("/event/:eventId", async ({ params, user }) => {
                await getEventById(params.eventId);

                const showAll = await canSeeAllGuests(user, params.eventId);

                if (showAll) {
                    return db
                        .select()
                        .from(guestRegistrations)
                        .where(eq(guestRegistrations.eventId, params.eventId));
                }

                return db
                    .select()
                    .from(guestRegistrations)
                    .where(
                        and(
                            eq(guestRegistrations.eventId, params.eventId),
                            eq(guestRegistrations.reporterId, user.id),
                        ),
                    );
            })
            .delete("/:id", async ({ params, user }) => {
                const result = await db
                    .select()
                    .from(guestRegistrations)
                    .where(eq(guestRegistrations.id, params.id))
                    .limit(1);

                if (result.length === 0) {
                    throw new AppError(
                        "Guest registration not found",
                        404,
                        "GUEST_NOT_FOUND",
                    );
                }

                const guest = result[0];
                // Owner can remove own, admin can remove any
                if (guest.reporterId !== user.id && !isAdmin(user.role)) {
                    throw new AppError(
                        "Not authorized to remove this guest",
                        403,
                        "FORBIDDEN",
                    );
                }

                await db
                    .delete(guestRegistrations)
                    .where(eq(guestRegistrations.id, params.id));
                notifyEventChange(guest.eventId, "guests");
                return { success: true };
            }),
    );
