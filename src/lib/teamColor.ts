// src/lib/teamColor.ts
//
// Team color helpers. User-supplied colors go through `sanitizeTeamColor`
// at the API boundary so we only ever carry a strict 6-char hex through
// the system — no `red`, no `rgb(...)`, no CSS-injection payloads. Every
// consumer renders the color as a class name from `teamColorClass` and the
// parent page emits a `<style>` block built by `teamColorStyleContent`.
// That style block is hashed via `Astro.csp?.insertStyleHash`, which keeps
// us off inline `style=""` attributes and out of CSP trouble.

const SHORT_HEX_RE = /^#[0-9a-fA-F]{3}$/;
const FULL_HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Sanitize a user-supplied team color to a safe 6-char lowercase hex,
 * or `null` if the input is missing or invalid. `null` is fine — every
 * consumer treats it as "no team color, fall back to initials".
 */
export function sanitizeTeamColor(input: unknown): string | null {
    if (typeof input !== "string") return null;
    const t = input.trim();
    if (FULL_HEX_RE.test(t)) return t.toLowerCase();
    if (SHORT_HEX_RE.test(t)) {
        // Expand #rgb -> #rrggbb so two equivalent forms map to one class.
        return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase();
    }
    return null;
}

/**
 * Stable, CSS-safe class name for a sanitized 6-char hex color. Hex chars
 * are already `[a-f0-9]`, so no escaping is needed. Example: `#ff0000` ->
 * `cc-ff0000`.
 */
export function teamColorClass(color: string): string {
    return `cc-${color.slice(1)}`;
}

/**
 * Build the body of a `<style>` block that defines one rule per distinct
 * color. Pair with `Astro.csp?.insertStyleHash(sha256StyleHash(content))`
 * in the parent page so CSP allows it; emit the block via
 * `<style is:inline set:html={content}></style>`.
 */
export function teamColorStyleContent(
    colors: Iterable<string | null | undefined>,
): string {
    const unique = new Set<string>();
    for (const c of colors) {
        const sanitized = sanitizeTeamColor(c);
        if (sanitized) unique.add(sanitized);
    }
    return [...unique]
        .map((c) => `.${teamColorClass(c)}{background-color:${c}}`)
        .join("");
}
