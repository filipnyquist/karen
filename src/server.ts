// src/server.ts — production server using Node http + ws

import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { eq } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { handler } from "../dist/server/entry.mjs";
import { loadSessionUser } from "./api/middleware/auth";
import { db } from "./db";
import { events } from "./db/schema";
import { mimeForFilename, UPLOAD_DIR } from "./lib/uploads";
import type { ReportMeta } from "./lib/yjs-types";
import { subscribe } from "./realtime/event-bus";
import { isResponsibleOrAdmin } from "./services/report-auth";
import {
    closeDoc,
    ensureLoaded,
    getYDoc,
    markDirty,
    saveAllDirty,
} from "./services/yjs-persistence";

const port = parseInt(process.env.PORT ?? "3000", 10);

// Single-byte notification we ship to WS clients after each save.
// The byte value (0x02) sits alongside the existing 0x00 (implicit
// Yjs update) and 0x01 (awareness) prefixes.
const SAVED_FRAME = new Uint8Array([0x02]);

// Room-based connection tracking
const rooms = new Map<string, Set<WebSocket>>();

function broadcast(
    roomId: string,
    data: Buffer | Uint8Array,
    exclude?: WebSocket,
) {
    const room = rooms.get(roomId);
    if (!room) return;
    for (const client of room) {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}

const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // Serve uploaded files
    if (url.pathname.startsWith("/uploads/")) {
        // path.basename prevents path traversal (e.g. /uploads/../../etc/passwd)
        const basename = path.basename(url.pathname);
        const filepath = path.join(UPLOAD_DIR, basename);
        if (existsSync(filepath)) {
            const file = Bun.file(filepath);
            const contentType = mimeForFilename(basename);
            file.arrayBuffer()
                .then((buf) => {
                    res.writeHead(200, {
                        "Content-Type": contentType,
                        "Content-Length": String(buf.byteLength),
                    });
                    res.end(Buffer.from(buf));
                })
                .catch(() => {
                    res.writeHead(500);
                    res.end("Internal error");
                });
            return;
        }
        res.writeHead(404);
        res.end("Not found");
        return;
    }

    handler(req, res);
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
    // /ws/event/:eventId — anonymous-friendly "event <X> changed"
    // notifications. No role gate because the event detail page is
    // already partially public-readable via SSR; the frames are
    // themselves harmless (no PII).
    if (req.url?.startsWith("/ws/event/")) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.pathname.replace("/ws/event/", "").split("/")[0];
        if (!eventId) {
            socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, async (ws) => {
            // Verify the event exists. Reject subscriptions to a stale
            // / fabricated id so a typo'd URL can't pin a room open.
            const [evt] = await db
                .select({ id: events.id })
                .from(events)
                .where(eq(events.id, eventId))
                .limit(1);
            if (!evt) {
                try {
                    ws.close(1008, "event not found");
                } catch {
                    /* ignore */
                }
                return;
            }
            const unsubscribe = subscribe(eventId, {
                send: (frame) => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
                },
            });
            ws.on("close", unsubscribe);
            ws.on("error", unsubscribe);
        });
        return;
    }

    if (!req.url?.startsWith("/ws/report/")) {
        socket.destroy();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const eventId = url.pathname.replace("/ws/report/", "").split("/")[0];
    if (!eventId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
    }

    // Build a Request for auth helpers
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const fakeReq = new Request(`http://${req.headers.host}${req.url}`, {
        headers,
    });

    (async () => {
        try {
            const user = await loadSessionUser(fakeReq);
            if (!user) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }

            const authorized = await isResponsibleOrAdmin(
                user.id,
                user.role,
                eventId,
            );
            if (!authorized) {
                socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
                socket.destroy();
                return;
            }

            const docId = `report:${eventId}`;
            getYDoc(docId, eventId);

            wss.handleUpgrade(req, socket, head, async (ws) => {
                // Deterministic color per user so peers recognise
                // them across reloads.
                const COLORS = [
                    "bg-blue-500",
                    "bg-emerald-500",
                    "bg-violet-500",
                    "bg-amber-500",
                    "bg-rose-500",
                    "bg-cyan-500",
                ];
                let hash = 0;
                for (let i = 0; i < user.id.length; i++) {
                    hash = (hash * 31 + user.id.charCodeAt(i)) >>> 0;
                }
                (ws as unknown as { __reportMeta: ReportMeta }).__reportMeta = {
                    userId: user.id,
                    eventId,
                    docId,
                    name: user.name ?? user.nickname ?? "Anonymous",
                    color: COLORS[hash % COLORS.length],
                };

                let room = rooms.get(docId);
                if (!room) {
                    room = new Set();
                    rooms.set(docId, room);
                }
                room.add(ws);

                const doc = getYDoc(docId, eventId);
                // Wait for the initial DB snapshot to land in the doc.
                // Without this, the first client after a restart gets an
                // empty snapshot because the loadDocInto async hasn't
                // completed yet.
                await ensureLoaded(docId);
                const update = Y.encodeStateAsUpdate(doc);
                // Prefix with 0x00 (FRAME_DOC_UPDATE) so the client can
                // route it as a doc update regardless of the first byte
                // Yjs happens to emit. The old byteLength > 2 guard
                // existed only because the receiving client relied on
                // the first byte alone to discriminate from awareness.
                const frame = new Uint8Array(update.byteLength + 1);
                frame[0] = 0x00;
                frame.set(update, 1);
                ws.send(frame);

                wss.emit("connection", ws, req);
            });
        } catch (e) {
            console.error("WS upgrade error:", e);
            socket.destroy();
        }
    })();
});

wss.on("connection", (ws) => {
    const meta = (ws as unknown as { __reportMeta: ReportMeta }).__reportMeta;

    ws.on("message", (raw) => {
        const data =
            typeof raw === "string"
                ? new TextEncoder().encode(raw)
                : new Uint8Array(raw as ArrayBuffer);

        // Doc-update frames start with 0x00 (FRAME_DOC_UPDATE). The
        // prefix is required — Y.encodeStateAsUpdate's first byte can
        // legitimately be 0x01, so without it we'd mis-route real
        // doc updates as awareness and silently drop them.
        if (data.byteLength > 0 && data[0] === 0x00) {
            const doc = getYDoc(meta.docId, meta.eventId);
            Y.applyUpdate(doc, data.subarray(1));
            broadcast(meta.docId, data, ws);
            markDirty(meta.docId);
            return;
        }

        // Awareness frames start with 0x01 and contain JSON-encoded
        // y-protocols/awareness state. Forward them to peers without
        // applying them to the Y.Doc — they're not Yjs updates.
        if (data.byteLength > 0 && data[0] === 0x01) {
            broadcast(meta.docId, data, ws);
            return;
        }

        // Unknown frame type — ignore.
    });

    ws.on("close", () => {
        const room = rooms.get(meta.docId);
        if (room) {
            room.delete(ws);
            if (room.size === 0) {
                rooms.delete(meta.docId);
                closeDoc(meta.docId).catch((e) =>
                    console.error(`Failed to close Yjs doc ${meta.docId}:`, e),
                );
            }
        }
    });
});

// Periodic save of dirty docs (every 5 seconds). Each save fires
// the `notify` callback after the two DB writes succeed, so we can
// broadcast a 0x02 frame to every WS in the affected room.
setInterval(() => {
    saveAllDirty((docId) => {
        broadcast(docId, SAVED_FRAME);
    }).catch((e) => console.error("Periodic Yjs save failed:", e));
}, 5000);

httpServer.listen(port, () => {
    console.log(`Karen running on http://localhost:${port}`);
});
