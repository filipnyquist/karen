// src/services/responsible-education.ts
//
// Helpers around the "responsible" qualification — a user_education
// row whose education_types.name === "responsible" and whose
// expires_at is null-or-future. This module is shared between the
// event-detail page (gate the "Anmäl som ansvarig" button) and the
// POST /api/workers/register endpoint (gate the actual write), so
// both sides agree on what counts as a valid responsible.

// Note: the existing responsibleOrAdminDerive middleware
// (src/api/middleware/auth.ts:154-221) does a *similar* inline check
// for already-registered responsibles but with event-scoped semantics
// (user must be a registered responsible for *this* event). That's
// intentionally kept separate — this helper covers the "can sign up
// to BE responsible" question, not the "is authorized to manage an
// event they're already responsible for" question.

import { and, eq } from "drizzle-orm";
import { AppError } from "../api/middleware/error";
import { db } from "../db";
import { educationTypes, userEducations } from "../db/schema";

export async function hasValidResponsibleEducation(
    userId: string,
): Promise<boolean> {
    const [row] = await db
        .select({ expiresAt: userEducations.expiresAt })
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
    if (!row) return false;
    const exp = row.expiresAt;
    if (exp && new Date() > exp) return false;
    return true;
}

export async function assertCanRegisterAsResponsible(
    userId: string,
): Promise<void> {
    const [row] = await db
        .select({ edu: userEducations })
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
    if (!row) {
        throw new AppError(
            "Responsible education required",
            403,
            "RESPONSIBLE_EDUCATION_REQUIRED",
        );
    }
    const exp = row.edu.expiresAt;
    if (exp && new Date() > exp) {
        throw new AppError(
            "Responsible education expired",
            403,
            "EDUCATION_EXPIRED",
        );
    }
}
