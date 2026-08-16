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

export const rateLimitPlugin = new Elysia().onBeforeHandle(({ request }) => {
    const url = new URL(request.url);
    const key = `${request.method}:${url.pathname}`;

    // Only rate limit login
    if (key !== "POST:/api/auth/login") return;

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
            `Too many login attempts. Try again in ${retryAfter}s.`,
            429,
            "RATE_LIMITED",
        );
    }
});
