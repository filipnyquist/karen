import { describe, expect, test } from "bun:test";
import { decrypt, encrypt, hashSsn } from "./encryption";

// Use a deterministic 32-byte test key (the zeros string from .env.example).
// The tests verify round-trips and determinism against this fixed key.
const TEST_KEY =
    "0000000000000000000000000000000000000000000000000000000000000000";

describe("encryption", () => {
    test("encrypt → decrypt round-trips arbitrary UTF-8", async () => {
        process.env.ENCRYPTION_KEY = TEST_KEY;
        const plain = "19950101-1234 — Mats Matsson";
        const ct = await encrypt(plain);
        expect(ct).not.toContain(plain);
        expect(ct).toMatch(/^[0-9a-f]{24}:[0-9a-f]+$/);
        const back = await decrypt(ct);
        expect(back).toBe(plain);
    });

    test("two encryptions of the same plaintext differ (random IV)", async () => {
        process.env.ENCRYPTION_KEY = TEST_KEY;
        const a = await encrypt("hello");
        const b = await encrypt("hello");
        expect(a).not.toBe(b);
    });

    test("hashSsn is deterministic for the same input", async () => {
        process.env.ENCRYPTION_KEY = TEST_KEY;
        const h1 = await hashSsn("123456789012");
        const h2 = await hashSsn("123456789012");
        expect(h1).toBe(h2);
        expect(h1).toHaveLength(64); // 32 bytes hex = 64 chars
    });

    test("hashSsn changes when the input changes", async () => {
        process.env.ENCRYPTION_KEY = TEST_KEY;
        const a = await hashSsn("123456789012");
        const b = await hashSsn("123456789013");
        expect(a).not.toBe(b);
    });

    test("decrypt rejects malformed ciphertexts", async () => {
        process.env.ENCRYPTION_KEY = TEST_KEY;
        expect(() => decrypt("not-encrypted")).toThrow();
        expect(() => decrypt("aa:")).toThrow();
    });
});
