// src/islands/BulkEducationGrant.tsx
//
// Admin tier bulk-grant of a single education type to a batch of users.
// Two tabs feed the same form:
//   • Event  — pick an event from a dropdown; workers for that event
//              are fetched on demand via
//              `GET /api/events/:id/workers` (the same endpoint the
//              event detail page uses). Cached in component state so
//              re-selecting is instant.
//   • Users  — multi-pick users from the directory via search + checkboxes.
// Either path lands users into a single `selectedUserIds: Set<string>`.
// The submit button POSTs to /api/admin/education/bulk.
//
// Hydration marker: the root <div> gets `data-hydrated="true"` after
// the first useEffect fires, so e2e tests can wait for Preact to
// attach the onChange handlers before driving a <select>.

import { useEffect, useMemo, useState } from "preact/hooks";

interface EducationTypeRow {
    id: number;
    name: string;
    description: string | null;
    validityMonths: number | null;
    nameSv: string | null;
    nameEn: string | null;
}

interface EventOption {
    id: string;
    name: string;
    startDate: string;
}

interface UserOption {
    id: string;
    email: string;
    name: string | null;
    nickname: string | null;
    role: "user" | "admin" | "superadmin";
}

// GET /api/events/:id/workers response shape, projected down to
// what the bulk-grant UI needs. The endpoint anonymises `name`
// server-side for non-auth callers (we're admin so we get the
// full name anyway).
interface RawEventWorker {
    id: string;
    nickname: string | null;
    name: string | null;
    profilePic: string | null;
    responsible: boolean;
    hasPubWorker: boolean;
    hasAas: boolean;
    createdAt: string;
}

interface WorkerLite {
    userId: string;
    nickname: string | null;
    name: string | null;
    responsible: boolean;
}

interface BulkEducationGrantProps {
    educationTypes: EducationTypeRow[];
    events: EventOption[];
    users: UserOption[];
    t: Record<string, string>;
}

type Mode = "event" | "users";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

function eduLabel(et: EducationTypeRow): string {
    return et.description || et.name;
}

function userLabel(u: UserOption | WorkerLite): string {
    return (
        u.nickname?.trim() ||
        (u as UserOption).name?.trim() ||
        (u as WorkerLite).name?.trim() ||
        (u as UserOption).email ||
        ""
    );
}

