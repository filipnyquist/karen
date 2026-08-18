// src/utils/password.ts
//
// Bun's bcrypt is the only realistic bcrypt implementation in this
// codebase. Wrap it once here so callers (registration, password reset,
// self-service password change) get a structured `AppError` on
// failure instead of an opaque `INTERNAL_ERROR` from the error plugin.

import { AppError } from "../api/middleware/error";

/** Hash a plaintext password with bcrypt. Surfaces bcrypt failures as `AppError(500, "PASSWORD_HASH_FAILED")`. */
export async function hashPassword(plain: string): Promise<string> {
    try {
        return await Bun.password.hash(plain, "bcrypt");
    } catch (err) {
        console.error("[hashPassword] Bun.password.hash failed:", err);
        throw new AppError(
            "Failed to hash password",
            500,
            "PASSWORD_HASH_FAILED",
        );
    }
}
