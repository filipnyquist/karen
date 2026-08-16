// src/islands/GuestManager.tsx
import { useEffect, useState } from "preact/hooks";
import { useEventSocket } from "./useEventSocket";

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
    /** Shown in the "adding as …" strip once the date of birth is on file. */
    reporterDisplayName: string;
    t: Record<string, string>;
}

interface Guest {
    id: string;
    guestName: string;
    guestEmail: string | null;
    guestBirthDate: string | null;
    reporterId?: string;
    createdAt: string;
    /** Present only on the /all endpoint (joined from users). */
    reporterName?: string | null;
    reporterNickname?: string | null;
}

interface AddGuestForm {
    guestName: string;
    guestEmail: string;
    guestBirthDate: string;
}

type Mode = "mine" | "all";

function DobValue({ value }: { value: string }) {
    return (
        <span class="font-mono text-xs text-gray-700 dark:text-gray-300">
            {value}
        </span>
    );
}

export default function GuestManager({
    eventId,
    isAdmin,
    isResponsible,
    isVerified,
    isAuthenticated,
    maxGuestsPerUser,
    reporterDisplayName,
    t,
}: GuestManagerProps) {
    const [mode, setMode] = useState<Mode>("mine");
    const [myGuests, setMyGuests] = useState<Guest[]>([]);
    const [allGuests, setAllGuests] = useState<Guest[]>([]);
    const [form, setForm] = useState<AddGuestForm>({
        guestName: "",
        guestEmail: "",
        guestBirthDate: "",
    });
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [adminOverride, setAdminOverride] = useState(false);

    // Own date-of-birth capture. Fetched client-side from
    // /api/profiles/me/birth-date — NOT shipped in the SSR payload — so
    // the modal may briefly show "no date of birth on file" until the
    // fetch resolves.
    const [ownBirthDate, setOwnBirthDate] = useState<string | null>(null);
    const [ownBirthDateInput, setOwnBirthDateInput] = useState("");
    const [savingOwnBirthDate, setSavingOwnBirthDate] = useState(false);
    const [ownBirthDateError, setOwnBirthDateError] = useState("");
    const [editingOwnBirthDate, setEditingOwnBirthDate] = useState(false);

    const canSeeAll = isAdmin || isResponsible;
    const remaining = Math.max(0, maxGuestsPerUser - myGuests.length);
    const canAdd =
        isVerified && (myGuests.length < maxGuestsPerUser || adminOverride);
    const needsOwnBirthDate = !ownBirthDate || editingOwnBirthDate;

    // fetchMyGuests is a fresh closure each render; the effect's only
    // meaningful dep is `isAuthenticated`.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on isAuthenticated
    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }
        fetchMyGuests();
        fetch("/api/profiles/me/birth-date", { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : { birthDate: null }))
            .then((d) => setOwnBirthDate(d?.birthDate ?? null))
            .catch(() => setOwnBirthDate(null));
    }, [isAuthenticated]);

    // fetchAllGuests is a fresh closure each render; the effect's only
    // meaningful deps are `mode` and `canSeeAll`.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on mode/canSeeAll
    useEffect(() => {
        if (mode === "all" && canSeeAll) {
            fetchAllGuests();
        }
    }, [mode, canSeeAll]);

    // Subscribe to /ws/event/:eventId so any guest add/remove by anyone
    // refetches this user's "my guests" list. The static "Gäster (X/X)"
    // badge on the page is updated separately by the inline eventScript.
    useEventSocket(eventId, (kind) => {
        if (kind !== "guests") return;
        fetchMyGuests();
        if (mode === "all" && canSeeAll) fetchAllGuests();
    });

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

    async function handleSaveOwnBirthDate(e: Event) {
        e.preventDefault();
        const value = ownBirthDateInput.trim();
        if (!value) return;

        setOwnBirthDateError("");
        setSavingOwnBirthDate(true);
        try {
            const res = await fetch("/api/profiles/me/birth-date", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ birthDate: value }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(
                    data.error ||
                        data.message ||
                        t["guest.ownSsnFailed"] ||
                        "Failed to save your date of birth",
                );
            }
            setOwnBirthDate(data.birthDate);
            setOwnBirthDateInput("");
            setEditingOwnBirthDate(false);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            setOwnBirthDateError(
                errMsg ||
                    t["guest.ownSsnFailed"] ||
                    "Failed to save your date of birth",
            );
        } finally {
            setSavingOwnBirthDate(false);
        }
    }

    async function handleAddGuest(e: Event) {
        e.preventDefault();
        if (!isVerified || !ownBirthDate) return;

        setError("");
        setSuccessMessage("");
        setSubmitting(true);

        try {
            const body: Record<string, unknown> = {
                eventId,
                guestName: form.guestName,
                guestEmail: form.guestEmail || undefined,
                guestBirthDate: form.guestBirthDate,
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

            setForm({ guestName: "", guestEmail: "", guestBirthDate: "" });
            setSuccessMessage(
                t["guest.guestAdded"] || "Guest added successfully!",
            );
            // The WS push will trigger fetchMyGuests() across all
            // subscribers — no manual broadcast or refetch needed here.
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
                    // Server broadcasts the "guests" change via WS;
                    // every subscriber refetches automatically.
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

                                    {/* Own DOB — asked once, then collapsed to
                                        a one-line strip so the form stays
                                        three fields wide forever after. */}
                                    {needsOwnBirthDate ? (
                                        <div class="rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
                                            <div class="flex items-start gap-2">
                                                <svg
                                                    class="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99L13.74 4a2 2 0 00-3.48 0L3.33 16.01A2 2 0 005.07 19z"
                                                    />
                                                </svg>
                                                <div class="min-w-0">
                                                    <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
                                                        {t[
                                                            "guest.ownSsnTitle"
                                                        ] ||
                                                            "Your date of birth"}
                                                    </p>
                                                    <p class="text-xs text-amber-800/80 dark:text-amber-200/70">
                                                        {t[
                                                            "guest.ownSsnExplain"
                                                        ] ||
                                                            "Used to verify your drinking age at events."}
                                                    </p>
                                                </div>
                                            </div>
                                            <div class="flex flex-wrap items-center gap-2">
                                                <input
                                                    id="ownBirthDate"
                                                    type="text"
                                                    pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
                                                    placeholder="YYYY-MM-DD"
                                                    value={ownBirthDateInput}
                                                    onInput={(e) =>
                                                        setOwnBirthDateInput(
                                                            (
                                                                e.target as HTMLInputElement
                                                            ).value,
                                                        )
                                                    }
                                                    class="flex-1 min-w-[12rem] rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-700 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={
                                                        handleSaveOwnBirthDate
                                                    }
                                                    disabled={
                                                        savingOwnBirthDate ||
                                                        !ownBirthDateInput.trim()
                                                    }
                                                    class="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                                                >
                                                    {savingOwnBirthDate
                                                        ? t["common.saving"] ||
                                                          "Saving..."
                                                        : t[
                                                              "guest.ownSsnSave"
                                                          ] || "Save"}
                                                </button>
                                                {editingOwnBirthDate &&
                                                    ownBirthDate && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingOwnBirthDate(
                                                                    false,
                                                                );
                                                                setOwnBirthDateError(
                                                                    "",
                                                                );
                                                                setOwnBirthDateInput(
                                                                    "",
                                                                );
                                                            }}
                                                            class="px-3 py-2 rounded-lg text-sm text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                                                        >
                                                            {t[
                                                                "common.cancel"
                                                            ] || "Cancel"}
                                                        </button>
                                                    )}
                                            </div>
                                            <small class="block text-xs text-amber-800/80 dark:text-amber-200/70 pl-1">
                                                YYYY-MM-DD
                                            </small>
                                            {ownBirthDateError && (
                                                <p class="text-xs text-red-600 dark:text-red-400">
                                                    {ownBirthDateError}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <p class="text-xs text-gray-500 dark:text-gray-400">
                                            {t["guest.ownSsnSaved"] ||
                                                "Adding as"}{" "}
                                            <span class="font-medium text-gray-700 dark:text-gray-300">
                                                {reporterDisplayName}
                                            </span>{" "}
                                            ·{" "}
                                            <DobValue
                                                value={ownBirthDate as string}
                                            />{" "}
                                            ·{" "}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingOwnBirthDate(
                                                        true,
                                                    );
                                                    setOwnBirthDateInput(
                                                        ownBirthDate as string,
                                                    );
                                                }}
                                                class="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
                                            >
                                                {t["guest.ownSsnChange"] ||
                                                    "change"}
                                            </button>
                                        </p>
                                    )}

                                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div>
                                            <label
                                                for="guestName"
                                                class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                                            >
                                                {t["guest.fullName"] ||
                                                    "Full name"}{" "}
                                                *
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
                                                for="guestBirthDate"
                                                class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                                            >
                                                {t["guest.ssn"] ||
                                                    "Date of birth"}{" "}
                                                *
                                            </label>
                                            <input
                                                id="guestBirthDate"
                                                type="text"
                                                pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
                                                placeholder="YYYY-MM-DD"
                                                required
                                                value={form.guestBirthDate}
                                                onInput={(e) =>
                                                    updateForm(
                                                        "guestBirthDate",
                                                        (
                                                            e.target as HTMLInputElement
                                                        ).value,
                                                    )
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            />
                                            <small class="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                YYYY-MM-DD
                                            </small>
                                        </div>
                                    </div>

                                    <div class="flex items-center gap-3">
                                        <button
                                            type="submit"
                                            disabled={
                                                submitting || !ownBirthDate
                                            }
                                            class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                                        >
                                            {submitting
                                                ? t["guest.adding"] ||
                                                  "Adding..."
                                                : t["guest.addGuest"] ||
                                                  "Add Guest"}
                                        </button>
                                        {!ownBirthDate && (
                                            <span class="text-xs text-gray-500 dark:text-gray-400">
                                                {t["guest.ownSsnRequired"] ||
                                                    "Register your date of birth above first."}
                                            </span>
                                        )}
                                    </div>
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
                                                    {guest.guestBirthDate && (
                                                        <span>
                                                            {t["guest.ssn"] ||
                                                                "Date of birth"}
                                                            :{" "}
                                                            {
                                                                guest.guestBirthDate
                                                            }
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
                                                {t["guest.guest"] || "Guest"}
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
                                                class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors align-top"
                                            >
                                                {/* Guest identity: name over
                                                    birth-date over email, so
                                                    the door staff reads one
                                                    block per person. */}
                                                <td class="px-4 py-2.5">
                                                    <div class="font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                                        {guest.guestName}
                                                    </div>
                                                    <div class="whitespace-nowrap">
                                                        {guest.guestBirthDate ? (
                                                            <DobValue
                                                                value={
                                                                    guest.guestBirthDate
                                                                }
                                                            />
                                                        ) : (
                                                            <span class="text-xs text-gray-400 dark:text-gray-500">
                                                                {t[
                                                                    "guest.noSwedishSsn"
                                                                ] ||
                                                                    "No date of birth on file"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {guest.guestEmail && (
                                                        <div class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                            {guest.guestEmail}
                                                        </div>
                                                    )}
                                                </td>
                                                {/* Submitter identity, mirroring
                                                    the guest block above it. */}
                                                <td class="px-4 py-2.5">
                                                    <div class="whitespace-nowrap">
                                                        <a
                                                            href={`/profile/${guest.reporterId}`}
                                                            class="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                        >
                                                            {guest.reporterName ||
                                                                guest.reporterNickname ||
                                                                "-"}
                                                        </a>
                                                    </div>
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
                                                                    "guest.removeGuest"
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
