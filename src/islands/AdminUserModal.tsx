// src/islands/AdminUserModal.tsx
import { useEffect, useState } from "preact/hooks";

interface AdminUserModalProps {
    userId: string;
    onClose: () => void;
    onRefresh: () => void;
    lang: string;
    /** True if the user opening this modal is a superadmin (can change any role). */
    currentUserIsSuperadmin: boolean;
    t: Record<string, string>;
}

interface UserDetail {
    user: {
        id: string;
        email: string;
        name: string | null;
        nickname: string | null;
        role: string;
        verified: boolean;
        emailVerified: boolean;
        createdAt: string;
        profilePic: string | null;
    };
    educations: {
        educationTypeId: number;
        name: string;
        description: string | null;
        completedAt: string;
        expiresAt: string | null;
    }[];
    tickets: {
        id: string;
        eventName: string;
        eventStartDate: string;
        isActive: boolean;
        createdAt: string;
        redeemedAt: string | null;
    }[];
}

interface EventOption {
    id: string;
    name: string;
    startDate: string;
}

interface EduType {
    id: number;
    name: string;
    description: string | null;
}

export default function AdminUserModal({
    userId,
    onClose,
    onRefresh,
    lang,
    currentUserIsSuperadmin,
    t,
}: AdminUserModalProps) {
    const [data, setData] = useState<UserDetail | null>(null);
    const [events, setEvents] = useState<EventOption[]>([]);
    const [eduTypes, setEduTypes] = useState<EduType[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [editName, setEditName] = useState("");
    const [editNickname, setEditNickname] = useState("");
    const [editRole, setEditRole] = useState("user");
    const [selectedEvent, setSelectedEvent] = useState("");
    const [selectedEdu, setSelectedEdu] = useState("");
    const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
        "idle",
    );

    async function copyUserId() {
        try {
            await navigator.clipboard.writeText(userId);
            setCopyState("copied");
            setTimeout(() => setCopyState("idle"), 2000);
        } catch {
            setCopyState("error");
            setTimeout(() => setCopyState("idle"), 2000);
        }
    }

    // `loadAll` closes over `userId`; using it as the dep would loop.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on userId
    useEffect(() => {
        loadAll();
    }, [userId]);

    async function loadAll() {
        setLoading(true);
        setError("");
        try {
            const [detailRes, eventsRes, eduRes] = await Promise.all([
                fetch(`/api/admin/users/${userId}`, {
                    credentials: "same-origin",
                }),
                fetch("/api/admin/events", { credentials: "same-origin" }),
                fetch("/api/admin/education-types", {
                    credentials: "same-origin",
                }),
            ]);

            if (!detailRes)
                throw new Error(t["common.failedToLoad"] || "Failed to load");
            const detail = await detailRes.json();
            setData(detail);
            setEditName(detail.user.name || "");
            setEditNickname(detail.user.nickname || "");
            setEditRole(detail.user.role);

            if (eventsRes.ok) setEvents(await eventsRes.json());
            if (eduRes.ok) setEduTypes(await eduRes.json());
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg || t["common.failedToLoad"] || "Failed to load");
        } finally {
            setLoading(false);
        }
    }

    function clearMsgs() {
        setError("");
        setSuccess("");
    }

    async function saveUser() {
        clearMsgs();
        try {
            // Non-superadmins are not allowed to change roles at all (the
            // server would 403 anyway), so we omit the field for them.
            // Superadmins can change to any role including superadmin.
            const body: Record<string, unknown> = {
                name: editName || null,
                nickname: editNickname || null,
            };
            if (
                currentUserIsSuperadmin &&
                data &&
                editRole !== data.user.role
            ) {
                body.role = editRole;
            }
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            setSuccess(t["admin.userUpdated"] || "User updated");
            await loadAll();
            onRefresh();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        }
    }

    async function toggleVerified() {
        clearMsgs();
        if (!data) return;
        try {
            const res = await fetch("/api/admin/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ userId }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            setSuccess(
                data.user.verified
                    ? t["admin.userUnverified"] || "User unverified"
                    : t["admin.userVerified"] || "User verified",
            );
            await loadAll();
            onRefresh();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        }
    }

    async function toggleEmailVerified() {
        clearMsgs();
        if (!data) return;
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    emailVerified: !data.user.emailVerified,
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            setSuccess(
                data.user.emailVerified
                    ? t["admin.emailUnverified"] || "Email marked unverified"
                    : t["admin.emailVerified"] || "Email marked verified",
            );
            await loadAll();
            onRefresh();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        }
    }

    async function grantEducation() {
        if (!selectedEdu) return;
        clearMsgs();
        try {
            const res = await fetch("/api/admin/education", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    userId,
                    educationTypeId: parseInt(selectedEdu, 10),
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            setSelectedEdu("");
            setSuccess(t["admin.educationGranted"] || "Education granted");
            await loadAll();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        }
    }

    async function revokeEducation(eduTypeId: number) {
        clearMsgs();
        try {
            const res = await fetch("/api/admin/education", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ userId, educationTypeId: eduTypeId }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            setSuccess(t["admin.educationRevoked"] || "Education revoked");
            await loadAll();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        }
    }

    async function issueTicket() {
        if (!selectedEvent) return;
        clearMsgs();
        try {
            const res = await fetch("/api/tickets/issue", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ userId, eventId: selectedEvent }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            setSelectedEvent("");
            setSuccess(t["admin.ticketIssued"] || "Ticket issued");
            await loadAll();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        }
    }

    function formatDate(d: string | null) {
        if (!d) return "-";
        return new Date(d).toLocaleDateString(lang, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    function eduLabel(et: { name: string; description?: string | null }) {
        return et.description || et.name;
    }

    if (loading) {
        return (
            <div
                class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                onClick={onClose}
            >
                <div
                    class="bg-white dark:bg-gray-900 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div class="flex justify-center py-12">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                    </div>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const u = data.user;

    return (
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={onClose}
        >
            <div
                class="bg-white dark:bg-gray-900 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div class="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate">
                        {u.nickname || u.name || u.email}
                    </h2>
                    <button
                        onClick={onClose}
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

                <div class="p-6 space-y-6">
                    {/* Messages */}
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

                    {/* User Info */}
                    <section class="space-y-3">
                        <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t["admin.userInfo"] || "User Info"}
                        </h3>
                        {/* UUID — visible here so an admin doing manual
                            account linking in the approval flow can grab
                            it without opening the DB or a separate tool. */}
                        <div class="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
                            <div class="flex items-center justify-between gap-3 mb-1">
                                <label class="text-xs font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.userId"] || "User ID"}
                                </label>
                                <button
                                    type="button"
                                    onClick={copyUserId}
                                    class="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
                                >
                                    {copyState === "copied"
                                        ? t["admin.copied"] || "Copied!"
                                        : copyState === "error"
                                          ? t["admin.copyFailed"] ||
                                            "Copy failed"
                                          : t["admin.copy"] || "Copy"}
                                </button>
                            </div>
                            <code class="block text-xs font-mono text-gray-700 dark:text-gray-300 break-all select-all">
                                {userId}
                            </code>
                        </div>
                        <div class="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.userTable.email"] || "Email"}
                                </label>
                                <span class="text-gray-900 dark:text-white">
                                    {u.email}
                                </span>
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.joined"] || "Joined"}
                                </label>
                                <span class="text-gray-900 dark:text-white">
                                    {formatDate(u.createdAt)}
                                </span>
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.userTable.name"] || "Name"}
                                </label>
                                <input
                                    type="text"
                                    value={editName}
                                    onInput={(e) =>
                                        setEditName(
                                            (e.target as HTMLInputElement)
                                                .value,
                                        )
                                    }
                                    class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-sm"
                                />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.userTable.nickname"] ||
                                        "Nickname"}
                                </label>
                                <input
                                    type="text"
                                    value={editNickname}
                                    onInput={(e) =>
                                        setEditNickname(
                                            (e.target as HTMLInputElement)
                                                .value,
                                        )
                                    }
                                    class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-sm"
                                />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.userTable.role"] || "Role"}
                                </label>
                                {currentUserIsSuperadmin ? (
                                    <select
                                        value={editRole}
                                        onChange={(e) =>
                                            setEditRole(
                                                (e.target as HTMLSelectElement)
                                                    .value,
                                            )
                                        }
                                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-sm"
                                    >
                                        <option value="user">
                                            {t["admin.roleUser"] || "User"}
                                        </option>
                                        <option value="admin">
                                            {t["admin.roleAdmin"] || "Admin"}
                                        </option>
                                        <option value="superadmin">
                                            {t["admin.roleSuperadmin"] ||
                                                "Superadmin"}
                                        </option>
                                    </select>
                                ) : (
                                    <div class="px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300">
                                        {editRole}
                                    </div>
                                )}
                                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                    {currentUserIsSuperadmin
                                        ? t["admin.roleDesc"] ||
                                          "Admins can manage all users and events"
                                        : "Only superadmins can change a user's role"}
                                </p>
                            </div>
                            <div class="flex flex-col gap-2">
                                <div class="flex items-center gap-3 flex-wrap">
                                    <button
                                        onClick={toggleVerified}
                                        class={`text-xs font-medium px-3 py-1 rounded-full ${u.verified ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"}`}
                                    >
                                        {u.verified
                                            ? `${t["admin.verifiedStudent"] || "Verified student/alumni"} ✓`
                                            : t["admin.userTable.verifyBtn"] ||
                                              "Verify"}
                                    </button>
                                    <button
                                        onClick={toggleEmailVerified}
                                        class={`text-xs font-medium px-3 py-1 rounded-full ${u.emailVerified ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
                                    >
                                        {u.emailVerified
                                            ? `${t["admin.emailVerifiedBtn"] || "Email verified"} ✓`
                                            : t["admin.markEmailVerifiedBtn"] ||
                                              "Mark email verified"}
                                    </button>
                                </div>
                                <p class="text-xs text-gray-400 dark:text-gray-500">
                                    {t["admin.verifiedDesc"] ||
                                        "Confirms the user is a verified student or alumni"}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={saveUser}
                            class="px-4 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                            {t["common.saveChanges"] || "Save changes"}
                        </button>
                    </section>

                    {/* Educations */}
                    <section class="space-y-3">
                        <div>
                            <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {t["admin.educations"] || "Educations"}
                            </h3>
                            <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                {t["admin.educationDesc"] ||
                                    "Qualifications the user has completed"}
                            </p>
                        </div>
                        {data.educations.length === 0 ? (
                            <p class="text-sm text-gray-400">
                                {t["admin.noEducations"] || "No educations"}
                            </p>
                        ) : (
                            <div class="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                {data.educations.map((edu) => {
                                    const isExpired =
                                        edu.expiresAt &&
                                        new Date() > new Date(edu.expiresAt);
                                    return (
                                        // educations table has no id
                                        // column on this side; pair
                                        // type with completedAt (users
                                        // can re-certify, so the pair
                                        // is unique).
                                        <div
                                            key={`${edu.educationTypeId}-${edu.completedAt}`}
                                            class="flex items-start justify-between px-3 py-2 text-sm"
                                        >
                                            <div>
                                                <span class="font-medium text-gray-900 dark:text-white">
                                                    {edu.description ||
                                                        edu.name}
                                                </span>
                                                {edu.description && (
                                                    <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                                        {edu.description}
                                                    </p>
                                                )}
                                                <span class="text-gray-400 ml-2 text-xs">
                                                    {formatDate(
                                                        edu.completedAt,
                                                    )}
                                                </span>
                                            </div>
                                            <div class="flex items-center gap-2 shrink-0">
                                                {isExpired ? (
                                                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                                                        {t["admin.expired"] ||
                                                            "Expired"}
                                                    </span>
                                                ) : edu.expiresAt ? (
                                                    <span class="text-xs text-gray-400">
                                                        {t["admin.expires"] ||
                                                            "Expires"}
                                                        :{" "}
                                                        {formatDate(
                                                            edu.expiresAt,
                                                        )}
                                                    </span>
                                                ) : null}
                                                <button
                                                    onClick={() =>
                                                        revokeEducation(
                                                            edu.educationTypeId,
                                                        )
                                                    }
                                                    class="text-xs text-red-500 hover:text-red-700"
                                                >
                                                    {t["admin.revoke"] ||
                                                        "Revoke"}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div class="flex gap-2">
                            <select
                                value={selectedEdu}
                                onChange={(e) =>
                                    setSelectedEdu(
                                        (e.target as HTMLSelectElement).value,
                                    )
                                }
                                class="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-sm"
                            >
                                <option value="">
                                    {t["admin.grantEducation"] ||
                                        "Grant education"}
                                    ...
                                </option>
                                {eduTypes.map((et) => (
                                    <option key={et.id} value={et.id}>
                                        {eduLabel(et)}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={grantEducation}
                                disabled={!selectedEdu}
                                class="px-3 py-1 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                {t["admin.grant"] || "Grant"}
                            </button>
                        </div>
                    </section>

                    {/* Tickets */}
                    <section class="space-y-3">
                        <div>
                            <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {t["ticket.title"] || "Tickets"}
                            </h3>
                            <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                {t["admin.ticketDesc"] ||
                                    "Entry tickets for events — can be issued manually"}
                            </p>
                        </div>
                        {data.tickets.length === 0 ? (
                            <p class="text-sm text-gray-400">
                                {t["admin.noTickets"] || "No tickets"}
                            </p>
                        ) : (
                            <div class="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                {data.tickets.map((tk) => (
                                    <div
                                        key={tk.id}
                                        class="flex items-center justify-between px-3 py-2 text-sm"
                                    >
                                        <div>
                                            <span class="font-medium text-gray-900 dark:text-white">
                                                {tk.eventName}
                                            </span>
                                            <span class="text-gray-400 ml-2 text-xs">
                                                {formatDate(tk.createdAt)}
                                            </span>
                                        </div>
                                        <span
                                            class={`text-xs px-2 py-0.5 rounded-full ${tk.isActive ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}
                                        >
                                            {tk.isActive
                                                ? t["admin.active"] || "Active"
                                                : tk.redeemedAt
                                                  ? t["admin.redeemed"] ||
                                                    "Redeemed"
                                                  : t["ticket.inactive"] ||
                                                    "Inactive"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div class="flex gap-2">
                            <select
                                value={selectedEvent}
                                onChange={(e) =>
                                    setSelectedEvent(
                                        (e.target as HTMLSelectElement).value,
                                    )
                                }
                                class="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-sm"
                            >
                                <option value="">
                                    {t["admin.selectEvent"] ||
                                        "Select event..."}
                                </option>
                                {events.map((ev) => (
                                    <option key={ev.id} value={ev.id}>
                                        {ev.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={issueTicket}
                                disabled={!selectedEvent}
                                class="px-3 py-1 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                                {t["admin.issue"] || "Issue"}
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
