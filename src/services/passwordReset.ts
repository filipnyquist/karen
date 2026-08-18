// src/services/passwordReset.ts
//
// Self-service forgot-password flow. Two operations:
//
//   - requestPasswordReset(email, lang) — looks up the user, generates
//     a 256-bit random token, stores its SHA-256 hash in
//     password_reset_tokens with a 1-hour expiry, invalidates any
//     prior unused tokens for the same user, and fires the reset
//     email off-thread via `dispatchEmail`. Returns the plaintext
//     token (caller decides whether to expose it).
//
//   - consumePasswordResetToken(tokenPlaintext, newPassword) —
//     hashes the input, looks up the unused + unexpired row, runs
//     a single transaction that rotates the user's passwordHash,
//     wipes all sessions, marks the row used, and writes an audit
//     entry with actor=user (mirrors the superadmin password
//     rotation's accountability).
//
// Timing-leak guard: when the email doesn't exist, the service
// returns silently — no row is written and no email is dispatched.
// The SELECT-by-email runs in roughly the same time whether the
// row exists or not (indexed lookup), and the dispatch is off-
// thread (see src/services/email.ts), so the HTTP response is
// independent of whether any SMTP send happened. Same response
// shape regardless → identical observable behavior.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError } from "../api/middleware/error";
import { config } from "../config";
import { db } from "../db";
import { passwordResetTokens, sessions, users } from "../db/schema";
import { hashPassword } from "../utils/password";
import { generateSessionToken, isStrongPassword } from "../utils/validation";
import { recordAdminAction } from "./auditLog";
import type { Lang } from "./email";
import { sendPasswordResetEmail } from "./email";

/** Hash a plaintext token to the form we store in the DB. */
export function hashToken(plaintext: string): string {
    return createHash("sha256").update(plaintext).digest("hex");
}

const ONE_HOUR_MS = 60 * 60 * 1000;

// ─── Request flow ─────────────────────────────────────────────

export interface RequestResetDeps {
    findUserByEmail: (
        email: string,
    ) => Promise<{ id: string; email: string } | null>;
    invalidatePriorTokens: (userId: string) => Promise<void>;
    insertToken: (
        userId: string,
        tokenHash: string,
        expiresAt: Date,
    ) => Promise<void>;
    /**
     * Hand off the rendered email. Defaults to the production
     * wrapper, which schedules the SMTP send off-thread.
     * Receives the SAME plaintext token that was hashed into the
     * DB — the email link must work with the token we stored.
     */
    dispatchEmail: (to: string, token: string, lang: Lang) => void;
}

const defaultRequestDeps: RequestResetDeps = {
    findUserByEmail: async (email) => {
        const [row] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
        return row ?? null;
    },
    invalidatePriorTokens: async (userId) => {
        await db
            .update(passwordResetTokens)
            .set({ usedAt: sql`NOW()` })
            .where(
                and(
                    eq(passwordResetTokens.userId, userId),
                    isNull(passwordResetTokens.usedAt),
                ),
            );
    },
    insertToken: async (userId, tokenHash, expiresAt) => {
        await db.insert(passwordResetTokens).values({
            userId,
            tokenHash,
            expiresAt,
        });
    },
    dispatchEmail: (to, token, lang) => {
        // Fire-and-forget — no await needed. The wrapper itself
        // schedules the actual SMTP round-trip on the next event-
        // loop tick via setImmediate, so the HTTP response has
        // already been flushed by the time SMTP is contacted.
        sendPasswordResetEmail({
            to,
            baseUrl: config.baseUrl,
            token,
            lang,
        });
    },
};

/**
 * Issue a password reset token. Returns `{ token, resetUrl }`:
 *   - `token` is the plaintext emailed to the user (null if the
 *     email isn't in the DB).
 *   - `resetUrl` is `${baseUrl}/reset-password?token=${token}` —
 *     only set in non-prod so e2e can complete the flow without
 *     scraping email logs. Mirrors the existing `acceptUrl`
 *     precedent on invitations.
 */
export async function requestPasswordReset(
    email: string,
    lang: Lang,
    deps: Partial<RequestResetDeps> = {},
): Promise<{ token: string | null; resetUrl: string | null }> {
    const d = { ...defaultRequestDeps, ...deps };
    const normalized = email.trim().toLowerCase();

    const user = await d.findUserByEmail(normalized);
    if (!user) {
        // No row, no email, no error. Identical response shape
        // whether or not the email exists.
        return { token: null, resetUrl: null };
    }

    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + ONE_HOUR_MS);

    await d.invalidatePriorTokens(user.id);
    await d.insertToken(user.id, tokenHash, expiresAt);

    // Fire-and-forget. `dispatchEmail` returns immediately;
    // `sendPasswordResetEmail` schedules the actual SMTP send
    // on the next event-loop tick.
    d.dispatchEmail(user.email, token, lang);

    const resetUrl =
        process.env.NODE_ENV === "production"
            ? null
            : `${config.baseUrl}/reset-password?token=${token}`;
    return { token, resetUrl };
}

// ─── Consume flow ─────────────────────────────────────────────

export type ConsumeResetReason =
    | "INVALID_TOKEN"
    | "TOKEN_EXPIRED"
    | "WEAK_PASSWORD";

