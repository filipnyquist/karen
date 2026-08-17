// src/services/educations.ts
//
// Single home for the "compute expiresAt from completedAt + validityMonths"
// math. Used by:
//   - POST /api/admin/education          (single-user grant, refactored)
//   - POST /api/admin/education/bulk     (new bulk grant)
//
// 30-day month approximation matches the legacy admin handler so behaviour
// is unchanged post-refactor.

/**
 * Compute the `expiresAt` timestamp for a `user_educations` row.
 *
 * @param validityMonths  From `education_types.validityMonths`. `null`
 *                        or `0` means the education never expires.
 * @param completedAt     The grant date — typically `new Date()` for
 *                        now, or a caller-supplied date for bulk grants.
 * @returns               `completedAt + validityMonths * 30 days`, or
 *                        `null` when validity is unset.
 */
export function computeEducationExpiry(
    validityMonths: number | null,
    completedAt: Date,
): Date | null {
    if (!validityMonths) return null;
    return new Date(
        completedAt.getTime() + validityMonths * 30 * 24 * 60 * 60 * 1000,
    );
}
