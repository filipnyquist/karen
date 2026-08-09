// scripts/encrypt-ssns.ts
// One-time migration to encrypt existing plaintext SSNs.
// Run with: bun scripts/encrypt-ssns.ts

import { eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { guestRegistrations } from "../src/db/schema";
import { encrypt, hashSsn } from "../src/lib/encryption";

async function main() {
    console.log("Fetching guests with plaintext SSNs...");

    const guests = await db
        .select({
            id: guestRegistrations.id,
            guestSsn: guestRegistrations.guestSsn,
        })
        .from(guestRegistrations)
        .where(isNotNull(guestRegistrations.guestSsn));

    console.log(`Found ${guests.length} guests with SSNs.`);

    let migrated = 0;
    let skipped = 0;

    for (const guest of guests) {
        const ssn = guest.guestSsn;
        if (!ssn) continue;

        // Skip already-encrypted values (format: iv:ciphertext, both hex)
        if (ssn.includes(":") && /^[0-9a-f]{24}:[0-9a-f]+$/.test(ssn)) {
            skipped++;
            continue;
        }

        const encrypted = await encrypt(ssn);
        const hash = await hashSsn(ssn);

        await db
            .update(guestRegistrations)
            .set({ guestSsn: encrypted, guestSsnHash: hash })
            .where(eq(guestRegistrations.id, guest.id));

        migrated++;
    }

    console.log(
        `Migrated: ${migrated}, Skipped (already encrypted): ${skipped}`,
    );
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
