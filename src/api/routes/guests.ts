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
import { decrypt, encrypt, hashSsn } from "../../lib/encryption";
import { parseSsn } from "../../lib/ssn";
import {
    getEventById,
    getGuestCountForEvent,
    getGuestCountForUser,
} from "../../services/events";
import type { AuthUser } from "../middleware/auth";
import { authDerive, isAdmin, verifiedDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

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

                // The submitter vouches for the guest with their own
                // personnummer, so it must be on file before they can add
                // anyone. The island disables the button for this case; this
                // is the server-side twin of that guard.
                const [reporter] = await db
                    .select({ ssn: users.ssn })
                    .from(users)
                    .where(eq(users.id, user.id))
                    .limit(1);
                if (!reporter?.ssn) {
                    throw new AppError(
                        "You must register your own SSN before adding guests",
                        409,
                        "REPORTER_SSN_REQUIRED",
                    );
                }

                // Normalize before hashing so the same person entered as
                // "900101-1239" and "19900101-1239" collides on the
                // guest_ssn_event_unique index instead of slipping through.
                const parsedSsn = parseSsn(body.guestSsn);
                const ssnHash = await hashSsn(parsedSsn.normalized);

                const existingSsn = await db
                    .select()
                    .from(guestRegistrations)
                    .where(
                        and(
                            eq(guestRegistrations.guestSsnHash, ssnHash),
                            eq(guestRegistrations.eventId, body.eventId),
                        ),
                    )
                    .limit(1);

                if (existingSsn.length > 0) {
                    throw new AppError(
                        "A guest with this SSN is already registered for this event",
                        409,
                        "GUEST_SSN_EXISTS",
                    );
                }

                const [registration] = await db
                    .insert(guestRegistrations)
                    .values({
                        eventId: body.eventId,
                        reporterId: user.id,
                        guestName: body.guestName,
                        guestEmail: body.guestEmail ?? null,
                        guestSsn: await encrypt(parsedSsn.display),
                        guestSsnHash: ssnHash,
                    })
                    .returning();

                return registration;
            },
            {
                body: t.Object({
                    eventId: t.String(),
                    guestName: t.String({ minLength: 1 }),
                    guestEmail: t.Optional(t.String()),
                    guestSsn: t.String({ minLength: 1 }),
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
                    guestSsn: g.guestSsn ? "••••••" : null,
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
                        guestSsn: guestRegistrations.guestSsn,
                        guestSsnHash: guestRegistrations.guestSsnHash,
                        createdAt: guestRegistrations.createdAt,
                        reporterName: users.name,
                        reporterNickname: users.nickname,
                        reporterSsn: users.ssn,
                    })
                    .from(guestRegistrations)
                    .innerJoin(
                        users,
                        eq(users.id, guestRegistrations.reporterId),
                    )
                    .where(eq(guestRegistrations.eventId, params.eventId));
                return Promise.all(
                    rows.map(async (g) => ({
                        ...g,
                        guestSsn: g.guestSsn ? await decrypt(g.guestSsn) : null,
                        reporterSsn: g.reporterSsn
                            ? await decrypt(g.reporterSsn)
                            : null,
                    })),
                );
            })
            .get("/event/:eventId", async ({ params, user }) => {
                await getEventById(params.eventId);

                const showAll = await canSeeAllGuests(user, params.eventId);

                if (showAll) {
                    const result = await db
                        .select()
                        .from(guestRegistrations)
                        .where(eq(guestRegistrations.eventId, params.eventId));
                    return Promise.all(
                        result.map(async (g) => ({
                            ...g,
                            guestSsn: g.guestSsn
                                ? await decrypt(g.guestSsn)
                                : null,
                        })),
                    );
                }

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
                    guestSsn: g.guestSsn ? "••••••" : null,
                }));
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
                return { success: true };
            }),
    );
