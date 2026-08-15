// src/db/schema.ts

import { relations, sql } from "drizzle-orm";
import {
    boolean,
    customType,
    index,
    integer,
    pgEnum,
    pgTable,
    primaryKey,
    serial,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; notNull: false }>({
    dataType() {
        return "bytea";
    },
});

// Role enum — constrains the column to a known set so we don't accept
// typos or accidental role-string drift from request bodies.
//
// `superadmin` is a strict superset of `admin`: a superadmin can do
// everything an admin can, plus invite users with a chosen role,
// change other users' roles (including admins/superadmins), and read
// the audit log. Added at the end so the underlying Postgres `ADD
// VALUE` migration appends safely (ALTER TYPE ... ADD VALUE cannot
// be re-ordered retroactively).
export const userRoleEnum = pgEnum("user_role", [
    "user",
    "responsible",
    "admin",
    "superadmin",
]);

// ─── Users & Auth ───

export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        email: text("email").notNull().unique(),
        // Nullable: legacy / placeholder accounts (created during data import)
        // have no password — login() rejects null with INVALID_CREDENTIALS.
        // Nullable: legacy-import.pykaren users have no password (they authenticate
        // via the migration flow that re-points a legacy placeholder to a new
        // account). Real signups always populate this.
        passwordHash: text("password_hash"),
        nickname: text("nickname"),
        name: text("name"),
        profilePic: text("profile_pic"),
        description: text("description"),
        // The member's own personnummer, shown to event responsibles alongside
        // the guests this member signed in. Same at-rest scheme as
        // guest_registrations.guest_ssn: AES-encrypted value plus an HMAC blind
        // index over the normalized form (see src/lib/ssn.ts) so we can check
        // "is this personnummer already claimed" without decrypting the column.
        // Nullable: existing accounts predate the field and fill it in on first
        // guest signup.
        ssn: text("ssn"),
        ssnHash: text("ssn_hash"),
        emailVerified: boolean("email_verified").default(false),
        verified: boolean("verified").default(false),
        role: userRoleEnum("role").default("user").notNull(),
        isLegacy: boolean("is_legacy").default(false),
        seenMigrationPrompt: boolean("seen_migration_prompt")
            .default(false)
            .notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => [
        // Partial: two accounts must not claim the same personnummer, but the
        // many rows that have not set one yet all stay NULL and unconstrained.
        uniqueIndex("users_ssn_hash_unique")
            .on(t.ssnHash)
            .where(sql`${t.ssnHash} IS NOT NULL`),
    ],
);

