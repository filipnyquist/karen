// src/islands/InviteUserModal.tsx
//
// Superadmin-only modal for issuing a new invitation. Posts to
// /api/invitations and displays the (dev-only) accept URL on success so
// the admin can hand the link to the invitee without scraping email logs.

import { useState } from "preact/hooks";

interface InviteUserModalProps {
    onClose: () => void;
    t: Record<string, string>;
}

interface InviteResponse {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    acceptUrl?: string;
}

export default function InviteUserModal({ onClose, t }: InviteUserModalProps) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<
        "user" | "responsible" | "admin" | "superadmin"
    >("user");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<InviteResponse | null>(null);

    async function submit(ev: Event) {
        ev.preventDefault();
        setSubmitting(true);
        setError("");
        try {
            const res = await fetch("/api/invitations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ email, role }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d.error || t["common.failed"] || "Failed");
            }
            const data = (await res.json()) as InviteResponse;
            setResult(data);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 max-w-md w-full p-6 space-y-4"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 class="text-lg font-bold text-gray-900 dark:text-white">
                    {t["invite.adminInviteTitle"] || "Invite a user"}
                </h2>

                {result ? (
                    <div class="space-y-3">
                        <p class="text-sm text-green-700 dark:text-green-400">
                            {t["invite.adminInviteSent"] || "Invitation sent."}
                        </p>
                        <p class="text-sm text-gray-600 dark:text-gray-400">
                            {result.email} — {result.role}
                        </p>
                        {result.acceptUrl && (
                            <div class="space-y-1">
                                <p class="text-xs text-gray-500 dark:text-gray-400">
                                    Dev-only link (production hides this — the
                                    invitee receives an email):
                                </p>
                                <input
                                    type="text"
                                    readOnly
                                    value={result.acceptUrl}
                                    class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-xs font-mono"
                                    onClick={(e) =>
                                        (e.target as HTMLInputElement).select()
                                    }
                                />
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            class="w-full px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <form onSubmit={submit} class="space-y-3">
                        <div>
                            <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                {t["invite.emailLabel"] || "Email"}
                            </label>
                            <input
                                type="email"
                                value={email}
                                onInput={(e) =>
                                    setEmail(
                                        (e.target as HTMLInputElement).value,
                                    )
                                }
                                required
                                class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                {t["invite.roleLabel"] || "Role"}
                            </label>
                            <select
                                value={role}
                                onChange={(e) =>
                                    setRole(
                                        (e.target as HTMLSelectElement)
                                            .value as typeof role,
                                    )
                                }
                                class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                            >
                                <option value="user">
                                    {t["admin.roleUser"] || "User"}
                                </option>
                                <option value="responsible">Responsible</option>
                                <option value="admin">
                                    {t["admin.roleAdmin"] || "Admin"}
                                </option>
                                <option value="superadmin">
                                    {t["admin.roleSuperadmin"] || "Superadmin"}
                                </option>
                            </select>
                        </div>

                        {error && (
                            <p class="text-sm text-red-600 dark:text-red-400">
                                {error}
                            </p>
                        )}

                        <div class="flex gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                class="flex-1 px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                class="flex-1 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {t["invite.sendInvite"] || "Send invitation"}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
