// src/api/routes/admin.ts

import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
    auditLog,
    educationTypes,
    events,
    locations,
    tickets,
    userEducations,
    users,
    workerRegistrations,
} from "../../db/schema";
import { recordAdminAction } from "../../services/auditLog";
import { computeEducationExpiry } from "../../services/educations";
import {
    adminDerive,
    isSuperadmin,
    superadminDerive,
} from "../middleware/auth";
import { AppError } from "../middleware/error";
import { exportRoutes } from "./exports";
import { superadminUserRoutes } from "./superadminUsers";

// Body validation for /reference-data endpoints. Kept here so the schemas
// live next to the routes that use them.
const locationBody = t.Object({
    name: t.String({ minLength: 1, maxLength: 100 }),
    description: t.Optional(t.String({ maxLength: 500 })),
    // `active` gates the public picker (`getEventById` /
    // `listEvents` / `getEventById` still joins freely, so existing
    // events keep showing their location name). Defaults to true on
    // POST; on PUT it's only updated when the field is present.
    active: t.Optional(t.Boolean()),
});
const educationTypeBody = t.Object({
    name: t.String({ minLength: 1, maxLength: 100 }),
    description: t.Optional(t.String({ maxLength: 500 })),
    validityMonths: t.Optional(
        t.Union([t.Null(), t.Integer({ minimum: 0, maximum: 120 })]),
    ),
    // Per-locale fields — the admin UI edits SV/EN versions
    // independently. Stored as the canonical fallback for the
    // legacy `name`/`description` columns: the renderer's locale
    // cascade (EN → SV → `name`) makes `name` the safety net.
    nameSv: t.Optional(t.String({ maxLength: 100 })),
    nameEn: t.Optional(t.String({ maxLength: 100 })),
    descriptionSv: t.Optional(t.String({ maxLength: 500 })),
    descriptionEn: t.Optional(t.String({ maxLength: 500 })),
});
const idParams = t.Object({ id: t.String() });

// Translate Postgres SQLSTATE codes thrown by the postgres-js driver into
// the project's AppError shape. Reference data is short-lived and the
// caller is one form away, so we don't bother with a generic middleware.
// Drizzle wraps the underlying PostgresError in a DrizzleQueryError; the
// original is reachable via `.cause`, so we look at both surfaces.
function isPgErrorWithCode(err: unknown, code: string): boolean {
    if (typeof err !== "object" || err === null) return false;
    if ("code" in err && (err as { code: unknown }).code === code) return true;
    const cause = (err as { cause?: unknown }).cause;
    if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        (cause as { code: unknown }).code === code
    ) {
        return true;
    }
    return false;
}