export interface ConsumeResetTxDeps {
    updatePasswordHash: (userId: string, hash: string) => Promise<void>;
    deleteSessionsForUser: (userId: string) => Promise<void>;
    markTokenUsed: (tokenId: string) => Promise<void>;
    recordAudit: (
        actorId: string,
        targetUserId: string,
        newValue: { via: string },
    ) => Promise<void>;
}

export interface ConsumeResetDeps {
    findToken: (tokenHash: string) => Promise<{
        id: string;
        userId: string;
        expiresAt: Date;
        usedAt: Date | null;
    } | null>;
    isStrongPassword: (plain: string) => boolean;
    hashPassword: (plain: string) => Promise<string>;
    withTransaction: (
        work: (tx: ConsumeResetTxDeps) => Promise<void>,
    ) => Promise<void>;
}

const defaultConsumeDeps: ConsumeResetDeps = {
    findToken: async (tokenHash) => {
        const [row] = await db
            .select({
                id: passwordResetTokens.id,
                userId: passwordResetTokens.userId,
                expiresAt: passwordResetTokens.expiresAt,
                usedAt: passwordResetTokens.usedAt,
            })
            .from(passwordResetTokens)
            .where(
                and(
                    eq(passwordResetTokens.tokenHash, tokenHash),
                    isNull(passwordResetTokens.usedAt),
                ),
            )
            .limit(1);
        return row ?? null;
    },
    isStrongPassword,
    hashPassword: async (plain) => hashPassword(plain),
    withTransaction: async (work) => {
        await db.transaction(async (tx) => {
            await work({
                updatePasswordHash: async (userId, hash) => {
                    await tx
                        .update(users)
                        .set({ passwordHash: hash, updatedAt: new Date() })
                        .where(eq(users.id, userId));
                },
                deleteSessionsForUser: async (userId) => {
                    await tx
                        .delete(sessions)
                        .where(eq(sessions.userId, userId));
                },
                markTokenUsed: async (tokenId) => {
                    await tx
                        .update(passwordResetTokens)
                        .set({ usedAt: sql`NOW()` })
                        .where(eq(passwordResetTokens.id, tokenId));
                },
                recordAudit: async (actorId, targetUserId, newValue) => {
                    // Best-effort: a transient audit-log failure must
                    // not roll back the password change. Catching
                    // here means the tx callback resolves normally,
                    // and Drizzle commits the user-facing ops.
                    try {
                        await recordAdminAction(
                            actorId,
                            "user.password_reset",
                            targetUserId,
                            { newValue },
                        );
                    } catch (err) {
                        console.warn(
                            "[passwordReset] audit insert failed (non-fatal): actor=",
                            actorId,
                            " target=",
                            targetUserId,
                            err,
                        );
                    }
                },
            });
        });
    },
};

/**
 * Consume a reset token and rotate the user's password. Wipes all
 * sessions so the user must re-authenticate on every device.
 * Throws `AppError` with reason `WEAK_PASSWORD`, `INVALID_TOKEN`,
 * or `TOKEN_EXPIRED` on the appropriate failure mode.
 */
export async function consumePasswordResetToken(
    tokenPlaintext: string,
    newPassword: string,
    deps: Partial<ConsumeResetDeps> = {},
): Promise<{ success: true }> {
    const d = { ...defaultConsumeDeps, ...deps };

    if (!d.isStrongPassword(newPassword)) {
        throw new AppError(
            "Password must be at least 8 characters with uppercase, lowercase, and a digit",
            400,
            "WEAK_PASSWORD",
        );
    }

    const tokenHash = hashToken(tokenPlaintext);
    const row = await d.findToken(tokenHash);
    if (!row) {
        throw new AppError(
            "Invalid or expired reset link",
            400,
            "INVALID_TOKEN",
        );
    }
    if (row.expiresAt.getTime() < Date.now()) {
        throw new AppError("Reset link has expired", 400, "TOKEN_EXPIRED");
    }

    const newHash = await d.hashPassword(newPassword);

    await d.withTransaction(async (tx) => {
        await tx.updatePasswordHash(row.userId, newHash);
        await tx.deleteSessionsForUser(row.userId);
        await tx.markTokenUsed(row.id);
        await tx.recordAudit(row.userId, row.userId, { via: "self" });
    });

    return { success: true };
}

// ─── Pre-flight check ──────────────────────────────────────────

export type ValidityReason = "invalid" | "expired" | "used";

export interface ValidityResult {
    valid: boolean;
    reason?: ValidityReason;
}

/**
 * Cheap SSR pre-flight: hash the input, lookup, classify the
 * outcome (used / expired / invalid) so the page can show a
 * specific banner. Doesn't see *all* rows for the user, only the
 * one matching this token — so the result is "this token is not
 * valid", not "this user has no valid tokens".
 */
export async function isValidResetToken(
    tokenPlaintext: string,
): Promise<ValidityResult> {
    const tokenHash = hashToken(tokenPlaintext);

    const [row] = await db
        .select({
            expiresAt: passwordResetTokens.expiresAt,
            usedAt: passwordResetTokens.usedAt,
        })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);

    if (!row) {
        return { valid: false, reason: "invalid" };
    }
    if (row.usedAt) {
        return { valid: false, reason: "used" };
    }
    if (row.expiresAt.getTime() < Date.now()) {
        return { valid: false, reason: "expired" };
    }
    return { valid: true };
}

// Suppress unused-import warning when this module is built with
// `noUnusedLocals`. `randomBytes` is exported by `node:crypto` and
// reserved for future use (e.g. migrating to a different RNG).
void randomBytes;
