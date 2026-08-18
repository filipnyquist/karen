// src/api/routes/auth.ts
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { config } from "../../config";
import { db } from "../../db";
import { users } from "../../db/schema";
import { detectLanguage } from "../../i18n";
import {
    checkLoginLockout,
    clearFailedLogins,
    recordFailedLogin,
} from "../../lib/loginLimiter";
import * as authService from "../../services/auth";
import {
    consumePasswordResetToken,
    isValidResetToken,
    requestPasswordReset,
} from "../../services/passwordReset";
import {
    buildSessionCookie,
    clearSessionCookie,
    extractSessionToken,
    isRequestSecure,
} from "../../utils/cookies";
import { loadSessionUser } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { getClientIp } from "../middleware/request";

async function verifyTurnstile(token: string): Promise<void> {
    const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                secret: config.turnstile.secret,
                response: token,
            }),
        },
    );
    const data = (await res.json()) as { success: boolean };
    if (!data.success) {
        throw new AppError(
            "Captcha verification failed",
            400,
            "CAPTCHA_FAILED",
        );
    }
}

// getClientIp is now imported from ../middleware/request (Phase 2 dedup).

export const authRoutes = new Elysia({ prefix: "/auth" })
    .post(
        "/register",
        async ({ body, set, request }) => {
            if (config.turnstile.secret) {
                if (!body.turnstileToken) {
                    throw new AppError(
                        "CAPTCHA required",
                        400,
                        "CAPTCHA_REQUIRED",
                    );
                }
                await verifyTurnstile(body.turnstileToken);
            }
            const user = await authService.createUser(
                body.email,
                body.password,
                body.name,
                body.nickname,
                detectLanguage(request) as "en" | "sv",
            );
            set.status = 201;
            return { id: user.id, email: user.email };
        },
        {
            body: t.Object({
                email: t.String({ format: "email" }),
                password: t.String({ minLength: 8 }),
                name: t.String({ minLength: 1 }),
                nickname: t.String({ minLength: 1 }),
                turnstileToken: t.Optional(t.String()),
            }),
        },
    )

    .get(
        "/verify-email",
        async ({ query, set }) => {
            await authService.verifyEmail(query.token);
            set.headers = { Location: "/login?verified=true" };
            set.status = 302;
            return { verified: true };
        },
        {
            query: t.Object({ token: t.String() }),
        },
    )

    .post(
        "/login",
        async ({ body, set, request }) => {
            const ip = getClientIp(request);
            checkLoginLockout(body.email, ip);

            if (config.turnstile.secret) {
                if (!body.turnstileToken) {
                    throw new AppError(
                        "CAPTCHA required",
                        400,
                        "CAPTCHA_REQUIRED",
                    );
                }
                await verifyTurnstile(body.turnstileToken);
            }

            try {
                const { token, expiresAt } = await authService.login(
                    body.email,
                    body.password,
                );
                clearFailedLogins(body.email, ip);
                const secure = isRequestSecure(request);
                set.headers = {
                    "Set-Cookie": buildSessionCookie(token, expiresAt, secure),
                };
                return { success: true };
            } catch (err) {
                if (
                    err instanceof AppError &&
                    err.code === "INVALID_CREDENTIALS"
                ) {
                    recordFailedLogin(body.email, ip);
                }
                throw err;
            }
        },
        {
            body: t.Object({
                email: t.String({ format: "email" }),
                password: t.String(),
                turnstileToken: t.Optional(t.String()),
            }),
        },
    )

    .post("/logout", async ({ request, set }) => {
        const token = extractSessionToken(request);
        if (token) await authService.logout(token);
        const secure = isRequestSecure(request);
        set.headers = { "Set-Cookie": clearSessionCookie(secure) };
        return { success: true };
    })

    .post("/dismiss-migration-prompt", async ({ request }) => {
        const user = await loadSessionUser(request);
        if (!user) throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
        await db
            .update(users)
            .set({ seenMigrationPrompt: true })
            .where(eq(users.id, user.id));
        return { success: true };
    })

    .post(
        "/request-verify",
        async ({ request, body }) => {
            const user = await loadSessionUser(request);
            if (!user)
                throw new AppError("Not authenticated", 401, "UNAUTHORIZED");

            await authService.requestVerification(
                user.id,
                body.email,
                detectLanguage(request) as "en" | "sv",
            );
            return { success: true };
        },
        {
            body: t.Object({ email: t.String({ format: "email" }) }),
        },
    )

    .get(
        "/verify-student",
        async ({ query, set }) => {
            await authService.verifyStudentToken(query.token);
            set.headers = { Location: "/verify?verified=1" };
            set.status = 302;
            return { verified: true };
        },
        {
            query: t.Object({ token: t.String() }),
        },
    )

    // ─── Forgot-password flow ──────────────────────────────────
    //
    // Same response shape regardless of whether the email is in
    // the DB — the service silently no-ops on a missing user and
    // the email send (when it does happen) is dispatched off-thread
    // via `requestPasswordReset`, so the response time doesn't gate
    // on SMTP. `resetUrl` is only set in non-prod so e2e can
    // complete the flow without scraping mailer logs (mirrors the
    // existing `acceptUrl` precedent on /api/invitations).
    .post(
        "/forgot-password",
        async ({ body, request }) => {
            if (config.turnstile.secret) {
                if (!body.turnstileToken) {
                    throw new AppError(
                        "CAPTCHA required",
                        400,
                        "CAPTCHA_REQUIRED",
                    );
                }
                await verifyTurnstile(body.turnstileToken);
            }
            const result = await requestPasswordReset(
                body.email,
                detectLanguage(request) as "en" | "sv",
            );
            return { success: true, resetUrl: result.resetUrl };
        },
        {
            body: t.Object({
                email: t.String({ format: "email" }),
                turnstileToken: t.Optional(t.String()),
            }),
        },
    )

    // SSR pre-flight the /reset-password page calls before
    // rendering the form. GET → exempt from CSRF by method.
    .get(
        "/reset-password/check",
        async ({ query }) => {
            return await isValidResetToken(query.token);
        },
        {
            query: t.Object({ token: t.String() }),
        },
    )

    // Consume a reset token: rotate the password, wipe sessions,
    // mark the row used, audit. No auto-login — the user proves
    // they know the new password by typing it at /login.
    .post(
        "/reset-password",
        async ({ body }) => {
            await consumePasswordResetToken(body.token, body.password);
            return { success: true };
        },
        {
            body: t.Object({
                token: t.String({ minLength: 32 }),
                password: t.String({ minLength: 8 }),
            }),
        },
    );
