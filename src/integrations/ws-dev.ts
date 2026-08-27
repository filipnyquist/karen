// src/integrations/ws-dev.ts
// Vite plugin that adds WebSocket support for /ws/report/* during astro dev.
// This mirrors the Bun.serve() websocket handler in src/server.ts.

import { eq } from "drizzle-orm";
import type { PluginOption, ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { loadSessionUser } from "../api/middleware/auth";
import { db } from "../db";
import { events } from "../db/schema";
import type { ReportMeta } from "../lib/yjs-types";
import { subscribe } from "../realtime/event-bus";
import { isResponsibleOrAdmin } from "../services/report-auth";
import {
    closeDoc,
    ensureLoaded,
    getYDoc,
    markDirty,
    saveAllDirty,
} from "../services/yjs-persistence";

// Single-byte notification we ship to WS clients after each save.
// The byte value (0x02) sits alongside the existing 0x00 (implicit
// Yjs update) and 0x01 (awareness) prefixes.
const SAVED_FRAME = new Uint8Array([0x02]);

// Room-based connection tracking (mirrors Bun's pub/sub)
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

export function wsDevPlugin(): PluginOption {
    return {
        name: "ws-report-dev",
        configureServer(server: ViteDevServer) {
            const wss = new WebSocketServer({ noServer: true });

            // Mirror of src/server.ts. Important contract for every branch
            // below: wss.handleUpgrade must run synchronously so the 101
            // Switching Protocols response is written before the upgrade
            // listener returns. Awaiting first (the previous version of
            // this file) caused BTH's reverse proxy to give up waiting
            // and reply 502 to the browser. See src/server.ts for the
            // full rationale.
            server.httpServer?.on("upgrade", (req, socket, head) => {
                const url = new URL(
                    req.url ?? "/",
                    `http://${req.headers.host}`,
                );

                // /ws/event/:eventId — anonymous-friendly "event <X> changed"
                // notifications. No role gate because the event detail page
                // is already partially public-readable via SSR; the frames
                // are themselves harmless (no PII).
                if (url.pathname.startsWith("/ws/event/")) {
                    const eventId = url.pathname
                        .replace("/ws/event/", "")
                        .split("/")[0];
                    if (!eventId) {
                        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                        socket.destroy();
                        return;
                    }

                    wss.handleUpgrade(req, socket, head, async (ws) => {
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
                                if (ws.readyState === WebSocket.OPEN)
                                    ws.send(frame);
                            },
                        });
                        ws.on("close", unsubscribe);
                        ws.on("error", unsubscribe);
                    });
                    return;
                }

                // /ws/report/:eventId — authenticated, role-gated Yjs sync.
                if (url.pathname.startsWith("/ws/report/")) {
                    const eventId = url.pathname
                        .replace("/ws/report/", "")
                        .split("/")[0];
                    if (!eventId) {
                        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                        socket.destroy();
                        return;
                    }

                    // Authenticate — build a Request object to reuse
                    // loadSessionUser. Cookies arrive on the upgrade
                    // request as a single 'cookie' header.
                    const headers = new Headers();
                    for (const [key, value] of Object.entries(req.headers)) {
                        if (typeof value === "string") headers.set(key, value);
                        else if (Array.isArray(value))
                            headers.set(key, value.join(", "));
                    }
                    const fakeReq = new Request(
                        `http://${req.headers.host}${req.url}`,
                        { headers },
                    );

                    // handleUpgrade is invoked synchronously — see the
                    // contract note above. Auth, role check, and the
                    // initial-snapshot load happen inside the callback.
                    // On failure we close the upgraded socket with 1008
                    // ("policy violation") rather than writing raw HTTP
                    // 401/403 lines that the proxy can no longer frame
                    // correctly once the upgrade event has fired.
                    wss.handleUpgrade(req, socket, head, async (ws) => {
                        try {
                            const user = await loadSessionUser(fakeReq);
                            if (!user) {
                                try {
                                    ws.close(1008, "unauthorized");
                                } catch {
                                    /* ignore */
                                }
                                return;
                            }

                            const authorized = await isResponsibleOrAdmin(
                                user.id,
                                user.role,
                                eventId,
                            );
                            if (!authorized) {
                                try {
                                    ws.close(1008, "forbidden");
                                } catch {
                                    /* ignore */
                                }
                                return;
                            }

                            const docId = `report:${eventId}`;
                            getYDoc(docId, eventId);

                            // Deterministic color per user.
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
                                hash =
                                    (hash * 31 + user.id.charCodeAt(i)) >>> 0;
                            }
                            (
                                ws as unknown as { __reportMeta: ReportMeta }
                            ).__reportMeta = {
                                userId: user.id,
                                eventId,
                                docId,
                                name: user.name ?? user.nickname ?? "Anonymous",
                                color: COLORS[hash % COLORS.length],
                            };

                            // Join room
                            let room = rooms.get(docId);
                            if (!room) {
                                room = new Set();
                                rooms.set(docId, room);
                            }
                            room.add(ws);

                            // Send current doc state
                            const doc = getYDoc(docId, eventId);
                            // Wait for the initial DB snapshot to land in
                            // the doc.
                            await ensureLoaded(docId);
                            if (ws.readyState !== WebSocket.OPEN) return;
                            const update = Y.encodeStateAsUpdate(doc);
                            // Prefix with 0x00 (FRAME_DOC_UPDATE) so the
                            // client can route it as a doc update
                            // regardless of the first byte Yjs happens to
                            // emit.
                            const frame = new Uint8Array(update.byteLength + 1);
                            frame[0] = 0x00;
                            frame.set(update, 1);
                            ws.send(frame);

                            wss.emit("connection", ws, req);
                        } catch (e) {
                            console.error("WS callback error:", e);
                            try {
                                ws.close(1011, "internal error");
                            } catch {
                                /* ignore */
                            }
                        }
                    });
                    return;
                }

                // Not our path — let Vite's HMR handle it.
            });

            wss.on("connection", (ws) => {
                const meta = (ws as unknown as { __reportMeta: ReportMeta })
                    .__reportMeta;

                ws.on("message", (raw) => {
                    const data =
                        typeof raw === "string"
                            ? new TextEncoder().encode(raw)
                            : new Uint8Array(raw as ArrayBuffer);

                    // Doc-update frames start with 0x00 (FRAME_DOC_UPDATE).
                    // The prefix is required — Y.encodeStateAsUpdate's first
                    // byte can legitimately be 0x01, so without it we'd
                    // mis-route real doc updates as awareness and silently
                    // drop them.
                    if (data.byteLength > 0 && data[0] === 0x00) {
                        const doc = getYDoc(meta.docId, meta.eventId);
                        Y.applyUpdate(doc, data.subarray(1));
                        broadcast(meta.docId, data, ws);
                        markDirty(meta.docId);
                        return;
                    }

                    // Awareness frames start with 0x01 and contain JSON
                    // y-protocols/awareness state — not Yjs updates.
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
                                console.error(
                                    `Failed to close Yjs doc ${meta.docId}:`,
                                    e,
                                ),
                            );
                        }
                    }
                });
            });

            // Periodic save (same as production). Each save fires the notify
            // callback after both DB writes succeed, so we can broadcast
            // a 0x02 frame to every WS in the affected room.
            const saveInterval = setInterval(() => {
                saveAllDirty((docId) => {
                    broadcast(docId, SAVED_FRAME);
                }).catch((e) => console.error("Periodic Yjs save failed:", e));
            }, 5000);

            // Cleanup on server close
            server.httpServer?.on("close", () => {
                clearInterval(saveInterval);
            });
        },
    };
}
