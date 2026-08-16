// src/realtime/event-bus.ts
//
// In-process pub/sub for "event <X> just changed" notifications.
//
// Every viewer of an event detail page (logged-in or anonymous) opens
// a WebSocket at /ws/event/:eventId; the upgrade handler in
// `src/server.ts` (production) and `src/integrations/ws-dev.ts`
// (Vite plugin) registers the connection here. The REST write paths
// (guests, comments, workers, events) call `notifyEventChange(...)`
// after a successful DB write and the bus fans the frame out to every
// subscribed socket for that event.
//
// The bus itself is runtime-agnostic — it knows nothing about WebSocket
// objects or transports. Each runtime supplies its own connection
// wrapper via `subscribe(...)`. That keeps the write-path callers
// identical across dev and prod.

export type EventKind = "guests" | "comments" | "workers" | "event";

export interface Connection {
    /** Send a single JSON frame. Caller guarantees it's a UTF-8 string. */
    send: (frame: string) => void;
}

// One room per event. Keyed by raw `eventId` — both runtimes build
// their room ids the same way so write-paths and the upgrade handlers
// agree without coordinating.
//
// The Map is parked on `globalThis` because Astro/Vite dev mode runs
// modules in separate graphs (Vite plugin context, page SSR, API route
// SSR) and would otherwise create three independent `subscribers` Maps —
// the upgrade handler would add connections to one Map and `notify` from
// the API route would look up a different empty Map. globalThis is the
// only object guaranteed to be shared across all of those contexts.
interface EventBusGlobal {
    __karenEventBusSubscribers?: Map<string, Set<Connection>>;
}
const g = globalThis as unknown as EventBusGlobal;
const subscribers: Map<
    string,
    Set<Connection>
> = g.__karenEventBusSubscribers ?? new Map<string, Set<Connection>>();
g.__karenEventBusSubscribers = subscribers;

function room(eventId: string): Set<Connection> {
    let set = subscribers.get(eventId);
    if (!set) {
        set = new Set<Connection>();
        subscribers.set(eventId, set);
    }
    return set;
}

/**
 * Add `conn` to the room for `eventId`. Returns an unsubscribe fn
 * the caller should invoke on socket close. Throws nothing — if the
 * room doesn't exist yet it's created on demand.
 */
export function subscribe(eventId: string, conn: Connection): () => void {
    const set = room(eventId);
    set.add(conn);
    return () => {
        set.delete(conn);
        if (set.size === 0) subscribers.delete(eventId);
    };
}

/**
 * Broadcast a single `{type, kind, eventId}` JSON frame to every
 * subscriber of `eventId`. No-op if no one is listening.
 */
export function notifyEventChange(eventId: string, kind: EventKind): void {
    const set = subscribers.get(eventId);
    if (!set || set.size === 0) return;
    const frame = JSON.stringify({
        type: "event-changed",
        kind,
        eventId,
    });
    for (const conn of set) {
        try {
            conn.send(frame);
        } catch {
            /* one bad subscriber must not break the others */
        }
    }
}
