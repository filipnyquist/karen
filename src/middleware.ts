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
    // Legacy redirect: the old site lived at /karen/*. Now that the
    // app itself is at the root, any /karen/* request lands on the
    // main page. 301 because the old paths aren't coming back.
    //
    // We hand-build the Response with a RELATIVE Location instead of
    // using `context.redirect("/", 301)`. The Astro helper builds an
    // absolute URL from `context.url`, which inside the standalone
    // Node adapter reflects the in-container scheme (http://) and
    // not the public scheme. Behind Traefik (HTTPS-only) the browser
    // would follow the redirect to http://karen.nyqui.st/, hit a
    // port nothing answers, and hang until the proxy times out. A
    // relative Location keeps the redirect on whatever scheme the
    // client actually used.
    const { pathname } = context.url;
    if (pathname === "/karen" || pathname.startsWith("/karen/")) {
        return new Response(null, {
            status: 301,
            headers: { Location: "/" },
        });
    }

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
