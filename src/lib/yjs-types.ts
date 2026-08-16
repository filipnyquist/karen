// src/lib/yjs-types.ts
//
// Shared types for the report WebSocket protocol. `src/server.ts` and
// `src/integrations/ws-dev.ts` both import this — keep them in sync.

export interface ReportMeta {
    userId: string;
    eventId: string;
    docId: string; // "report:<eventId>"
    // Awareness fields — the client publishes these on focus / keypress
    // so peers can render "X is editing Y".
    name: string;
    color: string; // tailwind bg class, e.g. "bg-blue-500"
}
