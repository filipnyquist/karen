// src/islands/ProfileEditor.tsx
import { useRef, useState } from "preact/hooks";

interface Profile {
    name: string | null;
    nickname: string | null;
    description: string | null;
    profilePic: string | null;
}

interface ProfileEditorProps {
    profile: Profile;
    /** Own user id, used to redirect back to the profile page after save. */
    userId: string;
    t: Record<string, string>;
}

export default function ProfileEditor({
    profile,
    userId,
    t,
}: ProfileEditorProps) {
    const [name, setName] = useState(profile.name || "");
    const [nickname, setNickname] = useState(profile.nickname || "");
    const [description, setDescription] = useState(profile.description || "");
    const [picUrl, setPicUrl] = useState(profile.profilePic || "");
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

    // Password change state
    const [currentPw, setCurrentPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [pwSaving, setPwSaving] = useState(false);
    const [pwError, setPwError] = useState("");
    const [pwSuccess, setPwSuccess] = useState("");

    async function handleFileChange(e: Event) {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            setError(
                t["profile.onlyImagesAllowed"] ||
                    "Only image files are allowed",
            );
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError(t["profile.fileTooLarge"] || "File too large (max 5MB)");
            return;
        }

        // Auto-upload immediately
        setUploading(true);
        setError("");
        try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch("/api/uploads/profile-pic", {
                method: "POST",
                body: formData,
                credentials: "same-origin",
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(
                    d.error || t["common.failedToUpload"] || "Upload failed",
                );
            }
            const data = await res.json();
            setPicUrl(data.url);
            setSuccess(t["profile.pictureUpdated"] || "Picture updated!");
            setTimeout(() => setSuccess(""), 3000);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setUploading(false);
            // Reset file input so the same file can be re-selected
            input.value = "";
        }
    }

    async function handleSave(e: Event) {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
            const res = await fetch("/api/profiles/me", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    name: name || null,
                    nickname: nickname || null,
                    description: description || null,
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(
                    d.error || t["common.failedToSave"] || "Save failed",
                );
            }
            // Skip the transient success toast — we navigate away
            // immediately, so the toast would never get a chance to
            // render. Landing on the profile page IS the confirmation.
            window.location.href = `/profile/${userId}`;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg);
        } finally {
            setSaving(false);
        }
    }

    async function handlePasswordChange(e: Event) {
        e.preventDefault();
        setPwError("");
        setPwSuccess("");

        if (newPw.length < 8) {
            setPwError(
                t["profile.passwordTooShort"] ||
                    "Password must be at least 8 characters",
            );
            return;
        }
        if (newPw !== confirmPw) {
            setPwError(
                t["profile.passwordMismatch"] || "Passwords do not match",
            );
            return;
        }

        setPwSaving(true);
        try {
            const res = await fetch("/api/profiles/me/password", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    currentPassword: currentPw,
                    newPassword: newPw,
                }),
            });
            if (!res.ok) {
                const d = await res.json();
                if (d.code === "WRONG_PASSWORD") {
                    throw new Error(
                        t["profile.wrongPassword"] ||
                            "Current password is incorrect",
                    );
                }
                throw new Error(d.error || "Failed to change password");
            }
            setPwSuccess(t["profile.passwordChanged"] || "Password changed!");
            setCurrentPw("");
            setNewPw("");
            setConfirmPw("");
            setTimeout(() => setPwSuccess(""), 3000);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setPwError(errMsg);
        } finally {
            setPwSaving(false);
        }
    }

    return (
        <div class="max-w-lg space-y-8">
            <form onSubmit={handleSave} class="space-y-6">
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

                {/* Profile picture */}
                <div class="flex items-center gap-4">
                    {picUrl ? (
                        <img
                            src={picUrl}
                            alt="Profile"
                            class="w-16 h-16 rounded-full object-cover shrink-0"
                        />
                    ) : (
                        <div class="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                            {(nickname || name || "?")[0].toUpperCase()}
                        </div>
                    )}
                    <div class="space-y-2">
                        <label class="inline-flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800 transition-colors">
                            {uploading
                                ? t["common.uploading"] || "Uploading..."
                                : t["profile.changePicture"] ||
                                  "Change picture"}
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileChange}
                                disabled={uploading}
                                class="hidden"
                            />
                        </label>
                    </div>
                </div>

                {/* Name */}
                <div>
                    <label
                        for="name"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["auth.name"] || "Name"}
                    </label>
                    <input
                        id="name"
                        type="text"
                        value={name}
                        maxLength={100}
                        onInput={(e) =>
                            setName((e.target as HTMLInputElement).value)
                        }
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {/* Nickname */}
                <div>
                    <label
                        for="nickname"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["auth.nickname"] || "Nickname"}
                    </label>
                    <input
                        id="nickname"
                        type="text"
                        value={nickname}
                        maxLength={100}
                        onInput={(e) =>
                            setNickname((e.target as HTMLInputElement).value)
                        }
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {/* Description */}
                <div>
                    <label
                        for="description"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["profile.description"] || "Description"}
                    </label>
                    <textarea
                        id="description"
                        rows={4}
                        value={description}
                        maxLength={500}
                        onInput={(e) =>
                            setDescription(
                                (e.target as HTMLTextAreaElement).value,
                            )
                        }
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder={
                            t["profile.tellAboutYourself"] ||
                            "Tell us about yourself..."
                        }
                    />
                </div>

                {/* Actions */}
                <div class="flex gap-3 pt-2">
                    <a
                        href="/profile/edit"
                        onClick={(e) => {
                            e.preventDefault();
                            history.back();
                        }}
                        class="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                        {t["common.cancel"] || "Cancel"}
                    </a>
                    <button
                        type="submit"
                        disabled={saving}
                        class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {saving
                            ? t["common.saving"] || "Saving..."
                            : t["common.save"] || "Save"}
                    </button>
                </div>
            </form>

            {/* Change password */}
            <form
                onSubmit={handlePasswordChange}
                class="space-y-4 pt-6 border-t border-gray-200 dark:border-gray-700"
            >
                <h3 class="text-lg font-medium text-gray-900 dark:text-white">
                    {t["profile.changePassword"] || "Change password"}
                </h3>

                {pwError && (
                    <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                        {pwError}
                    </div>
                )}
                {pwSuccess && (
                    <div class="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                        {pwSuccess}
                    </div>
                )}

                <div>
                    <label
                        for="currentPw"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["profile.currentPassword"] || "Current password"}
                    </label>
                    <input
                        id="currentPw"
                        type="password"
                        value={currentPw}
                        onInput={(e) =>
                            setCurrentPw((e.target as HTMLInputElement).value)
                        }
                        required
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <div>
                    <label
                        for="newPw"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["profile.newPassword"] || "New password"}
                    </label>
                    <input
                        id="newPw"
                        type="password"
                        value={newPw}
                        onInput={(e) =>
                            setNewPw((e.target as HTMLInputElement).value)
                        }
                        required
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <div>
                    <label
                        for="confirmPw"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["profile.confirmPassword"] || "Confirm new password"}
                    </label>
                    <input
                        id="confirmPw"
                        type="password"
                        value={confirmPw}
                        onInput={(e) =>
                            setConfirmPw((e.target as HTMLInputElement).value)
                        }
                        required
                        class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <button
                    type="submit"
                    disabled={pwSaving}
                    class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                    {pwSaving
                        ? t["common.saving"] || "Saving..."
                        : t["profile.changePassword"] || "Change password"}
                </button>
            </form>
        </div>
    );
}
