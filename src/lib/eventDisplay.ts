// src/lib/eventDisplay.ts
// Shared render helpers for event display data. Used by every place
// that renders the same field on multiple surfaces (detail page,
// list page, EventCard, live patcher) so the display rules stay in
// one place.

export type TFunction = (key: string) => string;

/**
 * Render the guest-count badge for an event.
 *
 * - `maxGuests === 0`     → `t("event.noGuestList")` (label only — the
 *   cap means there's no guest list at all, so the count is hidden too)
 * - `maxGuests` is a number > 0 → `${count}/${maxGuests}` (fraction)
 * - `maxGuests === null`  → `${count}` (no cap displayed)
 */
export function guestCountLabel(
    count: number,
    maxGuests: number | null,
    t: TFunction,
): string {
    if (maxGuests === 0) return t("event.noGuestList");
    if (maxGuests !== null) return `${count}/${maxGuests}`;
    return `${count}`;
}
