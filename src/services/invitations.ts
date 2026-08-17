// src/services/invitations.ts
//
// Superadmin-issued invitations to onboard new users with a chosen role.
// Tokens are 64-hex / 256-bit, single-use, and expire after 7 days. The
// invitation link in the email is the only proof of inbox ownership —
// the accept flow inserts a new user directly with the invited role,
// skipping the email-verification step.

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db";
import { type Invitation, invitations, users } from "../db/schema";
import { type Lang, sendInvitationEmail } from "./email";

/** Default invitation lifetime in days. */
const INVITATION_TTL_DAYS = 7;

/** Generate a 64-hex-char (256-bit) token. */
// Exported for unit tests only — the only production caller is
// `createInvitation` below.
export function generateInvitationToken(): string {
    return randomBytes(32).toString("hex");
}

export interface CreateInvitationInput {
    email: string;
    role: "user" | "admin" | "superadmin";
    invitedBy: string;
    lang: Lang;
}

export interface CreateInvitationResult {
    invitation: Invitation;
    token: string;
}

/**
 * Create an invitation for `email` with the chosen role. Throws if a user
 * with that email already exists. Sends an email containing the token. The
 * token is returned in the result so callers (e.g. dev mode or tests) can
 * read it back without parsing logs.
 */
export async function createInvitation(
    input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Reject if the email already belongs to a registered user — there's
    // no value in inviting them and we'd confuse the role on accept.
    const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
    if (existing.length > 0) {
        throw new Error("A user with that email already exists");
    }

    // Reject if there's an active (non-expired, non-accepted) invitation
    // for the same email — better to revoke and reissue than to silently
    // overwrite the link the previous invitee might already be using.
    const now = new Date();
    const active = await db
        .select()
        .from(invitations)
        .where(
            and(
                eq(invitations.email, normalizedEmail),
                isNull(invitations.acceptedAt),
            ),
        );
    const stillLive = active.find((a) => a.expiresAt > now);
    if (stillLive) {
        throw new Error("An active invitation already exists for that email");
    }

    const token = generateInvitationToken();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    const [created] = await db
        .insert(invitations)
        .values({
            email: normalizedEmail,
            role: input.role,
            token,
            invitedBy: input.invitedBy,
            expiresAt,
        })
        .returning();

    await sendInvitationEmail({
        to: normalizedEmail,
        baseUrl: config.baseUrl,
        token,
        role: input.role,
        lang: input.lang,
    });

    return { invitation: created, token };
}

export interface AcceptInvitationInput {
    token: string;
    password: string;
    name: string;
    nickname: string;
}

/**
 * Validate an invitation token and create the user with the invited role.
 * Throws on missing/expired/already-accepted tokens. Returns the new user.
 */
export async function acceptInvitation(
    input: AcceptInvitationInput,
): Promise<typeof users.$inferSelect> {
    const [invitation] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.token, input.token))
        .limit(1);

    if (!invitation) {
        throw new Error("Invitation not found");
    }
    if (invitation.acceptedAt !== null) {
        throw new Error("Invitation has already been accepted");
    }
    if (invitation.expiresAt < new Date()) {
        throw new Error("Invitation has expired");
    }

    const passwordHash = await Bun.password.hash(input.password, "bcrypt");
    const [user] = await db
        .insert(users)
        .values({
            email: invitation.email,
            passwordHash,
            name: input.name,
            nickname: input.nickname,
            // Invited users skip email verification — the link itself proves
            // inbox ownership. New admins/superadmins are flagged verified
            // too so they can immediately manage the platform.
            emailVerified: true,
            verified: invitation.role !== "user",
            role: invitation.role,
        })
        .returning();

    await db
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
        .where(eq(invitations.id, invitation.id));

    return user;
}

/**
 * Fetch the invitation for a token without consuming it. Used by the
 * /accept-invite page to show the email/role to the invitee before they
 * submit their password. Returns null on missing/expired/accepted tokens.
 */
export async function peekInvitation(token: string): Promise<{
    email: string;
    role: string;
    expiresAt: Date;
} | null> {
    const [invitation] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.token, token))
        .limit(1);
    if (!invitation) return null;
    if (invitation.acceptedAt !== null) return null;
    if (invitation.expiresAt < new Date()) return null;
    return {
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
    };
}

/** List invitations newest-first. Used by the admin UI to track who invited whom. */
export async function listInvitations(): Promise<
    Array<Invitation & { inviterEmail: string | null }>
> {
    const rows = await db
        .select({
            invitation: invitations,
            inviterEmail: users.email,
        })
        .from(invitations)
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .orderBy(desc(invitations.createdAt))
        .limit(200);
    return rows.map((r) => ({
        ...r.invitation,
        inviterEmail: r.inviterEmail,
    }));
}

/** Hard-delete an invitation (revoke). Returns true if a row was removed. */
export async function revokeInvitation(id: string): Promise<boolean> {
    const result = await db
        .delete(invitations)
        .where(eq(invitations.id, id))
        .returning({ id: invitations.id });
    return result.length > 0;
}
