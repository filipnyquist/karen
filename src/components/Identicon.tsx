// src/components/Identicon.tsx
//
// 2-letter identicon for the editor's presence chip. Takes a `name`
// and a `color` (Tailwind bg class). Picks letters from the first
// available word and renders a square with the two letters.

interface IdenticonProps {
    name: string;
    color?: string;
    size?: number;
    className?: string;
}

function initialsOf(name: string): string {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return "??";
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }
    return (
        (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")
    ).toUpperCase();
}

export default function Identicon({
    name,
    color = "bg-blue-500",
    size = 28,
    className = "",
}: IdenticonProps) {
    const initials = initialsOf(name);
    return (
        <div
            class={`${color} rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ${className}`}
            style={{ width: `${size}px`, height: `${size}px` }}
            title={name}
            role="img"
        >
            {initials}
        </div>
    );
}
