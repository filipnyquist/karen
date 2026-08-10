// src/islands/GuestManager.tsx
import { useEffect, useState } from "preact/hooks";

interface GuestManagerProps {
    eventId: string;
    isAdmin: boolean;
    isResponsible: boolean;
    isVerified: boolean;
    /** Whether the viewer is logged in. We don't try to fetch the
     * "my guests" list for anonymous users (it would 401, and the
     * page already gates the modal trigger behind login). */
    isAuthenticated: boolean;
    maxGuestsPerUser: number;
    t: Record<string, string>;
}

interface Guest {
    id: string;
    guestName: string;
    guestEmail: string | null;
    guestSsn: string | null;
    reporterId?: string;
    createdAt: string;
    /** Present only on the /all endpoint (joined from users). */
    reporterName?: string | null;
    reporterNickname?: string | null;
}

interface AddGuestForm {
    guestName: string;
    guestEmail: string;
    guestSsn: string;
}

type Mode = "mine" | "all";

export default function GuestManager({
    eventId,
    isAdmin,
    isResponsible,
    isVerified,
    isAuthenticated,
    maxGuestsPerUser,
    t,
}: GuestManagerProps) {
    const [mode, setMode] = useState<Mode>("mine");
    const [myGuests, setMyGuests] = useState<Guest[]>([]);
    const [allGuests, setAllGuests] = useState<Guest[]>([]);
    const [form, setForm] = useState<AddGuestForm>({
        guestName: "",
        guestEmail: "",
        guestSsn: "",
    });
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [adminOverride, setAdminOverride] = useState(false);

    const canSeeAll = isAdmin || isResponsible;
    const remaining = Math.max(0, maxGuestsPerUser - myGuests.length);
    const canAdd =
        isVerified && (myGuests.length < maxGuestsPerUser || adminOverride);

    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }
        fetchMyGuests();
    }, [eventId, isAuthenticated]);

    useEffect(() => {
        if (mode === "all" && canSeeAll) {
            fetchAllGuests();
        }
    }, [mode]);

    async function fetchMyGuests() {
        setLoading(true);
        try {
            const res = await fetch(`/api/guests/event/${eventId}/mine`, {
                credentials: "same-origin",
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(
                    data.error ||
                        data.message ||
                        t["guest.failedToLoad"] ||
                        "Failed to load guests",
                );
            }
            const data = await res.json();
            setMyGuests(data.guests ?? data);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(
                errMsg || t["guest.failedToLoad"] || "Failed to load guests",
            );
        } finally {
            setLoading(false);
        }
    }

    async function fetchAllGuests() {
        try {
            const res = await fetch(`/api/guests/event/${eventId}/all`, {
                credentials: "same-origin",
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(
                    data.error ||
                        data.message ||
                        t["guest.failedToLoad"] ||
                        "Failed to load guests",
                );
            }
            const data = await res.json();
            setAllGuests(data.guests ?? data);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            setError(
                errMsg || t["guest.failedToLoad"] || "Failed to load guests",
            );
        }
    }

    async function handleAddGuest(e: Event) {
        e.preventDefault();
        if (!isVerified) return;

        setError("");
        setSuccessMessage("");
        setSubmitting(true);

        try {
            const body: Record<string, unknown> = {
                eventId,
                guestName: form.guestName,
                guestEmail: form.guestEmail || undefined,
                guestSsn: form.guestSsn || undefined,
            };
            if (adminOverride && isAdmin) {
                body.adminOverride = true;
            }

            const res = await fetch("/api/guests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(
                    data.error ||
                        data.message ||
                        t["guest.failedToAdd"] ||
                        "Failed to add guest",
                );
            }

            setForm({ guestName: "", guestEmail: "", guestSsn: "" });
            setSuccessMessage(
                t["guest.guestAdded"] || "Guest added successfully!",
            );
            await fetchMyGuests();

            setTimeout(() => setSuccessMessage(""), 3000);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            setError(errMsg || t["guest.failedToAdd"] || "Failed to add guest");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRemoveGuest(guestId: string) {
        const w = window as unknown as {
            appConfirm?: (msg: string, cb: () => void) => void;
        };
        if (!w.appConfirm) return;
        w.appConfirm(
            t["guest.confirmRemove"] || "Remove this guest?",
            async () => {
                setError("");
                setSuccessMessage("");

                try {
                    const res = await fetch(`/api/guests/${guestId}`, {
                        method: "DELETE",
                        credentials: "same-origin",
                    });

                    if (!res.ok) {
                        const data = await res.json();
                        throw new Error(
                            data.error ||
                                data.message ||
                                t["guest.failedToRemove"] ||
                                "Failed to remove guest",
                        );
                    }

                    setSuccessMessage(
                        t["guest.guestRemoved"] || "Guest removed.",
                    );
                    await fetchMyGuests();
                    if (mode === "all") await fetchAllGuests();
                    setTimeout(() => setSuccessMessage(""), 3000);
                } catch (err) {
                    const errMsg =
                        err instanceof Error ? err.message : String(err);

                    setError(
                        errMsg ||
                            t["guest.failedToRemove"] ||
                            "Failed to remove guest",
                    );
                }
            },
        );
    }

    function updateForm(field: keyof AddGuestForm, value: string) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    if (loading) {
        return (
            <div class="flex justify-center items-center py-12">
                <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
            </div>
        );
    }

    return (
        <div class="space-y-6">
            {/* Mode tabs */}
            <div class="flex gap-2 border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={() => setMode("mine")}
                    class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        mode === "mine"
                            ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                >
                    {t["guest.myGuests"] || "My Guests"}
                </button>
                {canSeeAll && (
                    <button
                        onClick={() => setMode("all")}
                        class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            mode === "all"
                                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        }`}
                    >
                        {t["guest.allGuests"] || "All Guests"}
                    </button>
                )}
            </div>

            {/* Messages */}
            {error && (
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                </div>
            )}
            {successMessage && (
                <div class="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                    {successMessage}
                </div>
            )}

            {mode === "mine" ? (
                /* ─── My Guests mode ─── */
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="font-medium text-gray-800 dark:text-gray-200">
                            {t["guest.myGuests"] || "My Guests"}
                        </h3>
                        <span
                            class={`text-sm font-medium px-3 py-1 rounded-full ${
                                canAdd && !adminOverride
                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                                    : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                            }`}
                        >
                            {myGuests.length} / {maxGuestsPerUser}{" "}
                            {t["guest.guests"] || "guests"}
                            {canAdd && !adminOverride
                                ? ` (${remaining} ${t["guest.remaining"] || "remaining"})`
                                : !adminOverride
                                  ? ` (${t["guest.limitReached"] || "limit reached"})`
                                  : ""}
                        </span>
                    </div>

                    {!isVerified ? (
                        <div class="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300 text-sm">
                            {t["guest.needVerification"] ||
                                "You need to verify your account to add guests."}
                        </div>
                    ) : (
                        <>
                            {/* Admin override toggle */}
                            {isAdmin && (
                                <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={adminOverride}
                                        onChange={(e) => {
                                            setAdminOverride(
                                                (e.target as HTMLInputElement)
                                                    .checked,
                                            );
                                        }}
                                        class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span>
                                        {t["guest.adminOverride"] ||
                                            "Admin: override guest limit"}
                                    </span>
                                </label>
                            )}

                            {/* Add guest form */}
                            {canAdd && (
                                <form
                                    onSubmit={handleAddGuest}
                                    class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4"
                                >
                                    <h4 class="font-medium text-gray-800 dark:text-gray-200">
                                        {t["guest.addAGuest"] || "Add a Guest"}
                                    </h4>

                                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div>
                                            <label
                                                for="guestName"
                                                class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                                            >
                                                {t["auth.name"] || "Name"} *
                                            </label>
                                            <input
                                                id="guestName"
                                                type="text"
                                                required
                                                value={form.guestName}
                                                onInput={(e) =>
                                                    updateForm(
                                                        "guestName",
                                                        (
                                                            e.target as HTMLInputElement
                                                        ).value,
                                                    )
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                placeholder={
                                                    t[
                                                        "guest.guestNamePlaceholder"
                                                    ] || "Guest name"
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label
                                                for="guestEmail"
                                                class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                                            >
                                                {t["auth.email"] || "Email"}
                                            </label>
                                            <input
                                                id="guestEmail"
                                                type="email"
                                                value={form.guestEmail}
                                                onInput={(e) =>
                                                    updateForm(
                                                        "guestEmail",
                                                        (
                                                            e.target as HTMLInputElement
                                                        ).value,
                                                    )
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                placeholder={
                                                    t[
                                                        "guest.guestEmailPlaceholder"
                                                    ] || "guest@email.com"
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label
                                                for="guestSsn"
                                                class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                                            >
                                                {t["guest.ssn"] || "SSN"}
                                            </label>
                                            <input
                                                id="guestSsn"
                                                type="text"
                                                value={form.guestSsn}
                                                onInput={(e) =>
                                                    updateForm(
                                                        "guestSsn",
                                                        (
                                                            e.target as HTMLInputElement
                                                        ).value,
                                                    )
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                placeholder={
                                                    t["guest.ssnPlaceholder"] ||
                                                    "YYYYMMDD-XXXX"
                                                }
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                                    >
                                        {submitting
                                            ? t["guest.adding"] || "Adding..."
                                            : t["guest.addGuest"] ||
                                              "Add Guest"}
                                    </button>
                                </form>
                            )}

                            {/* My guest list */}
                            {myGuests.length === 0 ? (
                                <div class="text-center py-6">
                                    <p class="text-gray-500 dark:text-gray-400">
                                        {t["guest.noGuestsAdded"] ||
                                            "No guests added yet."}
                                    </p>
                                </div>
                            ) : (
                                <ul class="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                    {myGuests.map((guest) => (
                                        <li
                                            key={guest.id}
                                            class="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                        >
                                            <div class="min-w-0 flex-1">
                                                <p class="font-medium text-gray-900 dark:text-white truncate">
                                                    {guest.guestName}
                                                </p>
                                                <div class="text-xs text-gray-500 dark:text-gray-400 space-x-3">
                                                    {guest.guestEmail && (
                                                        <span>
                                                            {guest.guestEmail}
                                                        </span>
                                                    )}
                                                    {guest.guestSsn && (
                                                        <span>
                                                            {t["guest.ssn"] ||
                                                                "SSN"}
                                                            : {guest.guestSsn}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleRemoveGuest(guest.id)
                                                }
                                                class="ml-4 flex-shrink-0 p-1.5 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
                                                title={
                                                    t["guest.removeGuest"] ||
                                                    "Remove guest"
                                                }
                                            >
                                                <svg
                                                    class="w-5 h-5"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                    />
                                                </svg>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            ) : (
                /* ─── All Guests mode ─── */
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="font-medium text-gray-800 dark:text-gray-200">
                            {t["guest.allGuests"] || "All Guests"}
                        </h3>
                        <span class="text-sm text-gray-500 dark:text-gray-400">
                            {allGuests.length} {t["guest.guests"] || "guests"}
                        </span>
                    </div>

                    {allGuests.length === 0 ? (
                        <div class="text-center py-6">
                            <p class="text-gray-500 dark:text-gray-400">
                                {t["guest.noGuestsAdded"] ||
                                    "No guests added yet."}
                            </p>
                        </div>
                    ) : (
                        <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
                            <div class="overflow-x-auto overflow-y-hidden">
                                <table class="w-full text-sm">
                                    <thead class="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {t["auth.name"] || "Name"}
                                            </th>
                                            <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {t["auth.email"] || "Email"}
                                            </th>
                                            <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {t["guest.ssn"] || "SSN"}
                                            </th>
                                            <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {t["guest.addedBy"] ||
                                                    "Added by"}
                                            </th>
                                            <th class="px-4 py-2.5 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                {t["guest.addedAt"] || "Added"}
                                            </th>
                                            <th class="px-4 py-2.5 whitespace-nowrap" />
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                                        {allGuests.map((guest) => (
                                            <tr
                                                key={guest.id}
                                                class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                                            >
                                                <td class="px-4 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                                    {guest.guestName}
                                                </td>
                                                <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                    {guest.guestEmail || "-"}
                                                </td>
                                                <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap font-mono text-xs">
                                                    {guest.guestSsn || "-"}
                                                </td>
                                                <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                    <a
                                                        href={`/profile/${guest.reporterId}`}
                                                        class="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                    >
                                                        {guest.reporterNickname ||
                                                            guest.reporterName ||
                                                            "-"}
                                                    </a>
                                                </td>
                                                <td class="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                    {new Date(
                                                        guest.createdAt,
                                                    ).toLocaleString(
                                                        undefined,
                                                        {
                                                            year: "numeric",
                                                            month: "short",
                                                            day: "numeric",
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                        },
                                                    )}
                                                </td>
                                                <td class="px-4 py-2.5 text-right whitespace-nowrap">
                                                    {/* Only admins can remove guests in the All Guests view */}
                                                    {isAdmin && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleRemoveGuest(
                                                                    guest.id,
                                                                )
                                                            }
                                                            class="p-1.5 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
                                                            title={
                                                                t[
                                                                    "guest"
                                                                        .removeGuest
                                                                ] ||
                                                                "Remove guest"
                                                            }
                                                        >
                                                            <svg
                                                                class="w-5 h-5"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                viewBox="0 0 24 24"
                                                            >
                                                                <path
                                                                    stroke-linecap="round"
                                                                    stroke-linejoin="round"
                                                                    stroke-width="2"
                                                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                                />
                                                            </svg>
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
