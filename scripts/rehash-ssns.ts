// scripts/rehash-ssns.ts
// One-time migration to re-normalize existing guest SSNs.
//
// Rows written before src/lib/ssn.ts existed were hashed over whatever the
// user typed, so "900101-1239" and "19900101-1239" produced different
// guest_ssn_hash values and the guest_ssn_event_unique index never caught
// them as the same person. This rewrites both the encrypted value and the
// hash using the canonical form.
//
// Rows that collide once normalized cannot both keep their hash — the unique
// index forbids it. Those are reported for a human to resolve rather than
// silently dropped or force-written.
//
// Run with: bun scripts/rehash-ssns.ts [--apply]
// Without --apply it is a dry run and writes nothing.

import { eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { guestRegistrations } from "../src/db/schema";
import { decrypt, encrypt, hashSsn } from "../src/lib/encryption";
import { parseSsn } from "../src/lib/ssn";

interface Collision {
    eventId: string;
    normalized: string;
    ids: string[];
}

async function main() {
    const apply = process.argv.includes("--apply");
    console.log(
        apply
            ? "Applying SSN re-normalization..."
            : "DRY RUN — pass --apply to write. Nothing will be modified.",
    );

    const guests = await db
        .select({
            id: guestRegistrations.id,
            eventId: guestRegistrations.eventId,
            guestSsn: guestRegistrations.guestSsn,
            guestSsnHash: guestRegistrations.guestSsnHash,
        })
        .from(guestRegistrations)
        .where(isNotNull(guestRegistrations.guestSsn));

    console.log(`Found ${guests.length} guest rows with an SSN.`);

    // Claimed (eventId, normalized) pairs, so we detect a collision before
    // the database does and can report both sides of it.
    const seen = new Map<string, string>();
    const collisions = new Map<string, Collision>();
    const pending: Array<{ id: string; ssn: string; hash: string }> = [];

    let unchanged = 0;
    let undecryptable = 0;

    for (const guest of guests) {
        if (!guest.guestSsn) continue;

        let plaintext: string;
        try {
            plaintext = await decrypt(guest.guestSsn);
        } catch {
            // A value that will not decrypt predates encryption or was
            // written under a different key — never guess at it.
            console.warn(`  ! ${guest.id}: could not decrypt, skipping`);
            undecryptable++;
            continue;
        }

        const parsed = parseSsn(plaintext);
        const key = `${guest.eventId}:${parsed.normalized}`;
        const firstId = seen.get(key);

        if (firstId) {
            const existing = collisions.get(key);
            if (existing) {
                existing.ids.push(guest.id);
            } else {
                collisions.set(key, {
                    eventId: guest.eventId,
                    normalized: parsed.normalized,
                    ids: [firstId, guest.id],
                });
            }
            continue;
        }
        seen.set(key, guest.id);

        const hash = await hashSsn(parsed.normalized);
        if (hash === guest.guestSsnHash && plaintext === parsed.display) {
            unchanged++;
            continue;
        }

        pending.push({
            id: guest.id,
            ssn: await encrypt(parsed.display),
            hash,
        });
    }

    if (apply) {
        for (const row of pending) {
            await db
                .update(guestRegistrations)
                .set({ guestSsn: row.ssn, guestSsnHash: row.hash })
                .where(eq(guestRegistrations.id, row.id));
        }
    }

    console.log(
        `\n${apply ? "Rewritten" : "Would rewrite"}: ${pending.length}` +
            `, already canonical: ${unchanged}` +
            `, undecryptable: ${undecryptable}`,
    );

    if (collisions.size > 0) {
        console.log(
            `\n${collisions.size} duplicate SSN group(s) found. These were ` +
                `left untouched — the same person appears more than once in ` +
                `one event and only one row can keep the hash. Resolve by ` +
                `hand, then re-run:`,
        );
        for (const c of collisions.values()) {
            console.log(
                `  event ${c.eventId}  ${c.normalized}  rows: ${c.ids.join(", ")}`,
            );
        }
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
