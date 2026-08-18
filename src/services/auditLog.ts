// src/services/auditLog.ts
//
// Single helper for writing audit_log entries. Call this on every
// privileged admin action so changes are reviewable.

import { db } from "../db";
import { auditLog } from "../db/schema";

export type AuditAction =
    | "user.role.change"
    | "user.password.set"
    | "user.education.grant"
    | "user.education.grant.bulk"
    | "user.education.revoke"
    | "user.verified.set"
    | "user.email_verified.set"
    | "user.ban"
    | "user.profile.update"
    | "user.invite.create"
    | "user.invite.accept"
    | "user.invite.revoke"
    | "ticket.issue"
    | "ticket.issue.bulk"
    | "ticket.revoke"
    | "ticket.redeem"
    | "ticket.scan.denied"
    | "scoreboard.export"
    | "reference.location.create"
    | "reference.location.update"
    | "reference.location.delete"
    | "reference.education_type.create"
    | "reference.education_type.update"
    | "reference.education_type.delete"
    | "team.regenerate_code"
    | "migration.admin.manual";

export interface AuditPayload {
    oldValue?: unknown;
    newValue?: unknown;
}

export async function recordAdminAction(
    actorId: string,
    action: AuditAction,
    // Polymorphic: the user being affected, or null for resource-targeted
    // actions (e.g. ticket.issue.bulk affects an event, not a single user).
    targetUserId: string | null,
    payload: AuditPayload = {},
): Promise<void> {
    await db.insert(auditLog).values({
        actorId,
        action,
        targetUserId,
        oldValue:
            payload.oldValue !== undefined
                ? JSON.stringify(payload.oldValue)
                : null,
        newValue:
            payload.newValue !== undefined
                ? JSON.stringify(payload.newValue)
                : null,
    });
}
