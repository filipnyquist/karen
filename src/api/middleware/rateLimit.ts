// src/api/middleware/rateLimit.ts
import { Elysia } from "elysia";
import { AppError } from "./error";
import { getClientIp } from "./request";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const limits = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of limits) {
        if (now > entry.resetAt) limits.delete(key);
    }
}, 60_000).unref();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;

// Endpoints that should be throttled per IP. The forgot-password
// and reset-password POSTs are added alongside login so an attacker
// can't burn DB work / SMTP work by spamming them.
const RATE_LIMITED_PATHS = new Set<string>([
    "POST:/api/auth/login",
    "POST:/api/auth/forgot-password",
    "POST:/api/auth/reset-password",
]);

export const rateLimitPlugin = new Elysia().onBeforeHandle(({ request }) => {
    const url = new URL(request.url);
    const key = `${request.method}:${url.pathname}`;

    if (!RATE_LIMITED_PATHS.has(key)) return;

    const ip = getClientIp(request);
    const limitKey = `${key}:${ip}`;

    const now = Date.now();
    const entry = limits.get(limitKey);

    if (!entry || now > entry.resetAt) {
        limits.set(limitKey, { count: 1, resetAt: now + WINDOW_MS });
        return;
    }

    entry.count++;
    if (entry.count > MAX_REQUESTS) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        throw new AppError(
            `Too many requests. Try again in ${retryAfter}s.`,
            429,
            "RATE_LIMITED",
        );
    }
});
