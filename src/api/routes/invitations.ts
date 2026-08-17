// src/api/routes/invitations.ts
//
// Superadmin-only invitation management + a public accept endpoint that
// bootstraps a new user from an invitation token.

import { randomBytes } from "node:crypto";
import { Elysia, t } from "elysia";
import { config } from "../../config";
import { db } from "../../db";
import { sessions } from "../../db/schema";
import { detectLanguage } from "../../i18n";
import { recordAdminAction } from "../../services/auditLog";
import {
    acceptInvitation,
    createInvitation,
    listInvitations,
    peekInvitation,
    revokeInvitation,
} from "../../services/invitations";
import { buildSessionCookie } from "../../utils/cookies";
import { superadminDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const invitationRoutes = new Elysia({ prefix: "/invitations" })
    // POST /api/invitations — superadmin only. Issues an invite and emails the token.
    .use(
        new Elysia().derive(superadminDerive).post(
            "/",
            async ({ body, user: actor, request }) => {
                try {
                    const { invitation, token } = await createInvitation({
                        email: body.email,
                        role: body.role,
                        invitedBy: actor.id,
                        lang: detectLanguage(request) as "en" | "sv",
                    });
                    await recordAdminAction(
                        actor.id,
                        "user.invite.create",
                        null,
                        {
                            newValue: {
                                email: invitation.email,
                                role: invitation.role,
                            },
                        },
                    );
                    // Return the token in non-production so dev/test
                    // harnesses can complete the accept flow without
                    // scraping email logs. Production hides it.
                    return {
                        id: invitation.id,
                        email: invitation.email,
                        role: invitation.role,
                        expiresAt: invitation.expiresAt,
                        acceptUrl:
                            process.env.NODE_ENV === "production"
                                ? undefined
                                : `${config.baseUrl}/accept-invite?token=${token}`,
                    };
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : "Failed";
                    throw new AppError(message, 400, "BAD_REQUEST");
                }
            },
            {
                body: t.Object({
                    email: t.String({ format: "email" }),
                    role: t.Union([
                        t.Literal("user"),
                        t.Literal("admin"),
                        t.Literal("superadmin"),
                    ]),
                }),
            },
        ),
    )
    // GET /api/invitations — superadmin only. Lists all invitations.
    .use(
        new Elysia().derive(superadminDerive).get("/", async () => {
            const rows = await listInvitations();
            return rows;
        }),
    )
    // DELETE /api/invitations/:id — superadmin only. Revokes an invitation.
    .use(
        new Elysia().derive(superadminDerive).delete(
            "/:id",
            async ({ params, user: actor }) => {
                const removed = await revokeInvitation(params.id);
                if (!removed) {
                    throw new AppError(
                        "Invitation not found",
                        404,
                        "NOT_FOUND",
                    );
                }
                await recordAdminAction(actor.id, "user.invite.revoke", null, {
                    oldValue: { id: params.id },
                });
                return { success: true };
            },
            {
                params: t.Object({ id: t.String() }),
            },
        ),
    )
    // GET /api/invitations/check?token=... — public. Used by /accept-invite
    // to look up the email + role before showing the form.
    .get("/check", async ({ query }) => {
        if (!query?.token) {
            throw new AppError("token is required", 400, "BAD_REQUEST");
        }
        const inv = await peekInvitation(query.token);
        if (!inv) {
            throw new AppError(
                "Invitation is invalid or has expired",
                404,
                "INVITATION_INVALID",
            );
        }
        return inv;
    })
    // POST /api/invitations/accept — public. Creates the user and a session.
    .post(
        "/accept",
        async ({ body, set }) => {
            try {
                const user = await acceptInvitation({
                    token: body.token,
                    password: body.password,
                    name: body.name,
                    nickname: body.nickname,
                });
                await recordAdminAction(
                    user.id,
                    "user.invite.accept",
                    user.id,
                    { newValue: { email: user.email, role: user.role } },
                );
                // Mint a session so the user lands logged in on /welcome.
                const sessionToken = randomBytes(32).toString("hex");
                const expiresAt = new Date(Date.now() + config.sessionMaxAgeMs);
                await db.insert(sessions).values({
                    userId: user.id,
                    token: sessionToken,
                    expiresAt,
                });
                set.headers["Set-Cookie"] = buildSessionCookie(
                    sessionToken,
                    expiresAt,
                    new URL(config.baseUrl).protocol === "https:",
                );
                return { success: true, id: user.id, role: user.role };
            } catch (err) {
                const message = err instanceof Error ? err.message : "Failed";
                throw new AppError(message, 400, "BAD_REQUEST");
            }
        },
        {
            body: t.Object({
                token: t.String(),
                password: t.String({ minLength: 8 }),
                name: t.String({ minLength: 1 }),
                nickname: t.String({ minLength: 1 }),
            }),
        },
    );
