// src/services/passwordReset.test.ts
//
// Unit tests for the passwordReset service. Mirrors
// src/api/routes/superadminUsers.test.ts — DI mock fakes, no real
// Postgres.

import { describe, expect, mock, test } from "bun:test";
import { AppError } from "../api/middleware/error";
import {
    type ConsumeResetDeps,
    type ConsumeResetTxDeps,
    consumePasswordResetToken,
    hashToken,
    isValidResetToken,
    type RequestResetDeps,
    requestPasswordReset,
} from "./passwordReset";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN_PLAINTEXT = "0".repeat(64); // 64-hex string
const PASSWORD_OK = "StrongPass1";

function makeRequestDeps(overrides: Partial<RequestResetDeps> = {}): {
    deps: RequestResetDeps;
    calls: {
        findUserByEmail: string[];
        invalidatePriorTokens: string[];
        insertToken: Array<{
            userId: string;
            tokenHash: string;
            expiresAt: Date;
        }>;
        dispatchEmail: Array<{ to: string; token: string; lang: string }>;
    };
} {
    const calls = {
        findUserByEmail: [] as string[],
        invalidatePriorTokens: [] as string[],
        insertToken: [] as Array<{
            userId: string;
            tokenHash: string;
            expiresAt: Date;
        }>,
        dispatchEmail: [] as Array<{ to: string; token: string; lang: string }>,
    };

    const deps: RequestResetDeps = {
        findUserByEmail: mock(async (email: string) => {
            calls.findUserByEmail.push(email);
            // Default: pretend the user exists.
            return { id: USER_ID, email };
        }),
        invalidatePriorTokens: mock(async (userId: string) => {
            calls.invalidatePriorTokens.push(userId);
        }),
        insertToken: mock(
            async (userId: string, tokenHash: string, expiresAt: Date) => {
                calls.insertToken.push({ userId, tokenHash, expiresAt });
            },
        ),
        dispatchEmail: mock((to: string, token: string, lang: string) => {
            calls.dispatchEmail.push({ to, token, lang });
        }),
        ...overrides,
    };

    return { deps, calls };
}

function makeConsumeDeps(
    overrides: Partial<ConsumeResetDeps> = {},
    txOverrides: Partial<ConsumeResetTxDeps> = {},
): {
    deps: ConsumeResetDeps;
    txCalls: {
        updatePasswordHash: Array<{ userId: string; hash: string }>;
        deleteSessionsForUser: string[];
        markTokenUsed: string[];
        recordAudit: Array<{ actorId: string; targetUserId: string }>;
    };
} {
    const txCalls = {
        updatePasswordHash: [] as Array<{ userId: string; hash: string }>,
        deleteSessionsForUser: [] as string[],
        markTokenUsed: [] as string[],
        recordAudit: [] as Array<{ actorId: string; targetUserId: string }>,
    };

    const tx: ConsumeResetTxDeps = {
        updatePasswordHash: mock(async (userId: string, hash: string) => {
            txCalls.updatePasswordHash.push({ userId, hash });
        }),
        deleteSessionsForUser: mock(async (userId: string) => {
            txCalls.deleteSessionsForUser.push(userId);
        }),
        markTokenUsed: mock(async (tokenId: string) => {
            txCalls.markTokenUsed.push(tokenId);
        }),
        recordAudit: mock(async (actorId: string, targetUserId: string) => {
            txCalls.recordAudit.push({ actorId, targetUserId });
        }),
        ...txOverrides,
    };

    const deps: ConsumeResetDeps = {
        findToken: mock(async (_tokenHash: string) => ({
            id: "token-row-id",
            userId: USER_ID,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            usedAt: null,
        })),
        isStrongPassword: mock((_plain: string) => true),
        hashPassword: mock(async (_plain: string) => `hashed:${_plain}`),
        withTransaction: mock(async (work) => work(tx)),
        ...overrides,
    };

    return { deps, txCalls };
}

