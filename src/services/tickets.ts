// src/services/tickets.ts

import { and, eq, sql } from "drizzle-orm";
import { AppError } from "../api/middleware/error";
import { db } from "../db";
import { events, tickets, users, workerRegistrations } from "../db/schema";
import { recordAdminAction } from "./auditLog";

/** Generate a cryptographically random token for tickets */
export function generateToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Issue a single ticket.
 *
 * The DB-level partial unique index `tickets_one_active_per_user_event`
 * makes concurrent double-issuance impossible — we catch the resulting
 * Postgres unique-violation (SQLSTATE 23505) and translate it into a
 * meaningful 409 TICKET_EXISTS.
 */
export async function issueTicket(
    userId: string,
    eventId: string,
    actorId?: string,
) {
    const token = generateToken();

    try {
        const [ticket] = await db
            .insert(tickets)
            .values({ userId, eventId, token, isActive: true })
            .returning();
        if (actorId) {
            await recordAdminAction(actorId, "ticket.issue", userId, {
                newValue: { eventId },
            });
        }
        return ticket;
    } catch (err: unknown) {
        if (
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "23505"
        ) {
            throw new AppError(
                "User already has an active ticket for this event",
                409,
                "TICKET_EXISTS",
            );
        }
        throw err;
    }
}

/**
 * Preview a ticket holder for the scanner. Returns only the holder
 * identity — NOT the ticket's origin event. Tickets are queue-skip
 * rewards usable at any event the holder has scanner permission for, so
 * the origin event is metadata only.
 *
 * Authorization (the scanner's `canScanTickets` gate) is the route's
 * responsibility — this function intentionally does no auth so it stays
 * a pure read.
 */
export async function scanTicket(token: string) {
    const result = await db
        .select({
            ticket: tickets,
            user: users,
        })
        .from(tickets)
        .innerJoin(users, eq(tickets.userId, users.id))
        .where(eq(tickets.token, token))
        .limit(1);

    if (result.length === 0)
        throw new AppError("Ticket not found", 404, "TICKET_NOT_FOUND");

    const { ticket, user } = result[0];

    if (!ticket.isActive)
        throw new AppError(
            "Ticket is no longer active",
            400,
            "TICKET_INACTIVE",
        );
    if (ticket.redeemedAt)
        throw new AppError(
            "Ticket has already been redeemed",
            400,
            "TICKET_ALREADY_REDEEMED",
        );

    return {
        ticketId: ticket.id,
        isActive: ticket.isActive,
        createdAt: ticket.createdAt,
        user: {
            id: user.id,
            name: user.name,
            nickname: user.nickname,
            profilePic: user.profilePic,
        },
    };
}

/**
 * Redeem a ticket. Atomic — collapses the previous SELECT+check+UPDATE
 * into one statement. Two concurrent redeems of the same token: one
 * succeeds, the other returns 400 TICKET_ALREADY_REDEEMED.
 *
 * Tickets are queue-skip rewards — they can be redeemed at *any* event
 * the holder has scanner permission at, not just the event they were
 * earned at. The supplied `redeemedAtEventId` records where the
 * ticket was actually used (audit trail).
 */
export async function redeemTicket(
    token: string,
    redeemedAtEventId: string,
    scannerUserId: string,
) {
    const updated = await db
        .update(tickets)
        .set({
            redeemedAt: new Date(),
            isActive: false,
            redeemedAtEventId,
        })
        .where(
            and(
                eq(tickets.token, token),
                eq(tickets.isActive, true),
                sql`${tickets.redeemedAt} IS NULL`,
            ),
        )
        .returning();

    if (updated.length === 0) {
        // Distinguish the failure mode with a follow-up read.
        const existing = await db
            .select({
                isActive: tickets.isActive,
                redeemedAt: tickets.redeemedAt,
            })
            .from(tickets)
            .where(eq(tickets.token, token))
            .limit(1);
        if (existing.length === 0)
            throw new AppError("Ticket not found", 404, "TICKET_NOT_FOUND");
        if (existing[0].redeemedAt !== null)
            throw new AppError(
                "Ticket has already been redeemed",
                400,
                "TICKET_ALREADY_REDEEMED",
            );
        if (!existing[0].isActive)
            throw new AppError(
                "Ticket is no longer active",
                400,
                "TICKET_INACTIVE",
            );
        throw new AppError(
            "Ticket could not be redeemed",
            500,
            "INTERNAL_ERROR",
        );
    }

    const ticket = updated[0];
    await recordAdminAction(scannerUserId, "ticket.redeem", ticket.userId, {
        newValue: { redeemedAtEventId },
    });
    return ticket;
}

