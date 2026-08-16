// src/islands/ReportEditor.tsx
//
// Home-made collaborative report editor. Five plain textareas backed
// by a shared Y.Doc (one Y.Text per field), synced over a raw
// WebSocket to the same httpServer that serves the page (the dev
// plugin attaches to Vite's existing httpServer; production uses
// src/server.ts directly).
//
// IMPORTANT: the server is the single source of truth. All field
// content arrives over the WebSocket (initial snapshot on connect,
// then per-edit updates). We never seed fields from props, and we
// never PUT back to /api/reports/event/:id — the server's
// saveAllDirty() loop persists the Y.Doc to the reports table
// every 5s.
//
// Per-peer presence via y-protocols/awareness (carried as a 0x01-prefixed
// frame on the same WebSocket; doc updates use the existing path with
// no prefix). Reconnect with exponential backoff, connection-only pill,
// and a clickable "X is editing…" chip are local-only extras.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import Identicon from "../components/Identicon";

interface ReportEditorProps {
    eventId: string;
    currentUser?: {
        id: string;
        name: string | null;
        nickname: string | null;
    } | null;
    t: Record<string, string>;
}

const FIELDS = [
    { key: "whoWorked", rows: 4 },
    { key: "summary", rows: 12 },
    { key: "needToResupply", rows: 6 },
    { key: "economy", rows: 6 },
    { key: "other", rows: 6 },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

// Color palette for peer awareness badges.
const COLORS = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
];

interface Presence {
    userId: string;
    name: string;
    color: string;
    field: FieldKey | null;
    typing: boolean;
}

// Frame-type prefixes: 0x00 = doc update (default Y.applyUpdate
// output), 0x01 = awareness frame (JSON-encoded Awareness state),
// 0x02 = server-sent save notification. The 0x00 prefix is REQUIRED:
// Y.encodeStateAsUpdate's first byte can legitimately be 0x01
// (the struct head of the first content struct), so without an
// explicit prefix the receiving side would misclassify doc
// updates as awareness and drop them.
const FRAME_DOC_UPDATE = 0x00;
const FRAME_AWARENESS = 0x01;
const FRAME_SAVED = 0x02;

// How long the saved pill stays visible (ms). After this the pill
// auto-hides; the connection pill is unaffected.
const SAVED_PILL_TTL_MS = 8000;

function pickColor(userId: string): string {
    // Deterministic color per user — hash the id into the palette.
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    return COLORS[hash % COLORS.length];
}

function displayName(p: {
    name: string | null;
    nickname: string | null;
}): string {
    return p.nickname?.trim() || p.name?.trim() || "Anonymous";
}

