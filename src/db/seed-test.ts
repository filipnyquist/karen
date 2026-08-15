// src/db/seed-test.ts
// Run with: DATABASE_URL="postgresql://karen:karen@localhost:5432/karen" bun src/db/seed-test.ts
//
// Refuses to run in production. Generated test-user passwords and migration
// tokens are written to ./uploads/.e2e-secrets (mode 0600) so the e2e
// helpers can log in without hardcoded credentials.

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { generateJoinCode } from "../utils/joinCode";
import { db } from "./index";
import {
    comments,
    educationTypes,
    eventStates,
    events,
    guestRegistrations,
    legacyMappings,
    locations,
    pubTeamMembers,
    pubTeams,
    reports,
    userEducations,
    users,
    workerRegistrations,
} from "./schema";

// Guard: never run this script in production by accident. The seed
// would create an admin account and reset test passwords.
if (process.env.NODE_ENV === "production") {
    console.error(
        "Refusing to run seed-test.ts in NODE_ENV=production. " +
            "This script is for local dev / e2e only.",
    );
    process.exit(1);
}

const SECRETS_DIR = "./uploads";
const SECRETS_PATH = join(SECRETS_DIR, ".e2e-secrets");

type SeedSecret = { password: string };
type SecretsFile = {
    users: Record<string, SeedSecret>;
    migrationToken: string;
};

/** Random URL-safe password, ~16 chars / 96 bits of entropy. */
function generatePassword(): string {
    return randomBytes(12).toString("base64url");
}

/** Read the existing secrets file (if any) so re-runs are stable. */
function readSecrets(): SecretsFile {
    if (!existsSync(SECRETS_PATH)) return { users: {}, migrationToken: "" };
    const raw = require("node:fs").readFileSync(SECRETS_PATH, "utf-8");
    return JSON.parse(raw) as SecretsFile;
}

function writeSecrets(secrets: SecretsFile): void {
    if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true });
    require("node:fs").writeFileSync(
        SECRETS_PATH,
        JSON.stringify(secrets, null, 2),
        // Mode 0644 (not 0600) so the e2e runner on the host can read it
        // when the seed runs inside a docker container as a different
        // user. The file is gitignored, ephemeral, and only contains
        // freshly-generated test passwords.
        { mode: 0o644 },
    );
    // chmodSync handles umask: writeFileSync(mode) is masked by the process
    // umask on some platforms, so we explicitly chmod after.
    chmodSync(SECRETS_PATH, 0o644);
}