/**
 * Revoke a ticket (admin only). Atomic — sets isActive=false in one
 * statement and refuses to touch already-inactive rows. Writes a
 * `ticket.revoke` audit row with the calling admin as actor.
 */
export async function revokeTicket(ticketId: string, actorId: string) {
    const updated = await db
        .update(tickets)
        .set({ isActive: false })
        .where(and(eq(tickets.id, ticketId), eq(tickets.isActive, true)))
        .returning();

    if (updated.length === 0) {
        throw new AppError(
            "Ticket is already inactive",
            400,
            "TICKET_INACTIVE",
        );
    }

    await recordAdminAction(actorId, "ticket.revoke", updated[0].userId, {
        oldValue: { isActive: true },
        newValue: { isActive: false },
    });

    return updated[0];
}

/**
 * Check if a user is authorized to scan/redeem tickets for a given event.
 * Authorized if: admin, responsible for the event, or a worker registered
 * for the event within the time window.
 *
 * The lower bound is relaxed by 2 hours so setup crews arriving early
 * can scan tickets instead of being blocked at first scan.
 */
export async function canScanTickets(
    userId: string,
    userRole: string,
    eventId: string,
): Promise<boolean> {
    // Admins (and superadmins) can always scan
    if (userRole === "admin" || userRole === "superadmin") return true;

    // Check if the user is a responsible for this event
    const responsibleReg = await db
        .select()
        .from(workerRegistrations)
        .where(
            and(
                eq(workerRegistrations.eventId, eventId),
                eq(workerRegistrations.userId, userId),
                eq(workerRegistrations.responsible, true),
            ),
        )
        .limit(1);

    if (responsibleReg.length > 0) return true;

    // Check if the user is a worker registered for this event
    const eventRows = await db
        .select()
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1);
    if (eventRows.length === 0) return false;

    const eventStart = new Date(eventRows[0].startDate);
    const eventEnd = new Date(eventRows[0].endDate);
    const now = new Date();

    // Lower bound: event start - 2h grace (setup crews can scan early).
    // Upper bound: end-of-day after event end (post-event cleanup window).
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const earliestScan = new Date(eventStart.getTime() - TWO_HOURS_MS);
    const dayAfterEnd = new Date(eventEnd);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
    dayAfterEnd.setHours(23, 59, 59, 999);

    if (now < earliestScan || now > dayAfterEnd) {
        return false;
    }

    const workerReg = await db
        .select()
        .from(workerRegistrations)
        .where(
            and(
                eq(workerRegistrations.eventId, eventId),
                eq(workerRegistrations.userId, userId),
            ),
        )
        .limit(1);

    return workerReg.length > 0;
}

/**
 * Issue tickets to all workers registered for an event. Skips workers
 * who already have an active ticket (TICKET_EXISTS). Returns a
 * structured result so the lock endpoint can surface partial failures.
 *
 * The actor is the user triggering the bulk issuance (typically an
 * admin via /events/:id/lock). One audit row is written for the whole
 * batch.
 */
export async function issueTicketsForEvent(
    eventId: string,
    actorId: string,
): Promise<{ issued: number; skipped: number; failed: string[] }> {
    const regs = await db
        .select({ userId: workerRegistrations.userId })
        .from(workerRegistrations)
        .where(eq(workerRegistrations.eventId, eventId));

    let issued = 0;
    let skipped = 0;
    const failed: string[] = [];

    for (const reg of regs) {
        try {
            await issueTicket(reg.userId, eventId, actorId);
            issued++;
        } catch (err) {
            if (err instanceof AppError && err.code === "TICKET_EXISTS") {
                skipped++;
                continue;
            }
            failed.push(reg.userId);
        }
    }

    await recordAdminAction(actorId, "ticket.issue.bulk", null, {
        newValue: {
            eventId,
            issued,
            skipped,
            failedCount: failed.length,
        },
    });

    return { issued, skipped, failed };
}

/**
 * Get all tickets for a user.
 */
export async function getUserTickets(userId: string) {
    return db
        .select({
            ticket: tickets,
            event: events,
        })
        .from(tickets)
        .innerJoin(events, eq(tickets.eventId, events.id))
        .where(eq(tickets.userId, userId));
}

/**
 * Get all tickets for an event.
 */
export async function getEventTickets(eventId: string) {
    return db
        .select({
            ticket: tickets,
            user: users,
        })
        .from(tickets)
        .innerJoin(users, eq(tickets.userId, users.id))
        .where(eq(tickets.eventId, eventId));
}
