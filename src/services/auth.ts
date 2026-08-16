// src/services/auth.ts

import { and, eq, lt } from "drizzle-orm";
import type { AuthUser, Role } from "../api/middleware/auth";
import { AppError } from "../api/middleware/error";
import { config } from "../config";
import { db } from "../db";
import { sessions, users, verificationPins } from "../db/schema";
import {
    generateSessionToken,
    generateToken,
    isBthEmail,
    isStrongPassword,
    isValidEmail,
} from "../utils/validation";
import {
    type Lang,
    sendStudentVerificationEmail,
    sendVerificationEmail,
} from "./email";

export type { AuthUser, Role };

export async function createUser(
    email: string,
    password: string,
    name: string,
    nickname: string,
    lang: Lang = "sv",
): Promise<typeof users.$inferSelect> {
    // Normalise once at the top — `users.email` is case-sensitive at the
    // DB layer, so Test@x.com and test@x.com would otherwise land as
    // two distinct accounts. Every downstream use (lookup, insert,
    // send, verification row) takes the lowercased value.
    email = email.trim().toLowerCase();
    if (!isValidEmail(email))
        throw new AppError("Invalid email", 400, "INVALID_EMAIL");
    if (isBthEmail(email))
        throw new AppError(
            "BTH email not allowed for registration",
            400,
            "BTH_BLOCKED",
        );
    if (!isStrongPassword(password))
        throw new AppError(
            "Password must be at least 8 characters with uppercase, lowercase, and a digit",
            400,
            "WEAK_PASSWORD",
        );

    const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    if (existing.length > 0)
        throw new AppError("Email already registered", 409, "EMAIL_TAKEN");

    const passwordHash = await Bun.password.hash(password, "bcrypt");
    const [user] = await db
        .insert(users)
        .values({ email, passwordHash, name, nickname })
        .returning();

    // Create email verification token
    const verifyToken = generateToken();
    await sendVerificationEmail({
        to: email,
        baseUrl: config.baseUrl,
        token: verifyToken,
        lang,
    });

    await db.insert(verificationPins).values({
        userId: user.id,
        email,
        pin: verifyToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return user;
}

export async function verifyEmail(token: string): Promise<true> {
    const result = await db
        .select()
        .from(verificationPins)
        .where(
            and(
                eq(verificationPins.pin, token),
                eq(verificationPins.verified, false),
            ),
        )
        .limit(1);

    if (result.length === 0)
        throw new AppError(
            "Invalid or expired verification token",
            400,
            "INVALID_TOKEN",
        );
    if (new Date() > result[0].expiresAt)
        throw new AppError("Verification token expired", 400, "TOKEN_EXPIRED");

    await db
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, result[0].userId));
    await db
        .update(verificationPins)
        .set({ verified: true })
        .where(eq(verificationPins.id, result[0].id));

    return true;
}

export async function login(
    email: string,
    password: string,
): Promise<{
    token: string;
    expiresAt: Date;
    user: typeof users.$inferSelect;
}> {
    // Match the case-fold done at registration so a user can log in
    // regardless of how they typed their address at signup.
    email = email.trim().toLowerCase();
    const result = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    if (result.length === 0)
        throw new AppError(
            "Invalid email or password",
            401,
            "INVALID_CREDENTIALS",
        );

    const user = result[0];

    // Placeholder / legacy accounts have no password — they cannot log in.
    if (!user.passwordHash)
        throw new AppError(
            "Invalid email or password",
            401,
            "INVALID_CREDENTIALS",
        );

    const valid = await Bun.password.verify(
        password,
        user.passwordHash,
        "bcrypt",
    );
    if (!valid)
        throw new AppError(
            "Invalid email or password",
            401,
            "INVALID_CREDENTIALS",
        );
    if (!user.emailVerified)
        throw new AppError(
            "Please verify your email first",
            403,
            "EMAIL_NOT_VERIFIED",
        );

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionMaxAgeMs);

    // Clean up expired sessions for this user
    await db
        .delete(sessions)
        .where(
            and(
                eq(sessions.userId, user.id),
                lt(sessions.expiresAt, new Date()),
            ),
        );

    await db.insert(sessions).values({ userId: user.id, token, expiresAt });

    return { token, expiresAt, user };
}

export async function logout(token: string): Promise<true> {
    await db.delete(sessions).where(eq(sessions.token, token));
    return true;
}

/**
 * Issue a verification email to a logged-in user.
 *
 * Restricted to the user's own email address — sending a verification
 * code to a different address would let a logged-in attacker weaponize
 * the BTH-student verification flow.
 */
export async function requestVerification(
    userId: string,
    email: string,
    lang: Lang = "sv",
): Promise<true> {
    // Lowercase before the BTH-domain check so Foo@STUDENT.BTH.SE is
    // recognised as a BTH address. `users.email` is stored lowercase at
    // signup, so the equality compare below matches it exactly.
    email = email.trim().toLowerCase();
    if (!isBthEmail(email))
        throw new AppError(
            "Must be a @student.bth.se or @bthstudent.se email",
            400,
            "INVALID_EMAIL",
        );

    const [user] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");

    if (user.email.toLowerCase() !== email.toLowerCase())
        throw new AppError(
            "Email must match your account email",
            403,
            "EMAIL_MISMATCH",
        );

    const token = generateToken();
    await db.insert(verificationPins).values({
        userId,
        email,
        pin: token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await sendStudentVerificationEmail({
        to: email,
        baseUrl: config.baseUrl,
        token,
        lang,
    });
    return true;
}

export async function verifyStudentToken(token: string): Promise<true> {
    const result = await db
        .select()
        .from(verificationPins)
        .where(
            and(
                eq(verificationPins.pin, token),
                eq(verificationPins.verified, false),
            ),
        )
        .limit(1);

    if (result.length === 0)
        throw new AppError(
            "Invalid or expired verification link",
            400,
            "INVALID_TOKEN",
        );
    if (new Date() > result[0].expiresAt)
        throw new AppError("Verification link expired", 400, "TOKEN_EXPIRED");

    await db
        .update(users)
        .set({ verified: true })
        .where(eq(users.id, result[0].userId));
    await db
        .update(verificationPins)
        .set({ verified: true })
        .where(eq(verificationPins.id, result[0].id));

    return true;
}

// (The `getUserFromCookie` re-export was removed in Phase 2. Callers
// in src/api/routes/auth.ts now import `loadSessionUser` directly from
// `../middleware/auth`.)
