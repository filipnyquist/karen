// src/api/routes/teams.ts

import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { pubTeamMembers, pubTeams, users } from "../../db/schema";
import { MAX_FILE_SIZE, processAndStoreImage } from "../../lib/uploads";
import { recordAdminAction } from "../../services/auditLog";
import { generateJoinCode } from "../../utils/joinCode";
import type { AuthUser } from "../middleware/auth";
import {
    adminDerive,
    authDerive,
    isAdmin,
    loadSessionUser,
} from "../middleware/auth";
import { AppError } from "../middleware/error";

/** Derive user + require site admin OR team admin for the team in params */

/** Derive user + require site admin OR team admin for the team in params */
async function teamAdminDerive({
    request,
    params,
}: {
    request: Request;
    params: Record<string, string>;
}): Promise<{ user: AuthUser }> {
    const user = await loadSessionUser(request);
    if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");

    // Site admins (including superadmins) always pass
    if (isAdmin(user.role)) return { user };

    // Check team admin
    const teamId = params.id;
    if (!teamId) throw new AppError("Team ID required", 400, "BAD_REQUEST");

    const membership = await db
        .select()
        .from(pubTeamMembers)
        .where(
            and(
                eq(pubTeamMembers.teamId, teamId),
                eq(pubTeamMembers.userId, user.id),
            ),
        )
        .limit(1);

    if (membership.length === 0 || !membership[0].isAdmin) {
        throw new AppError("Team admin access required", 403, "FORBIDDEN");
    }

    return { user };
}

