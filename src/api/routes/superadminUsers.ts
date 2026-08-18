// src/api/routes/superadminUsers.ts
//
// Superadmin-only mutations on user accounts. Mounted from `adminRoutes`
// so it inherits the `/admin` prefix and the audit-log tier boundary;
// plain admins see 403 here.
//
// Currently exposes one route: PUT /api/admin/users/:id/password — a full
// password reset that hash-rotates the target user's password and wipes
// every session for that user. Unlike the self-service `PUT
// /api/profiles/me/password` (which preserves the caller's session),
// this forced reset logs the target out everywhere because the
// superadmin has no way to identify the target's "current" session and
// a stolen session token would otherwise remain valid after a reset.

import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { auditLog, sessions, users } from "../../db/schema";
import { hashPassword as defaultHashPassword } from "../../utils/password";
import { isStrongPassword } from "../../utils/validation";
import { superadminDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

/**
 * Inside-transaction dependencies. The reset runs `updatePassword`,
 * `deleteSessions`, and `recordAudit` inside a single transaction so a
 * mid-flow failure can't leave the user with a new password but live
 * sessions (or vice versa).
 */
export interface SetPasswordTxDeps {
    updatePassword: (id: string, hash: string) => Promise<void>;
    deleteSessions: (userId: string) => Promise<void>;
    /**
     * Best-effort: a failed audit insert should NOT roll back the
     * password change. The default implementation catches errors and
     * logs them so the user-facing outcome (password rotated, sessions
     * wiped) always succeeds. Tests can override for stricter assertions.
     */
    recordAudit: (
        actorId: string,
        targetUserId: string,
        newValue: { via: string },
    ) => Promise<void>;
}

export interface SetPasswordDeps {
    findUser: (id: string) => Promise<{ id: string } | null>;
    hashPassword: (plain: string) => Promise<string>;
    withTransaction: (
        work: (tx: SetPasswordTxDeps) => Promise<void>,
    ) => Promise<void>;
}

/**
 * Validates input, hash-rotates the target user's password, and wipes
 * every session for them. Forces re-login on every device.
 *
 * Throws `AppError` with the appropriate status code on validation
 * failures or missing user. Never returns on rejection.
 */
export async function setUserPassword(
    params: { id: string },
    body: { password: string; confirmPassword: string },
    actor: { id: string },
    deps: SetPasswordDeps,
): Promise<{ success: true }> {
    // Step-level logging is the primary diagnostic for the production
    // 500 we couldn't reproduce locally. Combined with the
    // `console.error("Unhandled error:", error)` in the error plugin,
    // the next failure prints exactly which step blew up.
    const log = (step: string): void =>
        console.log(
            `[setUserPassword] step=${step} actor=${actor.id} target=${params.id}`,
        );

    log("validate:start");
    if (body.password !== body.confirmPassword) {
        throw new AppError("Passwords do not match", 400, "PASSWORD_MISMATCH");
    }
    if (!isStrongPassword(body.password)) {
        throw new AppError(
            "Password must be at least 8 characters with uppercase, lowercase, and a digit",
            400,
            "WEAK_PASSWORD",
        );
    }
    log("validate:ok");

    log("findUser");
    const existing = await deps.findUser(params.id);
    if (!existing) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    log("hashPassword");
    const newHash = await deps.hashPassword(body.password);

    // Force every device to re-authenticate. A superadmin-set
    // password is a recovery action: leaving any active session
    // would let an attacker who already has a stolen token keep
    // it. The superadmin's own session (if any) on this user is
    // also wiped — that is intentional.
    log("withTransaction");
    await deps.withTransaction(async (tx) => {
        await tx.updatePassword(params.id, newHash);
        await tx.deleteSessions(params.id);
        await tx.recordAudit(actor.id, params.id, { via: "superadmin" });
    });

    log("done");
    return { success: true };
}

const defaultDeps: SetPasswordDeps = {
    findUser: async (id) => {
        const [row] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
        return row ?? null;
    },
    hashPassword: async (plain) => defaultHashPassword(plain),
    withTransaction: async (work) => {
        await db.transaction(async (tx) => {
            await work({
                updatePassword: async (id, hash) => {
                    await tx
                        .update(users)
                        .set({ passwordHash: hash, updatedAt: new Date() })
                        .where(eq(users.id, id));
                },
                deleteSessions: async (userId) => {
                    await tx
                        .delete(sessions)
                        .where(eq(sessions.userId, userId));
                },
                recordAudit: async (actorId, targetUserId, newValue) => {
                    // Best-effort: a transient audit-log failure
                    // (FK drift, lock wait, etc.) must not 500 the
                    // user. Catching here means the tx callback
                    // resolves normally, and Drizzle commits the
                    // user-facing ops that already succeeded.
                    try {
                        await tx.insert(auditLog).values({
                            actorId,
                            action: "user.password.set",
                            targetUserId,
                            oldValue: null,
                            newValue: JSON.stringify(newValue),
                        });
                    } catch (err) {
                        console.warn(
                            `[setUserPassword] audit insert failed (non-fatal): actor=${actorId} target=${targetUserId}`,
                            err,
                        );
                    }
                },
            });
        });
    },
};

export const superadminUserRoutes = new Elysia({ prefix: "/admin" })
    .derive(superadminDerive)
    .put(
        "/users/:id/password",
        async ({ body, params, user: actor }) =>
            setUserPassword(
                params as { id: string },
                body as { password: string; confirmPassword: string },
                actor,
                defaultDeps,
            ),
        {
            params: t.Object({ id: t.String({ format: "uuid" }) }),
            body: t.Object({
                password: t.String({ minLength: 8 }),
                confirmPassword: t.String({ minLength: 8 }),
            }),
        },
    );
