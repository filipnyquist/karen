// src/api/routes/events.ts

import { Elysia, t } from "elysia";
import {
    createEvent,
    deleteEvent,
    getEventById,
    listEvents,
    updateEvent,
} from "../../services/events";
import { issueTicketsForEvent } from "../../services/tickets";
import {
    adminDerive,
    isAdmin,
    responsibleOrAdminDerive,
} from "../middleware/auth";
import { AppError } from "../middleware/error";

export const eventRoutes = new Elysia()
    // Public routes
    .use(
        new Elysia({ prefix: "/events" })
            .get(
                "/",
                async ({ query }) => {
                    const limit = parseInt(query?.limit ?? "50", 10);
                    const offset = parseInt(query?.offset ?? "0", 10);
                    const result = await listEvents({ limit, offset });
                    return result.map((r) => ({
                        ...r.event,
                        location: r.location,
                        state: r.state,
                    }));
                },
                {
                    query: t.Object({
                        limit: t.Optional(t.String()),
                        offset: t.Optional(t.String()),
                    }),
                },
            )
            .get("/:id", async ({ params }) => {
                const { event, location, state } = await getEventById(
                    params.id,
                );
                return { ...event, location, state };
            }),
    )
    // Admin routes
    .use(
        new Elysia({ prefix: "/events" })
            .derive(adminDerive)
            .post(
                "/",
                async ({ body, user }) => {
                    const event = await createEvent({
                        ...body,
                        createdBy: user.id,
                    });
                    return event;
                },
                {
                    body: t.Object({
                        name: t.String(),
                        description: t.Optional(t.String()),
                        locationId: t.Number(),
                        startDate: t.String(),
                        endDate: t.String(),
                        maxGuests: t.Optional(t.Number()),
                        maxResponsibles: t.Optional(t.Number()),
                        maxWorkers: t.Optional(t.Number()),
                        minResponsibles: t.Optional(t.Number()),
                        minWorkers: t.Optional(t.Number()),
                        maxGuestsPerUser: t.Optional(t.Number()),
                        willOccur: t.Number(),
                        givesPoints: t.Optional(t.Boolean()),
                    }),
                },
            )
            .delete("/:id", async ({ params }) => {
                await deleteEvent(params.id);
                return { success: true };
            }),
    )
    // Responsible or admin routes
    .use(
        new Elysia({ prefix: "/events" })
            .derive(responsibleOrAdminDerive("id"))
            .put(
                "/:id",
                async ({ params, body }) => {
                    const updated = await updateEvent(params.id, body);
                    return updated;
                },
                {
                    body: t.Object({
                        name: t.Optional(t.String()),
                        description: t.Optional(t.String()),
                        locationId: t.Optional(t.Number()),
                        startDate: t.Optional(t.String()),
                        endDate: t.Optional(t.String()),
                        maxGuests: t.Optional(t.Number()),
                        maxResponsibles: t.Optional(t.Number()),
                        maxWorkers: t.Optional(t.Number()),
                        minResponsibles: t.Optional(t.Number()),
                        minWorkers: t.Optional(t.Number()),
                        maxGuestsPerUser: t.Optional(t.Number()),
                        willOccur: t.Optional(t.Number()),
                        givesPoints: t.Optional(t.Boolean()),
                        locked: t.Optional(t.Boolean()),
                    }),
                },
            ),
    )
    // Lock/unlock event
    .use(
        new Elysia({ prefix: "/events" })
            .derive(responsibleOrAdminDerive("id"))
            .post(
                "/:id/lock",
                async ({ params, body, user }) => {
                    if (!body.locked && !isAdmin(user.role)) {
                        throw new AppError(
                            "Only admins can unlock events",
                            403,
                            "FORBIDDEN",
                        );
                    }

                    await updateEvent(params.id, { locked: body.locked });

                    let ticketsIssued = 0;
                    let ticketsFailed: string[] = [];
                    if (body.locked && body.issueTickets) {
                        const result = await issueTicketsForEvent(
                            params.id,
                            user.id,
                        );
                        ticketsIssued = result.issued;
                        ticketsFailed = result.failed;
                    }

                    return {
                        success: true,
                        locked: body.locked,
                        ticketsIssued,
                        ticketsFailed,
                    };
                },
                {
                    body: t.Object({
                        locked: t.Boolean(),
                        issueTickets: t.Optional(t.Boolean()),
                    }),
                },
            ),
    );
