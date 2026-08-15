// src/api/routes/profiles.ts

import { and, eq, ilike, ne, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { sessions, users } from "../../db/schema";
import { extractSessionToken } from "../../utils/cookies";
import { parseDob } from "../../utils/dob";
import { isStrongPassword } from "../../utils/validation";
import { authDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

const DOB_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export const profileRoutes = new Elysia({ prefix: "/profiles" })
    .derive(authDerive)
    .get("/me/birth-date", async ({ user }) => {
        // Used by <GuestManager> to fetch the reporter's date of birth
        // on demand when the guest modal opens. Plaintext — kept out of
        // the SSR payload so DOB never ships in HTML.
        const [row] = await db
            .select({ birthDate: users.birthDate })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);
        return { birthDate: row?.birthDate ?? null };
    })
    .get("/me", async ({ user }) => {
        const result = await db
            .select({
                id: users.id,
                email: users.email,
                nickname: users.nickname,
                name: users.name,
                profilePic: users.profilePic,
                description: users.description,
                birthDate: users.birthDate,
                emailVerified: users.emailVerified,
                verified: users.verified,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);

        if (result.length === 0) {
            throw new AppError("User not found", 404, "USER_NOT_FOUND");
        }

        return result[0];
    })
    .put(
        "/me",
        async ({ body, user }) => {
            const updateData: Partial<typeof users.$inferInsert> = {
                updatedAt: new Date(),
            };
            if (body.nickname !== undefined)
                updateData.nickname = body.nickname;
            if (body.name !== undefined) updateData.name = body.name;
            if (body.description !== undefined)
                updateData.description = body.description;

            const [updated] = await db
                .update(users)
                .set(updateData)
                .where(eq(users.id, user.id))
                .returning();

            return {
                id: updated.id,
                email: updated.email,
                nickname: updated.nickname,
                name: updated.name,
                profilePic: updated.profilePic,
                description: updated.description,
                role: updated.role,
            };
        },
        {
            body: t.Object({
                nickname: t.Optional(t.Nullable(t.String())),
                name: t.Optional(t.Nullable(t.String())),
                description: t.Optional(t.Nullable(t.String())),
            }),
        },
    )
    .put(
        "/me/birth-date",
        async ({ body, user }) => {
            const parsed = parseDob(body.birthDate);
            if (parsed === null) {
                throw new AppError("Invalid date of birth", 400, "INVALID_DOB");
            }

            // DOB is freely settable — no uniqueness check, no
            // identity proof (it's not identity).
            await db
                .update(users)
                .set({ birthDate: parsed, updatedAt: new Date() })
                .where(eq(users.id, user.id));

            return { birthDate: parsed };
        },
        {
            body: t.Object({
                birthDate: t.String({ pattern: DOB_PATTERN }),
            }),
        },
    )
    .put(
        "/me/password",
        async ({ body, user, request }) => {
            const result = await db
                .select({ passwordHash: users.passwordHash })
                .from(users)
                .where(eq(users.id, user.id))
                .limit(1);

            if (result.length === 0 || !result[0].passwordHash) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            const valid = await Bun.password.verify(
                body.currentPassword,
                result[0].passwordHash,
                "bcrypt",
            );
            if (!valid) {
                throw new AppError(
                    "Current password is incorrect",
                    400,
                    "WRONG_PASSWORD",
                );
            }

            if (!isStrongPassword(body.newPassword)) {
                throw new AppError(
                    "Password must be at least 8 characters with uppercase, lowercase, and a digit",
                    400,
                    "WEAK_PASSWORD",
                );
            }

            const newHash = await Bun.password.hash(body.newPassword, "bcrypt");
            await db
                .update(users)
                .set({ passwordHash: newHash, updatedAt: new Date() })
                .where(eq(users.id, user.id));

            // Invalidate every other session for this user. The current
            // session is preserved so the caller stays logged in; other
            // devices are forced to re-authenticate with the new password.
            const currentToken = extractSessionToken(request);
            if (currentToken) {
                await db
                    .delete(sessions)
                    .where(
                        and(
                            eq(sessions.userId, user.id),
                            ne(sessions.token, currentToken),
                        ),
                    );
            } else {
                // No current session token (shouldn't happen since this
                // endpoint is auth-gated, but fail safely).
                await db.delete(sessions).where(eq(sessions.userId, user.id));
            }

            return { success: true };
        },
        {
            body: t.Object({
                currentPassword: t.String(),
                newPassword: t.String(),
            }),
        },
    )
    .get(
        "/search/:query",
        async ({ params, query }) => {
            const limit = parseInt(query?.limit ?? "20", 10);
            const searchTerm = `%${params.query}%`;

            const result = await db
                .select({
                    id: users.id,
                    nickname: users.nickname,
                    name: users.name,
                    profilePic: users.profilePic,
                    role: users.role,
                })
                .from(users)
                .where(
                    or(
                        ilike(users.name, searchTerm),
                        ilike(users.nickname, searchTerm),
                    ),
                )
                .limit(limit);

            return result;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
            }),
        },
    )
    .get("/:id", async ({ params }) => {
        const result = await db
            .select({
                id: users.id,
                nickname: users.nickname,
                name: users.name,
                profilePic: users.profilePic,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, params.id))
            .limit(1);

        if (result.length === 0) {
            throw new AppError("User not found", 404, "USER_NOT_FOUND");
        }

        return result[0];
    });