export const teamRoutes = new Elysia()
    // ── Public + member routes ──
    .use(
        new Elysia({ prefix: "/teams" })
            .derive(authDerive)
            .get("/", async () => {
                // Public listing — DO NOT expose joinCode. Only members
                // viewing a single team (via /:id) can see it.
                const result = await db
                    .select({
                        id: pubTeams.id,
                        name: pubTeams.name,
                        description: pubTeams.description,
                        teamColor: pubTeams.teamColor,
                        teamPic: pubTeams.teamPic,
                        createdBy: pubTeams.createdBy,
                        createdAt: pubTeams.createdAt,
                    })
                    .from(pubTeams);
                return result;
            })
            .get("/:id", async ({ params }) => {
                const teamResult = await db
                    .select()
                    .from(pubTeams)
                    .where(eq(pubTeams.id, params.id))
                    .limit(1);

                if (teamResult.length === 0) {
                    throw new AppError("Team not found", 404, "TEAM_NOT_FOUND");
                }

                const members = await db
                    .select({
                        member: pubTeamMembers,
                        user: {
                            id: users.id,
                            name: users.name,
                            nickname: users.nickname,
                        },
                    })
                    .from(pubTeamMembers)
                    .innerJoin(users, eq(pubTeamMembers.userId, users.id))
                    .where(eq(pubTeamMembers.teamId, params.id));

                return {
                    ...teamResult[0],
                    members: members.map((m) => ({
                        ...m.member,
                        user: m.user,
                    })),
                };
            })
            .post(
                "/:id/join",
                async ({ params, body, user }) => {
                    const teamResult = await db
                        .select({
                            id: pubTeams.id,
                            joinCode: pubTeams.joinCode,
                        })
                        .from(pubTeams)
                        .where(eq(pubTeams.id, params.id))
                        .limit(1);

                    if (teamResult.length === 0) {
                        throw new AppError(
                            "Team not found",
                            404,
                            "TEAM_NOT_FOUND",
                        );
                    }

                    // Teams are invite-only — a valid 8-char join code is
                    // required. Prevents blind enumeration by any logged-in
                    // user (P1-3).
                    if (
                        typeof body.code !== "string" ||
                        body.code.length !== 8 ||
                        body.code !== teamResult[0].joinCode
                    ) {
                        throw new AppError(
                            "Invalid join code",
                            403,
                            "INVALID_CODE",
                        );
                    }

                    const existing = await db
                        .select()
                        .from(pubTeamMembers)
                        .where(
                            and(
                                eq(pubTeamMembers.teamId, params.id),
                                eq(pubTeamMembers.userId, user.id),
                            ),
                        )
                        .limit(1);

                    if (existing.length > 0) {
                        throw new AppError(
                            "Already a member of this team",
                            409,
                            "ALREADY_MEMBER",
                        );
                    }

                    await db.insert(pubTeamMembers).values({
                        teamId: params.id,
                        userId: user.id,
                        isAdmin: false,
                    });

                    return { success: true };
                },
                {
                    body: t.Object({
                        code: t.String({ minLength: 8, maxLength: 8 }),
                    }),
                },
            )
            .post("/:id/leave", async ({ params, user }) => {
                const result = await db
                    .delete(pubTeamMembers)
                    .where(
                        and(
                            eq(pubTeamMembers.teamId, params.id),
                            eq(pubTeamMembers.userId, user.id),
                        ),
                    )
                    .returning();

                if (result.length === 0) {
                    throw new AppError(
                        "Not a member of this team",
                        404,
                        "NOT_MEMBER",
                    );
                }

                // Count remaining members
                const [countResult] = await db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(pubTeamMembers)
                    .where(eq(pubTeamMembers.teamId, params.id));

                if (countResult.count === 0) {
                    // Last member left — delete the team
                    await db.delete(pubTeams).where(eq(pubTeams.id, params.id));
                    return { success: true, teamDeleted: true };
                }

                return { success: true };
            }),
    )
    // ── Admin-only: create team ──
    .use(
        new Elysia({ prefix: "/teams" })
            .derive(adminDerive)
            .post(
                "/",
                async ({ body, user }) => {
                    const adminUserId = body.adminUserId ?? null;

                    if (adminUserId) {
                        const [targetUser] = await db
                            .select({ id: users.id })
                            .from(users)
                            .where(eq(users.id, adminUserId))
                            .limit(1);
                        if (!targetUser) {
                            throw new AppError(
                                "Selected admin user not found",
                                400,
                                "USER_NOT_FOUND",
                            );
                        }
                    }

                    const [team] = await db
                        .insert(pubTeams)
                        .values({
                            name: body.name,
                            description: body.description ?? null,
                            teamColor: body.teamColor ?? null,
                            teamPic: body.teamPic ?? null,
                            joinCode: generateJoinCode(),
                            createdBy: user.id,
                        })
                        .returning();

                    if (adminUserId) {
                        await db.insert(pubTeamMembers).values({
                            teamId: team.id,
                            userId: adminUserId,
                            isAdmin: true,
                        });
                    }

                    return team;
                },
                {
                    body: t.Object({
                        name: t.String(),
                        description: t.Optional(t.String()),
                        teamColor: t.Optional(t.String()),
                        teamPic: t.Optional(t.String()),
                        adminUserId: t.Optional(t.String()),
                    }),
                },
            )
            .delete("/:id", async ({ params }) => {
                const teamResult = await db
                    .select()
                    .from(pubTeams)
                    .where(eq(pubTeams.id, params.id))
                    .limit(1);

                if (teamResult.length === 0) {
                    throw new AppError("Team not found", 404, "TEAM_NOT_FOUND");
                }

                await db.delete(pubTeams).where(eq(pubTeams.id, params.id));
                return { success: true };
            }),
    )
    // ── Team admin routes (site admin OR team admin) ──
    .use(
        new Elysia({ prefix: "/teams" })
            .derive(teamAdminDerive)
            .put(
                "/:id",
                async ({ params, body }) => {
                    const teamResult = await db
                        .select()
                        .from(pubTeams)
                        .where(eq(pubTeams.id, params.id))
                        .limit(1);

                    if (teamResult.length === 0) {
                        throw new AppError(
                            "Team not found",
                            404,
                            "TEAM_NOT_FOUND",
                        );
                    }

                    const updateData: Partial<typeof pubTeams.$inferInsert> =
                        {};
                    if (body.name !== undefined) updateData.name = body.name;
                    if (body.description !== undefined)
                        updateData.description = body.description;
                    if (body.teamColor !== undefined)
                        updateData.teamColor = body.teamColor;
                    if (body.teamPic !== undefined)
                        updateData.teamPic = body.teamPic;

                    const [updated] = await db
                        .update(pubTeams)
                        .set(updateData)
                        .where(eq(pubTeams.id, params.id))
                        .returning();

                    return updated;
                },
                {
                    body: t.Object({
                        name: t.Optional(t.String()),
                        description: t.Optional(t.String()),
                        teamColor: t.Optional(t.String()),
                        teamPic: t.Optional(t.String()),
                    }),
                },
            )
            .put(
                "/:id/members/:userId",
                async ({ params, body }) => {
                    const existing = await db
                        .select()
                        .from(pubTeamMembers)
                        .where(
                            and(
                                eq(pubTeamMembers.teamId, params.id),
                                eq(pubTeamMembers.userId, params.userId),
                            ),
                        )
                        .limit(1);

                    if (existing.length === 0) {
                        throw new AppError(
                            "User is not a member of this team",
                            404,
                            "NOT_MEMBER",
                        );
                    }

                    await db
                        .update(pubTeamMembers)
                        .set({ isAdmin: body.isAdmin ?? false })
                        .where(
                            and(
                                eq(pubTeamMembers.teamId, params.id),
                                eq(pubTeamMembers.userId, params.userId),
                            ),
                        );

                    return { success: true };
                },
                {
                    body: t.Object({
                        isAdmin: t.Optional(t.Boolean()),
                    }),
                },
            )
            .delete("/:id/members/:userId", async ({ params, user }) => {
                // Don't allow removing yourself (use leave endpoint)
                if (params.userId === user.id && !isAdmin(user.role)) {
                    throw new AppError(
                        "Use the leave endpoint to remove yourself",
                        400,
                        "BAD_REQUEST",
                    );
                }

                const result = await db
                    .delete(pubTeamMembers)
                    .where(
                        and(
                            eq(pubTeamMembers.teamId, params.id),
                            eq(pubTeamMembers.userId, params.userId),
                        ),
                    )
                    .returning();

                if (result.length === 0) {
                    throw new AppError(
                        "User is not a member of this team",
                        404,
                        "NOT_MEMBER",
                    );
                }

                return { success: true };
            })
            // Regenerate the team's join code. The old code is
            // immediately invalidated. teamAdminDerive gates this to
            // site admins or team admins.
            .post("/:id/regenerate-code", async ({ params, user }) => {
                const newCode = generateJoinCode();
                const [updated] = await db
                    .update(pubTeams)
                    .set({ joinCode: newCode })
                    .where(eq(pubTeams.id, params.id))
                    .returning({
                        id: pubTeams.id,
                        joinCode: pubTeams.joinCode,
                    });
                if (!updated) {
                    throw new AppError("Team not found", 404, "TEAM_NOT_FOUND");
                }
                await recordAdminAction(
                    user.id,
                    "team.regenerate_code",
                    user.id,
                    {
                        newValue: { teamId: updated.id },
                    },
                );
                return { code: updated.joinCode };
            })
            .post(
                "/:id/picture",
                async ({ params, body }) => {
                    const file = body.file;

                    if (!file.type.startsWith("image/")) {
                        throw new AppError(
                            "Only image files are allowed",
                            400,
                            "INVALID_FILE_TYPE",
                        );
                    }

                    // Filename: team-{teamId}-{ts}.webp (always webp).
                    const filenameBase = `team-${params.id}-${Date.now()}`;

                    try {
                        const { publicUrl } = await processAndStoreImage(
                            file,
                            filenameBase,
                            { maxWidth: 512, maxHeight: 512 },
                        );

                        await db
                            .update(pubTeams)
                            .set({ teamPic: publicUrl })
                            .where(eq(pubTeams.id, params.id));

                        return { url: publicUrl };
                    } catch (err: unknown) {
                        if (
                            err instanceof Error &&
                            err.message.startsWith("INVALID_IMAGE")
                        ) {
                            throw new AppError(
                                "Could not process image — is it a valid image file?",
                                400,
                                "INVALID_IMAGE",
                            );
                        }
                        throw err;
                    }
                },
                {
                    body: t.Object({
                        file: t.File({
                            type: "image/*",
                            maxSize: MAX_FILE_SIZE,
                        }),
                    }),
                },
            ),
    );
