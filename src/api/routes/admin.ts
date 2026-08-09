// src/api/routes/admin.ts

import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
    auditLog,
    educationTypes,
    events,
    tickets,
    userEducations,
    users,
} from "../../db/schema";
import { recordAdminAction } from "../../services/auditLog";
import { adminDerive, isSuperadmin } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { exportRoutes } from "./exports";

export const adminRoutes = new Elysia({ prefix: "/admin" })
    .derive(adminDerive)
    .use(exportRoutes)
    .post(
        "/verify",
        async ({ body, user: actor }) => {
            const result = await db
                .select()
                .from(users)
                .where(eq(users.id, body.userId))
                .limit(1);

            if (result.length === 0) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            const previousVerified = result[0].verified;
            const [updated] = await db
                .update(users)
                .set({ verified: true, updatedAt: new Date() })
                .where(eq(users.id, body.userId))
                .returning();

            await recordAdminAction(
                actor.id,
                "user.verified.set",
                body.userId,
                {
                    oldValue: previousVerified,
                    newValue: true,
                },
            );

            return {
                id: updated.id,
                email: updated.email,
                name: updated.name,
                nickname: updated.nickname,
                verified: updated.verified,
            };
        },
        {
            body: t.Object({
                userId: t.String(),
            }),
        },
    )
    .post(
        "/education",
        async ({ body, user: actor }) => {
            const targetUser = await db
                .select()
                .from(users)
                .where(eq(users.id, body.userId))
                .limit(1);

            if (targetUser.length === 0) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            const eduType = await db
                .select()
                .from(educationTypes)
                .where(eq(educationTypes.id, body.educationTypeId))
                .limit(1);

            if (eduType.length === 0) {
                throw new AppError(
                    "Education type not found",
                    404,
                    "EDUCATION_TYPE_NOT_FOUND",
                );
            }

            const existing = await db
                .select()
                .from(userEducations)
                .where(
                    and(
                        eq(userEducations.userId, body.userId),
                        eq(
                            userEducations.educationTypeId,
                            body.educationTypeId,
                        ),
                    ),
                )
                .limit(1);

            if (existing.length > 0) {
                const completedAt = new Date();
                const expiresAt = eduType[0].validityMonths
                    ? new Date(
                          completedAt.getTime() +
                              eduType[0].validityMonths *
                                  30 *
                                  24 *
                                  60 *
                                  60 *
                                  1000,
                      )
                    : null;

                await db
                    .update(userEducations)
                    .set({
                        completedAt,
                        expiresAt,
                        verifiedBy: actor.id,
                    })
                    .where(
                        and(
                            eq(userEducations.userId, body.userId),
                            eq(
                                userEducations.educationTypeId,
                                body.educationTypeId,
                            ),
                        ),
                    );
            } else {
                const completedAt = new Date();
                const expiresAt = eduType[0].validityMonths
                    ? new Date(
                          completedAt.getTime() +
                              eduType[0].validityMonths *
                                  30 *
                                  24 *
                                  60 *
                                  60 *
                                  1000,
                      )
                    : null;

                await db.insert(userEducations).values({
                    userId: body.userId,
                    educationTypeId: body.educationTypeId,
                    completedAt,
                    expiresAt,
                    verifiedBy: actor.id,
                });
            }

            await recordAdminAction(
                actor.id,
                "user.education.grant",
                body.userId,
                {
                    newValue: { educationTypeId: body.educationTypeId },
                },
            );

            return { success: true };
        },
        {
            body: t.Object({
                userId: t.String(),
                educationTypeId: t.Number(),
            }),
        },
    )
    .delete(
        "/education",
        async ({ body, user: actor }) => {
            const result = await db
                .delete(userEducations)
                .where(
                    and(
                        eq(userEducations.userId, body.userId),
                        eq(
                            userEducations.educationTypeId,
                            body.educationTypeId,
                        ),
                    ),
                )
                .returning();

            if (result.length === 0) {
                throw new AppError(
                    "Education not found for this user",
                    404,
                    "EDUCATION_NOT_FOUND",
                );
            }

            await recordAdminAction(
                actor.id,
                "user.education.revoke",
                body.userId,
                {
                    oldValue: { educationTypeId: body.educationTypeId },
                },
            );

            return { success: true };
        },
        {
            body: t.Object({
                userId: t.String(),
                educationTypeId: t.Number(),
            }),
        },
    )
    .get(
        "/users",
        async ({ query }) => {
            const limit = parseInt(query?.limit ?? "50", 10);
            const offset = parseInt(query?.offset ?? "0", 10);

            const result = await db
                .select({
                    id: users.id,
                    email: users.email,
                    nickname: users.nickname,
                    name: users.name,
                    verified: users.verified,
                    emailVerified: users.emailVerified,
                    role: users.role,
                    createdAt: users.createdAt,
                })
                .from(users)
                .limit(limit)
                .offset(offset);

            return result;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
            }),
        },
    )
    .get("/education-types", async () => {
        return db.select().from(educationTypes);
    })
    // Search users
    .get("/users/search/:query", async ({ params }) => {
        const searchTerm = `%${params.query}%`;
        return db
            .select({
                id: users.id,
                email: users.email,
                nickname: users.nickname,
                name: users.name,
                verified: users.verified,
                emailVerified: users.emailVerified,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                or(
                    ilike(users.email, searchTerm),
                    ilike(users.name, searchTerm),
                    ilike(users.nickname, searchTerm),
                ),
            )
            .limit(50);
    })
    // User detail with educations + tickets
    .get("/users/:id", async ({ params }) => {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                nickname: users.nickname,
                name: users.name,
                profilePic: users.profilePic,
                description: users.description,
                emailVerified: users.emailVerified,
                verified: users.verified,
                role: users.role,
                isLegacy: users.isLegacy,
                seenMigrationPrompt: users.seenMigrationPrompt,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .where(eq(users.id, params.id))
            .limit(1);
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");

        const educations = await db
            .select({
                educationTypeId: educationTypes.id,
                name: educationTypes.name,
                description: educationTypes.description,
                completedAt: userEducations.completedAt,
                expiresAt: userEducations.expiresAt,
            })
            .from(userEducations)
            .innerJoin(
                educationTypes,
                eq(userEducations.educationTypeId, educationTypes.id),
            )
            .where(eq(userEducations.userId, params.id));

        const userTickets = await db
            .select({
                id: tickets.id,
                eventName: events.name,
                eventStartDate: events.startDate,
                isActive: tickets.isActive,
                createdAt: tickets.createdAt,
                redeemedAt: tickets.redeemedAt,
            })
            .from(tickets)
            .innerJoin(events, eq(tickets.eventId, events.id))
            .where(eq(tickets.userId, params.id))
            .orderBy(desc(tickets.createdAt));

        return { user, educations, tickets: userTickets };
    })
    // Edit user
    .put(
        "/users/:id",
        async ({ body, params, user: actor }) => {
            // Load the existing record so we can audit only what changed.
            const [existing] = await db
                .select()
                .from(users)
                .where(eq(users.id, params.id))
                .limit(1);
            if (!existing)
                throw new AppError("User not found", 404, "USER_NOT_FOUND");

            const updateData: Partial<typeof users.$inferInsert> = {
                updatedAt: new Date(),
            };
            // Role-change scoping: only superadmins may promote, demote, or
            // touch anyone whose current role is admin/superadmin. Admins
            // keep the ability to toggle a regular user between `user` and
            // `responsible` (e.g. once they've completed the responsible
            // education). All other profile fields stay admin-or-superadmin.
            if (body.role !== undefined) {
                const touchesPrivilegedRole =
                    body.role === "admin" ||
                    body.role === "superadmin" ||
                    existing.role === "admin" ||
                    existing.role === "superadmin";
                if (touchesPrivilegedRole && !isSuperadmin(actor.role)) {
                    throw new AppError(
                        "Only superadmins can change admin/superadmin roles",
                        403,
                        "FORBIDDEN",
                    );
                }
                updateData.role = body.role;
            }
            if (body.name !== undefined) updateData.name = body.name;
            if (body.nickname !== undefined)
                updateData.nickname = body.nickname;
            if (body.emailVerified !== undefined)
                updateData.emailVerified = body.emailVerified;
            if (body.verified !== undefined)
                updateData.verified = body.verified;

            const [updated] = await db
                .update(users)
                .set(updateData)
                .where(eq(users.id, params.id))
                .returning();

            if (!updated)
                throw new AppError("User not found", 404, "USER_NOT_FOUND");

            // Audit role changes explicitly — this is the highest-impact
            // privileged mutation, so it deserves its own audit_action.
            if (body.role !== undefined && body.role !== existing.role) {
                await recordAdminAction(
                    actor.id,
                    "user.role.change",
                    params.id,
                    {
                        oldValue: existing.role,
                        newValue: body.role,
                    },
                );
            }
            if (
                body.verified !== undefined &&
                body.verified !== existing.verified
            ) {
                await recordAdminAction(
                    actor.id,
                    "user.verified.set",
                    params.id,
                    {
                        oldValue: existing.verified,
                        newValue: body.verified,
                    },
                );
            }
            if (
                body.emailVerified !== undefined &&
                body.emailVerified !== existing.emailVerified
            ) {
                await recordAdminAction(
                    actor.id,
                    "user.email_verified.set",
                    params.id,
                    {
                        oldValue: existing.emailVerified,
                        newValue: body.emailVerified,
                    },
                );
            }
            // Generic profile update audit if anything other than verified flags changed.
            const profileChanged =
                (body.name !== undefined && body.name !== existing.name) ||
                (body.nickname !== undefined &&
                    body.nickname !== existing.nickname);
            if (profileChanged) {
                await recordAdminAction(
                    actor.id,
                    "user.profile.update",
                    params.id,
                    {
                        oldValue: {
                            name: existing.name,
                            nickname: existing.nickname,
                        },
                        newValue: {
                            name: updated.name,
                            nickname: updated.nickname,
                        },
                    },
                );
            }

            const { passwordHash: _omit, ...safeUser } = updated;
            return safeUser;
        },
        {
            body: t.Object({
                name: t.Optional(t.String()),
                nickname: t.Optional(t.String()),
                role: t.Optional(
                    t.Union([
                        t.Literal("user"),
                        t.Literal("responsible"),
                        t.Literal("admin"),
                        t.Literal("superadmin"),
                    ]),
                ),
                emailVerified: t.Optional(t.Boolean()),
                verified: t.Optional(t.Boolean()),
            }),
        },
    )
    // Events list for ticket issuance
    .get("/events", async () => {
        return db
            .select({
                id: events.id,
                name: events.name,
                startDate: events.startDate,
            })
            .from(events)
            .orderBy(desc(events.startDate))
            .limit(100);
    })
    // Audit log — read-only listing for superadmins. Useful for
    // accountability around ticket lifecycle, role changes, education grants,
    // invitations, etc. Strictly above admin: only superadmins may read.
    .get(
        "/audit-log",
        async ({ query, user: actor }) => {
            // adminDerive already authenticated an admin OR superadmin, so
            // we additionally enforce the strict superadmin check here.
            // 403 is the right shape for an API (clients expect JSON, not
            // redirects).
            if (actor.role !== "superadmin") {
                throw new AppError(
                    "Superadmin access required",
                    403,
                    "FORBIDDEN",
                );
            }
            const limit = Math.min(
                parseInt(query?.limit ?? "100", 10) || 100,
                500,
            );
            const actionFilter = query?.action;
            const where = actionFilter
                ? eq(auditLog.action, actionFilter)
                : undefined;
            return db
                .select({
                    id: auditLog.id,
                    actorId: auditLog.actorId,
                    action: auditLog.action,
                    targetUserId: auditLog.targetUserId,
                    oldValue: auditLog.oldValue,
                    newValue: auditLog.newValue,
                    createdAt: auditLog.createdAt,
                })
                .from(auditLog)
                .where(where as never)
                .orderBy(desc(auditLog.createdAt))
                .limit(limit);
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
                action: t.Optional(t.String()),
            }),
        },
    );
