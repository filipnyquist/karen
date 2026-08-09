// src/api/routes/reports.ts

import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { reports } from "../../db/schema";
import { getEventById } from "../../services/events";
import { adminDerive, responsibleOrAdminDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const reportRoutes = new Elysia()
    .use(
        new Elysia({ prefix: "/reports" })
            .derive(responsibleOrAdminDerive("eventId"))
            .post(
                "/",
                async ({ body }) => {
                    await getEventById(body.eventId);

                    const existing = await db
                        .select()
                        .from(reports)
                        .where(eq(reports.eventId, body.eventId))
                        .limit(1);

                    if (existing.length > 0) {
                        throw new AppError(
                            "Report already exists for this event",
                            409,
                            "REPORT_EXISTS",
                        );
                    }

                    const [report] = await db
                        .insert(reports)
                        .values({
                            eventId: body.eventId,
                            whoWorked: body.whoWorked ?? null,
                            summary: body.summary ?? null,
                            needToResupply: body.needToResupply ?? null,
                            economy: body.economy ?? null,
                            other: body.other ?? null,
                        })
                        .returning();

                    return report;
                },
                {
                    body: t.Object({
                        eventId: t.String(),
                        whoWorked: t.Optional(t.Union([t.String(), t.Null()])),
                        summary: t.Optional(t.Union([t.String(), t.Null()])),
                        needToResupply: t.Optional(
                            t.Union([t.String(), t.Null()]),
                        ),
                        economy: t.Optional(t.Union([t.String(), t.Null()])),
                        other: t.Optional(t.Union([t.String(), t.Null()])),
                    }),
                },
            ),
    )
    .use(
        new Elysia({ prefix: "/reports" })
            .derive(responsibleOrAdminDerive("eventId"))
            .get("/event/:eventId", async ({ params }) => {
                await getEventById(params.eventId);

                const result = await db
                    .select()
                    .from(reports)
                    .where(eq(reports.eventId, params.eventId))
                    .limit(1);

                if (result.length === 0) {
                    throw new AppError(
                        "Report not found",
                        404,
                        "REPORT_NOT_FOUND",
                    );
                }

                return result[0];
            }),
    )
    .use(
        new Elysia({ prefix: "/reports" })
            .derive(responsibleOrAdminDerive("eventId"))
            .put(
                "/event/:eventId",
                async ({ params, body }) => {
                    const existing = await db
                        .select()
                        .from(reports)
                        .where(eq(reports.eventId, params.eventId))
                        .limit(1);

                    if (existing.length === 0) {
                        throw new AppError(
                            "Report not found",
                            404,
                            "REPORT_NOT_FOUND",
                        );
                    }

                    const updateData: Partial<typeof reports.$inferInsert> = {
                        updatedAt: new Date(),
                    };
                    if (body.whoWorked !== undefined)
                        updateData.whoWorked = body.whoWorked;
                    if (body.summary !== undefined)
                        updateData.summary = body.summary;
                    if (body.needToResupply !== undefined)
                        updateData.needToResupply = body.needToResupply;
                    if (body.economy !== undefined)
                        updateData.economy = body.economy;
                    if (body.other !== undefined) updateData.other = body.other;

                    const [updated] = await db
                        .update(reports)
                        .set(updateData)
                        .where(eq(reports.eventId, params.eventId))
                        .returning();

                    return updated;
                },
                {
                    body: t.Object({
                        whoWorked: t.Optional(t.Union([t.String(), t.Null()])),
                        summary: t.Optional(t.Union([t.String(), t.Null()])),
                        needToResupply: t.Optional(
                            t.Union([t.String(), t.Null()]),
                        ),
                        economy: t.Optional(t.Union([t.String(), t.Null()])),
                        other: t.Optional(t.Union([t.String(), t.Null()])),
                    }),
                },
            ),
    )
    .use(
        new Elysia({ prefix: "/reports" })
            .derive(adminDerive)
            .delete("/event/:eventId", async ({ params }) => {
                const existing = await db
                    .select()
                    .from(reports)
                    .where(eq(reports.eventId, params.eventId))
                    .limit(1);

                if (existing.length === 0) {
                    throw new AppError(
                        "Report not found",
                        404,
                        "REPORT_NOT_FOUND",
                    );
                }

                await db
                    .delete(reports)
                    .where(eq(reports.eventId, params.eventId));
                return { success: true };
            }),
    );