// Reference-data lookup tables. Locations stay superadmin-only (the
// `active` toggle on locations affects what shows up in event
// creation — a heavy foot-gun). Education-types are relaxable to
// admin: the lookup lists are derived data the rest of the app reads
// from but the names are stable enough for an admin to manage
// safely. Each table is mounted as its own Elysia instance so the
// `derive` chain can set the right tier per table.
export const locationReferenceRoutes = new Elysia({
    prefix: "/reference-data",
})
    .derive(superadminDerive)
    .get("/locations", async () => {
        // GET stays unfiltered so superadmins can re-activate
        // retired locations. The public picker filters on
        // `locations.active`; see src/api/index.ts.
        return db.select().from(locations).orderBy(locations.name);
    })
    .post(
        "/locations",
        async ({ body, user: actor }) => {
            const name = body.name.trim();
            const description = body.description?.trim() || null;
            const active = body.active ?? true;
            try {
                const [row] = await db
                    .insert(locations)
                    .values({ name, description, active })
                    .returning();
                await recordAdminAction(
                    actor.id,
                    "reference.location.create",
                    null,
                    { newValue: row },
                );
                return row;
            } catch (err) {
                if (isPgErrorWithCode(err, "23505")) {
                    throw new AppError(
                        "A location with this name already exists",
                        409,
                        "LOCATION_NAME_TAKEN",
                    );
                }
                throw err;
            }
        },
        { body: locationBody },
    )
    .put(
        "/locations/:id",
        async ({ body, params, user: actor }) => {
            const id = parseInt(params.id, 10);
            if (Number.isNaN(id)) {
                throw new AppError("Invalid id", 400, "INVALID_ID");
            }
            const [existing] = await db
                .select()
                .from(locations)
                .where(eq(locations.id, id))
                .limit(1);
            if (!existing) {
                throw new AppError(
                    "Location not found",
                    404,
                    "LOCATION_NOT_FOUND",
                );
            }
            const name = body.name.trim();
            const description = body.description?.trim() || null;
            const setValues: Partial<typeof locations.$inferInsert> = {
                name,
                description,
            };
            if (body.active !== undefined) {
                setValues.active = body.active;
            }
            try {
                const [row] = await db
                    .update(locations)
                    .set(setValues)
                    .where(eq(locations.id, id))
                    .returning();
                await recordAdminAction(
                    actor.id,
                    "reference.location.update",
                    null,
                    { oldValue: existing, newValue: row },
                );
                return row;
            } catch (err) {
                if (isPgErrorWithCode(err, "23505")) {
                    throw new AppError(
                        "A location with this name already exists",
                        409,
                        "LOCATION_NAME_TAKEN",
                    );
                }
                throw err;
            }
        },
        { body: locationBody, params: idParams },
    )
    .delete(
        "/locations/:id",
        async ({ params, user: actor }) => {
            const id = parseInt(params.id, 10);
            if (Number.isNaN(id)) {
                throw new AppError("Invalid id", 400, "INVALID_ID");
            }
            const [existing] = await db
                .select()
                .from(locations)
                .where(eq(locations.id, id))
                .limit(1);
            if (!existing) {
                throw new AppError(
                    "Location not found",
                    404,
                    "LOCATION_NOT_FOUND",
                );
            }
            try {
                await db.delete(locations).where(eq(locations.id, id));
            } catch (err) {
                if (isPgErrorWithCode(err, "23503")) {
                    throw new AppError(
                        "Location is in use by one or more events",
                        409,
                        "LOCATION_IN_USE",
                    );
                }
                throw err;
            }
            await recordAdminAction(
                actor.id,
                "reference.location.delete",
                null,
                { oldValue: existing },
            );
            return { success: true };
        },
        { params: idParams },
    );

export const educationTypeReferenceRoutes = new Elysia({
    prefix: "/reference-data",
})
    .derive(adminDerive)
    .get("/education-types", async () => {
        return db.select().from(educationTypes).orderBy(educationTypes.name);
    })
    .post(
        "/education-types",
        async ({ body, user: actor }) => {
            const name = body.name.trim();
            const description = body.description?.trim() || null;
            const validityMonths = body.validityMonths ?? null;
            const nameSv = body.nameSv?.trim() || null;
            const nameEn = body.nameEn?.trim() || null;
            const descriptionSv = body.descriptionSv?.trim() || null;
            const descriptionEn = body.descriptionEn?.trim() || null;
            try {
                const [row] = await db
                    .insert(educationTypes)
                    .values({
                        name,
                        description,
                        validityMonths,
                        nameSv,
                        nameEn,
                        descriptionSv,
                        descriptionEn,
                    })
                    .returning();
                await recordAdminAction(
                    actor.id,
                    "reference.education_type.create",
                    null,
                    { newValue: row },
                );
                return row;
            } catch (err) {
                if (isPgErrorWithCode(err, "23505")) {
                    throw new AppError(
                        "An education type with this name already exists",
                        409,
                        "EDUCATION_TYPE_NAME_TAKEN",
                    );
                }
                throw err;
            }
        },
        { body: educationTypeBody },
    )
    .put(
        "/education-types/:id",
        async ({ body, params, user: actor }) => {
            const id = parseInt(params.id, 10);
            if (Number.isNaN(id)) {
                throw new AppError("Invalid id", 400, "INVALID_ID");
            }
            const [existing] = await db
                .select()
                .from(educationTypes)
                .where(eq(educationTypes.id, id))
                .limit(1);
            if (!existing) {
                throw new AppError(
                    "Education type not found",
                    404,
                    "EDUCATION_TYPE_NOT_FOUND",
                );
            }
            const name = body.name.trim();
            const description = body.description?.trim() || null;
            const validityMonths = body.validityMonths ?? null;
            const nameSv = body.nameSv?.trim() || null;
            const nameEn = body.nameEn?.trim() || null;
            const descriptionSv = body.descriptionSv?.trim() || null;
            const descriptionEn = body.descriptionEn?.trim() || null;
            try {
                const [row] = await db
                    .update(educationTypes)
                    .set({
                        name,
                        description,
                        validityMonths,
                        nameSv,
                        nameEn,
                        descriptionSv,
                        descriptionEn,
                    })
                    .where(eq(educationTypes.id, id))
                    .returning();
                await recordAdminAction(
                    actor.id,
                    "reference.education_type.update",
                    null,
                    { oldValue: existing, newValue: row },
                );
                return row;
            } catch (err) {
                if (isPgErrorWithCode(err, "23505")) {
                    throw new AppError(
                        "An education type with this name already exists",
                        409,
                        "EDUCATION_TYPE_NAME_TAKEN",
                    );
                }
                throw err;
            }
        },
        { body: educationTypeBody, params: idParams },
    )
    .delete(
        "/education-types/:id",
        async ({ params, user: actor }) => {
            const id = parseInt(params.id, 10);
            if (Number.isNaN(id)) {
                throw new AppError("Invalid id", 400, "INVALID_ID");
            }
            const [existing] = await db
                .select()
                .from(educationTypes)
                .where(eq(educationTypes.id, id))
                .limit(1);
            if (!existing) {
                throw new AppError(
                    "Education type not found",
                    404,
                    "EDUCATION_TYPE_NOT_FOUND",
                );
            }
            try {
                await db
                    .delete(educationTypes)
                    .where(eq(educationTypes.id, id));
            } catch (err) {
                if (isPgErrorWithCode(err, "23503")) {
                    throw new AppError(
                        "Education type is in use by one or more user educations",
                        409,
                        "EDUCATION_TYPE_IN_USE",
                    );
                }
                throw err;
            }
            await recordAdminAction(
                actor.id,
                "reference.education_type.delete",
                null,
                { oldValue: existing },
            );
            return { success: true };
        },
        { params: idParams },
    );

