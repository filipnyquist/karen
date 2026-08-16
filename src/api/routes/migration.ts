// src/api/routes/migration.ts

import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { config } from "../../config";
import { db } from "../../db";
import {
    comments,
    guestRegistrations,
    legacyMappings,
    pubTeamMembers,
    tickets,
    userEducations,
    users,
    workerRegistrations,
} from "../../db/schema";
import { detectLanguage } from "../../i18n";
import { sendMigrationLinkEmail } from "../../services/email";
import { adminDerive, authDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const migrationRoutes = new Elysia({ prefix: "/migration" })

    // ─── Auth-required routes ───
    .use(
        new Elysia()
            .derive(authDerive)

            // Lookup old email
            .post("/lookup", async ({ body, user }) => {
                const { email } = body as { email: string };
                if (!email)
                    throw new AppError(
                        "Email is required",
                        400,
                        "EMAIL_REQUIRED",
                    );

                const [mapping] = await db
                    .select()
                    .from(legacyMappings)
                    .where(
                        eq(
                            sql`LOWER(${legacyMappings.oldEmail})`,
                            email.toLowerCase(),
                        ),
                    )
                    .limit(1);

                if (!mapping) {
                    return { found: false };
                }

                if (mapping.realUserId) {
                    return {
                        found: true,
                        alreadyClaimed: true,
                        oldNickname: mapping.oldNickname,
                    };
                }

                if (mapping.placeholderUserId === user.id) {
                    return {
                        found: true,
                        alreadyClaimed: true,
                        oldNickname: mapping.oldNickname,
                    };
                }

                const [existingClaim] = await db
                    .select()
                    .from(legacyMappings)
                    .where(eq(legacyMappings.realUserId, user.id))
                    .limit(1);
                if (existingClaim) {
                    return { found: true, alreadyMigrated: true };
                }

                return {
                    found: true,
                    alreadyClaimed: false,
                    legacyId: mapping.id,
                    oldNickname: mapping.oldNickname,
                    oldEmail: mapping.oldEmail,
                };
            })

            // Send verification link
            .post("/send-link", async ({ body, request }) => {
                const { legacyId } = body as { legacyId: string };
                if (!legacyId)
                    throw new AppError(
                        "Legacy ID is required",
                        400,
                        "LEGACY_ID_REQUIRED",
                    );

                const [mapping] = await db
                    .select()
                    .from(legacyMappings)
                    .where(eq(legacyMappings.id, legacyId))
                    .limit(1);

                if (!mapping)
                    throw new AppError(
                        "Legacy mapping not found",
                        404,
                        "MAPPING_NOT_FOUND",
                    );
                if (mapping.realUserId)
                    throw new AppError(
                        "Already claimed",
                        409,
                        "ALREADY_CLAIMED",
                    );
                if (!mapping.oldEmail)
                    throw new AppError(
                        "No email on file for this legacy account",
                        400,
                        "LEGACY_EMAIL_MISSING",
                    );

                const token = crypto.randomUUID();
                const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

                await db
                    .update(legacyMappings)
                    .set({
                        migrationToken: token,
                        migrationTokenExpiry: expiry,
                    })
                    .where(eq(legacyMappings.id, mapping.id));

                await sendMigrationLinkEmail({
                    to: mapping.oldEmail,
                    baseUrl: config.baseUrl,
                    token,
                    lang: detectLanguage(request) as "en" | "sv",
                });

                return { sent: true };
            })

            // Verify link token and execute merge
            .get("/verify-link", async ({ query, user }) => {
                const token = query?.token;
                if (!token)
                    throw new AppError(
                        "Token is required",
                        400,
                        "TOKEN_REQUIRED",
                    );

                const [mapping] = await db
                    .select()
                    .from(legacyMappings)
                    .where(eq(legacyMappings.migrationToken, token))
                    .limit(1);

                if (!mapping)
                    throw new AppError(
                        "Invalid or expired link",
                        404,
                        "INVALID_LINK",
                    );
                if (mapping.realUserId)
                    throw new AppError(
                        "Already claimed",
                        409,
                        "ALREADY_CLAIMED",
                    );
                if (
                    !mapping.migrationTokenExpiry ||
                    new Date() > mapping.migrationTokenExpiry
                ) {
                    throw new AppError("Link expired", 410, "LINK_EXPIRED");
                }

                if (mapping.placeholderUserId === user.id) {
                    throw new AppError(
                        "Cannot claim your own placeholder",
                        400,
                        "CANNOT_CLAIM_SELF",
                    );
                }

                return await executeMerge(
                    mapping.placeholderUserId as string,
                    user.id,
                    mapping.id,
                );
            })

            // Request admin approval
            .post("/request-admin", async ({ body, user }) => {
                const { legacyId, reason } = body as {
                    legacyId: string;
                    reason?: string;
                };
                if (!legacyId)
                    throw new AppError(
                        "Legacy ID is required",
                        400,
                        "LEGACY_ID_REQUIRED",
                    );

                const [mapping] = await db
                    .select()
                    .from(legacyMappings)
                    .where(eq(legacyMappings.id, legacyId))
                    .limit(1);

                if (!mapping)
                    throw new AppError(
                        "Legacy mapping not found",
                        404,
                        "MAPPING_NOT_FOUND",
                    );
                if (mapping.realUserId)
                    throw new AppError(
                        "Already claimed",
                        409,
                        "ALREADY_CLAIMED",
                    );

                await db
                    .update(legacyMappings)
                    .set({
                        adminRequested: true,
                        adminRequestedReason:
                            reason ||
                            `User ${user.email} requested manual migration`,
                    })
                    .where(eq(legacyMappings.id, mapping.id));

                return { requested: true };
            }),
    )

    // ─── Admin routes ───
    .use(
        new Elysia()
            .derive(adminDerive)
            .get("/status", async () => {
                const allMappings = await db
                    .select({
                        id: legacyMappings.id,
                        oldUserId: legacyMappings.oldUserId,
                        oldEmail: legacyMappings.oldEmail,
                        oldNickname: legacyMappings.oldNickname,
                        realUserId: legacyMappings.realUserId,
                        migratedAt: legacyMappings.migratedAt,
                        adminRequested: legacyMappings.adminRequested,
                        adminRequestedReason:
                            legacyMappings.adminRequestedReason,
                        placeholderNickname: users.nickname,
                    })
                    .from(legacyMappings)
                    .leftJoin(
                        users,
                        eq(legacyMappings.placeholderUserId, users.id),
                    )
                    .orderBy(legacyMappings.oldUserId);

                const total = allMappings.length;
                const claimed = allMappings.filter((m) => m.realUserId).length;
                const pending = allMappings.filter(
                    (m) => m.adminRequested && !m.realUserId,
                ).length;

                return { total, claimed, pending, mappings: allMappings };
            })
            .post("/admin-approve", async ({ body }) => {
                const { legacyId, userId } = body as {
                    legacyId: string;
                    userId: string;
                };
                if (!legacyId || !userId)
                    throw new AppError(
                        "Legacy ID and user ID are required",
                        400,
                        "IDS_REQUIRED",
                    );

                const [mapping] = await db
                    .select()
                    .from(legacyMappings)
                    .where(eq(legacyMappings.id, legacyId))
                    .limit(1);

                if (!mapping)
                    throw new AppError(
                        "Legacy mapping not found",
                        404,
                        "MAPPING_NOT_FOUND",
                    );
                if (mapping.realUserId)
                    throw new AppError(
                        "Already claimed",
                        409,
                        "ALREADY_CLAIMED",
                    );

                const [realUser] = await db
                    .select()
                    .from(users)
                    .where(eq(users.id, userId))
                    .limit(1);
                if (!realUser)
                    throw new AppError("User not found", 404, "USER_NOT_FOUND");

                return await executeMerge(
                    mapping.placeholderUserId as string,
                    userId,
                    mapping.id,
                );
            }),
    );

// ─── Core merge logic ───
async function executeMerge(
    placeholderId: string,
    realUserId: string,
    mappingId: string,
) {
    // Run the whole merge in a single transaction. If any step fails (in
    // particular the final DELETE on the placeholder user, which trips
    // audit_log FK constraints), every prior statement — including the
    // `users.verified = true` set on the real user — rolls back. Without
    // this, a failed merge silently grants verified=true to the attacker
    // while returning HTTP 500 to the caller.
    return await db.transaction(async (tx) => {
        // 1. Reassign worker registrations
        await tx
            .update(workerRegistrations)
            .set({ userId: realUserId })
            .where(eq(workerRegistrations.userId, placeholderId));

        // 2. Reassign comments
        await tx
            .update(comments)
            .set({ userId: realUserId })
            .where(eq(comments.userId, placeholderId));

        // 3. Reassign pub team memberships
        await tx
            .update(pubTeamMembers)
            .set({ userId: realUserId })
            .where(eq(pubTeamMembers.userId, placeholderId));

        // 4. Reassign guest registrations
        await tx
            .update(guestRegistrations)
            .set({ reporterId: realUserId })
            .where(eq(guestRegistrations.reporterId, placeholderId));

        // 5. Reassign tickets
        await tx
            .update(tickets)
            .set({ userId: realUserId })
            .where(eq(tickets.userId, placeholderId));

        // 6. Reassign educations
        await tx
            .update(userEducations)
            .set({ userId: realUserId })
            .where(eq(userEducations.userId, placeholderId));

        // Count affected rows
        const [workerCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(workerRegistrations)
            .where(eq(workerRegistrations.userId, realUserId));
        const [commentCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(comments)
            .where(eq(comments.userId, realUserId));
        const [teamCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(pubTeamMembers)
            .where(eq(pubTeamMembers.userId, realUserId));
        const [ticketCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(tickets)
            .where(eq(tickets.userId, realUserId));
        const [guestCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(guestRegistrations)
            .where(eq(guestRegistrations.reporterId, realUserId));

        // 7. Transfer data from placeholder to real user (if real user hasn't set them)
        const [placeholder] = await tx
            .select()
            .from(users)
            .where(eq(users.id, placeholderId))
            .limit(1);
        const [realUser] = await tx
            .select()
            .from(users)
            .where(eq(users.id, realUserId))
            .limit(1);

        if (placeholder && realUser) {
            const updates: Partial<typeof users.$inferInsert> = {};
            if (!realUser.nickname && placeholder.nickname)
                updates.nickname = placeholder.nickname;
            if (!realUser.name && placeholder.name)
                updates.name = placeholder.name;
            if (!realUser.profilePic && placeholder.profilePic)
                updates.profilePic = placeholder.profilePic;

            updates.verified = true;

            if (Object.keys(updates).length > 0) {
                await tx
                    .update(users)
                    .set(updates)
                    .where(eq(users.id, realUserId));
            }
        }

        // 8. Update legacy mapping (clears the migration token)
        await tx
            .update(legacyMappings)
            .set({
                realUserId,
                migratedAt: new Date(),
                migrationToken: null,
                migrationTokenExpiry: null,
                adminRequested: false,
            })
            .where(eq(legacyMappings.id, mappingId));

        // 9. Delete the placeholder user. If this fails on audit_log FK
        // (restrict), the transaction rolls back atomically — no silent
        // verified=true side effect.
        await tx.delete(users).where(eq(users.id, placeholderId));

        return {
            success: true,
            stats: {
                workerRegistrations: workerCount?.count ?? 0,
                comments: commentCount?.count ?? 0,
                teamMemberships: teamCount?.count ?? 0,
                tickets: ticketCount?.count ?? 0,
                guestRegistrations: guestCount?.count ?? 0,
            },
        };
    });
}
