// src/services/yjs-persistence.ts

import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "../db";
import { reports, ydocs } from "../db/schema";

const REPORT_FIELDS = [
    "whoWorked",
    "summary",
    "needToResupply",
    "economy",
    "other",
] as const;

// In-memory Yjs documents, keyed by docId
const docs = new Map<string, Y.Doc>();
// Track which docs have unsaved changes
const dirtyDocs = new Set<string>();

/**
 * Get or create a Y.Doc for a report.
 * Loads from PostgreSQL if not in memory.
 * Seeds from existing reports row if no Yjs snapshot exists.
 */
export function getYDoc(docId: string, eventId: string): Y.Doc {
    let doc = docs.get(docId);
    if (doc) return doc;

    doc = new Y.Doc();
    docs.set(docId, doc);

    // Async load — the doc will be empty until loaded
    loadDocInto(docId, eventId, doc);

    return doc;
}

async function loadDocInto(docId: string, eventId: string, doc: Y.Doc) {
    // Try loading existing Yjs snapshot
    const rows = await db
        .select({ content: ydocs.content })
        .from(ydocs)
        .where(eq(ydocs.docId, docId))
        .limit(1);

    if (rows.length > 0 && rows[0].content) {
        Y.applyUpdate(doc, new Uint8Array(rows[0].content));
        return;
    }

    // No Yjs snapshot — seed from existing reports row
    const reportRows = await db
        .select()
        .from(reports)
        .where(eq(reports.eventId, eventId))
        .limit(1);

    if (reportRows.length > 0) {
        const r = reportRows[0];
        doc.transact(() => {
            for (const field of REPORT_FIELDS) {
                const val = (r as Record<string, unknown>)[field] as
                    | string
                    | null;
                if (val) {
                    doc.getText(field).insert(0, val);
                }
            }
        });
        markDirty(docId);
    }
}

export function markDirty(docId: string): void {
    dirtyDocs.add(docId);
}

/**
 * Save a single Yjs doc to PostgreSQL.
 * Also syncs the plain-text values back to the reports table.
 */
export async function saveDoc(docId: string, eventId: string): Promise<void> {
    const doc = docs.get(docId);
    if (!doc) return;

    const content = Buffer.from(Y.encodeStateAsUpdate(doc));

    // Upsert Yjs snapshot
    await db
        .insert(ydocs)
        .values({ docId, content })
        .onConflictDoUpdate({
            target: ydocs.docId,
            set: { content, updatedAt: new Date() },
        });

    // Sync text values to reports table
    const updates: Record<string, string | null> = {};
    for (const field of REPORT_FIELDS) {
        updates[field] = doc.getText(field).toString() || null;
    }

    await db
        .update(reports)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(reports.eventId, eventId));

    dirtyDocs.delete(docId);
}

/**
 * Save all dirty docs. Called periodically.
 */
export async function saveAllDirty(): Promise<void> {
    const toSave = [...dirtyDocs];
    for (const docId of toSave) {
        // Extract eventId from docId (format: "report:{eventId}")
        const eventId = docId.replace("report:", "");
        try {
            await saveDoc(docId, eventId);
        } catch (e) {
            console.error(`Failed to save Yjs doc ${docId}:`, e);
        }
    }
}

/**
 * Remove a doc from memory. Saves it first.
 */
export async function closeDoc(docId: string): Promise<void> {
    const eventId = docId.replace("report:", "");
    await saveDoc(docId, eventId);
    const doc = docs.get(docId);
    if (doc) {
        doc.destroy();
        docs.delete(docId);
    }
    dirtyDocs.delete(docId);
}