export default function BulkEducationGrant({
    educationTypes,
    events,
    users,
    t,
}: BulkEducationGrantProps) {
    const [mode, setMode] = useState<Mode>("event");
    const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [selectedEventId, setSelectedEventId] = useState<string>("");
    // Cache of workers per eventId — populated lazily when the user
    // picks an event. Lives only in component state; never SSR-
    // shipped, so Record vs. Map doesn't matter for serialisation.
    const [workersByEvent, setWorkersByEvent] = useState<
        Record<string, WorkerLite[]>
    >({});
    const [workersLoading, setWorkersLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [educationTypeId, setEducationTypeId] = useState<number | null>(null);
    const [completedAt, setCompletedAt] = useState<string>(todayISO);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    // Hydration marker — the first effect (any effect) fires once
    // Preact has finished hydrating, at which point the onChange
    // handlers on the form controls are wired up. Tests use this
    // attribute to wait before driving a `<select>`.
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        setHydrated(true);
    }, []);

    // Debounced user-search filter.
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(searchQuery), 300);
        return () => clearTimeout(handle);
    }, [searchQuery]);

    // Fetch workers for the selected event on demand. Cached in
    // `workersByEvent` keyed by eventId so re-selecting is instant.
    useEffect(() => {
        if (!selectedEventId) return;
        if (workersByEvent[selectedEventId]) {
            // Already cached; nothing to do.
            return;
        }
        let cancelled = false;
        setWorkersLoading(true);
        (async () => {
            try {
                const res = await fetch(
                    `/api/events/${selectedEventId}/workers`,
                    { credentials: "same-origin" },
                );
                if (!res.ok) {
                    throw new Error(
                        t["common.failedToLoad"] || "Failed to load",
                    );
                }
                const data = (await res.json()) as RawEventWorker[];
                if (cancelled) return;
                const lite: WorkerLite[] = data.map((r) => ({
                    userId: r.id,
                    nickname: r.nickname,
                    name: r.name,
                    responsible: r.responsible,
                }));
                setWorkersByEvent((prev) => ({
                    ...prev,
                    [selectedEventId]: lite,
                }));
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!cancelled) setWorkersLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedEventId, workersByEvent, t]);

    const clearMsgs = () => {
        setError("");
        setSuccess("");
    };

    const toggleUser = (userId: string) => {
        setSelectedUserIds((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    const selectAllWorkers = () => {
        const workers = workersByEvent[selectedEventId] ?? [];
        if (workers.length === 0) return;
        setSelectedUserIds((prev) => {
            const next = new Set(prev);
            for (const w of workers) next.add(w.userId);
            return next;
        });
    };

    const selectAllVisibleUsers = () => {
        setSelectedUserIds((prev) => {
            const next = new Set(prev);
            for (const u of filteredUsers) next.add(u.id);
            return next;
        });
    };

    const clearSelection = () => {
        setSelectedUserIds(new Set());
    };

    const filteredUsers = useMemo(() => {
        const q = debouncedSearch.trim().toLowerCase();
        if (!q) return users;
        return users.filter((u) => {
            const haystack =
                `${u.email} ${u.name ?? ""} ${u.nickname ?? ""}`.toLowerCase();
            return haystack.includes(q);
        });
    }, [users, debouncedSearch]);

    const eventWorkers = useMemo(
        () => workersByEvent[selectedEventId] ?? [],
        [workersByEvent, selectedEventId],
    );

    const selectedCount = selectedUserIds.size;
    const canSubmit =
        selectedCount > 0 &&
        educationTypeId !== null &&
        completedAt !== "" &&
        !saving;

    async function handleSubmit() {
        if (!canSubmit || educationTypeId === null) return;
        clearMsgs();

        const edu =
            educationTypes.find((e) => e.id === educationTypeId)?.name ?? "?";
        const count = selectedCount;
        const dateStr = completedAt;
        const confirmMsg = (
            t["admin.educationGrant.confirmBody"] ??
            'Grant "{edu}" to {count} users, completed {date}?'
        )
            .replace("{edu}", edu)
            .replace("{count}", String(count))
            .replace("{date}", dateStr);

        const confirmModal = window as unknown as {
            appConfirm: (msg: string, onYes: () => void) => void;
        };
        confirmModal.appConfirm(confirmMsg, async () => {
            setSaving(true);
            try {
                const completedAtIso = new Date(completedAt).toISOString();
                const res = await fetch("/api/admin/education/bulk", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        mode: "users",
                        educationTypeId,
                        completedAt: completedAtIso,
                        userIds: Array.from(selectedUserIds),
                    }),
                });
                if (!res.ok) {
                    const data = (await res.json().catch(() => null)) as {
                        message?: string;
                        error?: string;
                    } | null;
                    throw new Error(
                        data?.message ||
                            data?.error ||
                            t["admin.educationGrant.grantedFailure"] ||
                            "Grant failed",
                    );
                }
                const data = (await res.json()) as { granted?: number };
                const granted = data?.granted ?? count;
                const successMsg = (
                    t["admin.educationGrant.grantedSuccess"] ??
                    "Granted to {count} users."
                ).replace("{count}", String(granted));
                setSuccess(successMsg);
                setSelectedUserIds(new Set());
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                setError(errMsg);
            } finally {
                setSaving(false);
            }
        });
    }

    return (
        <div class="space-y-6" data-hydrated={hydrated ? "true" : "false"}>
            {error && (
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                </div>
            )}
            {success && (
                <div class="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                    {success}
                </div>
            )}

            {/* Tablist */}
            <div
                role="tablist"
                aria-label={t["admin.educationGrant.tabsLabel"]}
                class="flex border-b border-gray-200 dark:border-gray-700"
            >
                <button
                    type="button"
                    role="tab"
                    id="tab-event"
                    aria-selected={mode === "event"}
                    aria-controls="panel-event"
                    tabIndex={mode === "event" ? 0 : -1}
                    onClick={() => setMode("event")}
                    class={`px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
                        mode === "event"
                            ? "border-blue-600 text-blue-700 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                >
                    {t["admin.educationGrant.tabByEvent"]}
                </button>
                <button
                    type="button"
                    role="tab"
                    id="tab-users"
                    aria-selected={mode === "users"}
                    aria-controls="panel-users"
                    tabIndex={mode === "users" ? 0 : -1}
                    onClick={() => setMode("users")}
                    class={`px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
                        mode === "users"
                            ? "border-blue-600 text-blue-700 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                >
                    {t["admin.educationGrant.tabByUsers"]}
                </button>
            </div>

            {/* Event tab */}
            <div
                role="tabpanel"
                id="panel-event"
                aria-labelledby="tab-event"
                hidden={mode !== "event"}
                class="space-y-3"
            >
                <div>
                    <label
                        for="event-select"
                        class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
                    >
                        {t["admin.educationGrant.selectEvent"]}
                    </label>
                    <select
                        id="event-select"
                        value={selectedEventId}
                        onChange={(e) => {
                            clearMsgs();
                            setSelectedEventId(
                                (e.target as HTMLSelectElement).value,
                            );
                        }}
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                    >
                        <option value="">
                            {t["admin.educationGrant.selectEvent"]}
                        </option>
                        {events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                                {ev.name}
                            </option>
                        ))}
                    </select>
                </div>

                {selectedEventId && (
                    <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
                            <span class="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                {(
                                    t[
                                        "admin.educationGrant.eventWorkersHeading"
                                    ] ?? "Workers of {event}"
                                ).replace(
                                    "{event}",
                                    events.find((e) => e.id === selectedEventId)
                                        ?.name ?? "",
                                )}
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    clearMsgs();
                                    selectAllWorkers();
                                }}
                                disabled={
                                    workersLoading || eventWorkers.length === 0
                                }
                                class="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                            >
                                {t["admin.educationGrant.selectWorkersButton"]}
                            </button>
                        </div>
                        {workersLoading ? (
                            <p class="px-4 py-6 text-sm text-gray-400 text-center">
                                {t["common.loading"]}
                            </p>
                        ) : eventWorkers.length === 0 ? (
                            <p class="px-4 py-6 text-sm text-gray-400 text-center">
                                {t["admin.educationGrant.noEventSelected"]}
                            </p>
                        ) : (
                            <ul class="divide-y divide-gray-100 dark:divide-gray-800 max-h-96 overflow-y-auto">
                                {eventWorkers.map((w) => (
                                    <li
                                        key={w.userId}
                                        class="flex items-center gap-3 px-3 py-2 text-sm"
                                    >
                                        <input
                                            type="checkbox"
                                            id={`event-w-${w.userId}`}
                                            checked={selectedUserIds.has(
                                                w.userId,
                                            )}
                                            onChange={() =>
                                                toggleUser(w.userId)
                                            }
                                            class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                                        />
                                        <label
                                            for={`event-w-${w.userId}`}
                                            class="flex-1 cursor-pointer"
                                        >
                                            <span class="text-gray-900 dark:text-white">
                                                {userLabel(w)}
                                            </span>
                                            {w.responsible && (
                                                <span class="ml-2 text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                                                    🔑
                                                </span>
                                            )}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {/* Users tab */}
            <div
                role="tabpanel"
                id="panel-users"
                aria-labelledby="tab-users"
                hidden={mode !== "users"}
                class="space-y-3"
            >
                <div class="flex flex-wrap items-center gap-3">
                    <div class="relative flex-1 min-w-64">
                        <input
                            type="search"
                            placeholder={
                                t["admin.educationGrant.searchUsers"] ??
                                "Search by email, name, or nickname…"
                            }
                            value={searchQuery}
                            onInput={(e) => {
                                clearMsgs();
                                setSearchQuery(
                                    (e.target as HTMLSelectElement).value,
                                );
                            }}
                            class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-w-64"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            clearMsgs();
                            selectAllVisibleUsers();
                        }}
                        disabled={filteredUsers.length === 0}
                        class="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                        {t["admin.educationGrant.selectAll"]}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            clearMsgs();
                            clearSelection();
                        }}
                        disabled={selectedCount === 0}
                        class="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                        {t["admin.educationGrant.clearAll"]}
                    </button>
                </div>

                <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                    <p class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
                        {filteredUsers.length} of {users.length}
                    </p>
                    <ul class="divide-y divide-gray-100 dark:divide-gray-800 max-h-96 overflow-y-auto">
                        {filteredUsers.length === 0 ? (
                            <li class="px-4 py-6 text-sm text-gray-400 text-center">
                                {t["common.search"]}
                            </li>
                        ) : (
                            filteredUsers.map((u) => (
                                <li
                                    key={u.id}
                                    class="flex items-center gap-3 px-3 py-2 text-sm"
                                >
                                    <input
                                        type="checkbox"
                                        id={`user-${u.id}`}
                                        checked={selectedUserIds.has(u.id)}
                                        onChange={() => toggleUser(u.id)}
                                        class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                                    />
                                    <label
                                        for={`user-${u.id}`}
                                        class="flex-1 cursor-pointer"
                                    >
                                        <span class="text-gray-900 dark:text-white">
                                            {userLabel(u)}
                                        </span>
                                        <span class="ml-2 text-xs text-gray-400">
                                            {u.email}
                                        </span>
                                    </label>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            </div>

            {/* Shared grant form */}
            <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-4">
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {(
                        t["admin.educationGrant.selected"] ??
                        "{count} users selected"
                    ).replace("{count}", String(selectedCount))}
                </p>

                <div>
                    <label
                        for="education-type"
                        class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
                    >
                        {t["admin.educationGrant.selectEducation"]}
                    </label>
                    <select
                        id="education-type"
                        value={educationTypeId ?? ""}
                        onChange={(e) => {
                            clearMsgs();
                            const v = (e.target as HTMLSelectElement).value;
                            setEducationTypeId(v === "" ? null : Number(v));
                        }}
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                    >
                        <option value="">
                            {t["admin.educationGrant.selectEducation"]}
                        </option>
                        {educationTypes.map((et) => (
                            <option key={et.id} value={et.id}>
                                {eduLabel(et)}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label
                        for="completed-at"
                        class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
                    >
                        {t["admin.educationGrant.completedAtLabel"]}
                    </label>
                    <input
                        id="completed-at"
                        type="date"
                        value={completedAt}
                        onInput={(e) => {
                            clearMsgs();
                            setCompletedAt(
                                (e.target as HTMLSelectElement).value,
                            );
                        }}
                        required
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                    />
                    <p class="mt-1 text-xs text-gray-400">
                        {t["admin.educationGrant.completedAtHelp"]}
                    </p>
                </div>

                {selectedCount === 0 && (
                    <p class="text-xs text-yellow-700 dark:text-yellow-400">
                        {t["admin.educationGrant.noUsersSelected"]}
                    </p>
                )}

                <div class="flex justify-end">
                    <button
                        type="button"
                        onClick={() => {
                            clearMsgs();
                            handleSubmit();
                        }}
                        disabled={!canSubmit}
                        data-testid="grant-button"
                        class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving
                            ? (t["common.saving"] ?? "Saving...")
                            : (
                                  t["admin.educationGrant.grantButton"] ??
                                  "Grant education to {count} users"
                              ).replace("{count}", String(selectedCount))}
                    </button>
                </div>
            </div>
        </div>
    );
}
