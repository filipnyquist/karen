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
import { sessions, users } from "../../db/schema";
import { recordAdminAction } from "../../services/auditLog";
import { isStrongPassword } from "../../utils/validation";
import { superadminDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export interface SetPasswordDeps {
    findUser: (id: string) => Promise<{ id: string } | null>;
    updatePassword: (id: string, hash: string) => Promise<void>;
    deleteSessions: (userId: string) => Promise<void>;
    recordAudit: (
        actorId: string,
        targetUserId: string,
        newValue: { via: string },
    ) => Promise<void>;
    hashPassword: (plain: string) => Promise<string>;
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

    const existing = await deps.findUser(params.id);
    if (!existing) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const newHash = await deps.hashPassword(body.password);
    await deps.updatePassword(params.id, newHash);

    // Force every device to re-authenticate. A superadmin-set
    // password is a recovery action: leaving any active session
    // would let an attacker who already has a stolen token keep
    // it. The superadmin's own session (if any) on this user is
    // also wiped — that is intentional.
    await deps.deleteSessions(params.id);

    await deps.recordAudit(actor.id, params.id, { via: "superadmin" });

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
    updatePassword: async (id, hash) => {
        await db
            .update(users)
            .set({ passwordHash: hash, updatedAt: new Date() })
            .where(eq(users.id, id));
    },
    deleteSessions: async (userId) => {
        await db.delete(sessions).where(eq(sessions.userId, userId));
    },
    recordAudit: async (actorId, targetUserId, newValue) => {
        await recordAdminAction(actorId, "user.password.set", targetUserId, {
            newValue,
        });
    },
    hashPassword: async (plain) => Bun.password.hash(plain, "bcrypt"),
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
