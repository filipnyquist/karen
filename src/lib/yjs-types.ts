// src/lib/yjs-types.ts
//
// Shared Yjs-WebSocket bridge types. Both `src/server.ts` (production
// Bun.serve) and `src/integrations/ws-dev.ts` (Astro dev Vite plugin)
// attach the same `__reportMeta` property to a `WebSocket` during
// the upgrade handshake so the `connection` handler can route messages
// back to the right Y.Doc. Keep this single source of truth so the
// two servers can't drift.

/** Metadata attached to a `WebSocket` connection during the upgrade
 * handshake. Mirrors the Yjs document id, the user that opened the
 * doc, and the event it belongs to. */
export interface ReportMeta {
    userId: string;
    eventId: string;
    docId: string;
}
