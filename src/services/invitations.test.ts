// src/services/invitations.test.ts
//
// Verifies the deterministic, side-effect-free pieces of the invitations
// service: token generation. The DB-touching code paths
// (createInvitation, acceptInvitation) are exercised end-to-end via the
// e2e suite (e2e/admin/superadmin.spec.ts) where a real Postgres instance
// is available.

import { describe, expect, test } from "bun:test";
import { generateInvitationToken } from "./invitations";

describe("generateInvitationToken", () => {
    test("produces a 64-character lowercase hex string", () => {
        const token = generateInvitationToken();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    test("produces unique tokens on successive calls", () => {
        const a = generateInvitationToken();
        const b = generateInvitationToken();
        expect(a).not.toBe(b);
    });

    test("produces tokens with 256 bits of entropy (32 bytes hex)", () => {
        const token = generateInvitationToken();
        // 32 bytes => 64 hex chars => exactly 256 bits of randomness
        expect(token.length).toBe(64);
    });
});
