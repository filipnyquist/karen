// src/islands/AdminDashboard.tsx
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import AdminUserModal from "./AdminUserModal";
import InviteUserModal from "./InviteUserModal";

interface User {
    id: string;
    email: string;
    name: string | null;
    nickname: string | null;
    role: string;
    emailVerified: boolean | null;
    verified: boolean | null;
    createdAt: Date | string;
}

type SortBy =
    | "email"
    | "name"
    | "nickname"
    | "role"
    | "verified"
    | "emailVerified"
    | "createdAt";
type SortDir = "asc" | "desc";

interface AdminDashboardProps {
    initialUsers: User[];
    initialTotal: number;
    currentUserIsSuperadmin: boolean;
    t: Record<string, string>;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export default function AdminDashboard({
    initialUsers,
    initialTotal,
    currentUserIsSuperadmin,
    t,
}: AdminDashboardProps) {
    const [users, setUsers] = useState<User[]>(initialUsers);
    const [total, setTotal] = useState(initialTotal);
    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [sortBy, setSortBy] = useState<SortBy>("createdAt");
    const [sortDir, setSortDir] = useState<SortDir>("desc");
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setHydrated(true);
    }, []);

    // Debounce the search input — the user types here, `debouncedQuery`
    // is what actually drives the fetch.
    useEffect(() => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            setDebouncedQuery(query);
            setPage(0);
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, [query]);

    // Single fetch driven by the debounced search + sort + page.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const params = new URLSearchParams({
            sortBy,
            sortDir,
            limit: String(PAGE_SIZE),
            offset: String(page * PAGE_SIZE),
        });
        if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());

        fetch(`/api/admin/users?${params.toString()}`, {
            credentials: "same-origin",
        })
            .then((r) =>
                r.ok ? r.json() : Promise.reject(new Error(r.statusText)),
            )
            .then((data: { users: User[]; total: number }) => {
                if (cancelled) return;
                setUsers(data.users);
                setTotal(data.total);
            })
            .catch(() => {
                /* leave prior state intact */
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [debouncedQuery, sortBy, sortDir, page]);

    // Re-fetch the current view (used after the user modal mutates a row).
    const refreshUsers = useCallback(() => {
        setPage((p) => p);
        // Force the effect to re-run by toggling a stable trigger: bump
        // debouncedQuery to its current value via the setter pattern.
        setDebouncedQuery((q) => q);
    }, []);

    const toggleSort = (column: SortBy) => {
        if (sortBy === column) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortBy(column);
            setSortDir("asc");
        }
        setPage(0);
    };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const canPrev = page > 0;
    const canNext = page + 1 < totalPages;

    const columnHeader = (key: SortBy, label: string) => {
        const isActive = sortBy === key;
        const arrow = isActive ? (sortDir === "asc" ? "▲" : "▼") : "";
        const ariaSort = isActive
            ? sortDir === "asc"
                ? "ascending"
                : "descending"
            : "none";
        const ariaLabel = isActive
            ? sortDir === "asc"
                ? t["admin.sortAsc"] || "Sort ascending"
                : t["admin.sortDesc"] || "Sort descending"
            : t["admin.sortAsc"] || "Sort ascending";
        return (
            <th
                class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400"
                aria-sort={ariaSort}
            >
                <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    aria-label={`${label} — ${ariaLabel}`}
                    class="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                >
                    {label}
                    <span class="text-xs w-3 inline-block" aria-hidden="true">
                        {arrow}
                    </span>
                </button>
            </th>
        );
    };

    return (
        <div class="space-y-4" data-hydrated={hydrated ? "true" : "false"}>
            {/* Search + Invite button row */}
            <div class="flex items-center gap-3">
                <div class="relative flex-1">
                    <svg
                        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                    <input
                        type="text"
                        value={query}
                        onInput={(e) =>
                            setQuery((e.target as HTMLInputElement).value)
                        }
                        placeholder={
                            t["admin.searchUsers"] || "Search users..."
                        }
                        class="w-full pl-10 pr-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {loading && (
                        <div
                            class="absolute right-3 top-1/2 -translate-y-1/2"
                            role="status"
                            aria-label={t["admin.loading"] || "Loading..."}
                        >
                            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                        </div>
                    )}
                </div>
                {currentUserIsSuperadmin && (
                    <button
                        type="button"
                        onClick={() => setShowInviteModal(true)}
                        class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shrink-0"
                    >
                        + {t["invite.adminInviteButton"] || "Invite user"}
                    </button>
                )}
            </div>

            {/* Table */}
            <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div class="overflow-x-auto relative">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                {columnHeader(
                                    "email",
                                    t["admin.userTable.email"] || "Email",
                                )}
                                {columnHeader(
                                    "name",
                                    t["admin.userTable.name"] || "Name",
                                )}
                                {columnHeader(
                                    "nickname",
                                    t["admin.userTable.nickname"] || "Nickname",
                                )}
                                {columnHeader(
                                    "role",
                                    t["admin.userTable.role"] || "Role",
                                )}
                                {columnHeader(
                                    "verified",
                                    t["admin.userTable.verified"] || "Verified",
                                )}
                                {columnHeader(
                                    "emailVerified",
                                    t["admin.userTable.emailVerified"] ||
                                        "Email",
                                )}
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                            {users.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        class="px-4 py-8 text-center text-gray-400"
                                    >
                                        {loading
                                            ? t["admin.loading"] || "Loading..."
                                            : t["admin.noResults"] ||
                                              "No users found"}
                                    </td>
                                </tr>
                            ) : (
                                users.map((u) => (
                                    <tr
                                        key={u.id}
                                        class="hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer transition-colors"
                                        onClick={() => setSelectedUserId(u.id)}
                                    >
                                        <td class="px-4 py-2.5 text-gray-900 dark:text-white">
                                            {u.email}
                                        </td>
                                        <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                            {u.name || "-"}
                                        </td>
                                        <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                            {u.nickname || "-"}
                                        </td>
                                        <td class="px-4 py-2.5">
                                            <span
                                                class={`text-xs font-medium px-2 py-1 rounded-full ${
                                                    u.role === "superadmin"
                                                        ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                                                        : u.role === "admin"
                                                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                                                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                                }`}
                                            >
                                                {u.role}
                                            </span>
                                        </td>
                                        <td class="px-4 py-2.5">
                                            {u.verified ? (
                                                <span class="text-green-600 dark:text-green-400">
                                                    &#10003;
                                                </span>
                                            ) : (
                                                <span class="text-gray-400">
                                                    -
                                                </span>
                                            )}
                                        </td>
                                        <td class="px-4 py-2.5">
                                            {u.emailVerified ? (
                                                <span class="text-green-600 dark:text-green-400">
                                                    &#10003;
                                                </span>
                                            ) : (
                                                <span class="text-gray-400">
                                                    -
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Footer: total count + pagination */}
            <div class="flex items-center justify-between text-xs text-gray-400">
                <span>
                    {(t["admin.usersShown"] || "{count} users").replace(
                        "{count}",
                        String(total),
                    )}
                    {" — "}
                    {t["admin.clickRowToManage"] || "click a row to manage"}
                </span>
                <nav
                    class="flex items-center gap-2"
                    aria-label={t["admin.page"] || "Page"}
                >
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={!canPrev}
                        class="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                        ← {t["admin.prevPage"] || "Previous"}
                    </button>
                    <span class="text-gray-600 dark:text-gray-400">
                        {t["admin.page"] || "Page"} {page + 1}{" "}
                        {t["admin.of"] || "of"} {totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={!canNext}
                        class="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                        {t["admin.nextPage"] || "Next"} →
                    </button>
                </nav>
            </div>

            {/* Modals */}
            {selectedUserId && (
                <AdminUserModal
                    userId={selectedUserId}
                    onClose={() => setSelectedUserId(null)}
                    onRefresh={refreshUsers}
                    lang="sv"
                    currentUserIsSuperadmin={currentUserIsSuperadmin}
                    t={t}
                />
            )}
            {showInviteModal && (
                <InviteUserModal
                    onClose={() => setShowInviteModal(false)}
                    t={t}
                />
            )}
        </div>
    );
}