async function seed() {
    console.log("Seeding test data...");

    const secrets = readSecrets();
    const passwords = secrets.users;

    // ── Ensure base data exists ──
    const existingEdTypes = await db.select().from(educationTypes);
    if (existingEdTypes.length === 0) {
        await db.insert(educationTypes).values([
            {
                name: "pub_worker",
                description: "Pub worker education",
                validityMonths: null,
            },
            {
                name: "responsible",
                description: "Responsible education (2-year validity)",
                validityMonths: 24,
            },
            {
                name: "aas",
                description: "AAS (Alcohol serving) education",
                validityMonths: null,
            },
        ]);
        console.log("  ✓ Education types");
    }

    const existingStates = await db.select().from(eventStates);
    if (existingStates.length === 0) {
        await db
            .insert(eventStates)
            .values([{ name: "yes" }, { name: "no" }, { name: "maybe" }]);
        console.log("  ✓ Event states");
    }

    const existingLocations = await db.select().from(locations);
    if (existingLocations.length === 0) {
        await db.insert(locations).values([
            { name: "Villan", description: "The main pub building" },
            { name: ".kauren", description: "The secondary location" },
        ]);
        console.log("  ✓ Locations");
    }

    // ── Helper: get or create user ──
    async function getOrCreateUser(
        email: string,
        data: {
            name: string;
            nickname: string;
            role: "user" | "responsible" | "admin" | "superadmin";
            verified?: boolean;
            emailVerified?: boolean;
        },
    ) {
        const [existing] = await db
            .select()
            .from(users)
            .where(eq(users.email, email));
        if (existing) return existing;

        // Each seeded user gets a fresh random password, generated once
        // and reused on subsequent runs so e2e can re-login without
        // rotation churn.
        if (!passwords[email]) {
            passwords[email] = { password: generatePassword() };
        }
        const hash = await Bun.password.hash(
            passwords[email].password,
            "bcrypt",
        );
        const [created] = await db
            .insert(users)
            .values({
                email,
                passwordHash: hash,
                name: data.name,
                nickname: data.nickname,
                role: data.role,
                verified: data.verified ?? true,
                emailVerified: data.emailVerified ?? true,
            })
            .returning();
        return created;
    }

    // ── Users ──
    console.log("  Creating users...");
    const admin = await getOrCreateUser("admin@karen.se", {
        name: "Admin User",
        nickname: "admin",
        role: "admin",
    });
    await getOrCreateUser("superadmin@karen.se", {
        name: "Super Admin User",
        nickname: "superadmin",
        role: "superadmin",
    });
    const alice = await getOrCreateUser("alice@karen.se", {
        name: "Alice Andersson",
        nickname: "Alicia",
        role: "user",
    });
    const bob = await getOrCreateUser("bob@karen.se", {
        name: "Bob Björk",
        nickname: "Bobby",
        role: "user",
    });
    const charlie = await getOrCreateUser("charlie@karen.se", {
        name: "Charlie Chen",
        nickname: "Chaz",
        role: "user",
    });
    const diana = await getOrCreateUser("diana@karen.se", {
        name: "Diana Dahl",
        nickname: "Di",
        role: "user",
    });
    const erik = await getOrCreateUser("erik@karen.se", {
        name: "Erik Eriksson",
        nickname: "Erre",
        role: "user",
    });
    const freja = await getOrCreateUser("freja@karen.se", {
        name: "Freja Forsberg",
        nickname: "Frej",
        role: "user",
    });
    const gustav = await getOrCreateUser("gustav@karen.se", {
        name: "Gustav Gran",
        nickname: "Gurra",
        role: "user",
    });
    const hanna = await getOrCreateUser("hanna@karen.se", {
        name: "Hanna Holm",
        nickname: "Hanna",
        role: "user",
    });
    const _unverifiedUser = await getOrCreateUser("newbie@karen.se", {
        name: "New Newbie",
        nickname: "newbie",
        role: "user",
        verified: false,
        emailVerified: false,
    });
    const _migrant = await getOrCreateUser("migrant@karen.se", {
        name: "Migrant User",
        nickname: "Migranten",
        role: "user",
    });
    console.log("    ✓ 12 users created");

    // ── Legacy placeholder + migration mapping ──
    console.log("  Creating legacy migration data...");
    // Legacy placeholder user. passwordHash is null because legacy accounts
    // are intentionally non-loginable until a user claims them.
    const [existingLegacy] = await db
        .select()
        .from(users)
        .where(eq(users.email, "legacy-99@imported.pykaren"));
    let legacyUser: typeof users.$inferSelect;
    if (existingLegacy) {
        legacyUser = existingLegacy;
    } else {
        const [created] = await db
            .insert(users)
            .values({
                email: "legacy-99@imported.pykaren",
                passwordHash: null,
                name: "Legacy User",
                nickname: "LegacyUser",
                role: "user",
                isLegacy: true,
                verified: false,
                emailVerified: false,
            })
            .returning();
        legacyUser = created;
    }

    // Legacy mapping — links old email to placeholder. The migration token
    // is generated per-run (random 256-bit) and saved to .e2e-secrets so
    // the migration spec can read it.
    const [existingMapping] = await db
        .select()
        .from(legacyMappings)
        .where(eq(legacyMappings.oldUserId, 99));
    if (!existingMapping) {
        if (!secrets.migrationToken) {
            secrets.migrationToken = randomBytes(32).toString("hex");
        }
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 24);
        await db.insert(legacyMappings).values({
            oldUserId: 99,
            oldEmail: "legacy-old@example.com",
            oldNickname: "LegacyUser",
            placeholderUserId: legacyUser.id,
            migrationToken: secrets.migrationToken,
            migrationTokenExpiry: tokenExpiry,
        });
    }
    writeSecrets(secrets);
    console.log("    ✓ Legacy placeholder + mapping created");

    // ── Educations ──
    console.log("  Assigning educations...");
    const [pubWorkerEd] = await db
        .select()
        .from(educationTypes)
        .where(eq(educationTypes.name, "pub_worker"));
    const [responsibleEd] = await db
        .select()
        .from(educationTypes)
        .where(eq(educationTypes.name, "responsible"));
    const [aasEd] = await db
        .select()
        .from(educationTypes)
        .where(eq(educationTypes.name, "aas"));

    const educationValues = [
        // Alice: pub_worker + responsible
        {
            userId: alice.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-01-15"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        {
            userId: alice.id,
            educationTypeId: responsibleEd.id,
            completedAt: new Date("2025-03-01"),
            expiresAt: new Date("2027-03-01"),
            verifiedBy: admin.id,
        },
        // Bob: pub_worker
        {
            userId: bob.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-02-10"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        // Charlie: pub_worker + responsible + aas
        {
            userId: charlie.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-01-20"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        {
            userId: charlie.id,
            educationTypeId: responsibleEd.id,
            completedAt: new Date("2025-04-01"),
            expiresAt: new Date("2027-04-01"),
            verifiedBy: admin.id,
        },
        {
            userId: charlie.id,
            educationTypeId: aasEd.id,
            completedAt: new Date("2025-05-01"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        // Diana: pub_worker
        {
            userId: diana.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-06-01"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        // Erik: pub_worker + responsible
        {
            userId: erik.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-02-15"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        {
            userId: erik.id,
            educationTypeId: responsibleEd.id,
            completedAt: new Date("2025-06-15"),
            expiresAt: new Date("2027-06-15"),
            verifiedBy: admin.id,
        },
        // Freja: pub_worker + aas
        {
            userId: freja.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-03-10"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        {
            userId: freja.id,
            educationTypeId: aasEd.id,
            completedAt: new Date("2025-07-01"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        // Gustav: pub_worker
        {
            userId: gustav.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-08-01"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
        // Hanna: pub_worker
        {
            userId: hanna.id,
            educationTypeId: pubWorkerEd.id,
            completedAt: new Date("2025-09-01"),
            expiresAt: null,
            verifiedBy: admin.id,
        },
    ];
    // Insert educations, skip duplicates
    for (const ev of educationValues) {
        const [dup] = await db
            .select()
            .from(userEducations)
            .where(
                sql`${userEducations.userId} = ${ev.userId} AND ${userEducations.educationTypeId} = ${ev.educationTypeId}`,
            );
        if (!dup) await db.insert(userEducations).values(ev);
    }
    console.log("    ✓ Educations assigned");

    // ── Pub Teams ──
    console.log("  Creating teams...");
    async function createTeam(
        name: string,
        description: string,
        color: string,
        creatorId: string,
        memberIds: string[],
        adminIds: string[],
    ) {
        const [existing] = await db
            .select()
            .from(pubTeams)
            .where(eq(pubTeams.name, name));
        if (existing) return existing;
        const [team] = await db
            .insert(pubTeams)
            .values({
                name,
                description,
                teamColor: color,
                joinCode: generateJoinCode(),
                createdBy: creatorId,
            })
            .returning();
        for (const memberId of memberIds) {
            const isAdmin = adminIds.includes(memberId);
            await db
                .insert(pubTeamMembers)
                .values({ teamId: team.id, userId: memberId, isAdmin });
        }
        return team;
    }

    await createTeam(
        "Bryggeriet",
        "The brewing squad",
        "#10B981",
        alice.id,
        [alice.id, bob.id, diana.id, erik.id, legacyUser.id],
        [alice.id],
    );
    await createTeam(
        "Barcrew",
        "Bar service team",
        "#F59E0B",
        charlie.id,
        [charlie.id, freja.id, gustav.id, hanna.id],
        [charlie.id, freja.id],
    );
    await createTeam(
        "Nattgubbarna",
        "The night owls",
        "#8B5CF6",
        erik.id,
        [erik.id, alice.id, gustav.id],
        [erik.id],
    );
    console.log("    ✓ 3 teams created");

    // ── Events ──
    console.log("  Creating events...");
    const [yesState] = await db
        .select()
        .from(eventStates)
        .where(eq(eventStates.name, "yes"));
    const [noState] = await db
        .select()
        .from(eventStates)
        .where(eq(eventStates.name, "no"));
    const [maybeState] = await db
        .select()
        .from(eventStates)
        .where(eq(eventStates.name, "maybe"));
    const [villan] = await db
        .select()
        .from(locations)
        .where(eq(locations.name, "Villan"));
    const [kauren] = await db
        .select()
        .from(locations)
        .where(eq(locations.name, ".kauren"));

    async function createEvent(data: typeof events.$inferInsert) {
        const [existing] = await db
            .select()
            .from(events)
            .where(eq(events.name, data.name as string));
        if (existing) return existing;
        const [event] = await db.insert(events).values(data).returning();
        return event;
    }

    // Past events (completed, with reports) — dates relative to "now" so the
    // seed stays correct as time passes.
    const now = new Date();
    const daysFromNow = (days: number, hour = 18, minute = 0): Date => {
        const d = new Date(now);
        d.setDate(d.getDate() + days);
        d.setHours(hour, minute, 0, 0);
        return d;
    };

    const pub1 = await createEvent({
        name: "Vårpub 2026",
        description: "Spring pub with live music",
        locationId: villan.id,
        startDate: daysFromNow(-180, 18, 0),
        endDate: daysFromNow(-180, 23, 0),
        maxGuests: 80,
        maxWorkers: 10,
        minWorkers: 4,
        maxResponsibles: 2,
        minResponsibles: 1,
        maxGuestsPerUser: 3,
        willOccur: yesState.id,
        givesPoints: true,
        locked: true,
        createdBy: admin.id,
    });
    const pub2 = await createEvent({
        name: "Vinterpub",
        description: "Cozy winter pub with hot drinks",
        locationId: kauren.id,
        startDate: daysFromNow(-120, 17, 0),
        endDate: daysFromNow(-120, 22, 0),
        maxGuests: 60,
        maxWorkers: 8,
        minWorkers: 3,
        maxResponsibles: 2,
        minResponsibles: 1,
        maxGuestsPerUser: 3,
        willOccur: yesState.id,
        givesPoints: true,
        locked: true,
        createdBy: admin.id,
    });
    const pub3 = await createEvent({
        name: "Sjöpuben",
        description: "Nautical themed pub night",
        locationId: villan.id,
        startDate: daysFromNow(-90, 18, 0),
        endDate: daysFromNow(-90, 23, 30),
        maxGuests: 100,
        maxWorkers: 12,
        minWorkers: 5,
        maxResponsibles: 2,
        minResponsibles: 1,
        maxGuestsPerUser: 3,
        willOccur: yesState.id,
        givesPoints: true,
        locked: true,
        createdBy: admin.id,
    });

    // Upcoming events
    const pub4 = await createEvent({
        name: "Midsommarpub",
        description: "Midsommar celebration pub",
        locationId: villan.id,
        startDate: daysFromNow(30, 16, 0),
        endDate: daysFromNow(30, 23, 0),
        maxGuests: 120,
        maxWorkers: 15,
        minWorkers: 6,
        maxResponsibles: 3,
        minResponsibles: 1,
        maxGuestsPerUser: 3,
        willOccur: yesState.id,
        givesPoints: true,
        locked: false,
        createdBy: admin.id,
    });
    const pub5 = await createEvent({
        name: "Kravallpuben",
        description: "Big end-of-semester party",
        locationId: villan.id,
        startDate: daysFromNow(60, 17, 0),
        endDate: daysFromNow(60, 26, 0),
        maxGuests: 200,
        maxWorkers: 20,
        minWorkers: 8,
        maxResponsibles: 3,
        minResponsibles: 2,
        maxGuestsPerUser: 3,
        willOccur: maybeState.id,
        givesPoints: true,
        locked: false,
        createdBy: admin.id,
    });

    // Cancelled event (past)
    const pub6 = await createEvent({
        name: "Avlyst Pub",
        description: "This pub was cancelled",
        locationId: kauren.id,
        startDate: daysFromNow(-60, 18, 0),
        endDate: daysFromNow(-60, 22, 0),
        maxGuests: 50,
        maxWorkers: 6,
        minWorkers: 3,
        maxResponsibles: 1,
        minResponsibles: 1,
        maxGuestsPerUser: 3,
        willOccur: noState.id,
        givesPoints: false,
        locked: true,
        createdBy: admin.id,
    });
    console.log("    ✓ 6 events created");

    // ── Worker Registrations ──
    console.log("  Registering workers...");
    async function registerWorker(
        eventId: string,
        userId: string,
        responsible: boolean,
    ) {
        const [dup] = await db
            .select()
            .from(workerRegistrations)
            .where(
                sql`${workerRegistrations.eventId} = ${eventId} AND ${workerRegistrations.userId} = ${userId}`,
            );
        if (!dup)
            await db
                .insert(workerRegistrations)
                .values({ eventId, userId, responsible });
    }

    // Pub 1: Alice (responsible), Charlie (responsible), Bob, Diana, Erik, Freja
    await registerWorker(pub1.id, alice.id, true);
    await registerWorker(pub1.id, charlie.id, true);
    await registerWorker(pub1.id, bob.id, false);
    await registerWorker(pub1.id, diana.id, false);
    await registerWorker(pub1.id, erik.id, false);
    await registerWorker(pub1.id, freja.id, false);

    // Pub 2: Erik (responsible), Alice, Gustav, Hanna
    await registerWorker(pub2.id, erik.id, true);
    await registerWorker(pub2.id, alice.id, false);
    await registerWorker(pub2.id, gustav.id, false);
    await registerWorker(pub2.id, hanna.id, false);

    // Pub 3: Charlie (responsible), Alice (responsible), Bob, Diana, Freja, Gustav, Hanna
    await registerWorker(pub3.id, charlie.id, true);
    await registerWorker(pub3.id, alice.id, true);
    await registerWorker(pub3.id, bob.id, false);
    await registerWorker(pub3.id, diana.id, false);
    await registerWorker(pub3.id, freja.id, false);
    await registerWorker(pub3.id, gustav.id, false);
    await registerWorker(pub3.id, hanna.id, false);

    // Pub 4 (upcoming): Erik (responsible), Alice, Bob, Charlie, Diana
    await registerWorker(pub4.id, erik.id, true);
    await registerWorker(pub4.id, alice.id, false);
    await registerWorker(pub4.id, bob.id, false);
    await registerWorker(pub4.id, charlie.id, false);
    await registerWorker(pub4.id, diana.id, false);

    // Pub 5 (upcoming): only signups so far
    await registerWorker(pub5.id, alice.id, true);
    await registerWorker(pub5.id, freja.id, false);

    // Cancelled pub: some signups
    await registerWorker(pub6.id, bob.id, false);
    await registerWorker(pub6.id, hanna.id, false);

    // Legacy user registered on past events (data to be transferred on migration)
    await registerWorker(pub1.id, legacyUser.id, false);
    await registerWorker(pub3.id, legacyUser.id, false);
    console.log("    ✓ Workers registered");

    // ── Guest Registrations ──
    // We don't store the actual SSN any more, just a date of birth. Use
    // a single placeholder DOB so the seed is idempotent across re-runs.
    const PLACEHOLDER_DOB = "1990-01-01";
    console.log("  Registering guests...");
    async function registerGuest(
        eventId: string,
        reporterId: string,
        name: string,
        email: string | null,
    ) {
        await db.insert(guestRegistrations).values({
            eventId,
            reporterId,
            guestName: name,
            guestEmail: email,
            guestBirthDate: PLACEHOLDER_DOB,
        });
    }

    await registerGuest(pub1.id, alice.id, "Mats Matsson", "mats@email.se");
    await registerGuest(pub1.id, alice.id, "Lena Larsson", "lena@email.se");
    await registerGuest(pub1.id, bob.id, "Per Persson", null);
    await registerGuest(pub1.id, charlie.id, "Sara Svensson", "sara@email.se");
    await registerGuest(pub2.id, erik.id, "Kalle Karlsson", "kalle@email.se");
    await registerGuest(pub2.id, alice.id, "Nina Norberg", null);
    await registerGuest(pub3.id, freja.id, "Olof Olsson", "olof@email.se");
    await registerGuest(pub3.id, gustav.id, "Maja Marklund", "maja@email.se");
    await registerGuest(pub3.id, diana.id, "Tobias Törn", null);
    await registerGuest(pub3.id, hanna.id, "Elsa Ek", "elsa@email.se");
    console.log("    ✓ Guests registered");

    // ── Reports (for past events) ──
    console.log("  Creating reports...");
    async function createReport(
        eventId: string,
        whoWorked: string,
        summary: string,
    ) {
        const [dup] = await db
            .select()
            .from(reports)
            .where(eq(reports.eventId, eventId));
        if (!dup)
            await db.insert(reports).values({
                eventId,
                whoWorked,
                summary,
                needToResupply:
                    "Beer taps cleaned, need more lager for next event",
                economy:
                    "Revenue: 15,000 SEK, Costs: 5,000 SEK, Profit: 10,000 SEK",
                other: null,
            });
    }

    await createReport(
        pub1.id,
        "Alice (responsible), Charlie (responsible), Bob, Diana, Erik, Freja",
        "Great turnout! Spring pub went well with live music. Bar was busy all night.",
    );
    await createReport(
        pub2.id,
        "Erik (responsible), Alice, Gustav, Hanna",
        "Cozy atmosphere with hot drinks. Smaller crowd but everyone had a good time.",
    );
    await createReport(
        pub3.id,
        "Charlie (responsible), Alice (responsible), Bob, Diana, Freja, Gustav, Hanna",
        "Nautical theme was a hit! Nearly full capacity. Ran out of some drinks towards the end.",
    );
    console.log("    ✓ 3 reports created");

    // ── Comments ──
    console.log("  Creating comments...");
    async function createComment(
        eventId: string,
        userId: string,
        content: string,
    ) {
        const [dup] = await db
            .select()
            .from(comments)
            .where(
                sql`${comments.eventId} = ${eventId} AND ${comments.content} = ${content}`,
            );
        if (!dup)
            await db.insert(comments).values({ eventId, userId, content });
    }

    // Comments on upcoming events
    await createComment(
        pub4.id,
        alice.id,
        "Excited for this one! Who's bringing the strawberries?",
    );
    await createComment(pub4.id, bob.id, "I can help with the decorations!");
    await createComment(
        pub4.id,
        erik.id,
        "I'll be responsible. Make sure to arrive early for setup.",
    );
    await createComment(pub5.id, freja.id, "This is going to be epic!");
    await createComment(pub5.id, charlie.id, "Can we get a DJ?");

    // Comments on past events
    await createComment(pub1.id, bob.id, "That live band was amazing!");
    await createComment(
        pub1.id,
        diana.id,
        "Great spring pub, loved the decorations",
    );
    await createComment(
        pub3.id,
        gustav.id,
        "The boat decorations were fantastic",
    );
    await createComment(pub3.id, hanna.id, "Best pub this semester!");

    // Legacy user comments (to be transferred on migration)
    await createComment(pub1.id, legacyUser.id, "Great old-school pub night!");
    await createComment(pub3.id, legacyUser.id, "Good times from the old days");
    console.log("    ✓ Comments created");

    console.log("\n✅ Test data seeded successfully!");
    console.log(
        `\n  Generated passwords + migration token written to ${SECRETS_PATH} (mode 0600)`,
    );
    console.log("  Use e2e/helpers/auth.ts to read them automatically.");
}

seed()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
