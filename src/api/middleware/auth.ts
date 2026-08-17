// src/api/middleware/auth.ts

import { and, eq } from "drizzle-orm";
import { config } from "../../config";
import { db } from "../../db";
import {
    educationTypes,
    sessions,
    userEducations,
    users,
    workerRegistrations,
} from "../../db/schema";
import { detectLanguage, t } from "../../i18n";
import { extractSessionToken } from "../../utils/cookies";
import { AppError } from "./error";

// Note: a historical `'responsible'` value was removed. The privilege
// to "be responsible" at an event is education-derived — see
// `assertCanRegisterAsResponsible` in `src/services/responsible-education.ts`.
export type Role = "user" | "admin" | "superadmin";

/** True if the role is `admin` OR `superadmin` (superadmin is a superset). */
export const isAdmin = (r: Role | string | null | undefined): boolean =>
    r === "admin" || r === "superadmin";

/** True only for the superadmin tier. */
export const isSuperadmin = (r: Role | string | null | undefined): boolean =>
    r === "superadmin";

export interface AuthUser {
    id: string;
    email: string;
    role: Role;
    verified: boolean | null;
    emailVerified: boolean | null;
    name: string | null;
    nickname: string | null;
    seenMigrationPrompt: boolean;
}

/**
 * Single source of truth for session lookup. Returns the AuthUser for the
 * active session, or null if the cookie is missing, invalid, or expired.
 *
 * Performs a rolling renewal (extending `expiresAt`) when the session has
 * lived past half its configured lifetime.
 */
export async function loadSessionUser(
    request: Request,
): Promise<AuthUser | null> {
    const token = extractSessionToken(request);
    if (!token) return null;

    const result = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.token, token), eq(sessions.userId, users.id)))
        .limit(1);

    if (result.length === 0) return null;

    const { session, user } = result[0];

    if (new Date() > session.expiresAt) {
        await db.delete(sessions).where(eq(sessions.token, token));
        return null;
    }

    // Rolling renewal
    const halfAge = config.sessionMaxAgeMs / 2;
    const age = Date.now() - session.createdAt.getTime();
    if (age > halfAge) {
        const newExpiry = new Date(Date.now() + config.sessionMaxAgeMs);
        await db
            .update(sessions)
            .set({ expiresAt: newExpiry })
            .where(eq(sessions.token, token));
    }

    return {
        id: user.id,
        email: user.email,
        role: user.role as Role,
        verified: user.verified,
        emailVerified: user.emailVerified,
        name: user.name,
        nickname: user.nickname,
        seenMigrationPrompt: user.seenMigrationPrompt,
    };
}

// (The legacy `getUserFromRequest` alias was removed in Phase 2 of the
// code-quality cleanup. All call sites in this repo now use
// `loadSessionUser` directly.)

// Derive functions - use directly on route Elysia instances via .derive(authDerive)
// e.g. new Elysia({ prefix: '/events' }).derive(authDerive).post(...)

/** Derive user from session cookie - throws 401 if not logged in */
export async function authDerive({
    request,
}: {
    request: Request;
}): Promise<{ user: AuthUser }> {
    const user = await loadSessionUser(request);
    if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
    return { user };
}

/** Derive user + require admin role (or superadmin — superset). */
export async function adminDerive({
    request,
}: {
    request: Request;
}): Promise<{ user: AuthUser }> {
    const user = await loadSessionUser(request);
    if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
    if (!isAdmin(user.role))
        throw new AppError("Admin access required", 403, "FORBIDDEN");
    return { user };
}

/** Derive user + require superadmin role (strictly above admin). */
export async function superadminDerive({
    request,
}: {
    request: Request;
}): Promise<{ user: AuthUser }> {
    const user = await loadSessionUser(request);
    if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
    if (!isSuperadmin(user.role))
        throw new AppError("Superadmin access required", 403, "FORBIDDEN");
    return { user };
}

/** Derive user + require verified */
export async function verifiedDerive({
    request,
}: {
    request: Request;
}): Promise<{ user: AuthUser }> {
    const user = await loadSessionUser(request);
    if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
    if (!user.verified) {
        const lang = detectLanguage(request);
        throw new AppError(
            t(lang)("auth.studentVerificationRequired"),
            403,
            "NOT_VERIFIED",
        );
    }
    return { user };
}

/** Create a derive function that requires admin OR responsible for the given event */
export function responsibleOrAdminDerive(eventIdParam: string = "id") {
    return async ({
        request,
        params,
    }: {
        request: Request;
        params: Record<string, string>;
    }): Promise<{ user: AuthUser }> => {
        const user = await loadSessionUser(request);
        if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
        if (isAdmin(user.role)) return { user };

        const responsibleEd = await db
            .select()
            .from(userEducations)
            .innerJoin(
                educationTypes,
                eq(userEducations.educationTypeId, educationTypes.id),
            )
            .where(
                and(
                    eq(userEducations.userId, user.id),
                    eq(educationTypes.name, "responsible"),
                ),
            )
            .limit(1);

        if (responsibleEd.length === 0) {
            throw new AppError(
                "Responsible education required",
                403,
                "FORBIDDEN",
            );
        }

        const edu = responsibleEd[0].user_educations;
        if (edu.expiresAt && new Date() > edu.expiresAt) {
            throw new AppError(
                "Responsible education expired",
                403,
                "EDUCATION_EXPIRED",
            );
        }

        const eventId = params[eventIdParam];
        const reg = await db
            .select()
            .from(workerRegistrations)
            .where(
                and(
                    eq(workerRegistrations.eventId, eventId),
                    eq(workerRegistrations.userId, user.id),
                    eq(workerRegistrations.responsible, true),
                ),
            )
            .limit(1);

        if (reg.length === 0) {
            throw new AppError(
                "Not a responsible for this event",
                403,
                "NOT_RESPONSIBLE",
            );
        }

        return { user };
    };
}
