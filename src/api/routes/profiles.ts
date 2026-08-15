// src/api/routes/profiles.ts

import { and, eq, ilike, ne, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { sessions, users } from "../../db/schema";
import { decrypt, encrypt, hashSsn } from "../../lib/encryption";
import { parseSsn } from "../../lib/ssn";
import { extractSessionToken } from "../../utils/cookies";
import { isStrongPassword } from "../../utils/validation";
import { authDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const profileRoutes = new Elysia({ prefix: "/profiles" })
    .derive(authDerive)
    .get("/me/ssn", async ({ user }) => {
        // Returns the current user's own SSN, decrypted. Used by
        // <GuestManager> to fetch the reporter's SSN on demand when the
        // guest modal opens — kept out of the SSR payload so the
        // decrypted personnummer never ships in HTML.
        const [row] = await db
            .select({ ssn: users.ssn })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);
        return { ssn: row?.ssn ? await decrypt(row.ssn) : null };
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
                ssn: users.ssn,
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

        // Decrypt in place — callers get the readable personnummer, never
        // the stored ciphertext.
        const { ssn, ...rest } = result[0];
        return { ...rest, ssn: ssn ? await decrypt(ssn) : null };
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
        "/me/ssn",
        async ({ body, user }) => {
            const parsed = parseSsn(body.ssn);
            if (parsed.normalized === "") {
                throw new AppError("SSN cannot be empty", 400, "SSN_REQUIRED");
            }

            const ssnHash = await hashSsn(parsed.normalized);

            // Guard the partial unique index with a friendly error rather
            // than letting the constraint surface as a 500.
            const existing = await db
                .select({ id: users.id })
                .from(users)
                .where(and(eq(users.ssnHash, ssnHash), ne(users.id, user.id)))
                .limit(1);
            if (existing.length > 0) {
                throw new AppError(
                    "That personnummer is already registered to another account",
                    409,
                    "SSN_ALREADY_REGISTERED",
                );
            }

            await db
                .update(users)
                .set({
                    ssn: await encrypt(parsed.display),
                    ssnHash,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));

            // Echo back the readable value only — never the ciphertext.
            return { ssn: parsed.display, kind: parsed.kind };
        },
        {
            body: t.Object({
                ssn: t.String({ minLength: 1 }),
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
