// src/islands/ReportEditor.tsx
import { useEffect, useRef, useState } from "preact/hooks";
import * as Y from "yjs";

interface ReportEditorProps {
    eventId: string;
    initialReport: {
        whoWorked: string | null;
        summary: string | null;
        needToResupply: string | null;
        economy: string | null;
        other: string | null;
    } | null;
    workers: { nickname: string | null; name: string | null }[];
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

export default function ReportEditor({
    eventId,
    initialReport,
    workers,
    t,
}: ReportEditorProps) {
    const [connected, setConnected] = useState(false);
    const ydocRef = useRef<Y.Doc | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const textareaRefs = useRef<
        Partial<Record<FieldKey, HTMLTextAreaElement | null>>
    >({});
    // Track whether we're applying a remote change to avoid echo
    const isRemoteChange = useRef(false);

    useEffect(() => {
        const doc = new Y.Doc();
        ydocRef.current = doc;

        // Seed from initial data if no Yjs state was loaded from server
        const hasInitialData =
            initialReport && Object.values(initialReport).some((v) => v);
        // We don't seed here — the server-side loadDocInto handles seeding from
        // either the ydocs table or the reports table.

        // Set up Y.Text observers for each field
        const cleanups: (() => void)[] = [];

        for (const { key } of FIELDS) {
            const ytext = doc.getText(key);

            const observer = () => {
                const textarea = textareaRefs.current[key];
                if (!textarea) return;

                const newValue = ytext.toString();
                if (textarea.value === newValue) return;

                // Preserve cursor position
                const selStart = textarea.selectionStart;
                const selEnd = textarea.selectionEnd;
                const oldLen = textarea.value.length;
                const diff = newValue.length - oldLen;

                isRemoteChange.current = true;
                textarea.value = newValue;

                // Adjust cursor: if cursor was after the change point, shift it
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

        // Connect WebSocket
        const wsProtocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}/ws/report/${eventId}`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.addEventListener("open", () => {
            setConnected(true);
        });

        ws.addEventListener("close", () => {
            setConnected(false);
        });

        ws.addEventListener("message", (event) => {
            const data =
                event.data instanceof ArrayBuffer
                    ? new Uint8Array(event.data)
                    : new Uint8Array(event.data);
            Y.applyUpdate(doc, data);
        });

        // Observe doc changes and send to server
        const updateHandler = (update: Uint8Array, origin: unknown) => {
            if (origin === "remote") return;
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(update);
            }
        };
        doc.on("update", updateHandler);

        // After connecting, if Yjs doc is empty and we have initial data, seed it
        // (This handles the case where the server had no existing ydoc/report)
        const seedTimeout = setTimeout(() => {
            const allEmpty = FIELDS.every(
                ({ key }) => doc.getText(key).length === 0,
            );
            if (allEmpty && hasInitialData) {
                doc.transact(() => {
                    for (const { key } of FIELDS) {
                        const val = initialReport?.[key];
                        if (val) {
                            doc.getText(key).insert(0, val);
                        }
                    }
                }, "remote");
            }

            // Special: pre-fill whoWorked with worker names if still empty
            const whoWorkedText = doc.getText("whoWorked");
            if (whoWorkedText.length === 0 && workers.length > 0) {
                const names = workers
                    .map((w) => w.nickname || w.name || "")
                    .filter(Boolean)
                    .join("\n");
                if (names) {
                    doc.transact(() => {
                        whoWorkedText.insert(0, names);
                    });
                }
            }
        }, 500);

        return () => {
            clearTimeout(seedTimeout);
            doc.off("update", updateHandler);
            cleanups.forEach((fn) => {
                fn();
            });
            ws.close();
            doc.destroy();
        };
    }, [eventId]);

    function handleInput(key: FieldKey, value: string) {
        if (isRemoteChange.current) return;
        const doc = ydocRef.current;
        if (!doc) return;

        const ytext = doc.getText(key);
        const current = ytext.toString();
        if (current === value) return;

        // Replace entire content
        doc.transact(() => {
            if (ytext.length > 0) {
                ytext.delete(0, ytext.length);
            }
            if (value.length > 0) {
                ytext.insert(0, value);
            }
        });
    }

    function handleClose() {
        // Navigate back to event page
        window.location.href = `/event/${eventId}`;
    }

    return (
        <div class="h-full flex flex-col">
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
                <div class="flex items-center gap-3">
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                        {t["report.title"]}
                    </h2>
                    <span
                        class={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${
                            connected
                                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                        }`}
                    >
                        <span
                            class={`w-1.5 h-1.5 rounded-full ${
                                connected
                                    ? "bg-green-500"
                                    : "bg-yellow-500 animate-pulse"
                            }`}
                        />
                        {connected
                            ? t["report.connected"]
                            : t["report.reconnecting"]}
                    </span>
                </div>
                <button
                    onClick={handleClose}
                    class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
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

            {/* Notice */}
            <div class="px-6 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800 shrink-0">
                <p class="text-xs text-blue-600 dark:text-blue-400">
                    {t["report.autoSaveNotice"]}
                </p>
            </div>

            {/* Form */}
            <div class="flex-1 overflow-y-auto p-6 space-y-5">
                {FIELDS.map(({ key, rows }) => (
                    <div>
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
