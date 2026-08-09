// src/api/routes/comments.ts

import { eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { comments, users } from "../../db/schema";
import { getEventById } from "../../services/events";
import { authDerive, isAdmin } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const commentRoutes = new Elysia({ prefix: "/comments" })
    .derive(authDerive)
    .post(
        "/",
        async ({ body, user }) => {
            await getEventById(body.eventId);

            if (!body.content.trim()) {
                throw new AppError(
                    "Comment content cannot be empty",
                    400,
                    "EMPTY_COMMENT",
                );
            }

            const [comment] = await db
                .insert(comments)
                .values({
                    eventId: body.eventId,
                    userId: user.id,
                    content: body.content.trim(),
                })
                .returning();

            return comment;
        },
        {
            body: t.Object({
                eventId: t.String(),
                content: t.String(),
            }),
        },
    )
    .get(
        "/event/:eventId",
        async ({ params, query }) => {
            await getEventById(params.eventId);

            const limit = parseInt(query?.limit ?? "50", 10);
            const offset = parseInt(query?.offset ?? "0", 10);

            const result = await db
                .select({
                    comment: comments,
                    user: {
                        id: users.id,
                        name: users.name,
                        nickname: users.nickname,
                    },
                })
                .from(comments)
                .innerJoin(users, eq(comments.userId, users.id))
                .where(eq(comments.eventId, params.eventId))
                .orderBy(sql`${comments.createdAt} ASC`)
                .limit(limit)
                .offset(offset);

            return result.map((r) => ({
                ...r.comment,
                user: r.user,
            }));
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
            }),
        },
    )
    .delete("/:id", async ({ params, user }) => {
        const result = await db
            .select()
            .from(comments)
            .where(eq(comments.id, params.id))
            .limit(1);

        if (result.length === 0) {
            throw new AppError("Comment not found", 404, "COMMENT_NOT_FOUND");
        }

        const comment = result[0];
        if (comment.userId !== user.id && !isAdmin(user.role)) {
            throw new AppError(
                "Not authorized to delete this comment",
                403,
                "FORBIDDEN",
            );
        }

        await db.delete(comments).where(eq(comments.id, params.id));
        return { success: true };
    });