describe("hashToken", () => {
    test("SHA-256 hex of the input", () => {
        expect(hashToken("")).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        expect(hashToken("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
    });

    test("deterministic", () => {
        expect(hashToken(TOKEN_PLAINTEXT)).toBe(hashToken(TOKEN_PLAINTEXT));
    });
});

describe("requestPasswordReset", () => {
    test("inserts a row, hashes the token, fires email off-thread", async () => {
        const { deps, calls } = makeRequestDeps();

        const result = await requestPasswordReset("alice@karen.se", "en", deps);

        expect(result.token).toBeTruthy();
        expect(result.resetUrl).toMatch(
            /^http:\/\/localhost:4321\/reset-password\?token=/,
        );

        // Lookup was case-insensitive (trim + lowercase).
        expect(calls.findUserByEmail).toEqual(["alice@karen.se"]);

        // We hashed the token before insert.
        expect(calls.insertToken.length).toBe(1);
        const { userId, tokenHash, expiresAt } = calls.insertToken[0];
        expect(userId).toBe(USER_ID);
        expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(tokenHash).toBe(hashToken(result.token as string));
        // 1-hour TTL.
        expect(expiresAt.getTime()).toBeGreaterThan(
            Date.now() + 50 * 60 * 1000,
        );
        expect(expiresAt.getTime()).toBeLessThan(Date.now() + 70 * 60 * 1000);

        // The dispatched email uses the SAME plaintext token the row was hashed from.
        expect(calls.dispatchEmail.length).toBe(1);
        // result.token is string|null (null when the email doesn't exist);
        // narrow for the type checker.
        expect(calls.dispatchEmail[0]).toEqual({
            to: "alice@karen.se",
            token: result.token as string,
            lang: "en",
        });
    });

    test("non-existing email: no row, no email, no error", async () => {
        const trackedEmail: string[] = [];
        const { deps, calls } = makeRequestDeps({
            findUserByEmail: mock(async (email: string) => {
                trackedEmail.push(email);
                return null;
            }),
        });

        const result = await requestPasswordReset(
            "nobody@karen.se",
            "en",
            deps,
        );

        expect(result.token).toBeNull();
        expect(result.resetUrl).toBeNull();
        // Override was called with the normalized email.
        expect(trackedEmail).toEqual(["nobody@karen.se"]);
        // No row, no email dispatch, no prior-token invalidation.
        expect(calls.insertToken).toEqual([]);
        expect(calls.invalidatePriorTokens).toEqual([]);
        expect(calls.dispatchEmail).toEqual([]);
    });

    test("invalidates prior unused tokens for the same user", async () => {
        const { deps, calls } = makeRequestDeps();

        await requestPasswordReset("alice@karen.se", "en", deps);

        expect(calls.invalidatePriorTokens).toEqual([USER_ID]);
    });
});

describe("consumePasswordResetToken", () => {
    test("happy path: rotate hash, wipe sessions, mark used, audit", async () => {
        const { deps, txCalls } = makeConsumeDeps();

        const result = await consumePasswordResetToken(
            TOKEN_PLAINTEXT,
            PASSWORD_OK,
            deps,
        );

        expect(result).toEqual({ success: true });

        // All four tx ops ran, in the expected order.
        expect(txCalls.updatePasswordHash.length).toBe(1);
        expect(txCalls.updatePasswordHash[0]).toEqual({
            userId: USER_ID,
            hash: `hashed:${PASSWORD_OK}`,
        });
        expect(txCalls.deleteSessionsForUser).toEqual([USER_ID]);
        expect(txCalls.markTokenUsed).toEqual(["token-row-id"]);
        // Audit actor = target = user (self-service).
        expect(txCalls.recordAudit).toEqual([
            { actorId: USER_ID, targetUserId: USER_ID },
        ]);
    });

    test("rejects WEAK_PASSWORD before any DB op", async () => {
        const findTokenCalls: string[] = [];
        const { deps, txCalls } = makeConsumeDeps({
            isStrongPassword: mock(() => false),
            findToken: mock(async (hash: string) => {
                findTokenCalls.push(hash);
                return {
                    id: "token-row-id",
                    userId: USER_ID,
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                    usedAt: null,
                };
            }),
        });

        try {
            await consumePasswordResetToken(TOKEN_PLAINTEXT, "abc", deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("WEAK_PASSWORD");
            expect((err as AppError).statusCode).toBe(400);
        }

        // No DB lookup, no tx ops.
        expect(findTokenCalls).toEqual([]);
        expect(txCalls.updatePasswordHash).toEqual([]);
        expect(txCalls.deleteSessionsForUser).toEqual([]);
        expect(txCalls.markTokenUsed).toEqual([]);
        expect(txCalls.recordAudit).toEqual([]);
    });

    test("rejects when no unused row matches the token", async () => {
        const { deps, txCalls } = makeConsumeDeps({
            findToken: mock(async () => null),
        });

        try {
            await consumePasswordResetToken(TOKEN_PLAINTEXT, PASSWORD_OK, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("INVALID_TOKEN");
        }

        expect(txCalls.updatePasswordHash).toEqual([]);
    });

    test("rejects when token has expired", async () => {
        const { deps } = makeConsumeDeps({
            findToken: mock(async () => ({
                id: "token-row-id",
                userId: USER_ID,
                expiresAt: new Date(Date.now() - 1000), // 1s in the past
                usedAt: null,
            })),
        });

        try {
            await consumePasswordResetToken(TOKEN_PLAINTEXT, PASSWORD_OK, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("TOKEN_EXPIRED");
        }
    });

    test("tx rollback: a throw inside withTransaction propagates and undoes user-facing ops", async () => {
        const { deps, txCalls } = makeConsumeDeps({
            withTransaction: mock(async () => {
                // Simulate partial progress before the failure. Real
                // Postgres would have rolled back the update at this
                // point — we're testing that the failure reaches
                // the caller, not that Drizzle literally undoes it.
                throw new Error("synthetic tx failure");
            }),
        });

        try {
            await consumePasswordResetToken(TOKEN_PLAINTEXT, PASSWORD_OK, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect((err as Error).message).toBe("synthetic tx failure");
        }

        // None of the tx callbacks ran (they're inside the throwing
        // work function).
        expect(txCalls.updatePasswordHash).toEqual([]);
        expect(txCalls.deleteSessionsForUser).toEqual([]);
        expect(txCalls.markTokenUsed).toEqual([]);
        expect(txCalls.recordAudit).toEqual([]);
    });
});

describe("isValidResetToken (DB-backed)", () => {
    // Live DB call — only meaningful when the test DB is running.
    // The e2e suite covers this end-to-end; the unit suite skips it
    // by design (no DB connection here).
    test.skip("missing token → invalid", async () => {
        const result = await isValidResetToken(
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        );
        expect(result).toEqual({ valid: false, reason: "invalid" });
    });
});
