// src/api/routes/superadminUsers.test.ts
//
// Unit tests for the superadmin password reset. We test the handler
// function directly with injected dependencies so we don't need a real
// Postgres instance. End-to-end coverage (including session
// invalidation and login with the new password) lives in
// e2e/admin/superadmin-password-reset.spec.ts.

import { describe, expect, mock, test } from "bun:test";
import { AppError } from "../middleware/error";
import { type SetPasswordDeps, setUserPassword } from "./superadminUsers";

const ACTOR_ID = "00000000-0000-0000-0000-00000000aaaa";
const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const PASSWORD_OK = "StrongPass1";
const PASSWORD_OK_ALT = "StrongPass2";

function makeDeps(overrides: Partial<SetPasswordDeps> = {}): SetPasswordDeps {
    return {
        findUser: mock(async (_id: string) => ({ id: TARGET_ID })),
        updatePassword: mock(async (_id: string, _hash: string) => {}),
        deleteSessions: mock(async (_userId: string) => {}),
        recordAudit: mock(
            async (
                _actorId: string,
                _targetUserId: string,
                _newValue: {
                    via: string;
                },
            ) => {},
        ),
        hashPassword: mock(async (plain: string) => `hashed:${plain}`),
        ...overrides,
    };
}

describe("setUserPassword", () => {
    test("hash-rotates the password, deletes sessions, records audit", async () => {
        const deps = makeDeps();

        const result = await setUserPassword(
            { id: TARGET_ID },
            { password: PASSWORD_OK, confirmPassword: PASSWORD_OK },
            { id: ACTOR_ID },
            deps,
        );

        expect(result).toEqual({ success: true });

        expect(deps.findUser).toHaveBeenCalledWith(TARGET_ID);
        expect(deps.hashPassword).toHaveBeenCalledWith(PASSWORD_OK);
        expect(deps.updatePassword).toHaveBeenCalledWith(
            TARGET_ID,
            `hashed:${PASSWORD_OK}`,
        );
        expect(deps.deleteSessions).toHaveBeenCalledWith(TARGET_ID);
        expect(deps.recordAudit).toHaveBeenCalledWith(ACTOR_ID, TARGET_ID, {
            via: "superadmin",
        });
    });

    test("AppError 404 when target user does not exist", async () => {
        const deps = makeDeps({
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

        expect(deps.updatePassword).not.toHaveBeenCalled();
        expect(deps.deleteSessions).not.toHaveBeenCalled();
        expect(deps.recordAudit).not.toHaveBeenCalled();
    });

    test("AppError 400 PASSWORD_MISMATCH when passwords differ", async () => {
        const deps = makeDeps();

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
        expect(deps.updatePassword).not.toHaveBeenCalled();
        expect(deps.recordAudit).not.toHaveBeenCalled();
    });

    test("AppError 400 WEAK_PASSWORD for weak password", async () => {
        const deps = makeDeps();

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
        expect(deps.updatePassword).not.toHaveBeenCalled();
        expect(deps.recordAudit).not.toHaveBeenCalled();
    });

    test("audit payload never contains the password or hash", async () => {
        const auditCalls: Array<{
            actorId: string;
            targetUserId: string;
            newValue: { via: string };
        }> = [];
        const deps = makeDeps({
            recordAudit: async (actorId, targetUserId, newValue) => {
                auditCalls.push({ actorId, targetUserId, newValue });
            },
        });

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
});
