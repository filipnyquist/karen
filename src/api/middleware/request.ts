// src/api/middleware/request.ts
//
// Request-level helpers shared between API routes. Currently just the
// client IP extractor used by both the auth (login throttling) and
// the rate-limit middleware. If we add more shared helpers (e.g. CSRF
// token reader, user-agent parser) they go here.

/**
 * Return the most likely real client IP for the incoming request.
 * Honours `X-Forwarded-For` (left-most = original client, set by the
 * load balancer in front of the app) and falls back to `X-Real-IP`.
 * If neither header is present (loopback traffic, tests) returns
 * `"unknown"`.
 */
export function getClientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    return request.headers.get("x-real-ip") ?? "unknown";
}
