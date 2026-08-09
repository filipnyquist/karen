// src/islands/StudentVerify.tsx
import { useState } from "preact/hooks";

interface StudentVerifyProps {
    t: Record<string, string>;
    alreadyVerified?: boolean;
    verifiedSuccess?: boolean;
}

export default function StudentVerify({
    t,
    verifiedSuccess,
}: StudentVerifyProps) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);

    if (verifiedSuccess) {
        return (
            <div class="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p class="text-green-700 dark:text-green-300 font-medium">
                    {t["auth.verifyComplete"]}
                </p>
            </div>
        );
    }

    if (sent) {
        return (
            <div class="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p class="text-blue-700 dark:text-blue-300 font-medium">
                    {t["auth.verifyLinkSent"]}
                </p>
            </div>
        );
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const res = await fetch("/api/auth/request-verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(
                    data.message || data.error || "Failed to send verification",
                );
                return;
            }
            setSent(true);
        } catch {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} class="space-y-4">
            <div>
                <label
                    for="verify-email"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                    {t["auth.email"]}
                </label>
                <input
                    id="verify-email"
                    type="email"
                    required
                    value={email}
                    onInput={(e) =>
                        setEmail((e.target as HTMLInputElement).value)
                    }
                    placeholder="namn@student.bth.se"
                    class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>
            {error && (
                <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p class="text-sm text-red-700 dark:text-red-300">
                        {error}
                    </p>
                </div>
            )}
            <button
                type="submit"
                disabled={loading}
                class="w-full px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
                {loading ? t["common.loading"] : t["auth.sendVerifyLink"]}
            </button>
        </form>
    );
}
