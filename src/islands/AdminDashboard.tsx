// src/islands/AdminDashboard.tsx
import { useCallback, useEffect, useState } from "preact/hooks";
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

interface EduType {
    id: number;
    name: string;
}

interface AdminDashboardProps {
    initialUsers: User[];
    educationTypes: EduType[];
    currentUserIsSuperadmin: boolean;
    t: Record<string, string>;
}

export default function AdminDashboard({
    initialUsers,
    currentUserIsSuperadmin,
    t,
}: AdminDashboardProps) {
    const [users, setUsers] = useState<User[]>(initialUsers);
    const [search, setSearch] = useState("");
    const [searching, setSearching] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [searchTimeout, setSearchTimeout] = useState<ReturnType<
        typeof setTimeout
    > | null>(null);

    const refreshUsers = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/users?limit=100", {
                credentials: "same-origin",
            });
            if (res.ok) setUsers(await res.json());
        } catch {}
    }, []);

    useEffect(() => {
        if (!search.trim()) {
            setUsers(initialUsers);
            return;
        }
        if (searchTimeout) clearTimeout(searchTimeout);
        const tm = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await fetch(
                    `/api/admin/users/search/${encodeURIComponent(search)}`,
                    { credentials: "same-origin" },
                );
                if (res.ok) setUsers(await res.json());
            } catch {}
            setSearching(false);
        }, 300);
        setSearchTimeout(tm);
    }, [search]);

    return (
        <div class="space-y-4">
            {/* Search + Invite button row */}
            <div class="flex items-center gap-3">
                <div class="relative flex-1">
                    <svg
                        class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
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
                        value={search}
                        onInput={(e) =>
                            setSearch((e.target as HTMLInputElement).value)
                        }
                        placeholder={
                            t["admin.searchUsers"] || "Search users..."
                        }
                        class="w-full pl-10 pr-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {searching && (
                        <div class="absolute right-3 top-1/2 -translate-y-1/2">
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
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userTable.email"] || "Email"}
                                </th>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userTable.name"] || "Name"}
                                </th>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userTable.nickname"] ||
                                        "Nickname"}
                                </th>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userTable.role"] || "Role"}
                                </th>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userTable.verified"] ||
                                        "Verified"}
                                </th>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userTable.emailVerified"] ||
                                        "Email"}
                                </th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                            {users.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={6}
                                        class="px-4 py-8 text-center text-gray-400"
                                    >
                                        {t["admin.noResults"] ||
                                            "No users found"}
                                    </td>
                                </tr>
                            ) : (
                                users.map((u) => (
                                    <tr
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

            <p class="text-xs text-gray-400">
                {(t["admin.usersShown"] || "{count} users shown").replace(
                    "{count}",
                    String(users.length),
                )}{" "}
                — {t["admin.clickRowToManage"] || "click a row to manage"}
            </p>

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
