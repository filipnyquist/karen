// src/services/events.ts

import { and, count, eq, sql } from "drizzle-orm";
import { AppError } from "../api/middleware/error";
import { config } from "../config";
import { db } from "../db";
import {
    eventStates,
    events,
    guestRegistrations,
    locations,
    workerRegistrations,
} from "../db/schema";

export async function createEvent(data: {
    name: string;
    description?: string;
    locationId: number;
    startDate: string;
    endDate: string;
    maxGuests?: number;
    maxResponsibles?: number;
    maxWorkers?: number;
    minResponsibles?: number;
    minWorkers?: number;
    maxGuestsPerUser?: number;
    willOccur: number;
    givesPoints?: boolean;
    createdBy: string;
}) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);

    if (end <= start) {
        throw new AppError(
            "End date must be after start date",
            400,
            "INVALID_DATES",
        );
    }

    // Validate location exists
    const location = await db
        .select()
        .from(locations)
        .where(eq(locations.id, data.locationId))
        .limit(1);
    if (location.length === 0) {
        throw new AppError("Location not found", 404, "LOCATION_NOT_FOUND");
    }

    // Validate event state exists
    const state = await db
        .select()
        .from(eventStates)
        .where(eq(eventStates.id, data.willOccur))
        .limit(1);
    if (state.length === 0) {
        throw new AppError("Event state not found", 404, "STATE_NOT_FOUND");
    }

    const [event] = await db
        .insert(events)
        .values({
            name: data.name,
            description: data.description ?? null,
            locationId: data.locationId,
            startDate: start,
            endDate: end,
            maxGuests: data.maxGuests ?? config.defaultMaxGuests,
            maxResponsibles: data.maxResponsibles ?? null,
            maxWorkers: data.maxWorkers ?? null,
            minResponsibles: data.minResponsibles ?? null,
            minWorkers: data.minWorkers ?? null,
            maxGuestsPerUser:
                data.maxGuestsPerUser ?? config.defaultMaxGuestsPerUser,
            willOccur: data.willOccur,
            givesPoints: data.givesPoints ?? true,
            locked: false,
            createdBy: data.createdBy,
        })
        .returning();

    return event;
}

export async function updateEvent(
    eventId: string,
    data: {
        name?: string;
        description?: string;
        locationId?: number;
        startDate?: string;
        endDate?: string;
        maxGuests?: number;
        maxResponsibles?: number;
        maxWorkers?: number;
        minResponsibles?: number;
        minWorkers?: number;
        maxGuestsPerUser?: number;
        willOccur?: number;
        givesPoints?: boolean;
        locked?: boolean;
    },
) {
    const updateData: Partial<typeof events.$inferInsert> = {
        updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
        updateData.description = data.description;
    if (data.locationId !== undefined) updateData.locationId = data.locationId;
    if (data.willOccur !== undefined) updateData.willOccur = data.willOccur;
    if (data.givesPoints !== undefined)
        updateData.givesPoints = data.givesPoints;
    if (data.locked !== undefined) updateData.locked = data.locked;
    if (data.maxGuests !== undefined) updateData.maxGuests = data.maxGuests;
    if (data.maxResponsibles !== undefined)
        updateData.maxResponsibles = data.maxResponsibles;
    if (data.maxWorkers !== undefined) updateData.maxWorkers = data.maxWorkers;
    if (data.minResponsibles !== undefined)
        updateData.minResponsibles = data.minResponsibles;
    if (data.minWorkers !== undefined) updateData.minWorkers = data.minWorkers;
    if (data.maxGuestsPerUser !== undefined)
        updateData.maxGuestsPerUser = data.maxGuestsPerUser;

    if (data.startDate !== undefined)
        updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

    const [updated] = await db
        .update(events)
        .set(updateData)
        .where(eq(events.id, eventId))
        .returning();
    return updated;
}

export async function getEventById(eventId: string): Promise<{
    event: typeof events.$inferSelect;
    location: typeof locations.$inferSelect;
    state: typeof eventStates.$inferSelect;
}> {
    const result = await db
        .select({
            event: events,
            location: locations,
            state: eventStates,
        })
        .from(events)
        .innerJoin(locations, eq(events.locationId, locations.id))
        .innerJoin(eventStates, eq(events.willOccur, eventStates.id))
        .where(eq(events.id, eventId))
        .limit(1);

    if (result.length === 0) {
        throw new AppError("Event not found", 404, "EVENT_NOT_FOUND");
    }

    return result[0];
}

export async function listEvents(options?: {
    limit?: number;
    offset?: number;
}) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const result = await db
        .select({
            event: events,
            location: locations,
            state: eventStates,
        })
        .from(events)
        .innerJoin(locations, eq(events.locationId, locations.id))
        .innerJoin(eventStates, eq(events.willOccur, eventStates.id))
        .orderBy(sql`${events.startDate} DESC`)
        .limit(limit)
        .offset(offset);

    return result;
}

export async function deleteEvent(eventId: string): Promise<{ success: true }> {
    await getEventById(eventId);
    await db.delete(events).where(eq(events.id, eventId));
    return { success: true };
}

export async function getWorkerCountForEvent(eventId: string): Promise<number> {
    const result = await db
        .select({ count: count() })
        .from(workerRegistrations)
        .where(eq(workerRegistrations.eventId, eventId));

    return result[0]?.count ?? 0;
}

export async function getResponsibleCountForEvent(
    eventId: string,
): Promise<number> {
    const result = await db
        .select({ count: count() })
        .from(workerRegistrations)
        .where(
            and(
                eq(workerRegistrations.eventId, eventId),
                eq(workerRegistrations.responsible, true),
            ),
        );

    return result[0]?.count ?? 0;
}

export async function getGuestCountForEvent(eventId: string): Promise<number> {
    const result = await db
        .select({ count: count() })
        .from(guestRegistrations)
        .where(eq(guestRegistrations.eventId, eventId));

    return result[0]?.count ?? 0;
}

export async function getGuestCountForUser(
    eventId: string,
    userId: string,
): Promise<number> {
    const result = await db
        .select({ count: count() })
        .from(guestRegistrations)
        .where(
            and(
                eq(guestRegistrations.eventId, eventId),
                eq(guestRegistrations.reporterId, userId),
            ),
        );

    return result[0]?.count ?? 0;
}
