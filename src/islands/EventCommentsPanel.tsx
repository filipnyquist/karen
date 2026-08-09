// src/islands/EventCommentsPanel.tsx
//
// Hydrated island replacing the static comments list + post-comment
// form on the event detail page. Polls every 10s while the tab is
// visible and the textarea is empty (paused while the user has unsent
// draft text so we don't clobber it).

import { useState } from "preact/hooks";
import { useLiveRefresh } from "./useLiveRefresh";

export interface Comment {
    id: string;
    content: string;
    createdAt: string;
    userId: string;
    userName: string | null;
    userNickname: string | null;
}

interface Props {
    eventId: string;
    initialComments: Comment[];
    currentUserId: string | null;
    responsibleUserIds: string[];
    canPost: boolean; // logged in
    canDelete: boolean; // admin or owner of comment
    t: Record<string, string>;
}

function isoToLocal(iso: string, lang: string): string {
    return new Date(iso).toLocaleString(lang ?? "sv", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function EventCommentsPanel({
    eventId,
    initialComments,
    currentUserId,
    responsibleUserIds,
    canPost,
    canDelete,
    t,
}: Props) {
    const [comments, setComments] = useState<Comment[]>(initialComments);
    const [draft, setDraft] = useState("");
    const [posting, setPosting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const lang = t["common.locale"] ?? "sv";
    const responsibleSet = new Set(responsibleUserIds);

    useLiveRefresh(
        async () => {
            try {
                const res = await fetch(`/api/events/${eventId}/comments`, {
                    credentials: "same-origin",
                });
                if (!res.ok) return;
                const data = (await res.json()) as Comment[];
                setComments(data);
            } catch {
                /* swallow */
            }
        },
        { pauseWhile: () => draft.length > 0 },
    );

    async function submit(ev: Event) {
        ev.preventDefault();
        const content = draft.trim();
        if (!content) return;

        const csrf =
            document.cookie
                .split("; ")
                .find((c) => c.startsWith("csrf_token="))
                ?.split("=")[1] ?? "";

        setPosting(true);
        setError("");
        try {
            const res = await fetch("/api/comments", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrf,
                },
                credentials: "same-origin",
                body: JSON.stringify({ eventId, content }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    data.error ??
                        t["common.failedToPostComment"] ??
                        "Failed to post comment",
                );
            }
            setDraft("");
            // Re-fetch immediately so the new comment shows up. Calling
            // refresh.bump() here would still see the stale draft ref
            // because setState hasn't flushed yet, so pauseWhile would
            // incorrectly suppress the fetch.
            await fetchComments();
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg ?? t["common.networkError"] ?? "Network error");
        } finally {
            setPosting(false);
        }
    }

    async function fetchComments() {
        try {
            const res = await fetch(`/api/events/${eventId}/comments`, {
                credentials: "same-origin",
            });
            if (!res.ok) return;
            const data = (await res.json()) as Comment[];
            setComments(data);
        } catch {
            /* swallow */
        }
    }

    async function deleteComment(id: string) {
        const csrf =
            document.cookie
                .split("; ")
                .find((c) => c.startsWith("csrf_token="))
                ?.split("=")[1] ?? "";
        setDeletingId(id);
        try {
            const res = await fetch(`/api/comments/${id}`, {
                method: "DELETE",
                credentials: "same-origin",
                headers: csrf ? { "X-CSRF-Token": csrf } : {},
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    data.error ??
                        t["common.failedToDeleteComment"] ??
                        "Failed to delete",
                );
            }
            setComments((prev) => prev.filter((c) => c.id !== id));
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg ?? t["common.networkError"] ?? "Network error");
            setDeletingId(null);
        }
    }

    return (
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t["event.comments"]}
            </h2>

            {canPost && (
                <form onSubmit={submit} id="comment-form" class="mb-6">
                    <div class="flex gap-3">
                        <input
                            type="text"
                            id="comment-input"
                            value={draft}
                            onInput={(e) =>
                                setDraft((e.target as HTMLInputElement).value)
                            }
                            required
                            placeholder={`${t["event.comments"] ?? "Kommentarer"}…`}
                            class="flex-1 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <button
                            type="submit"
                            disabled={posting || draft.trim().length === 0}
                            class="px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shrink-0"
                        >
                            {t["common.save"]}
                        </button>
                    </div>
                </form>
            )}

            {error && (
                <p class="text-sm text-red-600 dark:text-red-400 mb-3">
                    {error}
                </p>
            )}

            {comments.length === 0 ? (
                <p class="text-sm text-gray-400 dark:text-gray-500">-</p>
            ) : (
                <div class="space-y-4">
                    {comments.map((c) => {
                        const isOwner = c.userId === currentUserId;
                        const isAdmin = canDelete && !isOwner;
                        const showable = isOwner || isAdmin;
                        return (
                            <div
                                class="flex gap-3"
                                id={`comment-${c.id}`}
                                key={c.id}
                            >
                                <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0">
                                    {(c.userNickname || c.userName || "?")
                                        .charAt(0)
                                        .toUpperCase()}
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-baseline gap-2 flex-wrap">
                                        <a
                                            href={`/profile/${c.userId}`}
                                            class="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                                        >
                                            {c.userNickname ||
                                                c.userName ||
                                                t["common.unknown"] ||
                                                "Unknown"}
                                        </a>
                                        {responsibleSet.has(c.userId) && (
                                            <span class="text-xs font-medium px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                                                🔑{" "}
                                                {t["event.responsible"] ??
                                                    "Responsible"}
                                            </span>
                                        )}
                                        <span class="text-xs text-gray-400 dark:text-gray-500">
                                            {isoToLocal(c.createdAt, lang)}
                                        </span>
                                        {showable && (
                                            <button
                                                type="button"
                                                data-action="delete-comment"
                                                data-comment-id={c.id}
                                                onClick={() => {
                                                    (
                                                        window as unknown as {
                                                            appConfirm: (
                                                                msg: string,
                                                                cb: () => void,
                                                            ) => void;
                                                        }
                                                    ).appConfirm(
                                                        t[
                                                            "common.confirmDeleteComment"
                                                        ] ?? "Delete comment?",
                                                        () =>
                                                            deleteComment(c.id),
                                                    );
                                                }}
                                                disabled={deletingId === c.id}
                                                class="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 ml-auto disabled:opacity-50"
                                            >
                                                {t["common.delete"]}
                                            </button>
                                        )}
                                    </div>
                                    <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
                                        {c.content}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