export default function ReportEditor({
    eventId,
    currentUser,
    t,
}: ReportEditorProps) {
    const [connected, setConnected] = useState(false);
    const [presence, setPresence] = useState<Presence[]>([]);
    // Timestamp (ms since epoch) of the most recent server save
    // notification. Null until the server tells us it just persisted.
    // Drives the "Sparat / Sparad Xs sedan" pill.
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    // Wall-clock tick updated once a second so the saved pill can
    // recompute its "Xs sedan" text. Cheap state; only re-renders
    // this single component.
    const [now, setNow] = useState<number>(() => Date.now());

    const ydocRef = useRef<Y.Doc | null>(null);
    const awarenessRef = useRef<Awareness | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const savedHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const textareaRefs = useRef<
        Partial<Record<FieldKey, HTMLTextAreaElement | null>>
    >({});
    const isRemoteChange = useRef(false);
    const typingTimersRef = useRef<
        Partial<Record<FieldKey, ReturnType<typeof setTimeout>>>
    >({});

    // Pick a stable color for this user once.
    const myColor = useMemo(
        () => pickColor(currentUser?.id ?? "anon"),
        [currentUser?.id],
    );
    const myName = useMemo(
        () =>
            displayName({
                name: currentUser?.name ?? null,
                nickname: currentUser?.nickname ?? null,
            }),
        [currentUser?.name, currentUser?.nickname],
    );

    // 1s ticker that drives the saved pill's relative-time
    // rendering ("Sparad Ns sedan"). Cheap — single state bump.
    useEffect(() => {
        const handle = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(handle);
    }, []);

    useEffect(() => {
        const doc = new Y.Doc();
        ydocRef.current = doc;
        const awareness = new Awareness(doc);
        awarenessRef.current = awareness;

        // Set up Y.Text observers for each field — write remote changes
        // back into the textarea, preserving the caret.
        const cleanups: (() => void)[] = [];

        for (const { key } of FIELDS) {
            const ytext = doc.getText(key);

            const observer = () => {
                const textarea = textareaRefs.current[key];
                if (!textarea) return;

                const newValue = ytext.toString();
                if (textarea.value === newValue) return;

                const selStart = textarea.selectionStart;
                const selEnd = textarea.selectionEnd;
                const oldLen = textarea.value.length;
                const diff = newValue.length - oldLen;

                isRemoteChange.current = true;
                textarea.value = newValue;

                const changeIndex = findChangeStart(
                    textarea.value,
                    newValue,
                    selStart,
                );
                if (selStart > changeIndex) {
                    textarea.selectionStart = selStart + diff;
                    textarea.selectionEnd = selEnd + diff;
                } else {
                    textarea.selectionStart = selStart;
                    textarea.selectionEnd = selEnd;
                }
                isRemoteChange.current = false;
            };

            ytext.observe(observer);
            cleanups.push(() => ytext.unobserve(observer));
        }

        // Presence -> React state mirror.
        const onAwareness = () => {
            const states = Array.from(awareness.getStates().values()) as Array<{
                user?: { id: string; name: string; color: string };
                field?: FieldKey;
                typing?: boolean;
            }>;
            const me = currentUser?.id ?? null;
            const others: Presence[] = [];
            for (const state of states) {
                if (!state.user) continue;
                if (me && state.user.id === me) continue;
                others.push({
                    userId: state.user.id,
                    name: state.user.name,
                    color: state.user.color,
                    field: (state.field as FieldKey | undefined) ?? null,
                    typing: Boolean(state.typing),
                });
            }
            setPresence(others);
        };
        awareness.on("change", onAwareness);

        // WebSocket lifecycle -------------------------------------------------
        const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/report/${eventId}`;
        let ws: WebSocket | null = null;
        let closedByCleanup = false;

        const connect = () => {
            const attempt = reconnectAttemptsRef.current;
            ws = new WebSocket(wsUrl);
            ws.binaryType = "arraybuffer";
            wsRef.current = ws;

            ws.addEventListener("open", () => {
                reconnectAttemptsRef.current = 0;
                setConnected(true);

                // Send our initial awareness state so peers see us.
                if (currentUser) {
                    awareness.setLocalState({
                        user: {
                            id: currentUser.id,
                            name: myName,
                            color: myColor,
                        },
                        field: null,
                        typing: false,
                    });
                }
            });

            ws.addEventListener("close", () => {
                setConnected(false);
                if (closedByCleanup) return;

                // Exponential backoff: 1s, 2s, 4s, 8s (cap).
                const delay = Math.min(1000 * 2 ** attempt, 8000);
                reconnectAttemptsRef.current = attempt + 1;
                reconnectTimerRef.current = setTimeout(connect, delay);
            });

            ws.addEventListener("message", (event) => {
                const data =
                    event.data instanceof ArrayBuffer
                        ? new Uint8Array(event.data)
                        : new Uint8Array(event.data);

                if (data.byteLength > 0 && data[0] === FRAME_DOC_UPDATE) {
                    // Document update frame (initial snapshot on
                    // connect, or per-edit updates from peers). Strip
                    // the prefix and apply; the Y.Text observers on
                    // each field write the new value into the matching
                    // textarea.
                    Y.applyUpdate(doc, data.subarray(1));
                    return;
                }

                if (data.byteLength > 0 && data[0] === FRAME_AWARENESS) {
                    // Awareness frame: drop the prefix byte, parse JSON,
                    // and apply. The Awareness class manages client IDs.
                    try {
                        const payload = JSON.parse(
                            new TextDecoder().decode(data.subarray(1)),
                        );
                        if (Array.isArray(payload)) {
                            for (const [clientID, state] of payload) {
                                if (
                                    clientID !== undefined &&
                                    state !== undefined
                                ) {
                                    awareness.states.set(
                                        Number(clientID),
                                        state,
                                    );
                                }
                            }
                            // The Y.Doc observer on the Awareness
                            // instance fires "change" automatically,
                            // which our `sendAwareness` listener picks
                            // up. No manual emit needed — that would
                            // cause a broadcast loop where each client
                            // re-sends its received awareness frames.
                        }
                    } catch (e) {
                        // Malformed awareness frame — ignore.
                        void e;
                    }
                    return;
                }

                if (data.byteLength > 0 && data[0] === FRAME_SAVED) {
                    // Server just finished persisting this doc. Bump
                    // lastSavedAt and (re)arm the auto-hide timer.
                    setLastSavedAt(Date.now());
                    if (savedHideTimerRef.current !== null) {
                        clearTimeout(savedHideTimerRef.current);
                    }
                    savedHideTimerRef.current = setTimeout(() => {
                        setLastSavedAt(null);
                    }, SAVED_PILL_TTL_MS);
                    return;
                }

                // Unknown frame type — ignore. (Defensive: if anything
                // sends a bare Y.applyUpdate output without the 0x00
                // prefix, we no longer silently apply it.)
            });

            ws.addEventListener("error", () => {
                // The close handler will retry.
            });
        };
        connect();

        // Ship every local edit to the server as a full-state snapshot.
        // The server fans it out to peers and marks the doc dirty so
        // saveAllDirty() persists it. Frame is prefixed with 0x00 so
        // peers and the initial-state consumer can route it as a doc
        // update rather than misreading the first Yjs struct byte.
        doc.on("update", (_update: Uint8Array, origin: unknown) => {
            if (origin === "remote") return;
            if (ws && ws.readyState === WebSocket.OPEN) {
                const snapshot = Y.encodeStateAsUpdate(doc);
                const frame = new Uint8Array(snapshot.byteLength + 1);
                frame[0] = FRAME_DOC_UPDATE;
                frame.set(snapshot, 1);
                ws.send(frame);
            }
        });

        // Awareness -> server. Whenever our state changes, ship it as
        // a 0x01-prefixed JSON frame.
        const sendAwareness = () => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const payload = JSON.stringify(
                Array.from(awareness.getStates().entries()),
            );
            const body = new TextEncoder().encode(payload);
            const frame = new Uint8Array(body.byteLength + 1);
            frame[0] = FRAME_AWARENESS;
            frame.set(body, 1);
            ws.send(frame);
        };
        awareness.on("change", sendAwareness);

        return () => {
            closedByCleanup = true;
            if (reconnectTimerRef.current)
                clearTimeout(reconnectTimerRef.current);
            if (savedHideTimerRef.current)
                clearTimeout(savedHideTimerRef.current);
            awareness.off("change", onAwareness);
            awareness.off("change", sendAwareness);
            awareness.destroy();
            doc.off("update", () => {});
            cleanups.forEach((fn) => {
                fn();
            });
            ws?.close();
            doc.destroy();
        };
        // Re-create the WS each time eventId or currentUser.id changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, currentUser?.id, myName, myColor, currentUser]);

    function handleInput(key: FieldKey, value: string) {
        if (isRemoteChange.current) return;
        const doc = ydocRef.current;
        const awareness = awarenessRef.current;
        if (!doc) return;

        const ytext = doc.getText(key);
        const current = ytext.toString();
        if (current === value) return;

        doc.transact(() => {
            if (ytext.length > 0) {
                ytext.delete(0, ytext.length);
            }
            if (value.length > 0) {
                ytext.insert(0, value);
            }
        });

        // Mark typing=true with the active field, schedule typing=false
        // 1.5s after the last keystroke.
        if (awareness && currentUser) {
            awareness.setLocalStateField("typing", true);
            awareness.setLocalStateField("field", key);
            const existing = typingTimersRef.current[key];
            if (existing !== undefined) {
                clearTimeout(existing);
            }
            typingTimersRef.current[key] = setTimeout(() => {
                awareness.setLocalStateField("typing", false);
            }, 1500);
        }
    }

    function focusField(key: FieldKey) {
        const awareness = awarenessRef.current;
        if (awareness && currentUser) {
            awareness.setLocalStateField("field", key);
            awareness.setLocalStateField("typing", true);
            const existing = typingTimersRef.current[key];
            if (existing !== undefined) {
                clearTimeout(existing);
            }
            typingTimersRef.current[key] = setTimeout(() => {
                awareness.setLocalStateField("typing", false);
            }, 1500);
        }
    }

    function blurField() {
        const awareness = awarenessRef.current;
        if (awareness) {
            awareness.setLocalStateField("field", null);
            awareness.setLocalStateField("typing", false);
        }
    }

    function jumpToField(key: FieldKey) {
        const ta = textareaRefs.current[key];
        if (ta) {
            ta.scrollIntoView({ behavior: "smooth", block: "center" });
            ta.focus();
        }
    }

    function handleClose() {
        window.location.href = `/event/${eventId}`;
    }

    function pill() {
        if (connected) {
            return {
                cls: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
                dot: "bg-green-500",
                text: t["report.connected"] ?? "Connected",
            };
        }
        return {
            cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
            dot: "bg-yellow-500 animate-pulse",
            text: t["report.reconnecting"] ?? "Reconnecting…",
        };
    }

    // Save-feedback pill. Sits to the LEFT of the connection pill.
    // Returns null until the server sends a 0x02 frame, then shows
    // "Sparat" briefly, ages to "Sparad Xs sedan", and hides after
    // SAVED_PILL_TTL_MS.
    function savedPill() {
        if (lastSavedAt === null) return null;
        const elapsedMs = now - lastSavedAt;
        if (elapsedMs >= SAVED_PILL_TTL_MS) return null;
        const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
        const text =
            seconds < 2
                ? (t["report.saved"] ?? "Saved")
                : (t["report.savedAgo"] ?? "Saved {seconds}s ago").replace(
                      "{seconds}",
                      String(seconds),
                  );
        return {
            cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
            dot: "bg-green-500",
            text,
        };
    }

    function presenceChip() {
        if (!presence || presence.length === 0) return null;
        const typing = presence.filter((p) => p.typing);
        return (
            <div class="flex items-center gap-2 px-2" aria-live="polite">
                <div class="flex -space-x-2">
                    {presence.slice(0, 5).map((p) => (
                        <button
                            key={p.userId}
                            type="button"
                            title={p.name}
                            aria-label={p.name}
                            class="rounded-full ring-2 ring-white dark:ring-gray-900"
                            onClick={() =>
                                p.field ? jumpToField(p.field) : null
                            }
                        >
                            <Identicon
                                name={p.name}
                                color={p.color}
                                size={24}
                            />
                        </button>
                    ))}
                </div>
                {typing.length > 0 && (
                    <span class="text-xs text-gray-500 dark:text-gray-400 italic">
                        {typing.length === 1
                            ? (
                                  t["report.editingOther"] ??
                                  "{name} is editing…"
                              ).replace("{name}", typing[0].name)
                            : (
                                  t["report.othersEditing"] ??
                                  "{count} others editing"
                              ).replace("{count}", String(typing.length))}
                    </span>
                )}
            </div>
        );
    }

    const currentPill = pill();
    const savedPillInfo = savedPill();

    return (
        <div class="h-full flex flex-col">
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-white shrink-0">
                        {t["report.title"]}
                    </h2>
                    {presenceChip()}
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    {savedPillInfo && (
                        <span
                            class={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${savedPillInfo.cls}`}
                            aria-live="polite"
                        >
                            <span
                                class={`w-1.5 h-1.5 rounded-full ${savedPillInfo.dot}`}
                            />
                            {savedPillInfo.text}
                        </span>
                    )}
                    <span
                        class={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${currentPill.cls}`}
                    >
                        <span
                            class={`w-1.5 h-1.5 rounded-full ${currentPill.dot}`}
                        />
                        {currentPill.text}
                    </span>
                    <button
                        onClick={handleClose}
                        class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                        type="button"
                        aria-label={t["report.close"]}
                    >
                        <svg
                            class="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Notice */}
            <div class="px-6 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 shrink-0">
                <p class="text-xs text-blue-600 dark:text-blue-400">
                    {t["report.autoSaveNotice"]}
                </p>
            </div>

            {/* Form */}
            <div class="flex-1 overflow-y-auto p-6 space-y-5">
                {FIELDS.map(({ key, rows }) => (
                    <div key={key}>
                        <label
                            for={`report-${key}`}
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t[
                                `report.${key === "needToResupply" ? "resupply" : key}`
                            ] || key}
                        </label>
                        <textarea
                            id={`report-${key}`}
                            ref={(el) => {
                                textareaRefs.current[key] = el;
                            }}
                            rows={rows}
                            onFocus={() => focusField(key)}
                            onBlur={blurField}
                            class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            placeholder={
                                t[
                                    `report.${key === "needToResupply" ? "resupply" : key}`
                                ] || key
                            }
                            onInput={(e) =>
                                handleInput(
                                    key,
                                    (e.target as HTMLTextAreaElement).value,
                                )
                            }
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function findChangeStart(
    oldVal: string,
    newVal: string,
    maxCheck: number,
): number {
    const end = Math.min(maxCheck, oldVal.length, newVal.length);
    for (let i = 0; i < end; i++) {
        if (oldVal[i] !== newVal[i]) return i;
    }
    return end;
}
