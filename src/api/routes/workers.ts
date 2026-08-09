// src/api/routes/workers.ts

import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { events, workerRegistrations } from "../../db/schema";
import {
    getEventById,
    getResponsibleCountForEvent,
    getWorkerCountForEvent,
} from "../../services/events";
import {
    authDerive,
    responsibleOrAdminDerive,
    verifiedDerive,
} from "../middleware/auth";
import { AppError } from "../middleware/error";

export const workerRoutes = new Elysia()
    // Responsible or admin removes a worker from an event
    .use(
        new Elysia({ prefix: "/workers" })
            .derive(responsibleOrAdminDerive("eventId"))
            .delete("/event/:eventId/user/:userId", async ({ params }) => {
                const result = await db
                    .delete(workerRegistrations)
                    .where(
                        and(
                            eq(workerRegistrations.eventId, params.eventId),
                            eq(workerRegistrations.userId, params.userId),
                        ),
                    )
                    .returning();

                if (result.length === 0) {
                    throw new AppError(
                        "Worker not registered for this event",
                        404,
                        "NOT_REGISTERED",
                    );
                }

                return { success: true };
            }),
    )
    .use(
        new Elysia({ prefix: "/workers" }).derive(verifiedDerive).post(
            "/register",
            async ({ body, user }) => {
                const { event } = await getEventById(body.eventId);

                const existing = await db
                    .select()
                    .from(workerRegistrations)
                    .where(
                        and(
                            eq(workerRegistrations.eventId, body.eventId),
                            eq(workerRegistrations.userId, user.id),
                        ),
                    )
                    .limit(1);

                if (existing.length > 0) {
                    throw new AppError(
                        "Already registered for this event",
                        409,
                        "ALREADY_REGISTERED",
                    );
                }

                if (body.responsible) {
                    if (event.maxResponsibles !== null) {
                        const responsibleCount =
                            await getResponsibleCountForEvent(body.eventId);
                        if (responsibleCount >= event.maxResponsibles) {
                            throw new AppError(
                                "Max responsibles reached for this event",
                                400,
                                "MAX_RESPONSIBLES",
                            );
                        }
                    }
                } else {
                    if (event.maxWorkers !== null) {
                        const workerCount = await getWorkerCountForEvent(
                            body.eventId,
                        );
                        if (workerCount >= event.maxWorkers) {
                            throw new AppError(
                                "Max workers reached for this event",
                                400,
                                "MAX_WORKERS",
                            );
                        }
                    }
                }

                const [registration] = await db
                    .insert(workerRegistrations)
                    .values({
                        eventId: body.eventId,
                        userId: user.id,
                        responsible: body.responsible ?? false,
                    })
                    .returning();

                return registration;
            },
            {
                body: t.Object({
                    eventId: t.String(),
                    responsible: t.Optional(t.Boolean()),
                }),
            },
        ),
    )
    .use(
        new Elysia({ prefix: "/workers" })
            .derive(authDerive)
            .delete("/register/:eventId", async ({ params, user }) => {
                const result = await db
                    .delete(workerRegistrations)
                    .where(
                        and(
                            eq(workerRegistrations.eventId, params.eventId),
                            eq(workerRegistrations.userId, user.id),
                        ),
                    )
                    .returning();

                if (result.length === 0) {
                    throw new AppError(
                        "Not registered for this event",
                        404,
                        "NOT_REGISTERED",
                    );
                }

                return { success: true };
            })
            .get("/mine", async ({ user }) => {
                const result = await db
                    .select({
                        registration: workerRegistrations,
                        event: events,
                    })
                    .from(workerRegistrations)
                    .innerJoin(
                        events,
                        eq(workerRegistrations.eventId, events.id),
                    )
                    .where(eq(workerRegistrations.userId, user.id))
                    .orderBy(events.startDate);

                return result.map((r) => ({
                    ...r.registration,
                    event: r.event,
                }));
            }),
    );
