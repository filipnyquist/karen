// src/api/routes/guests.ts

import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { config } from "../../config";
import { db } from "../../db";
import { guestRegistrations, workerRegistrations } from "../../db/schema";
import { decrypt, encrypt, hashSsn } from "../../lib/encryption";
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

                if (body.guestSsn) {
                    const ssnHash = await hashSsn(body.guestSsn);
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
                }

                const encryptedSsn = body.guestSsn
                    ? await encrypt(body.guestSsn)
                    : null;
                const ssnHash = body.guestSsn
                    ? await hashSsn(body.guestSsn)
                    : null;

                const [registration] = await db
                    .insert(guestRegistrations)
                    .values({
                        eventId: body.eventId,
                        reporterId: user.id,
                        guestName: body.guestName,
                        guestEmail: body.guestEmail ?? null,
                        guestSsn: encryptedSsn,
                        guestSsnHash: ssnHash,
                    })
                    .returning();

                return registration;
            },
            {
                body: t.Object({
                    eventId: t.String(),
                    guestName: t.String(),
                    guestEmail: t.Optional(t.String()),
                    guestSsn: t.Optional(t.String()),
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

                const result = await db
                    .select()
                    .from(guestRegistrations)
                    .where(eq(guestRegistrations.eventId, params.eventId));
                return Promise.all(
                    result.map(async (g) => ({
                        ...g,
                        guestSsn: g.guestSsn ? await decrypt(g.guestSsn) : null,
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
