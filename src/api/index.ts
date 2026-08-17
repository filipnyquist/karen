// src/api/index.ts
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { eventStates, locations } from "../db/schema";
import { csrfPlugin } from "./middleware/csrf";
import { AppError, errorPlugin } from "./middleware/error";
import { rateLimitPlugin } from "./middleware/rateLimit";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { commentRoutes } from "./routes/comments";
import { eventLiveRoutes } from "./routes/eventLive";
import { eventRoutes } from "./routes/events";
import { guestRoutes } from "./routes/guests";
import { invitationRoutes } from "./routes/invitations";
import { migrationRoutes } from "./routes/migration";
import { profileRoutes } from "./routes/profiles";
import { reportRoutes } from "./routes/reports";
import { teamRoutes } from "./routes/teams";
import { ticketRoutes } from "./routes/tickets";
import { uploadRoutes } from "./routes/uploads";
import { workerRoutes } from "./routes/workers";

export const api = new Elysia({ prefix: "/api" })
    // Public reference data endpoints
    .get("/locations", async () => {
        // Filter retired locations out of the event-creation picker.
        // The createEvent service applies the same filter server-side
        // so API-only bypass is closed too. The admin GET route
        // (superadmin-only) intentionally returns all rows.
        return db
            .select()
            .from(locations)
            .where(eq(locations.active, true))
            .orderBy(locations.name);
    })
    .get("/event-states", async () => {
        return db.select().from(eventStates);
    })
    .use(errorPlugin)
    .use(rateLimitPlugin)
    .use(csrfPlugin)
    .onError(({ error, set }) => {
        if (
            error instanceof AppError ||
            ("statusCode" in error && "code" in error)
        ) {
            const appErr = error as AppError;
            set.status = appErr.statusCode;
            return { error: appErr.message, code: appErr.code };
        }
        // Elysia schema-validation failures throw a ValidationError.
        // Surface them as 400 instead of the catch-all 500 so clients
        // see actionable messages (e.g., "token is required").
        const errName = error?.constructor?.name;
        if (
            errName === "ValidationError" ||
            errName === "ElysiaValidationError"
        ) {
            set.status = 400;
            return {
                error:
                    (error as { message?: string })?.message ??
                    "Validation failed",
                code: "VALIDATION_ERROR",
            };
        }
        if (error instanceof Error) {
            console.error("Unhandled error:", error);
            set.status = 500;
            return { error: "Internal server error", code: "INTERNAL_ERROR" };
        }
        console.error("Unknown error:", error);
        set.status = 500;
        return { error: "Internal server error", code: "INTERNAL_ERROR" };
    })
    .use(authRoutes)
    .use(eventRoutes)
    .use(eventLiveRoutes)
    .use(workerRoutes)
    .use(guestRoutes)
    .use(commentRoutes)
    .use(reportRoutes)
    .use(profileRoutes)
    .use(teamRoutes)
    .use(adminRoutes)
    .use(invitationRoutes)
    .use(ticketRoutes)
    .use(uploadRoutes)
    .use(migrationRoutes)
    .get("/health", () => ({ status: "ok" }));
