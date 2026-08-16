// src/utils/joinCode.ts
//
// 8-character base32 join codes for pub teams. Excludes visually
// ambiguous characters (0/O, 1/I/L) so codes are easy to read and
// transcribe. ~47 bits of entropy (32^8 ≈ 1.1e12 combinations) —
// brute force is computationally infeasible, but we still rate-limit
// the join endpoint (see P2-2 follow-up).

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 32 chars

export function generateJoinCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let code = "";
    for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
    return code;
}
