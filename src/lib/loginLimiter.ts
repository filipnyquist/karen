// src/lib/loginLimiter.ts

interface LoginAttempt {
    failures: number;
    lockedUntil: number;
}

const attempts = new Map<string, LoginAttempt>();

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_MS = 15 * 60 * 1000; // failures reset after 15 min of no attempts

// Clean up expired entries every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
        if (now > entry.lockedUntil && now > entry.lockedUntil + WINDOW_MS) {
            attempts.delete(key);
        }
    }
}, 60_000).unref();

function getKey(email: string, ip: string): string {
    return `${email.toLowerCase()}:${ip}`;
}

export function checkLoginLockout(email: string, ip: string): void {
    const entry = attempts.get(getKey(email, ip));
    if (!entry) return;

    const now = Date.now();
    if (entry.lockedUntil && now < entry.lockedUntil) {
        const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
        throw new Error(
            `Account temporarily locked. Try again in ${retryAfter}s.`,
        );
    }
}

export function recordFailedLogin(email: string, ip: string): void {
    const key = getKey(email, ip);
    const entry = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };

    entry.failures++;
    if (entry.failures >= MAX_FAILURES) {
        entry.lockedUntil = Date.now() + LOCKOUT_MS;
    }

    attempts.set(key, entry);
}

export function clearFailedLogins(email: string, ip: string): void {
    attempts.delete(getKey(email, ip));
}
