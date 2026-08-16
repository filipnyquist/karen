// src/islands/TeamPictureUploader.tsx
import { useRef, useState } from "preact/hooks";
import { sanitizeTeamColor, teamColorClass } from "../lib/teamColor";

interface TeamPictureUploaderProps {
    teamId: string;
    currentPic: string | null;
    teamColor: string | null;
    teamName: string;
    t: Record<string, string>;
}

export default function TeamPictureUploader({
    teamId,
    currentPic,
    teamColor,
    teamName,
    t,
}: TeamPictureUploaderProps) {
    const [picUrl, setPicUrl] = useState(currentPic || "");
    const [uploading, setUploading] = useState(false);
    const sanitizedColor = sanitizeTeamColor(teamColor);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);

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

        setUploading(true);
        setError("");
        try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch(`/api/teams/${teamId}/picture`, {
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
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
            input.value = "";
        }
    }

    return (
        <div class="space-y-3">
            <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t["team.teamPicture"] || "Team picture"}
            </h3>
            <div class="flex items-center gap-4">
                {picUrl ? (
                    <img
                        src={picUrl}
                        alt={teamName}
                        class="w-16 h-16 rounded-full object-cover shrink-0"
                    />
                ) : sanitizedColor ? (
                    <span
                        class={`w-16 h-16 rounded-full shrink-0 border-2 border-white dark:border-gray-700 shadow-sm ${teamColorClass(sanitizedColor)}`}
                    />
                ) : (
                    <span class="w-16 h-16 rounded-full shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-2xl font-bold text-gray-500 dark:text-gray-400">
                        {teamName[0].toUpperCase()}
                    </span>
                )}
                <label class="inline-flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800 transition-colors">
                    {uploading
                        ? t["common.uploading"] || "Uploading..."
                        : t["team.changeTeamPicture"] || "Change picture"}
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
            {error && (
                <p class="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            {success && (
                <p class="text-sm text-green-600 dark:text-green-400">
                    {success}
                </p>
            )}
        </div>
    );
}
