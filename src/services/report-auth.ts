// src/services/report-auth.ts

import { and, eq } from "drizzle-orm";
import { isAdmin } from "../api/middleware/auth";
import { db } from "../db";
import {
    educationTypes,
    userEducations,
    workerRegistrations,
} from "../db/schema";

export async function isResponsibleOrAdmin(
    userId: string,
    role: string,
    eventId: string,
): Promise<boolean> {
    // Admins (and superadmins) always pass.
    if (isAdmin(role)) return true;

    const responsibleEd = await db
        .select()
        .from(userEducations)
        .innerJoin(
            educationTypes,
            eq(userEducations.educationTypeId, educationTypes.id),
        )
        .where(
            and(
                eq(userEducations.userId, userId),
                eq(educationTypes.name, "responsible"),
            ),
        )
        .limit(1);

    if (responsibleEd.length === 0) return false;

    const edu = responsibleEd[0].user_educations;
    if (edu.expiresAt && new Date() > edu.expiresAt) return false;

    const reg = await db
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

    return reg.length > 0;
}
