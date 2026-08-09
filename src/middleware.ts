// src/middleware.ts
import { defineMiddleware } from "astro:middleware";
import { type AuthUser, loadSessionUser } from "./api/middleware/auth";
import { detectLanguage, getTranslations, t } from "./i18n/index";
import {
    buildCsrfCookie,
    extractLangCookie,
    isRequestSecure,
    parseCookies,
} from "./utils/cookies";

const CSRF_COOKIE_NAME = "csrf_token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function generateCsrfToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export const onRequest = defineMiddleware(async (context, next) => {
    // Detect language from cookie, default to sv
    const lang =
        extractLangCookie(context.request) ?? detectLanguage(context.request);
    context.locals.lang = lang;
    context.locals.t = t(lang);
    context.locals.translations = getTranslations(lang);

    // Get current user from session cookie
    context.locals.user = null;
    const user = await loadSessionUser(context.request);
    if (user) {
        context.locals.user = user satisfies AuthUser;
    }

    const response = await next();

    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
    );
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    // Allow camera access for the QR scanner island; deny microphone/geolocation
    // (no caller in this app needs them).
    response.headers.set(
        "Permissions-Policy",
        "camera=(self), microphone=(), geolocation=()",
    );
    // CSP is delivered by Astro's native `security.csp` config (hash-based, production only).
    // See astro.config.mjs — dev mode is intentionally unblocked.

    // CSRF: issue a `csrf_token` cookie on every safe HTML response so the
    // client can stamp `X-CSRF-Token` on subsequent fetches. The cookie is
    // JS-readable (no HttpOnly) so the client-side helper can read it.
    const method = context.request.method.toUpperCase();
    if (SAFE_METHODS.has(method)) {
        const cookies = parseCookies(context.request.headers.get("cookie"));
        if (!cookies[CSRF_COOKIE_NAME]) {
            const token = generateCsrfToken();
            const oneYear = new Date(Date.now() + 365 * 24 * 3600 * 1000);
            const secure = isRequestSecure(context.request);
            response.headers.append(
                "Set-Cookie",
                buildCsrfCookie(token, oneYear, secure),
            );
        }
    }

    return response;
});
