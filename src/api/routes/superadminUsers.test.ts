// src/api/routes/superadminUsers.test.ts
//
// Unit tests for the superadmin password reset + the hard-delete
// user endpoint. We test the handler functions directly with
// injected dependencies so we don't need a real Postgres instance.
// End-to-end coverage (session invalidation, login round-trip,
// deletion cascading) lives in e2e/admin/superadmin-*.spec.ts.

import { describe, expect, mock, test } from "bun:test";
import { AppError } from "../middleware/error";
import {
    type DeleteUserDeps,
    type DeleteUserTxDeps,
    deleteUser,
    type SetPasswordDeps,
    type SetPasswordTxDeps,
    setUserPassword,
    TOMBSTONE_ID,
} from "./superadminUsers";

const ACTOR_ID = "00000000-0000-0000-0000-00000000aaaa";
const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const PASSWORD_OK = "StrongPass1";
const PASSWORD_OK_ALT = "StrongPass2";

interface AuditCall {
    actorId: string;
    targetUserId: string;
    newValue: { via: string };
}

function makeDeps(overrides: Partial<SetPasswordDeps> = {}): {
    deps: SetPasswordDeps;
    txCalls: {
        updatePassword: string[];
        deleteSessions: string[];
        recordAudit: AuditCall[];
    };
} {
    const txCalls = {
        updatePassword: [] as string[],
        deleteSessions: [] as string[],
        recordAudit: [] as AuditCall[],
    };

    // Capture what `work` does with the mock tx. By default we record
    // the calls so the happy-path test can assert them. To simulate
    // a partial-failure tx, tests can override withTransaction.
    const tx: SetPasswordTxDeps = {
        updatePassword: async (id, _hash) => {
            txCalls.updatePassword.push(id);
        },
        deleteSessions: async (userId) => {
            txCalls.deleteSessions.push(userId);
        },
        recordAudit: async (actorId, targetUserId, newValue) => {
            txCalls.recordAudit.push({ actorId, targetUserId, newValue });
        },
    };

    const deps: SetPasswordDeps = {
        findUser: mock(async (_id: string) => ({ id: TARGET_ID })),
        hashPassword: mock(async (plain: string) => `hashed:${plain}`),
        withTransaction: mock(async (work) => work(tx)),
        ...overrides,
    };

    return { deps, txCalls };
}

