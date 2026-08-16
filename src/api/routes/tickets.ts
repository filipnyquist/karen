// src/api/routes/tickets.ts
import { Elysia, t } from "elysia";
import { recordAdminAction } from "../../services/auditLog";
import { getEventById } from "../../services/events";
import {
    canScanTickets,
    getEventTickets,
    getUserTickets,
    issueTicket,
    redeemTicket,
    revokeTicket,
    scanTicket,
} from "../../services/tickets";
import { adminDerive, authDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const ticketRoutes = new Elysia()
    .use(
        new Elysia({ prefix: "/tickets" })
            .derive(adminDerive)
            .post(
                "/issue",
                async ({ body, user }) => {
                    const ticket = await issueTicket(
                        body.userId,
                        body.eventId,
                        user.id,
                    );
                    return ticket;
                },
                {
                    body: t.Object({
                        userId: t.String({ format: "uuid" }),
                        eventId: t.String({ format: "uuid" }),
                    }),
                },
            )
            .delete("/:id", async ({ params, user }) => {
                const ticket = await revokeTicket(params.id, user.id);
                return ticket;
            })
            .get("/event/:eventId", async ({ params }) => {
                await getEventById(params.eventId);
                const result = await getEventTickets(params.eventId);
                return result.map((r) => ({
                    ...r.ticket,
                    user: r.user,
                }));
            }),
    )
    .use(
        new Elysia({ prefix: "/tickets" })
            .derive(authDerive)
            .post(
                "/scan",
                async ({ body, user }) => {
                    // Authorize FIRST so an unauthorized caller never
                    // gets the holder PII back from scanTicket.
                    const authorized = await canScanTickets(
                        user.id,
                        user.role,
                        body.eventId,
                    );
                    if (!authorized) {
                        await recordAdminAction(
                            user.id,
                            "ticket.scan.denied",
                            user.id,
                            {
                                newValue: {
                                    eventId: body.eventId,
                                    tokenPreview: `${body.token.slice(0, 8)}…`,
                                },
                            },
                        );
                        throw new AppError(
                            "Not authorized to scan tickets for this event",
                            403,
                            "FORBIDDEN",
                        );
                    }
                    const preview = await scanTicket(body.token);
                    return preview;
                },
                {
                    // Token format: 64-char hex (current generator) is
                    // 256 bits of entropy, but any 16-256-char opaque
                    // string is acceptable — the DB does an exact-match
                    // equality lookup.
                    body: t.Object({
                        token: t.String({ minLength: 16, maxLength: 256 }),
                        eventId: t.String({ format: "uuid" }),
                    }),
                },
            )
            .post(
                "/redeem",
                async ({ body, user }) => {
                    const authorized = await canScanTickets(
                        user.id,
                        user.role,
                        body.eventId,
                    );
                    if (!authorized) {
                        await recordAdminAction(
                            user.id,
                            "ticket.scan.denied",
                            user.id,
                            {
                                newValue: {
                                    eventId: body.eventId,
                                    tokenPreview: `${body.token.slice(0, 8)}…`,
                                },
                            },
                        );
                        throw new AppError(
                            "Not authorized to redeem tickets for this event",
                            403,
                            "FORBIDDEN",
                        );
                    }
                    const ticket = await redeemTicket(
                        body.token,
                        body.eventId,
                        user.id,
                    );
                    return ticket;
                },
                {
                    body: t.Object({
                        token: t.String({ minLength: 16, maxLength: 256 }),
                        eventId: t.String({ format: "uuid" }),
                    }),
                },
            )
            .get("/mine", async ({ user }) => {
                const result = await getUserTickets(user.id);
                return result.map((r) => ({
                    ...r.ticket,
                    event: r.event,
                }));
            }),
    );
