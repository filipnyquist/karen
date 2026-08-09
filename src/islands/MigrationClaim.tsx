// src/islands/MigrationClaim.tsx
import { useEffect, useState } from "preact/hooks";

interface MigrationStats {
    workerRegistrations: number;
    comments: number;
    teamMemberships: number;
    tickets: number;
    guestRegistrations: number;
}

interface MigrationClaimProps {
    t: Record<string, string>;
    isNewUser?: boolean;
    verifyToken?: string;
}

type Step = "lookup" | "found" | "link-sent" | "success" | "admin-request";

export default function MigrationClaim({
    t,
    isNewUser,
    verifyToken,
}: MigrationClaimProps) {
    const [step, setStep] = useState<Step>(verifyToken ? "lookup" : "lookup");
    const [email, setEmail] = useState("");
    const [legacyId, setLegacyId] = useState("");
    const [oldNickname, setOldNickname] = useState("");
    const [oldEmail, setOldEmail] = useState("");
    const [reason, setReason] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [stats, setStats] = useState<MigrationStats | null>(null);

    // Auto-verify if token present in URL
    useEffect(() => {
        if (!verifyToken) return;
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(
                    `/api/migration/verify-link?token=${encodeURIComponent(verifyToken)}`,
                    {
                        credentials: "same-origin",
                    },
                );
                const data = await res.json();
                if (!res.ok)
                    throw new Error(
                        data.error ||
                            t["migration.invalidToken"] ||
                            "Invalid or expired link",
                    );

                if (data.stats) setStats(data.stats);
                setStep("success");
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);

                setError(errMsg);
                setStep("lookup");
            } finally {
                setLoading(false);
            }
        })();
    }, [verifyToken]);

    async function handleLookup(e: Event) {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/migration/lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Lookup failed");

            if (!data.found) {
                setError(
                    t["migration.notFound"] ||
                        "No account found with that email",
                );
            } else if (data.alreadyClaimed) {
                setError(
                    t["migration.alreadyClaimed"] ||
                        "This account has already been claimed",
                );
            } else if (data.alreadyMigrated) {
                setError(
                    t["migration.youAlreadyMigrated"] ||
                        "You have already migrated an account",
                );
            } else {
                setLegacyId(data.legacyId);
                setOldNickname(data.oldNickname || "");
                setOldEmail(data.oldEmail || "");
                setStep("found");
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setLoading(false);
        }
    }

    async function handleSendLink(e: Event) {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/migration/send-link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ legacyId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to send link");
            setStep("link-sent");
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setLoading(false);
        }
    }

    async function handleAdminRequest(e: Event) {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/migration/request-admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ legacyId, reason }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Request failed");
            setStep("admin-request");
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setLoading(false);
        }
    }

    // Show loading spinner while auto-verifying
    if (verifyToken && loading) {
        return (
            <div class="max-w-md text-center py-8">
                <p class="text-gray-500 dark:text-gray-400">
                    {t["migration.verifying"] || "Verifying..."}
                </p>
            </div>
        );
    }

    return (
        <div class="max-w-md">
            {error && (
                <div class="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                </div>
            )}

            {/* Step 1: Lookup */}
            {step === "lookup" && (
                <form onSubmit={handleLookup} class="space-y-4">
                    <div>
                        <label
                            for="email"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["migration.oldEmail"] ||
                                "Your old email from the previous system"}
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onInput={(e) =>
                                setEmail((e.target as HTMLInputElement).value)
                            }
                            required
                            class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="old-email@example.com"
                        />
                    </div>
                    <div class="flex items-center gap-3">
                        <button
                            type="submit"
                            disabled={loading || !email}
                            class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {loading
                                ? t["common.loading"] || "Searching..."
                                : t["migration.search"] || "Search"}
                        </button>
                        {isNewUser && (
                            <a
                                href="/"
                                class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                            >
                                {t["migration.skip"] || "No, I'm new"}
                            </a>
                        )}
                    </div>
                </form>
            )}

            {/* Step 2: Found */}
            {step === "found" && (
                <div class="space-y-4">
                    <div class="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <p class="text-blue-700 dark:text-blue-300 font-medium">
                            {t["migration.foundAccount"] || "Found account"}:{" "}
                            {oldNickname}
                        </p>
                    </div>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                        {t["migration.sendCodeExplanation"] ||
                            "A verification link will be sent to your old email address."}
                    </p>
                    <div class="flex gap-3">
                        <button
                            onClick={handleSendLink}
                            disabled={loading}
                            class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {loading
                                ? t["common.loading"] || "Sending..."
                                : t["migration.sendCode"] ||
                                  "Send verification link"}
                        </button>
                        <button
                            onClick={() => {
                                setStep("lookup");
                                setError("");
                            }}
                            class="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                            {t["common.back"] || "Back"}
                        </button>
                    </div>
                    <div class="pt-2 border-t border-gray-200 dark:border-gray-700">
                        <button
                            onClick={() => setStep("admin-request")}
                            class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
                        >
                            {t["migration.lostAccess"] ||
                                "Lost access to your old email?"}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Link sent - check your email */}
            {step === "link-sent" && (
                <div class="space-y-4">
                    <div class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                        <p class="text-green-700 dark:text-green-300 font-medium">
                            {t["migration.linkSent"] || "Check your inbox!"}
                        </p>
                        <p class="text-green-600 dark:text-green-400 text-sm mt-1">
                            {t["migration.codeSent"] ||
                                "A verification link has been sent to"}{" "}
                            {oldEmail}
                        </p>
                    </div>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                        {t["migration.linkInstruction"] ||
                            "Click the link in the email to complete the migration. The link expires in 24 hours."}
                    </p>
                    <button
                        onClick={handleSendLink}
                        disabled={loading}
                        class="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                        {t["migration.resendCode"] || "Resend link"}
                    </button>
                </div>
            )}

            {/* Step 4: Success */}
            {step === "success" && (
                <div class="space-y-4">
                    <div class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                        <p class="text-green-700 dark:text-green-300 font-medium text-lg">
                            {t["migration.successTitle"] ||
                                "Migration complete!"}
                        </p>
                        <p class="text-green-600 dark:text-green-400 text-sm mt-1">
                            {t["migration.successDescription"] ||
                                "Your old account has been linked to your new profile."}
                        </p>
                        {stats && (
                            <div class="mt-3 pt-3 border-t border-green-200 dark:border-green-800">
                                <p class="text-green-700 dark:text-green-300 text-sm font-medium">
                                    {t["migration.transferredData"] ||
                                        "Transferred data:"}
                                </p>
                                <ul class="text-green-600 dark:text-green-400 text-sm mt-1 space-y-0.5">
                                    <li>
                                        {stats.workerRegistrations}{" "}
                                        {t["migration.workerRegistrations"] ||
                                            "worked events"}
                                    </li>
                                    <li>
                                        {stats.comments}{" "}
                                        {t["migration.comments"] || "comments"}
                                    </li>
                                    <li>
                                        {stats.teamMemberships}{" "}
                                        {t["migration.teamMemberships"] ||
                                            "team memberships"}
                                    </li>
                                    {stats.tickets > 0 && (
                                        <li>
                                            {stats.tickets}{" "}
                                            {t["migration.tickets"] ||
                                                "tickets"}
                                        </li>
                                    )}
                                    {stats.guestRegistrations > 0 && (
                                        <li>
                                            {stats.guestRegistrations}{" "}
                                            {t[
                                                "migration.guestRegistrations"
                                            ] || "guest registrations"}
                                        </li>
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>
                    <a
                        href="/profile/edit"
                        class="inline-block px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        {t["migration.goToProfile"] || "Go to profile"}
                    </a>
                </div>
            )}

            {/* Admin request flow */}
            {step === "admin-request" && (
                <form onSubmit={handleAdminRequest} class="space-y-4">
                    <div class="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                        <p class="text-yellow-700 dark:text-yellow-300 text-sm">
                            {t["migration.adminRequestExplanation"] ||
                                "If you lost access to your old email, an admin can manually approve your migration."}
                        </p>
                    </div>
                    <div>
                        <label
                            for="reason"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["migration.reason"] ||
                                "Why you need manual approval"}
                        </label>
                        <textarea
                            id="reason"
                            value={reason}
                            onInput={(e) =>
                                setReason(
                                    (e.target as HTMLTextAreaElement).value,
                                )
                            }
                            rows={3}
                            class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={
                                t["migration.reasonPlaceholder"] ||
                                "I lost access to my old email..."
                            }
                        />
                    </div>
                    <div class="flex gap-3">
                        <button
                            type="submit"
                            disabled={loading}
                            class="px-4 py-2 rounded-md bg-yellow-600 text-white text-sm font-medium hover:bg-yellow-700 disabled:opacity-50 transition-colors"
                        >
                            {loading
                                ? t["common.loading"] || "Sending..."
                                : t["migration.requestApproval"] ||
                                  "Request admin approval"}
                        </button>
                        <button
                            onClick={() => {
                                setStep("found");
                                setError("");
                            }}
                            class="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                            {t["common.back"] || "Back"}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
