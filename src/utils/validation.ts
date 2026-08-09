// src/utils/validation.ts

/** Validates Swedish SSN format: YYYYMMDD-XXXX or YYYYMMDDXXXX */
export function isValidSwedishSsn(ssn: string): boolean {
    const cleaned = ssn.replace(/[-]/g, "");
    return /^\d{12}$/.test(cleaned);
}

/** Validates email format */
export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Validates BTH student email */
export function isBthEmail(email: string): boolean {
    return (
        email.endsWith("@student.bth.se") || email.endsWith("@bthstudent.se")
    );
}

/** Password must be at least 8 characters with uppercase, lowercase, and digit */
export function isStrongPassword(password: string): boolean {
    if (password.length < 8) return false;
    if (!/[A-Z]/.test(password)) return false;
    if (!/[a-z]/.test(password)) return false;
    if (!/[0-9]/.test(password)) return false;
    return true;
}

/** Generate a crypto-secure random token */
export function generateToken(): string {
    return crypto.randomUUID();
}

/** Generate a high-entropy session token (256-bit, hex-encoded) */
export function generateSessionToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