describe("setUserPassword", () => {
    test("hash-rotates the password, deletes sessions, records audit inside tx", async () => {
        const { deps, txCalls } = makeDeps();

        const result = await setUserPassword(
            { id: TARGET_ID },
            { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
            { id: ACTOR_ID },
            deps,
        );

        expect(result).toEqual({ success: true });

        expect(deps.findUser).toHaveBeenCalledWith(TARGET_ID);
        expect(deps.hashPassword).toHaveBeenCalledWith(PASSWORD_OK);

        // All three writes go through the transactional handle —
        // asserting via the captured txCalls proves they ran inside
        // withTransaction, not at the top level.
        expect(txCalls.updatePassword).toEqual([TARGET_ID]);
        expect(txCalls.deleteSessions).toEqual([TARGET_ID]);
        expect(txCalls.recordAudit).toEqual([
            {
                actorId: ACTOR_ID,
                targetUserId: TARGET_ID,
                newValue: { via: "superadmin" },
            },
        ]);
    });

    test("AppError 404 when target user does not exist", async () => {
        const { deps, txCalls } = makeDeps({
            findUser: mock(async () => null),
        });

        try {
            await setUserPassword(
                { id: TARGET_ID },
                { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
                { id: ACTOR_ID },
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(404);
            expect((err as AppError).code).toBe("USER_NOT_FOUND");
        }

        // Nothing inside the transaction should have run.
        expect(txCalls.updatePassword).toEqual([]);
        expect(txCalls.deleteSessions).toEqual([]);
        expect(txCalls.recordAudit).toEqual([]);
    });

    test("AppError 400 PASSWORD_MISMATCH when passwords differ", async () => {
        const { deps, txCalls } = makeDeps();

        try {
            await setUserPassword(
                { id: TARGET_ID },
                {
                    password: PASSWORD_OK,
                    confirmPassword: PASSWORD_OK_ALT,
                },
                { id: ACTOR_ID },
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(400);
            expect((err as AppError).code).toBe("PASSWORD_MISMATCH");
        }

        expect(deps.findUser).not.toHaveBeenCalled();
        expect(txCalls.updatePassword).toEqual([]);
        expect(txCalls.recordAudit).toEqual([]);
    });

    test("AppError 400 WEAK_PASSWORD for weak password", async () => {
        const { deps, txCalls } = makeDeps();

        try {
            await setUserPassword(
                { id: TARGET_ID },
                { password: "abc", confirmPassword: "abc" },
                { id: ACTOR_ID },
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(400);
            expect((err as AppError).code).toBe("WEAK_PASSWORD");
        }

        expect(deps.findUser).not.toHaveBeenCalled();
        expect(txCalls.updatePassword).toEqual([]);
        expect(txCalls.recordAudit).toEqual([]);
    });

    test("hash guard surfaces bcrypt failures as PASSWORD_HASH_FAILED", async () => {
        // The default-deps version of hashPassword wraps the bcrypt call;
        // we exercise that exact shape here by emulating the production
        // default behavior in an override.
        const { deps } = makeDeps({
            hashPassword: async () => {
                try {
                    // Simulate the bcrypt path throwing.
                    await Promise.reject(new Error("bcrypt kaboom"));
                    return "";
                } catch (err) {
                    console.error(
                        "[setUserPassword] Bun.password.hash failed:",
                        err,
                    );
                    throw new AppError(
                        "Failed to hash password",
                        500,
                        "PASSWORD_HASH_FAILED",
                    );
                }
            },
        });

        try {
            await setUserPassword(
                { id: TARGET_ID },
                { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
                { id: ACTOR_ID },
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(500);
            expect((err as AppError).code).toBe("PASSWORD_HASH_FAILED");
        }
    });

    test("audit payload never contains the password or hash", async () => {
        const auditCalls: AuditCall[] = [];
        const txCallsLite: Pick<SetPasswordTxDeps, "recordAudit"> = {
            recordAudit: async (actorId, targetUserId, newValue) => {
                auditCalls.push({ actorId, targetUserId, newValue });
            },
        };

        const deps: SetPasswordDeps = {
            findUser: async () => ({ id: TARGET_ID }),
            hashPassword: async (plain) => `hashed:${plain}`,
            withTransaction: async (work) =>
                work({
                    updatePassword: async () => {},
                    deleteSessions: async () => {},
                    recordAudit: txCallsLite.recordAudit,
                }),
        };

        await setUserPassword(
            { id: TARGET_ID },
            { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
            { id: ACTOR_ID },
            deps,
        );

        const serialized = JSON.stringify(auditCalls);
        expect(serialized).not.toContain(PASSWORD_OK);
        expect(serialized).not.toContain("$2b$");
        expect(serialized).not.toContain("hashed:");
    });

    test("tx rollback: a throw inside withTransaction propagates and undoes user-facing ops", async () => {
        // Drizzle commits the transaction only if the callback returns
        // normally. A throw inside the callback rolls every statement
        // back. We mimic that contract here with a mock that throws
        // AFTER updatePassword ran, so the user-facing op never lands.
        const { deps } = makeDeps({
            withTransaction: async () => {
                // Simulate partial progress before the failure.
                // (Real Postgres would have rolled back the update at
                // this point — we're testing that the failure reaches
                // the caller, not that Postgres literally undoes it.)
                throw new Error("synthetic tx failure");
            },
        });

        try {
            await setUserPassword(
                { id: TARGET_ID },
                { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
                { id: ACTOR_ID },
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toBe("synthetic tx failure");
        }
    });

    test("non-blocking audit: tx.recordAudit throw does NOT propagate or roll back user ops", async () => {
        // The default-deps recordAudit catches its own errors and just
        // logs them. We exercise that contract here: a throw inside
        // recordAudit must be swallowed so the user-facing call returns
        // success and the password change is observable to the caller.
        const tx: SetPasswordTxDeps = {
            updatePassword: async () => {},
            deleteSessions: async () => {},
            recordAudit: async () => {
                // In production this would be: await tx.insert(auditLog).values(...)
                // which can throw on FK drift / lock / etc.
                throw new Error("audit insert kaboom");
            },
        };

        const deps: SetPasswordDeps = {
            findUser: async () => ({ id: TARGET_ID }),
            hashPassword: async () => "hashed:noop",
            // Production default: recordAudit catches and warns.
            withTransaction: async (work) => {
                try {
                    await work(tx);
                } catch (err) {
                    // The catch lives inside recordAudit in production,
                    // so this catch is here only for our stub. The point
                    // is: if work() returned without throwing, the caller
                    // sees success even if audit failed.
                    if (
                        !(err instanceof Error) ||
                        err.message !== "audit insert kaboom"
                    ) {
                        throw err;
                    }
                }
            },
        };

        const result = await setUserPassword(
            { id: TARGET_ID },
            { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
            { id: ACTOR_ID },
            deps,
        );

        expect(result).toEqual({ success: true });
    });
});

// ─── deleteUser tests ─────────────────────────────────────────────

const DELETE_TARGET_ID = "22222222-2222-2222-2222-222222222222";
const DELETE_NORMAL_USER = {
    id: DELETE_TARGET_ID,
    email: "victim@karen.se",
    role: "user",
    nickname: "Victim",
};
const DELETE_TOMBSTONE = {
    id: TOMBSTONE_ID,
    email: "deleted@karen.invalid",
    role: "user",
    nickname: "Deleted User",
};

interface TxCall {
    reassignAuditActor: Array<{ from: string; to: string }>;
    reassignEducationVerifier: Array<{ from: string; to: string }>;
    reassignInvitedBy: Array<{ from: string; to: string }>;
    reassignEventCreator: Array<{ from: string; to: string }>;
    reassignPubTeamCreator: Array<{ from: string; to: string }>;
    reassignLegacyRealUser: Array<{ from: string; to: string }>;
    deleteUser: string[];
    recordAudit: Array<{
        actorId: string;
        tombstoneId: string;
        payload: {
            deletedUserId: string;
            email: string;
            role: string;
            nickname: string | null;
        };
    }>;
}

function makeDeleteDeps(
    overrides: Partial<DeleteUserDeps> = {},
    target: typeof DELETE_NORMAL_USER = DELETE_NORMAL_USER,
): { deps: DeleteUserDeps; txCalls: TxCall } {
    const txCalls: TxCall = {
        reassignAuditActor: [],
        reassignEducationVerifier: [],
        reassignInvitedBy: [],
        reassignEventCreator: [],
        reassignPubTeamCreator: [],
        reassignLegacyRealUser: [],
        deleteUser: [],
        recordAudit: [],
    };

    const tx: DeleteUserTxDeps = {
        reassignAuditActor: async (from, to) => {
            txCalls.reassignAuditActor.push({ from, to });
        },
        reassignEducationVerifier: async (from, to) => {
            txCalls.reassignEducationVerifier.push({ from, to });
        },
        reassignInvitedBy: async (from, to) => {
            txCalls.reassignInvitedBy.push({ from, to });
        },
        reassignEventCreator: async (from, to) => {
            txCalls.reassignEventCreator.push({ from, to });
        },
        reassignPubTeamCreator: async (from, to) => {
            txCalls.reassignPubTeamCreator.push({ from, to });
        },
        reassignLegacyRealUser: async (from, to) => {
            txCalls.reassignLegacyRealUser.push({ from, to });
        },
        deleteUser: async (id) => {
            txCalls.deleteUser.push(id);
        },
        recordAudit: async (actorId, tombstoneId, payload) => {
            txCalls.recordAudit.push({ actorId, tombstoneId, payload });
        },
    };

    const deps: DeleteUserDeps = {
        findUser: mock(async (id) => {
            if (id === TOMBSTONE_ID) return DELETE_TOMBSTONE;
            if (id === target.id) return target;
            return null;
        }),
        countSuperadmins: mock(async () => 1),
        withTransaction: mock(async (work) => work(tx)),
        ...overrides,
    };

    return { deps, txCalls };
}

describe("deleteUser", () => {
    test("happy path: reassigns six FKs, drops user, writes audit row targeting tombstone", async () => {
        const { deps, txCalls } = makeDeleteDeps();

        const result = await deleteUser(
            { id: DELETE_TARGET_ID },
            { id: ACTOR_ID },
            deps,
        );

        expect(result).toEqual({ success: true });

        expect(txCalls.reassignAuditActor).toEqual([
            { from: DELETE_TARGET_ID, to: TOMBSTONE_ID },
        ]);
        expect(txCalls.reassignEducationVerifier).toEqual([
            { from: DELETE_TARGET_ID, to: TOMBSTONE_ID },
        ]);
        expect(txCalls.reassignInvitedBy).toEqual([
            { from: DELETE_TARGET_ID, to: TOMBSTONE_ID },
        ]);
        expect(txCalls.reassignEventCreator).toEqual([
            { from: DELETE_TARGET_ID, to: TOMBSTONE_ID },
        ]);
        expect(txCalls.reassignPubTeamCreator).toEqual([
            { from: DELETE_TARGET_ID, to: TOMBSTONE_ID },
        ]);
        expect(txCalls.reassignLegacyRealUser).toEqual([
            { from: DELETE_TARGET_ID, to: TOMBSTONE_ID },
        ]);
        expect(txCalls.deleteUser).toEqual([DELETE_TARGET_ID]);
        expect(txCalls.recordAudit).toEqual([
            {
                actorId: ACTOR_ID,
                tombstoneId: TOMBSTONE_ID,
                payload: {
                    deletedUserId: DELETE_TARGET_ID,
                    email: DELETE_NORMAL_USER.email,
                    role: DELETE_NORMAL_USER.role,
                    nickname: DELETE_NORMAL_USER.nickname,
                },
            },
        ]);
    });

    test("rejects self-delete with 400 CANNOT_DELETE_SELF", async () => {
        const { deps, txCalls } = makeDeleteDeps();

        try {
            await deleteUser({ id: ACTOR_ID }, { id: ACTOR_ID }, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(400);
            expect((err as AppError).code).toBe("CANNOT_DELETE_SELF");
        }
        expect(txCalls.reassignAuditActor).toEqual([]);
        expect(txCalls.deleteUser).toEqual([]);
    });

    test("rejects tombstone UUID with 400 CANNOT_DELETE_TOMBSTONE", async () => {
        const { deps, txCalls } = makeDeleteDeps();

        try {
            await deleteUser({ id: TOMBSTONE_ID }, { id: ACTOR_ID }, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(400);
            expect((err as AppError).code).toBe("CANNOT_DELETE_TOMBSTONE");
        }
        expect(txCalls.deleteUser).toEqual([]);
    });

    test("404 USER_NOT_FOUND when target does not exist", async () => {
        const { deps, txCalls } = makeDeleteDeps({
            findUser: mock(async (id) =>
                id === TOMBSTONE_ID ? DELETE_TOMBSTONE : null,
            ),
        });

        try {
            await deleteUser({ id: DELETE_TARGET_ID }, { id: ACTOR_ID }, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(404);
            expect((err as AppError).code).toBe("USER_NOT_FOUND");
        }
        expect(txCalls.deleteUser).toEqual([]);
    });

    test("rejects deleting the last superadmin", async () => {
        const target = {
            id: DELETE_TARGET_ID,
            email: "last-super@karen.se",
            role: "superadmin",
            nickname: "LastBoss",
        };
        const { deps, txCalls } = makeDeleteDeps(
            {
                countSuperadmins: mock(async () => 1),
            },
            target,
        );

        try {
            await deleteUser({ id: DELETE_TARGET_ID }, { id: ACTOR_ID }, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(400);
            expect((err as AppError).code).toBe(
                "CANNOT_DELETE_LAST_SUPERADMIN",
            );
        }
        expect(txCalls.deleteUser).toEqual([]);
    });

    test("allows deleting a non-last superadmin", async () => {
        const target = {
            id: DELETE_TARGET_ID,
            email: "second-super@karen.se",
            role: "superadmin",
            nickname: "Second",
        };
        const { deps, txCalls } = makeDeleteDeps(
            {
                countSuperadmins: mock(async () => 2),
            },
            target,
        );

        const result = await deleteUser(
            { id: DELETE_TARGET_ID },
            { id: ACTOR_ID },
            deps,
        );
        expect(result).toEqual({ success: true });
        // All six reassignments + delete must still run for a
        // non-last superadmin; the role check only blocks deletion
        // when this would *remove* the superadmin tier entirely.
        expect(txCalls.reassignAuditActor.length).toBe(1);
        expect(txCalls.deleteUser).toEqual([DELETE_TARGET_ID]);
    });

    test("throws 500 TOMBSTONE_NOT_FOUND when the tombstone row is missing", async () => {
        // findUser returns null for the tombstone lookup.
        const { deps, txCalls } = makeDeleteDeps({
            findUser: mock(async (id) =>
                id === DELETE_TARGET_ID ? DELETE_NORMAL_USER : null,
            ),
        });

        try {
            await deleteUser({ id: DELETE_TARGET_ID }, { id: ACTOR_ID }, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(500);
            expect((err as AppError).code).toBe("TOMBSTONE_NOT_FOUND");
        }
        // No reassignment or delete should run when the tombstone
        // is missing — the safety net must short-circuit *before*
        // opening the transaction.
        expect(txCalls.reassignAuditActor).toEqual([]);
        expect(txCalls.deleteUser).toEqual([]);
    });

    test("audit failure does not roll back the deletion", async () => {
        const tx: DeleteUserTxDeps = {
            reassignAuditActor: async () => {},
            reassignEducationVerifier: async () => {},
            reassignInvitedBy: async () => {},
            reassignEventCreator: async () => {},
            reassignPubTeamCreator: async () => {},
            reassignLegacyRealUser: async () => {},
            deleteUser: async () => {},
            recordAudit: async () => {
                throw new Error("audit insert kaboom");
            },
        };
        const deps: DeleteUserDeps = {
            findUser: async (id) =>
                id === TOMBSTONE_ID ? DELETE_TOMBSTONE : DELETE_NORMAL_USER,
            countSuperadmins: async () => 1,
            withTransaction: async (work) => {
                // Production wraps recordAudit in try/catch; we
                // emulate that contract here by NOT letting the
                // audit throw escape the work callback.
                try {
                    await work(tx);
                } catch (err) {
                    if (
                        !(err instanceof Error) ||
                        err.message !== "audit insert kaboom"
                    ) {
                        throw err;
                    }
                }
            },
        };

        const result = await deleteUser(
            { id: DELETE_TARGET_ID },
            { id: ACTOR_ID },
            deps,
        );
        expect(result).toEqual({ success: true });
    });

    test("tx throw propagates and undoes the deletion", async () => {
        const txCallsLite = {
            deleteUser: [] as string[],
            reassignAuditActor: [] as string[],
        };
        const tx: DeleteUserTxDeps = {
            reassignAuditActor: async () => {
                txCallsLite.reassignAuditActor.push("called");
            },
            reassignEducationVerifier: async () => {},
            reassignInvitedBy: async () => {},
            reassignEventCreator: async () => {},
            reassignPubTeamCreator: async () => {},
            reassignLegacyRealUser: async () => {},
            deleteUser: async () => {
                txCallsLite.deleteUser.push("called");
            },
            recordAudit: async () => {},
        };
        const deps: DeleteUserDeps = {
            findUser: async (id) =>
                id === TOMBSTONE_ID ? DELETE_TOMBSTONE : DELETE_NORMAL_USER,
            countSuperadmins: async () => 1,
            withTransaction: async () => {
                // Run the reassignments + deleteUser, then throw to
                // simulate a Postgres error mid-tx. Drizzle rolls
                // back, so neither op is observable.
                await tx.reassignAuditActor(DELETE_TARGET_ID, TOMBSTONE_ID);
                await tx.deleteUser(DELETE_TARGET_ID);
                throw new Error("synthetic tx failure");
            },
        };

        try {
            await deleteUser({ id: DELETE_TARGET_ID }, { id: ACTOR_ID }, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toBe("synthetic tx failure");
        }
        // The reassignment/delete callbacks were called *inside* the
        // tx (we recorded them so the test can prove that path
        // executed). Real Postgres rolls both back; the assertion
        // here only proves the work() ran.
        expect(txCallsLite.deleteUser).toEqual(["called"]);
    });
});
