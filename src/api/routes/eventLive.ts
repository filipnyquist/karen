// src/api/routes/eventLive.ts
//
// Read-only JSON endpoints that back the polling "live refresh" islands on
// the event detail page. Each returns the same shape as the corresponding
// SSR'd section in src/pages/event/[id].astro so initial paint matches the
// first polled response (no flicker on hydration).
//
// Public endpoints: anonymous visitors can read them. Sensitive fields
// (worker real names, commenter real names) are anonymized server-side
// via `anonymizeName` when the caller is not authenticated, so the
// client never sees a full name for a non-logged-in viewer even
// with DevTools open.

import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
    comments,
    educationTypes,
    events,
    guestRegistrations,
    userEducations,
    users,
    workerRegistrations,
} from "../../db/schema";
import { getEventById } from "../../services/events";
import { anonymizeName } from "../../utils/anonymize";
import { loadSessionUser } from "../middleware/auth";

export const eventLiveRoutes = new Elysia({ prefix: "/events" })
    // GET /api/events/:id/workers — worker rows, same shape as the
    // SSR'd section so hydration is a no-op for unchanged data.
    .get(
        "/:id/workers",
        async ({ request, params }) => {
            await getEventById(params.id);
            const isAuthenticated = !!(await loadSessionUser(request));

            const rows = await db
                .select({
                    id: users.id,
                    nickname: users.nickname,
                    name: users.name,
                    profilePic: users.profilePic,
                    responsible: workerRegistrations.responsible,
                    createdAt: workerRegistrations.createdAt,
                })
                .from(workerRegistrations)
                .innerJoin(users, eq(workerRegistrations.userId, users.id))
                .where(eq(workerRegistrations.eventId, params.id))
                .orderBy(
                    desc(workerRegistrations.responsible),
                    workerRegistrations.createdAt,
                );

            // Mirror the SSR page: include per-worker education flags so
            // the island can render the 🍺 / 🎓 badges without a second
            // fetch. Looks up pub_worker + aas education_type ids in one
            // shot and filters user_educations accordingly — the prior
            // version didn't filter by type, so any education (including
            // just `responsible`) made hasPubWorker = true.
            const workerIds = rows.map((r) => r.id);
            const eduTypes =
                workerIds.length > 0
                    ? await db
                          .select({
                              id: educationTypes.id,
                              name: educationTypes.name,
                          })
                          .from(educationTypes)
                    : [];
            const pubWorkerTypeId = eduTypes.find(
                (t) => t.name === "pub_worker",
            )?.id;
            const aasTypeId = eduTypes.find((t) => t.name === "aas")?.id;

            const eduRows =
                workerIds.length > 0
                    ? await db
                          .select({
                              userId: userEducations.userId,
                              educationTypeId: userEducations.educationTypeId,
                          })
                          .from(userEducations)
                          .where(
                              and(
                                  inArray(userEducations.userId, workerIds),
                                  or(
                                      pubWorkerTypeId
                                          ? eq(
                                                userEducations.educationTypeId,
                                                pubWorkerTypeId,
                                            )
                                          : undefined,
                                      aasTypeId
                                          ? eq(
                                                userEducations.educationTypeId,
                                                aasTypeId,
                                            )
                                          : undefined,
                                  ),
                              ),
                          )
                    : [];
            const pubWorkerSet = new Set<string>();
            const aasSet = new Set<string>();
            for (const row of eduRows) {
                if (pubWorkerTypeId && row.educationTypeId === pubWorkerTypeId)
                    pubWorkerSet.add(row.userId);
                if (aasTypeId && row.educationTypeId === aasTypeId)
                    aasSet.add(row.userId);
            }
            return rows.map((r) => ({
                ...r,
                // Server-side anonymization: a non-logged-in viewer gets
                // the truncated name. Authenticated users get the full
                // name. The island just renders what we return.
                name: isAuthenticated
                    ? r.name
                    : (anonymizeName(r.name, false) as string | null),
                hasPubWorker: pubWorkerSet.has(r.id),
                hasAas: aasSet.has(r.id),
            }));
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )
    // GET /api/events/:id/comments — most recent 50 comments, same
    // shape as the SSR query. userName is anonymized server-side for
    // non-auth viewers; userNickname is always public.
    .get(
        "/:id/comments",
        async ({ request, params }) => {
            await getEventById(params.id);
            const isAuthenticated = !!(await loadSessionUser(request));

            const rows = await db
                .select({
                    id: comments.id,
                    content: comments.content,
                    createdAt: comments.createdAt,
                    userId: comments.userId,
                    userName: users.name,
                    userNickname: users.nickname,
                })
                .from(comments)
                .innerJoin(users, eq(comments.userId, users.id))
                .where(eq(comments.eventId, params.id))
                .orderBy(desc(comments.createdAt))
                .limit(50);
            return rows.map((r) => ({
                ...r,
                userName: isAuthenticated
                    ? r.userName
                    : (anonymizeName(r.userName, false) as string | null),
            }));
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )
    // GET /api/events/:id/counts — small aggregate for the capacity
    // counters. Always returns totals (the privacy-sensitive "all guests"
    // list is a separate endpoint gated by canSeeAllGuests).
    .get(
        "/:id/counts",
        async ({ params }) => {
            const [event] = await db
                .select({
                    maxWorkers: events.maxWorkers,
                    maxGuests: events.maxGuests,
                    maxGuestsPerUser: events.maxGuestsPerUser,
                })
                .from(events)
                .where(eq(events.id, params.id))
                .limit(1);
            if (!event) {
                return {
                    workers: 0,
                    maxWorkers: null,
                    guests: 0,
                    maxGuests: null,
                    maxGuestsPerUser: 3,
                };
            }

            const [{ workerCount }] = await db
                .select({ workerCount: count() })
                .from(workerRegistrations)
                .where(eq(workerRegistrations.eventId, params.id));
            const [{ guestCount }] = await db
                .select({ guestCount: count() })
                .from(guestRegistrations)
                .where(eq(guestRegistrations.eventId, params.id));

            return {
                workers: Number(workerCount),
                maxWorkers: event.maxWorkers,
                guests: Number(guestCount),
                maxGuests: event.maxGuests,
                maxGuestsPerUser: event.maxGuestsPerUser ?? 3,
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
