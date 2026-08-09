// src/utils/cookies.ts
//
// Shared cookie parsing & cookie-construction helpers.
// All cookie reads should funnel through this module so the parser stays in one place.

const SESSION_COOKIE = "session_token";
const CSRF_COOKIE = "csrf_token";
const LANG_COOKIE = "lang";

/**
 * Parse a Cookie header into a key→value map. Trims whitespace, unquotes values
 * per RFC 6265, and discards empty / duplicate keys (first wins).
 */
export function parseCookies(
    cookieHeader: string | null,
): Record<string, string> {
    if (!cookieHeader) return {};
    const out: Record<string, string> = {};
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const name = part.slice(0, eq).trim();
        if (!name || name in out) continue;
        let value = part.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        try {
            out[name] = decodeURIComponent(value);
        } catch {
            out[name] = value;
        }
    }
    return out;
}

/** Extract the session token from a Request, or null if absent. */
export function extractSessionToken(request: Request): string | null {
    const cookies = parseCookies(request.headers.get("cookie"));
    return cookies[SESSION_COOKIE] ?? null;
}

/** Extract the CSRF token from a Request, or null if absent. */
export function extractCsrfToken(request: Request): string | null {
    const cookies = parseCookies(request.headers.get("cookie"));
    return cookies[CSRF_COOKIE] ?? null;
}

/** Extract the language cookie (`"sv"` or `"en"`), or null if unset/invalid. */
export function extractLangCookie(request: Request): "sv" | "en" | null {
    const cookies = parseCookies(request.headers.get("cookie"));
    const lang = cookies[LANG_COOKIE];
    return lang === "sv" || lang === "en" ? lang : null;
}

/**
 * Detect whether the request came in over HTTPS, either via the URL
 * scheme or via a trusted proxy's `X-Forwarded-Proto` header. Used to
 * decide whether to set the `Secure` flag on session/CSRF cookies.
 *
 * Safari (desktop + iOS) refuses to set `Secure` cookies on HTTP
 * origins — including `http://localhost` — so during local dev we must
 * omit `Secure` for the cookie to actually persist. Chrome and Firefox
 * special-case localhost; Safari does not.
 */
export function isRequestSecure(request: Request): boolean {
    const url = new URL(request.url);
    if (url.protocol === "https:") return true;
    const forwarded = request.headers.get("x-forwarded-proto");
    if (forwarded?.toLowerCase().startsWith("https")) return true;
    return false;
}

/** Build the `Set-Cookie` value for an authenticated session. */
export function buildSessionCookie(
    token: string,
    expiresAt: Date,
    secure = true,
): string {
    const parts = [
        `${SESSION_COOKIE}=${token}`,
        "HttpOnly",
        "SameSite=Lax",
        "Path=/",
        `Expires=${expiresAt.toUTCString()}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

/** Build the `Set-Cookie` value that clears the session. */
export function clearSessionCookie(secure = true): string {
    const parts = [
        `${SESSION_COOKIE}=`,
        "HttpOnly",
        "SameSite=Lax",
        "Path=/",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

/**
 * Build the `Set-Cookie` value for a CSRF token. The cookie is JS-readable
 * (no HttpOnly) because the client must read it to stamp the `X-CSRF-Token`
 * header on subsequent state-changing requests.
 */
export function buildCsrfCookie(
    token: string,
    expiresAt: Date,
    secure = true,
): string {
    const parts = [
        `${CSRF_COOKIE}=${token}`,
        "SameSite=Lax",
        "Path=/",
        `Expires=${expiresAt.toUTCString()}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}

/** Build the `Set-Cookie` value that clears the CSRF token. */
export function clearCsrfCookie(secure = true): string {
    const parts = [
        `${CSRF_COOKIE}=`,
        "SameSite=Lax",
        "Path=/",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}
