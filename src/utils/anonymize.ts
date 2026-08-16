// src/utils/anonymize.ts

/**
 * Truncates a name to first 3 characters + "..." for non-authenticated viewers.
 * Returns null/undefined unchanged. Short names (< 4 chars) are returned as-is.
 */
export function anonymizeName(
    name: string | null | undefined,
    isAuthenticated: boolean,
): string | null | undefined {
    if (isAuthenticated || !name) return name;
    if (name.length <= 3) return name;
    return `${name.slice(0, 3)}...`;
}
