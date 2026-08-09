// src/server.ts — production server using Node http + ws

import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { handler } from "../dist/server/entry.mjs";
import { loadSessionUser } from "./api/middleware/auth";
import { mimeForFilename, UPLOAD_DIR } from "./lib/uploads";
import type { ReportMeta } from "./lib/yjs-types";
import { isResponsibleOrAdmin } from "./services/report-auth";
import {
    closeDoc,
    getYDoc,
    markDirty,
    saveAllDirty,
} from "./services/yjs-persistence";

const port = parseInt(process.env.PORT ?? "3000", 10);

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

            wss.handleUpgrade(req, socket, head, (ws) => {
                (ws as unknown as { __reportMeta: ReportMeta }).__reportMeta = {
                    userId: user.id,
                    eventId,
                    docId,
                };

                let room = rooms.get(docId);
                if (!room) {
                    room = new Set();
                    rooms.set(docId, room);
                }
                room.add(ws);

                const doc = getYDoc(docId, eventId);
                const update = Y.encodeStateAsUpdate(doc);
                if (update.byteLength > 2) {
                    ws.send(update);
                }

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

        const doc = getYDoc(meta.docId, meta.eventId);
        Y.applyUpdate(doc, data);

        broadcast(meta.docId, data, ws);
        markDirty(meta.docId);
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

// Periodic save of dirty docs (every 5 seconds)
setInterval(() => {
    saveAllDirty().catch((e) => console.error("Periodic Yjs save failed:", e));
}, 5000);

httpServer.listen(port, () => {
    console.log(`Karen running on http://localhost:${port}`);
});
