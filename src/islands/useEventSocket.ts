// src/islands/useEventSocket.ts
//
// Subscribe an island to /ws/event/:eventId. The server pushes
// `{type: "event-changed", kind, eventId}` frames whenever guests,
// comments, workers, or event metadata changes; the hook calls
// `onChange(kind)` for each one and the island re-fetches whatever
// it cares about.
//
// Multiple islands on the same page (Workers, Comments, GuestManager)
// share a single WebSocket per `eventId` — the first mount creates
// it, every subsequent mount adds another listener to the same
// socket, and the last unmount closes the socket. The shared
// connection reconnects with exponential backoff (1s → 2s → 4s → …
// capped at 30s) on disconnect.
//
// Callers can pass a fresh inline function for `onChange` every render
// — the hook stores the latest in a ref so the WebSocket isn't
// torn down on every parent re-render.

import { useEffect, useRef } from "preact/hooks";
import type { EventKind } from "../realtime/event-bus";

interface SharedConnection {
    socket: WebSocket;
    listeners: Set<(kind: EventKind) => void>;
    retryTimer: ReturnType<typeof setTimeout> | null;
    backoff: number;
    /** Set when the last listener unmounts — stops the reconnect loop. */
    closed: boolean;
}

const shared = new Map<string, SharedConnection>();

function isValidKind(kind: unknown): kind is EventKind {
    return (
        kind === "guests" ||
        kind === "comments" ||
        kind === "workers" ||
        kind === "event"
    );
}

function socketUrl(eventId: string): string {
    const proto =
        typeof window !== "undefined" && window.location.protocol === "https:"
            ? "wss:"
            : "ws:";
    return `${proto}//${window.location.host}/ws/event/${eventId}`;
}

/**
 * Attach onmessage/onclose/onerror to a freshly-created socket.
 * Reconnect logic replaces `conn.socket` in place so existing
 * listeners survive — the Set is on the conn, not the socket.
 */
function wireSocket(conn: SharedConnection, eventId: string): void {
    conn.socket.onmessage = (e) => {
        conn.backoff = 1000;
        try {
            const msg = JSON.parse(e.data as string) as {
                type?: string;
                kind?: unknown;
                eventId?: string;
            };
            if (msg.type !== "event-changed") return;
            if (msg.eventId !== eventId) return;
            if (!isValidKind(msg.kind)) return;
            for (const cb of conn.listeners) cb(msg.kind);
        } catch {
            /* malformed frame — ignore */
        }
    };

    conn.socket.onclose = () => {
        if (conn.closed) return;
        const delay = conn.backoff;
        conn.backoff = Math.min(conn.backoff * 2, 30_000);
        conn.retryTimer = setTimeout(() => {
            conn.retryTimer = null;
            if (conn.closed) return;
            try {
                conn.socket = new WebSocket(socketUrl(eventId));
            } catch {
                scheduleReconnect(conn, eventId);
                return;
            }
            wireSocket(conn, eventId);
        }, delay);
    };

    conn.socket.onerror = () => {
        // onclose fires right after; let it drive the reconnect.
    };
}

function scheduleReconnect(conn: SharedConnection, eventId: string): void {
    if (conn.closed) return;
    const delay = conn.backoff;
    conn.backoff = Math.min(conn.backoff * 2, 30_000);
    conn.retryTimer = setTimeout(() => {
        conn.retryTimer = null;
        if (conn.closed) return;
        try {
            conn.socket = new WebSocket(socketUrl(eventId));
        } catch {
            scheduleReconnect(conn, eventId);
            return;
        }
        wireSocket(conn, eventId);
    }, delay);
}

export function useEventSocket(
    eventId: string,
    onChange: (kind: EventKind) => void,
): void {
    const callbackRef = useRef(onChange);
    callbackRef.current = onChange;

    useEffect(() => {
        if (typeof window === "undefined" || typeof WebSocket === "undefined")
            return;

        let conn = shared.get(eventId);
        if (!conn) {
            conn = {
                socket: new WebSocket(socketUrl(eventId)),
                listeners: new Set(),
                retryTimer: null,
                backoff: 1000,
                closed: false,
            };
            shared.set(eventId, conn);
            wireSocket(conn, eventId);
        }

        const handler = (kind: EventKind) => callbackRef.current(kind);
        conn.listeners.add(handler);

        return () => {
            const c = shared.get(eventId);
            if (!c) return;
            c.listeners.delete(handler);
            if (c.listeners.size === 0) {
                c.closed = true;
                if (c.retryTimer !== null) clearTimeout(c.retryTimer);
                if (
                    c.socket.readyState === WebSocket.OPEN ||
                    c.socket.readyState === WebSocket.CONNECTING
                ) {
                    c.socket.close();
                }
                shared.delete(eventId);
            }
        };
    }, [eventId]);
}
