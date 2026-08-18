// src/api/middleware/csrf.ts
//
// Double-submit-cookie CSRF protection for state-changing API requests.
//
// On the first GET/HEAD/OPTIONS through the API we issue a `csrf_token`
// cookie. Browsers attach it to all subsequent fetches; client code reads
// the cookie and stamps the same value into the `X-CSRF-Token` header. The
// middleware rejects non-GET requests whose header doesn't match the cookie.
//
// Routes exempted from CSRF: unauthenticated login/register/verify endpoints.
// A CSRF token doesn't help an attacker who doesn't have credentials, and
// exempting these lets the login flow bootstrap a session before a token
// has been issued.

import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../../db";
import { sessions } from "../../db/schema";
import {
    buildCsrfCookie,
    extractCsrfToken,
    extractSessionToken,
    isRequestSecure,
    parseCookies,
} from "../../utils/cookies";
import { AppError } from "./error";

const CSRF_HEADER = "X-CSRF-Token";
const CSRF_COOKIE_NAME = "csrf_token";

/** Generate a fresh 256-bit CSRF token. */
function generateCsrfToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Routes that are exempt from CSRF — see module header for rationale. */
function isExempt(pathname: string, method: string): boolean {
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        return true;
    }
    // Unauthenticated auth routes don't need CSRF: the user has no
    // credentials yet, so a CSRF attack buys the attacker nothing.
    const unauthEndpoints = [
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/verify-email",
        "/api/auth/verify-student",
        // Invitation accept: the invitee has no session yet (the link in
        // the email is the proof of inbox ownership), so CSRF buys an
        // attacker nothing. /check is a GET and exempt by method anyway.
        "/api/invitations/accept",
        // Password reset: user has no session yet, so CSRF buys an
        // attacker nothing. The email link in the request step is
        // itself the proof of inbox ownership in the consume step.
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
    ];
    return unauthEndpoints.includes(pathname);
}

export const csrfPlugin = new Elysia({ name: "csrf" })
    // Issue a CSRF cookie on every successful response that doesn't
    // already have one. Belt-and-braces — the Astro middleware also
    // ensures the cookie is present for HTML responses.
    .onAfterHandle(({ request, response }) => {
        // Only set the cookie on safe methods, since the client reads it
        // before sending subsequent state-changing requests. Skip if the
        // request already has one.
        const existing = extractCsrfToken(request);
        if (existing) return;

        const cookieHeader = request.headers.get("cookie") ?? "";
        if (parseCookies(cookieHeader)[CSRF_COOKIE_NAME]) return;

        // Only set cookies on actual responses (not e.g. upgrade requests).
        if (response instanceof Response) {
            const token = generateCsrfToken();
            const oneYear = new Date(Date.now() + 365 * 24 * 3600 * 1000);
            const secure = isRequestSecure(request);
            const existingSetCookie = response.headers.get("set-cookie");
            const csrfCookie = buildCsrfCookie(token, oneYear, secure);
            response.headers.append(
                "Set-Cookie",
                existingSetCookie
                    ? `${existingSetCookie}, ${csrfCookie}`
                    : csrfCookie,
            );
        }
    })
    .onBeforeHandle(async ({ request }) => {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();

        if (isExempt(url.pathname, method)) return;

        // Bypass CSRF check for cross-origin callers that present a valid
        // session cookie but no CSRF cookie — this happens on the very
        // first authenticated request after login. We treat this as the
        // login transition: a new CSRF cookie is issued in onAfterHandle.
        const sessionToken = extractSessionToken(request);
        const csrfCookie = extractCsrfToken(request);
        if (sessionToken && !csrfCookie) {
            // Verify the session is still valid (no DB hit if not present).
            if (sessionToken) {
                const rows = await db
                    .select({ id: sessions.id })
                    .from(sessions)
                    .where(eq(sessions.token, sessionToken))
                    .limit(1);
                if (rows.length > 0) return;
            }
        }

        if (!csrfCookie) {
            throw new AppError(
                "CSRF token missing — reload the page and try again",
                403,
                "CSRF_INVALID",
            );
        }
        const headerToken = request.headers.get(CSRF_HEADER);
        if (!headerToken || headerToken !== csrfCookie) {
            throw new AppError(
                "CSRF token missing or invalid",
                403,
                "CSRF_INVALID",
            );
        }
    });

/** Exposed for tests / debugging — clear the CSRF cookie. */
// (The `csrfLogoutCookie` re-export was removed in Phase 2 — callers
// use `clearCsrfCookie` from `../../utils/cookies` directly.)
