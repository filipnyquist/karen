// src/api/routes/workers.ts

import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { events, workerRegistrations } from "../../db/schema";
import { notifyEventChange } from "../../realtime/event-bus";
import {
    getEventById,
    getResponsibleCountForEvent,
    getWorkerCountForEvent,
} from "../../services/events";
import { assertCanRegisterAsResponsible } from "../../services/responsible-education";
import {
    authDerive,
    isAdmin,
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

                notifyEventChange(params.eventId, "workers");
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

                // Gate responsible sign-ups by education existence +
                // expiry. Bypassed clients (someone who crafts the
                // request directly with responsible: true) get a 403
                // before the capacity check below.
                if (body.responsible) {
                    await assertCanRegisterAsResponsible(user.id);
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

                notifyEventChange(body.eventId, "workers");
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
                const [registration] = await db
                    .select()
                    .from(workerRegistrations)
                    .where(
                        and(
                            eq(workerRegistrations.eventId, params.eventId),
                            eq(workerRegistrations.userId, user.id),
                        ),
                    )
                    .limit(1);

                if (!registration) {
                    throw new AppError(
                        "Not registered for this event",
                        404,
                        "NOT_REGISTERED",
                    );
                }

                // Dropping a shift leaves the event short-staffed, so an
                // ordinary worker cannot walk away unilaterally — someone who
                // can arrange a replacement has to do it. Admins and the
                // event's own responsibles are exactly that group.
                //
                // This mirrors the gating on the Unregister button in
                // src/pages/event/[id].astro; the two must agree or the UI
                // will offer an action the API refuses (or hide a valid one).
                if (!isAdmin(user.role) && !registration.responsible) {
                    throw new AppError(
                        "You need to contact KPS or a responsible to be removed from this event, as a replacement worker has to be found",
                        403,
                        "SELF_REMOVAL_FORBIDDEN",
                    );
                }

                await db
                    .delete(workerRegistrations)
                    .where(eq(workerRegistrations.id, registration.id));

                notifyEventChange(params.eventId, "workers");
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
