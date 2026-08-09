// src/lib/guards.ts
//
// Page-level auth gates. Each helper either returns the authenticated
// user (the common case) or returns the `Response` from `Astro.redirect`
// when the caller is not allowed. The page handles both cases:
//
//   const guard = requireAdmin(Astro);
//   if (guard instanceof Response) return guard;
//   const currentUser = guard;
//
// This replaces the 12+ copies of:
//   if (!currentUser || !isAdmin(currentUser.role)) {
//     return Astro.redirect("/");
//   }
//
// Variants:
//   - requireAuth(Astro): any logged-in user
//   - requireAdmin(Astro): admin or superadmin
//   - requireSuperadmin(Astro): only superadmin
//   - requireResponsibleOrAdmin(Astro, eventIdParam = "id"):
//     site admin, superadmin, or the event's responsible user

import type { AstroGlobal } from "astro";
import {
    type AuthUser,
    isAdmin as roleIsAdmin,
    isSuperadmin as roleIsSuperadmin,
} from "../api/middleware/auth";
import { isResponsibleOrAdmin } from "../services/report-auth";

/** Redirect target for unauthenticated viewers. */
const LOGIN_REDIRECT = "/login";

/** Redirect target for logged-in-but-not-allowed viewers. */
const HOME_REDIRECT = "/";

/** A helper returned one of: an AuthUser (allowed) or a Response (redirect). */
export type GuardResult = AuthUser | Response;

/**
 * Require any logged-in user. If anonymous, redirect to /login.
 * Otherwise returns the user.
 */
export function requireAuth(astro: AstroGlobal): GuardResult {
    const user = astro.locals.user;
    if (!user) return astro.redirect(LOGIN_REDIRECT);
    return user;
}

/**
 * Require an admin or superadmin. Anonymous users get redirected to
 * /login; logged-in non-admins get redirected to /. Returns the user
 * on success.
 */
export function requireAdmin(astro: AstroGlobal): GuardResult {
    const user = requireAuth(astro);
    if (user instanceof Response) return user;
    if (!roleIsAdmin(user.role)) return astro.redirect(HOME_REDIRECT);
    return user;
}

/**
 * Require a superadmin. Non-superadmins get redirected to /. Returns
 * the user on success.
 */
export function requireSuperadmin(astro: AstroGlobal): GuardResult {
    const user = requireAuth(astro);
    if (user instanceof Response) return user;
    if (!roleIsSuperadmin(user.role)) return astro.redirect(HOME_REDIRECT);
    return user;
}

/**
 * Require site admin, superadmin, or the event's responsible user.
 * The `eventIdParam` defaults to "id" — match the param name used in
 * the page's dynamic segment (e.g. `[id].astro`).
 */
export async function requireResponsibleOrAdmin(
    astro: AstroGlobal,
    eventIdParam = "id",
): Promise<GuardResult> {
    const user = requireAuth(astro);
    if (user instanceof Response) return user;
    const eventId = (astro.params as Record<string, string>)[eventIdParam];
    if (!eventId) {
        // No event id in scope (e.g. listing pages) — fall back to admin
        // check; the responsible half only applies to event-scoped pages.
        if (!roleIsAdmin(user.role)) return astro.redirect(HOME_REDIRECT);
        return user;
    }
    if (await isResponsibleOrAdmin(user.id, user.role, eventId)) {
        return user;
    }
    return astro.redirect(HOME_REDIRECT);
}
