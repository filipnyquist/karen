// src/api/routes/superadminUsers.ts
//
// Superadmin-only mutations on user accounts. Mounted from `adminRoutes`
// so it inherits the `/admin` prefix and the audit-log tier boundary;
// plain admins see 403 here.
//
// Routes exposed:
//   - PUT    /api/admin/users/:id/password  — full password reset
//   - DELETE /api/admin/users/:id           — hard delete the user

import { eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
    auditLog,
    events,
    invitations,
    legacyMappings,
    pubTeams,
    sessions,
    userEducations,
    users,
} from "../../db/schema";
import { hashPassword as defaultHashPassword } from "../../utils/password";
import { isStrongPassword } from "../../utils/validation";
import { superadminDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

/**
 * Fixed zero-UUID sentinel that absorbs FK reassignments when a
 * real user is hard-deleted. The row is seeded at the bottom of
 * `src/db/seed.ts` and `src/db/seed-test.ts`, plus an idempotent
 * migration (`src/db/migrations/0005_tombstone_user.sql`). A
 * defensive existence check at the top of `deleteUser` throws
 * TOMBSTONE_NOT_FOUND as a final safety net.
 */
export const TOMBSTONE_ID = "00000000-0000-0000-0000-000000000000";

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

/**
 * Hard-delete a user. Behavior:
 *
 *   1. Reject self-delete (400 CANNOT_DELETE_SELF).
 *   2. Reject when the target is the last superadmin in the system
 *      (400 CANNOT_DELETE_LAST_SUPERADMIN). Deleting your only
 *      superadmin would lock out the recovery path.
 *   3. Verify the tombstone row exists; if not, throw a 500 with
 *      TOMBSTONE_NOT_FOUND so a half-migrated DB fails loudly
 *      instead of crashing on a FK violation deep inside the tx.
 *   4. In a single tx, point every non-cascading FK that touches the
 *      target at the tombstone, drop the user row, then best-effort
 *      write the audit row targeting the tombstone. If audit fails,
 *      the user is still deleted — non-blocking, mirrors
 *      setUserPassword's pattern.
 *
 * The six reassignments cover every NO ACTION / RESTRICT FK in the
 * schema that targets users(id). CASCADE columns (sessions,
 * verificationPins, password_reset_tokens, userEducations.userId,
 * workerRegistrations, guestRegistrations, comments, tickets,
 * pub_team_members) drop themselves when the user row is deleted,
 * and SET NULL columns (legacyMappings.placeholderUserId,
 * invitations.acceptedByUserId) go null with no extra work.
 */
export interface DeleteUserTxDeps {
    reassignAuditActor: (fromId: string, toId: string) => Promise<void>;
    reassignEducationVerifier: (fromId: string, toId: string) => Promise<void>;
    reassignInvitedBy: (fromId: string, toId: string) => Promise<void>;
    reassignEventCreator: (fromId: string, toId: string) => Promise<void>;
    reassignPubTeamCreator: (fromId: string, toId: string) => Promise<void>;
    reassignLegacyRealUser: (fromId: string, toId: string) => Promise<void>;
    deleteUser: (id: string) => Promise<void>;
    recordAudit: (
        actorId: string,
        tombstoneId: string,
        payload: {
            deletedUserId: string;
            email: string;
            role: string;
            nickname: string | null;
        },
    ) => Promise<void>;
}

export interface DeleteUserDeps {
    /** Returns a minimal projection of the user. Used for the
     *  self-delete check and the audit payload. Must return the
     *  identity fields even when the tombstone is the lookup target
     *  (so the safety-net check can distinguish "tombstone missing"
     *  from "user missing"). */
    findUser: (id: string) => Promise<{
        id: string;
        email: string;
        role: string;
        nickname: string | null;
    } | null>;
    countSuperadmins: () => Promise<number>;
    withTransaction: (
        work: (tx: DeleteUserTxDeps) => Promise<void>,
    ) => Promise<void>;
}

export async function deleteUser(
    params: { id: string },
    actor: { id: string },
    deps: DeleteUserDeps,
): Promise<{ success: true }> {
    if (params.id === actor.id) {
        throw new AppError(
            "You cannot delete your own account",
            400,
            "CANNOT_DELETE_SELF",
        );
    }
    if (params.id === TOMBSTONE_ID) {
        // Defensive: a fat-fingered admin / curl request could send
        // the tombstone UUID. Returning 400 is friendlier than 500.
        throw new AppError(
            "This user is the deleted-users system account and cannot be deleted",
            400,
            "CANNOT_DELETE_TOMBSTONE",
        );
    }

    const target = await deps.findUser(params.id);
    if (!target) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    if (target.role === "superadmin") {
        // Role check first, count check second. A non-last superadmin
        // can still be removed when the deployment runs multiple.
        const total = await deps.countSuperadmins();
        if (total <= 1) {
            throw new AppError(
                "Cannot delete the last superadmin",
                400,
                "CANNOT_DELETE_LAST_SUPERADMIN",
            );
        }
    }

    // Layer-4 safety net: the three seeding paths (migration 0005 +
    // prod seed + test seed) should always have inserted the
    // tombstone. A missing tombstone means the operator skipped
    // every seeding step; surface that with a clear, actionable
    // error instead of letting the tx blow up on a FK halfway
    // through the reassignments.
    const tombstone = await deps.findUser(TOMBSTONE_ID);
    if (!tombstone) {
        throw new AppError(
            "Tombstone user not found — run migrations and reseed before retrying",
            500,
            "TOMBSTONE_NOT_FOUND",
        );
    }

    await deps.withTransaction(async (tx) => {
        await tx.reassignAuditActor(target.id, TOMBSTONE_ID);
        await tx.reassignEducationVerifier(target.id, TOMBSTONE_ID);
        await tx.reassignInvitedBy(target.id, TOMBSTONE_ID);
        await tx.reassignEventCreator(target.id, TOMBSTONE_ID);
        await tx.reassignPubTeamCreator(target.id, TOMBSTONE_ID);
        await tx.reassignLegacyRealUser(target.id, TOMBSTONE_ID);
        await tx.deleteUser(target.id);
        // Best-effort audit: a failed insert (lock wait, FK drift)
        // must not roll back the deletion. matches setUserPassword's
        // contract where the user-facing op wins.
        await tx.recordAudit(actor.id, TOMBSTONE_ID, {
            deletedUserId: target.id,
            email: target.email,
            role: target.role,
            nickname: target.nickname,
        });
    });

    return { success: true };
}

const deleteUserDefaultDeps: DeleteUserDeps = {
    findUser: async (id) => {
        const [row] = await db
            .select({
                id: users.id,
                email: users.email,
                role: users.role,
                nickname: users.nickname,
            })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
        return row ?? null;
    },
    countSuperadmins: async () => {
        const [row] = await db
            .select({
                count: sql<number>`count(*)::int`,
            })
            .from(users)
            .where(eq(users.role, "superadmin"));
        return row?.count ?? 0;
    },
    withTransaction: async (work) => {
        await db.transaction(async (tx) => {
            await work({
                reassignAuditActor: async (fromId, toId) => {
                    await tx
                        .update(auditLog)
                        .set({ actorId: toId })
                        .where(eq(auditLog.actorId, fromId));
                },
                reassignEducationVerifier: async (fromId, toId) => {
                    await tx
                        .update(userEducations)
                        .set({ verifiedBy: toId })
                        .where(eq(userEducations.verifiedBy, fromId));
                },
                reassignInvitedBy: async (fromId, toId) => {
                    await tx
                        .update(invitations)
                        .set({ invitedBy: toId })
                        .where(eq(invitations.invitedBy, fromId));
                },
                reassignEventCreator: async (fromId, toId) => {
                    await tx
                        .update(events)
                        .set({ createdBy: toId })
                        .where(eq(events.createdBy, fromId));
                },
                reassignPubTeamCreator: async (fromId, toId) => {
                    await tx
                        .update(pubTeams)
                        .set({ createdBy: toId })
                        .where(eq(pubTeams.createdBy, fromId));
                },
                reassignLegacyRealUser: async (fromId, toId) => {
                    await tx
                        .update(legacyMappings)
                        .set({ realUserId: toId })
                        .where(eq(legacyMappings.realUserId, fromId));
                },
                deleteUser: async (id) => {
                    await tx.delete(users).where(eq(users.id, id));
                },
                recordAudit: async (actorId, tombstoneId, payload) => {
                    try {
                        await tx.insert(auditLog).values({
                            actorId,
                            action: "user.delete",
                            // audit_log.target_user_id is intentionally
                            // not a FK (see schema.ts), so pointing at
                            // the tombstone is safe.
                            targetUserId: tombstoneId,
                            oldValue: JSON.stringify(payload),
                            newValue: JSON.stringify({
                                reassignedTo: TOMBSTONE_ID,
                            }),
                        });
                    } catch (err) {
                        console.warn(
                            `[deleteUser] audit insert failed (non-fatal): actor=${actorId} target was ${payload.deletedUserId}`,
                            err,
                        );
                    }
                },
            });
        });
    },
};

// Mounted inside `adminRoutes` (prefix `/admin`), so this subapp uses no
// extra prefix — the resulting path is `/api/admin/users/:id/password`,
// not `/api/admin/admin/users/:id/password`. The `superadminDerive` here
// still gates the route above whatever derive chain `adminRoutes`
// inherited.
export const superadminUserRoutes = new Elysia()
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
    )
    .delete(
        "/users/:id",
        async ({ params, user: actor }) =>
            deleteUser(params as { id: string }, actor, deleteUserDefaultDeps),
        {
            params: t.Object({ id: t.String({ format: "uuid" }) }),
        },
    );