export const adminRoutes = new Elysia({ prefix: "/admin" })
    .derive(adminDerive)
    .use(exportRoutes)
    .use(locationReferenceRoutes)
    .use(educationTypeReferenceRoutes)
    .use(superadminUserRoutes)
    .post(
        "/verify",
        async ({ body, user: actor }) => {
            const result = await db
                .select()
                .from(users)
                .where(eq(users.id, body.userId))
                .limit(1);

            if (result.length === 0) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            const previousVerified = result[0].verified;
            const [updated] = await db
                .update(users)
                .set({ verified: true, updatedAt: new Date() })
                .where(eq(users.id, body.userId))
                .returning();

            await recordAdminAction(
                actor.id,
                "user.verified.set",
                body.userId,
                {
                    oldValue: previousVerified,
                    newValue: true,
                },
            );

            return {
                id: updated.id,
                email: updated.email,
                name: updated.name,
                nickname: updated.nickname,
                verified: updated.verified,
            };
        },
        {
            body: t.Object({
                userId: t.String(),
            }),
        },
    )
    .post(
        "/education",
        async ({ body, user: actor }) => {
            const targetUser = await db
                .select()
                .from(users)
                .where(eq(users.id, body.userId))
                .limit(1);

            if (targetUser.length === 0) {
                throw new AppError("User not found", 404, "USER_NOT_FOUND");
            }

            const eduType = await db
                .select()
                .from(educationTypes)
                .where(eq(educationTypes.id, body.educationTypeId))
                .limit(1);

            if (eduType.length === 0) {
                throw new AppError(
                    "Education type not found",
                    404,
                    "EDUCATION_TYPE_NOT_FOUND",
                );
            }

            // Expiry math lives in one place now — both this single-user
            // grant and the bulk grant below call computeEducationExpiry.
            const completedAt = new Date();
            const expiresAt = computeEducationExpiry(
                eduType[0].validityMonths,
                completedAt,
            );

            const existing = await db
                .select()
                .from(userEducations)
                .where(
                    and(
                        eq(userEducations.userId, body.userId),
                        eq(
                            userEducations.educationTypeId,
                            body.educationTypeId,
                        ),
                    ),
                )
                .limit(1);

            if (existing.length > 0) {
                await db
                    .update(userEducations)
                    .set({
                        completedAt,
                        expiresAt,
                        verifiedBy: actor.id,
                    })
                    .where(
                        and(
                            eq(userEducations.userId, body.userId),
                            eq(
                                userEducations.educationTypeId,
                                body.educationTypeId,
                            ),
                        ),
                    );
            } else {
                await db.insert(userEducations).values({
                    userId: body.userId,
                    educationTypeId: body.educationTypeId,
                    completedAt,
                    expiresAt,
                    verifiedBy: actor.id,
                });
            }

            await recordAdminAction(
                actor.id,
                "user.education.grant",
                body.userId,
                {
                    newValue: { educationTypeId: body.educationTypeId },
                },
            );

            return { success: true };
        },
        {
            body: t.Object({
                userId: t.String(),
                educationTypeId: t.Number(),
            }),
        },
    )
    // ─── bulk grant (admin + superadmin) ─────────────────────────────
    // Two-tab UI at /admin/education-grant:
    //   • mode="event"  → resolve workers from worker_registrations
    //   • mode="users"  → trust the body's userIds array
    // Single atomic INSERT ... ON CONFLICT DO UPDATE on the
    // (user_id, education_type_id) composite PK. Idempotent:
    // re-running just re-certifies (the same operation as a fresh
    // grant via the single-user endpoint above).
    .post(
        "/education/bulk",
        async ({ body, user: actor }) => {
            // ── 1. Resolve target user ids ──────────────────────────────
            let userIds: string[];

            if (body.mode === "event") {
                if (!body.eventId) {
                    throw new AppError(
                        "Missing eventId for mode=event",
                        400,
                        "MISSING_EVENT_ID",
                    );
                }
                const eventRow = await db
                    .select({ id: events.id })
                    .from(events)
                    .where(eq(events.id, body.eventId))
                    .limit(1);
                if (eventRow.length === 0) {
                    throw new AppError(
                        "Event not found",
                        404,
                        "EVENT_NOT_FOUND",
                    );
                }
                const rows = await db
                    .select({ userId: workerRegistrations.userId })
                    .from(workerRegistrations)
                    .where(eq(workerRegistrations.eventId, body.eventId));
                userIds = rows.map((r) => r.userId);
            } else {
                if (!body.userIds || body.userIds.length === 0) {
                    throw new AppError(
                        "No users selected",
                        400,
                        "NO_USERS_SELECTED",
                    );
                }
                userIds = body.userIds;
            }

            if (userIds.length === 0) {
                throw new AppError(
                    "No users selected",
                    400,
                    "NO_USERS_SELECTED",
                );
            }

            // ── 2. Validate education type ─────────────────────────────
            const eduType = await db
                .select()
                .from(educationTypes)
                .where(eq(educationTypes.id, body.educationTypeId))
                .limit(1);
            if (eduType.length === 0) {
                throw new AppError(
                    "Education type not found",
                    404,
                    "EDUCATION_TYPE_NOT_FOUND",
                );
            }

            // ── 3. Compute expiry once ─────────────────────────────────
            const completedAt = new Date(body.completedAt);
            if (Number.isNaN(completedAt.getTime())) {
                throw new AppError(
                    "Invalid completedAt timestamp",
                    400,
                    "INVALID_COMPLETED_AT",
                );
            }
            const expiresAt = computeEducationExpiry(
                eduType[0].validityMonths,
                completedAt,
            );

            // ── 4. Atomic upsert — single SQL over the composite PK ─────
            await db
                .insert(userEducations)
                .values(
                    userIds.map((uid) => ({
                        userId: uid,
                        educationTypeId: body.educationTypeId,
                        completedAt,
                        expiresAt,
                        verifiedBy: actor.id,
                    })),
                )
                .onConflictDoUpdate({
                    target: [
                        userEducations.userId,
                        userEducations.educationTypeId,
                    ],
                    set: {
                        completedAt,
                        expiresAt,
                        verifiedBy: actor.id,
                    },
                });

            // ── 5. Audit row (single log entry for the batch) ──────────
            await recordAdminAction(
                actor.id,
                "user.education.grant.bulk",
                null,
                {
                    newValue: {
                        educationTypeId: body.educationTypeId,
                        userIds,
                        completedAt: completedAt.toISOString(),
                        count: userIds.length,
                        mode: body.mode,
                        eventId:
                            body.mode === "event"
                                ? (body.eventId ?? null)
                                : null,
                    },
                },
            );

            return {
                success: true,
                granted: userIds.length,
                skipped: 0,
            };
        },
        {
            body: t.Object({
                mode: t.Union([t.Literal("event"), t.Literal("users")]),
                educationTypeId: t.Number(),
                completedAt: t.String({ format: "date-time" }),
                // Per-mode optional fields; presence is enforced inside
                // the handler (Elysia 1.x doesn't expose a tagged-union
                // body validator, so we validate manually).
                eventId: t.Optional(t.String({ format: "uuid" })),
                userIds: t.Optional(
                    t.Array(t.String({ format: "uuid" }), {
                        maxItems: 500,
                    }),
                ),
            }),
        },
    )
    .delete(
        "/education",
        async ({ body, user: actor }) => {
            const result = await db
                .delete(userEducations)
                .where(
                    and(
                        eq(userEducations.userId, body.userId),
                        eq(
                            userEducations.educationTypeId,
                            body.educationTypeId,
                        ),
                    ),
                )
                .returning();

            if (result.length === 0) {
                throw new AppError(
                    "Education not found for this user",
                    404,
                    "EDUCATION_NOT_FOUND",
                );
            }

            await recordAdminAction(
                actor.id,
                "user.education.revoke",
                body.userId,
                {
                    oldValue: { educationTypeId: body.educationTypeId },
                },
            );

            return { success: true };
        },
        {
            body: t.Object({
                userId: t.String(),
                educationTypeId: t.Number(),
            }),
        },
    )
    .get(
        "/users",
        async ({ query }) => {
            const limit = parseInt(query?.limit ?? "50", 10);
            const offset = parseInt(query?.offset ?? "0", 10);

            // Legacy placeholder rows (created by import-legacy.ts, targeted
            // for the migration flow at /admin/migrate) are filtered out of
            // the admin user table — admins manage real accounts here. The
            // dedicated migration page is the place to inspect placeholders.
            const result = await db
                .select({
                    id: users.id,
                    email: users.email,
                    nickname: users.nickname,
                    name: users.name,
                    verified: users.verified,
                    emailVerified: users.emailVerified,
                    role: users.role,
                    createdAt: users.createdAt,
                })
                .from(users)
                .where(eq(users.isLegacy, false))
                .limit(limit)
                .offset(offset);

            return result;
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
            }),
        },
    )
    .get("/education-types", async () => {
        return db.select().from(educationTypes);
    })
    // Search users (same legacy-placeholder filter as the list endpoint —
    // see comment on GET /users above for the rationale).
    .get("/users/search/:query", async ({ params }) => {
        const searchTerm = `%${params.query}%`;
        return db
            .select({
                id: users.id,
                email: users.email,
                nickname: users.nickname,
                name: users.name,
                verified: users.verified,
                emailVerified: users.emailVerified,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(
                and(
                    eq(users.isLegacy, false),
                    or(
                        ilike(users.email, searchTerm),
                        ilike(users.name, searchTerm),
                        ilike(users.nickname, searchTerm),
                    ),
                ),
            )
            .limit(50);
    })
    // User detail with educations + tickets
    .get("/users/:id", async ({ params }) => {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                nickname: users.nickname,
                name: users.name,
                profilePic: users.profilePic,
                description: users.description,
                emailVerified: users.emailVerified,
                verified: users.verified,
                role: users.role,
                isLegacy: users.isLegacy,
                seenMigrationPrompt: users.seenMigrationPrompt,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .where(eq(users.id, params.id))
            .limit(1);
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");

        const educations = await db
            .select({
                educationTypeId: educationTypes.id,
                name: educationTypes.name,
                description: educationTypes.description,
                completedAt: userEducations.completedAt,
                expiresAt: userEducations.expiresAt,
            })
            .from(userEducations)
            .innerJoin(
                educationTypes,
                eq(userEducations.educationTypeId, educationTypes.id),
            )
            .where(eq(userEducations.userId, params.id));

        const userTickets = await db
            .select({
                id: tickets.id,
                eventName: events.name,
                eventStartDate: events.startDate,
                isActive: tickets.isActive,
                createdAt: tickets.createdAt,
                redeemedAt: tickets.redeemedAt,
            })
            .from(tickets)
            .innerJoin(events, eq(tickets.eventId, events.id))
            .where(eq(tickets.userId, params.id))
            .orderBy(desc(tickets.createdAt));

        return { user, educations, tickets: userTickets };
    })
    // Edit user
    .put(
        "/users/:id",
        async ({ body, params, user: actor }) => {
            // Load the existing record so we can audit only what changed.
            const [existing] = await db
                .select()
                .from(users)
                .where(eq(users.id, params.id))
                .limit(1);
            if (!existing)
                throw new AppError("User not found", 404, "USER_NOT_FOUND");

            const updateData: Partial<typeof users.$inferInsert> = {
                updatedAt: new Date(),
            };
            // Role-change scoping: only superadmins may promote, demote, or
            // touch anyone whose current role is admin/superadmin. Admins
            // keep the ability to toggle a regular user between `user` and
            // `responsible` (e.g. once they've completed the responsible
            // education). All other profile fields stay admin-or-superadmin.
            if (body.role !== undefined) {
                const touchesPrivilegedRole =
                    body.role === "admin" ||
                    body.role === "superadmin" ||
                    existing.role === "admin" ||
                    existing.role === "superadmin";
                if (touchesPrivilegedRole && !isSuperadmin(actor.role)) {
                    throw new AppError(
                        "Only superadmins can change admin/superadmin roles",
                        403,
                        "FORBIDDEN",
                    );
                }
                updateData.role = body.role;
            }
            if (body.name !== undefined) updateData.name = body.name;
            if (body.nickname !== undefined)
                updateData.nickname = body.nickname;
            if (body.emailVerified !== undefined)
                updateData.emailVerified = body.emailVerified;
            if (body.verified !== undefined)
                updateData.verified = body.verified;

            const [updated] = await db
                .update(users)
                .set(updateData)
                .where(eq(users.id, params.id))
                .returning();

            if (!updated)
                throw new AppError("User not found", 404, "USER_NOT_FOUND");

            // Audit role changes explicitly — this is the highest-impact
            // privileged mutation, so it deserves its own audit_action.
            if (body.role !== undefined && body.role !== existing.role) {
                await recordAdminAction(
                    actor.id,
                    "user.role.change",
                    params.id,
                    {
                        oldValue: existing.role,
                        newValue: body.role,
                    },
                );
            }
            if (
                body.verified !== undefined &&
                body.verified !== existing.verified
            ) {
                await recordAdminAction(
                    actor.id,
                    "user.verified.set",
                    params.id,
                    {
                        oldValue: existing.verified,
                        newValue: body.verified,
                    },
                );
            }
            if (
                body.emailVerified !== undefined &&
                body.emailVerified !== existing.emailVerified
            ) {
                await recordAdminAction(
                    actor.id,
                    "user.email_verified.set",
                    params.id,
                    {
                        oldValue: existing.emailVerified,
                        newValue: body.emailVerified,
                    },
                );
            }
            // Generic profile update audit if anything other than verified flags changed.
            const profileChanged =
                (body.name !== undefined && body.name !== existing.name) ||
                (body.nickname !== undefined &&
                    body.nickname !== existing.nickname);
            if (profileChanged) {
                await recordAdminAction(
                    actor.id,
                    "user.profile.update",
                    params.id,
                    {
                        oldValue: {
                            name: existing.name,
                            nickname: existing.nickname,
                        },
                        newValue: {
                            name: updated.name,
                            nickname: updated.nickname,
                        },
                    },
                );
            }

            const { passwordHash: _omit, ...safeUser } = updated;
            return safeUser;
        },
        {
            body: t.Object({
                name: t.Optional(t.String()),
                nickname: t.Optional(t.String()),
                role: t.Optional(
                    t.Union([
                        t.Literal("user"),
                        t.Literal("admin"),
                        t.Literal("superadmin"),
                    ]),
                ),
                emailVerified: t.Optional(t.Boolean()),
                verified: t.Optional(t.Boolean()),
            }),
        },
    )
    // Events list for ticket issuance
    .get("/events", async () => {
        return db
            .select({
                id: events.id,
                name: events.name,
                startDate: events.startDate,
            })
            .from(events)
            .orderBy(desc(events.startDate))
            .limit(100);
    })
    // Audit log — read-only listing for superadmins. Useful for
    // accountability around ticket lifecycle, role changes, education grants,
    // invitations, etc. Strictly above admin: only superadmins may read.
    .get(
        "/audit-log",
        async ({ query, user: actor }) => {
            // adminDerive already authenticated an admin OR superadmin, so
            // we additionally enforce the strict superadmin check here.
            // 403 is the right shape for an API (clients expect JSON, not
            // redirects).
            if (actor.role !== "superadmin") {
                throw new AppError(
                    "Superadmin access required",
                    403,
                    "FORBIDDEN",
                );
            }
            const limit = Math.min(
                parseInt(query?.limit ?? "100", 10) || 100,
                500,
            );
            const actionFilter = query?.action;
            const where = actionFilter
                ? eq(auditLog.action, actionFilter)
                : undefined;
            return db
                .select({
                    id: auditLog.id,
                    actorId: auditLog.actorId,
                    action: auditLog.action,
                    targetUserId: auditLog.targetUserId,
                    oldValue: auditLog.oldValue,
                    newValue: auditLog.newValue,
                    createdAt: auditLog.createdAt,
                })
                .from(auditLog)
                .where(where as never)
                .orderBy(desc(auditLog.createdAt))
                .limit(limit);
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
                action: t.Optional(t.String()),
            }),
        },
    );
