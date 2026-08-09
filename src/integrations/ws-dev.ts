// src/integrations/ws-dev.ts
// Vite plugin that adds WebSocket support for /ws/report/* during astro dev.
// This mirrors the Bun.serve() websocket handler in src/server.ts.

import type { PluginOption, ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { loadSessionUser } from "../api/middleware/auth";
import type { ReportMeta } from "../lib/yjs-types";
import { isResponsibleOrAdmin } from "../services/report-auth";
import {
    closeDoc,
    getYDoc,
    markDirty,
    saveAllDirty,
} from "../services/yjs-persistence";

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

            // Intercept upgrade requests for /ws/report/*
            server.httpServer?.on("upgrade", (req, socket, head) => {
                if (!req.url?.startsWith("/ws/report/")) {
                    // Not our path — let Vite's HMR handle it
                    return;
                }

                const url = new URL(req.url, `http://${req.headers.host}`);
                const eventId = url.pathname
                    .replace("/ws/report/", "")
                    .split("/")[0];
                if (!eventId) {
                    socket.destroy();
                    return;
                }

                // Authenticate — build a Request object to reuse getUserFromRequest
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
                            // Attach metadata
                            (
                                ws as unknown as { __reportMeta: ReportMeta }
                            ).__reportMeta = {
                                userId: user.id,
                                eventId,
                                docId,
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
                const meta = (ws as unknown as { __reportMeta: ReportMeta })
                    .__reportMeta;

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
                                console.error(
                                    `Failed to close Yjs doc ${meta.docId}:`,
                                    e,
                                ),
                            );
                        }
                    }
                });
            });

            // Periodic save (same as production)
            const saveInterval = setInterval(() => {
                saveAllDirty().catch((e) =>
                    console.error("Periodic Yjs save failed:", e),
                );
            }, 5000);

            // Cleanup on server close
            server.httpServer?.on("close", () => {
                clearInterval(saveInterval);
            });
        },
    };
}
