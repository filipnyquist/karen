// src/islands/AdminMigration.tsx
import { useEffect, useState } from "preact/hooks";

interface Mapping {
    id: string;
    oldUserId: number;
    oldEmail: string;
    oldNickname: string | null;
    realUserId: string | null;
    migratedAt: string | null;
    adminRequested: boolean;
    adminRequestedReason: string | null;
    placeholderNickname: string | null;
}

interface MigrationStatus {
    total: number;
    claimed: number;
    pending: number;
    mappings: Mapping[];
}

interface AdminMigrationProps {
    t: Record<string, string>;
}

export default function AdminMigration({ t }: AdminMigrationProps) {
    const [status, setStatus] = useState<MigrationStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<
        "all" | "unclaimed" | "pending" | "claimed"
    >("all");
    const [search, setSearch] = useState("");
    const [approving, setApproving] = useState<string | null>(null);
    const [error, setError] = useState("");

    async function fetchStatus() {
        try {
            const res = await fetch("/api/migration/status", {
                credentials: "same-origin",
            });
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setStatus(data);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setLoading(false);
        }
    }

    // fetchStatus is a fresh closure each render; the function closes
    // over no state-changing values, so mount-once is correct.
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
    useEffect(() => {
        fetchStatus();
    }, []);

    async function handleApprove(mapping: Mapping) {
        // For manual migration, the admin needs the real user's UUID. Prompt
        // for it — the admin knows which new account to link to.
        const promptText =
            t["migration.manuallyMigratePrompt"] ||
            "Enter the UUID of the real user to migrate this legacy account to:";
        const userId = prompt(
            `${promptText} (${mapping.oldNickname || mapping.oldEmail})`,
        );
        if (!userId) return;

        setApproving(mapping.id);
        setError("");
        try {
            const res = await fetch("/api/migration/admin-approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ legacyId: mapping.id, userId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Approval failed");
            await fetchStatus();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setApproving(null);
        }
    }

    if (loading) {
        return (
            <p class="text-gray-500">{t["common.loading"] || "Loading..."}</p>
        );
    }

    if (!status) {
        return (
            <p class="text-red-500">
                {error || "Failed to load migration status"}
            </p>
        );
    }

    const filtered = status.mappings
        .filter((m) => {
            if (filter === "unclaimed")
                return !m.realUserId && !m.adminRequested;
            if (filter === "pending") return m.adminRequested && !m.realUserId;
            if (filter === "claimed") return !!m.realUserId;
            return true;
        })
        .filter((m) => {
            if (!search) return true;
            const q = search.toLowerCase();
            return (
                (m.oldEmail || "").toLowerCase().includes(q) ||
                (m.oldNickname || "").toLowerCase().includes(q) ||
                (m.placeholderNickname || "").toLowerCase().includes(q) ||
                String(m.oldUserId).includes(q)
            );
        });

    return (
        <div class="space-y-4">
            {error && (
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                </div>
            )}

            {/* Stats */}
            <div class="grid grid-cols-3 gap-4">
                <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 text-center">
                    <p class="text-2xl font-bold text-gray-900 dark:text-white">
                        {status.total}
                    </p>
                    <p class="text-sm text-gray-500">
                        {t["migration.total"] || "Total"}
                    </p>
                </div>
                <div class="bg-green-50 dark:bg-green-900/30 rounded-lg border border-green-200 dark:border-green-800 p-4 text-center">
                    <p class="text-2xl font-bold text-green-700 dark:text-green-300">
                        {status.claimed}
                    </p>
                    <p class="text-sm text-green-600 dark:text-green-400">
                        {t["migration.claimed"] || "Claimed"}
                    </p>
                </div>
                <div class="bg-yellow-50 dark:bg-yellow-900/30 rounded-lg border border-yellow-200 dark:border-yellow-800 p-4 text-center">
                    <p class="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
                        {status.pending}
                    </p>
                    <p class="text-sm text-yellow-600 dark:text-yellow-400">
                        {t["migration.pending"] || "Pending"}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div class="flex flex-wrap gap-3 items-center">
                <input
                    type="text"
                    value={search}
                    onInput={(e) =>
                        setSearch((e.target as HTMLInputElement).value)
                    }
                    placeholder={
                        t["migration.searchPlaceholder"] ||
                        "Search by email or nickname..."
                    }
                    class="flex-1 min-w-48 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div class="flex gap-1">
                    {(["all", "unclaimed", "pending", "claimed"] as const).map(
                        (f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                class={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                    filter === f
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                                }`}
                            >
                                {t[`migration.filter.${f}`] || f}
                            </button>
                        ),
                    )}
                </div>
            </div>

            {/* Table */}
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-gray-200 dark:border-gray-700">
                            <th class="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">
                                ID
                            </th>
                            <th class="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">
                                {t["migration.oldNickname"] || "Old Nickname"}
                            </th>
                            <th class="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">
                                {t["migration.oldEmailLabel"] || "Old Email"}
                            </th>
                            <th class="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">
                                {t["migration.status_label"] || "Status"}
                            </th>
                            <th class="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">
                                {t["migration.actions"] || "Actions"}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((m) => (
                            <tr
                                key={m.id}
                                class="border-b border-gray-100 dark:border-gray-800"
                            >
                                <td class="py-2 px-3 text-gray-500 dark:text-gray-400">
                                    {m.oldUserId}
                                </td>
                                <td class="py-2 px-3 text-gray-900 dark:text-white">
                                    {m.oldNickname ||
                                        m.placeholderNickname ||
                                        "-"}
                                </td>
                                <td class="py-2 px-3 text-gray-600 dark:text-gray-400">
                                    {m.oldEmail || "-"}
                                </td>
                                <td class="py-2 px-3">
                                    {m.realUserId ? (
                                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                            {t["migration.statusClaimed"] ||
                                                "Claimed"}
                                        </span>
                                    ) : m.adminRequested ? (
                                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                                            {t["migration.statusPending"] ||
                                                "Pending"}
                                        </span>
                                    ) : (
                                        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                            {t["migration.statusUnclaimed"] ||
                                                "Unclaimed"}
                                        </span>
                                    )}
                                </td>
                                <td class="py-2 px-3">
                                    {!m.realUserId && (
                                        <button
                                            onClick={() => handleApprove(m)}
                                            disabled={approving === m.id}
                                            class="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                            title={
                                                t[
                                                    "migration.manuallyMigrateHelp"
                                                ] ||
                                                "Use this for accounts where the user can't submit a request themselves."
                                            }
                                        >
                                            {approving === m.id
                                                ? "..."
                                                : t[
                                                      "migration.manuallyMigrate"
                                                  ] || "Manually migrate"}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 && (
                            <tr>
                                <td
                                    colSpan={5}
                                    class="py-4 px-3 text-center text-gray-500 dark:text-gray-400"
                                >
                                    {t["migration.noResults"] || "No results"}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