export const sessions = pgTable("sessions", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const verificationPins = pgTable("verification_pins", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    pin: text("pin").notNull(),
    verified: boolean("verified").default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ─── Education System ───

export const educationTypes = pgTable("education_types", {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    validityMonths: integer("validity_months"),
});

export const userEducations = pgTable(
    "user_educations",
    {
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        educationTypeId: integer("education_type_id")
            .notNull()
            .references(() => educationTypes.id),
        completedAt: timestamp("completed_at", {
            withTimezone: true,
        }).notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        verifiedBy: uuid("verified_by")
            .notNull()
            // ON DELETE RESTRICT: deleting an admin who has verified
            // education records blocks loudly rather than silently
            // orphaning the education. Force the operator to reassign
            // verifications first.
            .references(() => users.id, { onDelete: "restrict" }),
    },
    (table) => [primaryKey({ columns: [table.userId, table.educationTypeId] })],
);

// ─── Events ───

export const locations = pgTable("locations", {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
});

export const eventStates = pgTable("event_states", {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
});

export const events = pgTable("events", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    locationId: integer("location_id")
        .notNull()
        .references(() => locations.id),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    maxGuests: integer("max_guests"),
    maxResponsibles: integer("max_responsibles"),
    maxWorkers: integer("max_workers"),
    minResponsibles: integer("min_responsibles"),
    minWorkers: integer("min_workers"),
    maxGuestsPerUser: integer("max_guests_per_user").default(3),
    willOccur: integer("will_occur")
        .notNull()
        .references(() => eventStates.id),
    givesPoints: boolean("gives_points").default(true),
    locked: boolean("locked").default(false),
    createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ─── Registrations ───

export const workerRegistrations = pgTable(
    "worker_registrations",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        responsible: boolean("responsible").default(false),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        uniqueIndex("worker_event_user_unique").on(table.eventId, table.userId),
    ],
);

export const guestRegistrations = pgTable(
    "guest_registrations",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        reporterId: uuid("reporter_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        guestName: text("guest_name").notNull(),
        guestEmail: text("guest_email"),
        guestSsn: text("guest_ssn"),
        guestSsnHash: text("guest_ssn_hash"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        uniqueIndex("guest_ssn_event_unique").on(
            table.guestSsnHash,
            table.eventId,
        ),
    ],
);

// ─── Comments ───

export const comments = pgTable("comments", {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
        .notNull()
        .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ─── Reports ───

export const reports = pgTable("reports", {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
        .notNull()
        .references(() => events.id)
        .unique(),
    whoWorked: text("who_worked"),
    summary: text("summary"),
    needToResupply: text("need_to_resupply"),
    economy: text("economy"),
    other: text("other"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ─── Tickets ───

export const tickets = pgTable(
    "tickets",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        eventId: uuid("event_id")
            .notNull()
            // Provenance — where this ticket was earned. Tickets are
            // queue-skip rewards and can be redeemed at any event where
            // the holder has scanner permission; this FK is NOT used to
            // gate redemption.
            .references(() => events.id, { onDelete: "cascade" }),
        token: text("token").notNull().unique(),
        isActive: boolean("is_active").default(true),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
        redeemedAtEventId: uuid("redeemed_at_event_id").references(
            () => events.id,
            { onDelete: "set null" },
        ),
    },
    (table) => [
        // DB-level guarantee: a user cannot hold two active tickets for
        // the same event. Catches the TOCTOU race in issueTicket.
        uniqueIndex("tickets_one_active_per_user_event")
            .on(table.userId, table.eventId)
            .where(sql`${table.isActive} = true`),
        // Hot read paths: getUserTickets, getEventTickets, /tickets/mine.
        index("tickets_user_active_idx").on(table.userId, table.isActive),
        index("tickets_event_active_idx").on(table.eventId, table.isActive),
    ],
);

// ─── Pub Teams ───

export const pubTeams = pgTable("pub_teams", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    teamColor: text("team_color"),
    teamPic: text("team_pic"),
    // 8-char base32 join code. Always required — teams are invite-only by
    // default, no open enrollment. Regenerate via the team-admin endpoint
    // to invalidate an old code.
    joinCode: varchar("join_code", { length: 8 }).notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

export const pubTeamMembers = pgTable(
    "pub_team_members",
    {
        teamId: uuid("team_id")
            .notNull()
            .references(() => pubTeams.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        isAdmin: boolean("is_admin").default(false),
    },
    (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);

// ─── Legacy Migration ───

export const legacyMappings = pgTable("legacy_mappings", {
    id: uuid("id").defaultRandom().primaryKey(),
    oldUserId: integer("old_user_id").notNull().unique(),
    oldEmail: varchar("old_email", { length: 254 }).notNull(),
    oldNickname: varchar("old_nickname", { length: 100 }),
    placeholderUserId: uuid("placeholder_user_id").references(() => users.id, {
        onDelete: "set null",
    }),
    realUserId: uuid("real_user_id").references(() => users.id),
    migratedAt: timestamp("migrated_at", { withTimezone: true }),
    migrationToken: varchar("migration_token", { length: 64 }),
    migrationTokenExpiry: timestamp("migration_token_expiry", {
        withTimezone: true,
    }),
    adminRequested: boolean("admin_requested").default(false),
    adminRequestedReason: text("admin_requested_reason"),
});

// ─── Relations ───

export const usersRelations = relations(users, ({ many }) => ({
    sessions: many(sessions),
    educations: many(userEducations),
    workerRegistrations: many(workerRegistrations),
    guestRegistrations: many(guestRegistrations),
    comments: many(comments),
    tickets: many(tickets),
    invitationsCreated: many(invitations, {
        relationName: "invitationsInviter",
    }),
    invitationsAccepted: many(invitations, {
        relationName: "invitationsAccepter",
    }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
    user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const educationTypesRelations = relations(
    educationTypes,
    ({ many }) => ({
        userEducations: many(userEducations),
    }),
);

export const userEducationsRelations = relations(userEducations, ({ one }) => ({
    user: one(users, {
        fields: [userEducations.userId],
        references: [users.id],
    }),
    educationType: one(educationTypes, {
        fields: [userEducations.educationTypeId],
        references: [educationTypes.id],
    }),
    verifier: one(users, {
        fields: [userEducations.verifiedBy],
        references: [users.id],
    }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
    location: one(locations, {
        fields: [events.locationId],
        references: [locations.id],
    }),
    state: one(eventStates, {
        fields: [events.willOccur],
        references: [eventStates.id],
    }),
    creator: one(users, { fields: [events.createdBy], references: [users.id] }),
    workers: many(workerRegistrations),
    guests: many(guestRegistrations),
    comments: many(comments),
    report: one(reports, {
        fields: [events.id],
        references: [reports.eventId],
    }),
    tickets: many(tickets),
}));

export const workerRegistrationsRelations = relations(
    workerRegistrations,
    ({ one }) => ({
        event: one(events, {
            fields: [workerRegistrations.eventId],
            references: [events.id],
        }),
        user: one(users, {
            fields: [workerRegistrations.userId],
            references: [users.id],
        }),
    }),
);

export const guestRegistrationsRelations = relations(
    guestRegistrations,
    ({ one }) => ({
        event: one(events, {
            fields: [guestRegistrations.eventId],
            references: [events.id],
        }),
        reporter: one(users, {
            fields: [guestRegistrations.reporterId],
            references: [users.id],
        }),
    }),
);

export const commentsRelations = relations(comments, ({ one }) => ({
    event: one(events, { fields: [comments.eventId], references: [events.id] }),
    user: one(users, { fields: [comments.userId], references: [users.id] }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
    event: one(events, { fields: [reports.eventId], references: [events.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
    user: one(users, { fields: [tickets.userId], references: [users.id] }),
    event: one(events, { fields: [tickets.eventId], references: [events.id] }),
}));

export const pubTeamsRelations = relations(pubTeams, ({ many }) => ({
    members: many(pubTeamMembers),
}));

export const pubTeamMembersRelations = relations(pubTeamMembers, ({ one }) => ({
    team: one(pubTeams, {
        fields: [pubTeamMembers.teamId],
        references: [pubTeams.id],
    }),
    user: one(users, {
        fields: [pubTeamMembers.userId],
        references: [users.id],
    }),
}));

export const legacyMappingsRelations = relations(legacyMappings, ({ one }) => ({
    placeholderUser: one(users, {
        fields: [legacyMappings.placeholderUserId],
        references: [users.id],
        relationName: "legacyPlaceholder",
    }),
    realUser: one(users, {
        fields: [legacyMappings.realUserId],
        references: [users.id],
        relationName: "legacyReal",
    }),
}));

// ─── Yjs Documents ───

export const ydocs = pgTable("ydocs", {
    docId: text("doc_id").primaryKey(),
    content: bytea("content"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ─── Audit Log ───
// Records every privileged admin action (role change, education grant, etc.)
// so changes can be reviewed and rolled back if needed.
//
// `targetUserId` is polymorphic — it's the user being affected (for
// user-targeted actions like role change, ticket revoke) or NULL for
// resource-targeted actions (e.g. ticket.issue.bulk affects an event, not
// a single user). Earlier versions had a FK to users.id here which
// blocked non-user targets; the FK is now removed.
export const auditLog = pgTable("audit_log", {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
});

// ─── Invitations ───
// Superadmins issue invitations to onboard new users with a chosen
// role. The token in the email link is the only thing that proves
// ownership of the inbox — it's 64 hex chars / 256 bits and never
// reused. The accept flow inserts a new user directly with the
// invited role (skipping email-verification since the invite link
// itself proves ownership).
export const invitations = pgTable("invitations", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    token: text("token").notNull().unique(),
    invitedBy: uuid("invited_by")
        .notNull()
        .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
        onDelete: "set null",
    }),
});

export const invitationsRelations = relations(invitations, ({ one }) => ({
    inviter: one(users, {
        fields: [invitations.invitedBy],
        references: [users.id],
        relationName: "invitationsInviter",
    }),
    accepter: one(users, {
        fields: [invitations.acceptedByUserId],
        references: [users.id],
        relationName: "invitationsAccepter",
    }),
}));

// ─── Type exports ───

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type WorkerRegistration = typeof workerRegistrations.$inferSelect;
export type GuestRegistration = typeof guestRegistrations.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type PubTeam = typeof pubTeams.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type EducationType = typeof educationTypes.$inferSelect;
export type UserEducation = typeof userEducations.$inferSelect;
export type LegacyMapping = typeof legacyMappings.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
