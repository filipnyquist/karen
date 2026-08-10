// src/islands/EventWorkersPanel.tsx
//
// Hydrated island replacing the static Workers table on the event
// detail page. Polls /api/events/:eventId/workers every 10s while
// the tab is visible; admin/responsible can still remove workers
// via the existing DELETE /api/workers/event/:eventId/user/:userId
// endpoint, after which we bump() to re-render immediately.

import { useState } from "preact/hooks";
import { useLiveRefresh } from "./useLiveRefresh";

export interface Worker {
    id: string;
    nickname: string | null;
    name: string | null;
    profilePic: string | null;
    responsible: boolean;
    hasPubWorker: boolean;
    hasAas: boolean;
    createdAt: string;
}

interface Props {
    eventId: string;
    initialWorkers: Worker[];
    // The page already computed these; pass them in so we render the
    // exact same permission UI without re-deriving.
    canManage: boolean;
    /** Authenticated user id (for hiding the remove-self button). */
    currentUserId: string | null;
    t: Record<string, string>;
}

export default function EventWorkersPanel({
    eventId,
    initialWorkers,
    canManage,
    currentUserId,
    t,
}: Props) {
    const [workers, setWorkers] = useState<Worker[]>(initialWorkers);
    const [error, setError] = useState("");

    const refresh = useLiveRefresh(async () => {
        try {
            const res = await fetch(`/api/events/${eventId}/workers`, {
                credentials: "same-origin",
            });
            if (!res.ok) return; // next tick retries
            const data = (await res.json()) as Worker[];
            setWorkers(data);
        } catch {
            /* swallow */
        }
    });

    async function removeWorker(userId: string) {
        try {
            const csrf =
                document.cookie
                    .split("; ")
                    .find((c) => c.startsWith("csrf_token="))
                    ?.split("=")[1] ?? "";
            const res = await fetch(
                `/api/workers/event/${eventId}/user/${userId}`,
                {
                    method: "DELETE",
                    credentials: "same-origin",
                    headers: csrf ? { "X-CSRF-Token": csrf } : {},
                },
            );
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                setError(d.error ?? t["common.failed"] ?? "Failed");
                return;
            }
            refresh.bump();
        } catch {
            setError(t["common.networkError"] ?? "Network error");
        }
    }

    return (
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                    {t["event.workers"]}
                </h2>
            </div>
            {workers.length === 0 ? (
                <p class="text-sm text-gray-400 dark:text-gray-500 px-6 py-4">
                    {t["event.noWorkers"]}
                </p>
            ) : (
                <div>
                    <table class="w-full text-sm table-fixed">
                        <thead class="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400" />
                                <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["auth.nickname"] || "Nickname"}
                                </th>
                                <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["auth.name"] || "Name"}
                                </th>
                                <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["event.roles"] || "Roles"}
                                </th>
                                <th class="px-4 py-2.5" />
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                            {workers.map((w) => (
                                <tr
                                    key={w.id}
                                    class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                                >
                                    <td class="px-4 py-2.5">
                                        <a href={`/profile/${w.id}`}>
                                            {w.profilePic ? (
                                                <img
                                                    src={w.profilePic}
                                                    alt=""
                                                    class="w-8 h-8 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300">
                                                    {(
                                                        w.nickname?.trim() ||
                                                        w.name?.trim() ||
                                                        "?"
                                                    )
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </div>
                                            )}
                                        </a>
                                    </td>
                                    <td class="px-4 py-2.5 max-w-0">
                                        <a
                                            href={`/profile/${w.id}`}
                                            class="block truncate text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                                        >
                                            {w.nickname ?? "-"}
                                        </a>
                                    </td>
                                    <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300 max-w-0 truncate">
                                        {w.name ?? "-"}
                                    </td>
                                    <td class="px-4 py-2.5">
                                        <div class="flex items-center gap-1">
                                            {w.responsible && (
                                                <span class="group relative inline-flex">
                                                    <span
                                                        class="cursor-default"
                                                        aria-hidden="true"
                                                    >
                                                        🔑
                                                    </span>
                                                    <span
                                                        role="tooltip"
                                                        class="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 dark:bg-gray-700"
                                                    >
                                                        {t[
                                                            "event.responsible"
                                                        ] ?? "Responsible"}
                                                        <span class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900 dark:bg-gray-700" />
                                                    </span>
                                                </span>
                                            )}
                                            {w.hasPubWorker && (
                                                <span class="group relative inline-flex">
                                                    <span
                                                        class="cursor-default"
                                                        aria-hidden="true"
                                                    >
                                                        🍺
                                                    </span>
                                                    <span
                                                        role="tooltip"
                                                        class="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 dark:bg-gray-700"
                                                    >
                                                        {t["event.pubWorker"] ??
                                                            "Pub Worker"}
                                                        <span class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900 dark:bg-gray-700" />
                                                    </span>
                                                </span>
                                            )}
                                            {w.hasAas && (
                                                <span class="group relative inline-flex">
                                                    <span
                                                        class="cursor-default"
                                                        aria-hidden="true"
                                                    >
                                                        🎓
                                                    </span>
                                                    <span
                                                        role="tooltip"
                                                        class="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 dark:bg-gray-700"
                                                    >
                                                        {t["event.aas"] ??
                                                            "AAS"}
                                                        <span class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900 dark:bg-gray-700" />
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td class="px-4 py-2.5 text-right">
                                        {canManage &&
                                            w.id !== currentUserId && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (
                                                            confirm(
                                                                t[
                                                                    "event.confirmRemoveWorker"
                                                                ] ??
                                                                    "Remove this worker?",
                                                            )
                                                        ) {
                                                            removeWorker(w.id);
                                                        }
                                                    }}
                                                    class="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium transition-colors"
                                                >
                                                    {t["event.removeWorker"] ??
                                                        "Remove"}
                                                </button>
                                            )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {error && (
                <p class="text-sm text-red-600 dark:text-red-400 px-6 py-2">
                    {error}
                </p>
            )}
        </div>
    );
}
