// src/islands/SearchBar.tsx
import { useEffect, useRef, useState } from "preact/hooks";

interface SearchResult {
    id: string;
    name: string;
    nickname: string | null;
    profilePic: string | null;
}

export default function SearchBar() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Close dropdown when clicking outside
        function handleClickOutside(e: MouseEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setShowDropdown(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        if (query.trim().length < 2) {
            setResults([]);
            setShowDropdown(false);
            return;
        }

        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await fetch(
                    `/api/profiles/search?q=${encodeURIComponent(query.trim())}`,
                );
                if (res.ok) {
                    const data = await res.json();
                    setResults(data.profiles ?? data.results ?? data);
                    setShowDropdown(true);
                } else {
                    setResults([]);
                }
            } catch {
                setResults([]);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [query]);

    function handleSelect(userId: string) {
        setShowDropdown(false);
        setQuery("");
        window.location.href = `/profile/${userId}`;
    }

    return (
        <div ref={containerRef} class="relative w-full max-w-md">
            {/* Search input */}
            <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg
                        class="h-5 w-5 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                </div>
                <input
                    type="text"
                    value={query}
                    onInput={(e) =>
                        setQuery((e.target as HTMLInputElement).value)
                    }
                    onFocus={() => {
                        if (results.length > 0) setShowDropdown(true);
                    }}
                    placeholder="Search users..."
                    class="w-full pl-10 pr-10 py-2 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                {loading && (
                    <div class="absolute inset-y-0 right-0 pr-3 flex items-center">
                        <div class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                    </div>
                )}
            </div>

            {/* Dropdown */}
            {showDropdown && (
                <div class="absolute z-50 mt-1 w-full bg-white rounded-lg shadow-lg border border-gray-200 max-h-64 overflow-y-auto">
                    {results.length === 0 && !loading ? (
                        <div class="px-4 py-3 text-sm text-gray-500">
                            No users found for "{query}"
                        </div>
                    ) : (
                        <ul class="py-1">
                            {results.map((user) => (
                                <li key={user.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(user.id)}
                                        class="w-full px-4 py-2 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                                    >
                                        {user.profilePic ? (
                                            <img
                                                src={user.profilePic}
                                                alt={user.name}
                                                class="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                            />
                                        ) : (
                                            <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm font-bold flex-shrink-0">
                                                {user.name
                                                    .charAt(0)
                                                    .toUpperCase()}
                                            </div>
                                        )}
                                        <div class="min-w-0">
                                            <p class="text-sm font-medium text-gray-900 truncate">
                                                {user.name}
                                            </p>
                                            {user.nickname && (
                                                <p class="text-xs text-gray-500 truncate">
                                                    @{user.nickname}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
