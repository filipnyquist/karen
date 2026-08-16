// src/db/seed.ts

import { eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "./index";
import { educationTypes, eventStates, locations, users } from "./schema";

async function seed() {
    console.log("Seeding database...");

    // Education types
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
        console.log("  ✓ Education types seeded");
    }

    // Event states
    const existingStates = await db.select().from(eventStates);
    if (existingStates.length === 0) {
        await db
            .insert(eventStates)
            .values([{ name: "yes" }, { name: "no" }, { name: "maybe" }]);
        console.log("  ✓ Event states seeded");
    }

    // Locations
    const existingLocations = await db.select().from(locations);
    if (existingLocations.length === 0) {
        await db.insert(locations).values([
            { name: "Villan", description: "The main pub building" },
            { name: ".kauren", description: "The secondary location" },
        ]);
        console.log("  ✓ Locations seeded");
    }

    // Admin user
    const adminEmail = "admin@karen.se";
    const existingAdmin = await db
        .select()
        .from(users)
        .where(eq(users.email, adminEmail));
    if (existingAdmin.length === 0) {
        const hash = await Bun.password.hash(config.adminPassword(), "bcrypt");
        await db.insert(users).values({
            email: adminEmail,
            passwordHash: hash,
            name: "Admin",
            nickname: "admin",
            emailVerified: true,
            verified: true,
            role: "admin",
        });
        console.log("  ✓ Admin user created (admin@karen.se)");
    }

    // Superadmin user — strictly above `admin`. Seeded idempotently from a
    // separate env var (SUPERADMIN_PASSWORD) so existing deployments don't
    // silently elevate admin@karen.se. Only created when the row is missing.
    const superadminEmail = "superadmin@karen.se";
    const existingSuperadmin = await db
        .select()
        .from(users)
        .where(eq(users.email, superadminEmail));
    if (existingSuperadmin.length === 0) {
        const hash = await Bun.password.hash(
            config.superadminPassword(),
            "bcrypt",
        );
        await db.insert(users).values({
            email: superadminEmail,
            passwordHash: hash,
            name: "Super Admin",
            nickname: "superadmin",
            emailVerified: true,
            verified: true,
            role: "superadmin",
        });
        console.log("  ✓ Superadmin user created (superadmin@karen.se)");
    }

    console.log("Seed complete.");
}

seed()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
