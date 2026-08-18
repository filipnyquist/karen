// src/api/routes/migration.test.ts
//
// Unit tests for the admin-side migration approval. We test the
// extracted `adminApproveMigration` function directly with injected
// dependencies so the validation/guard logic can be covered without a
// real Postgres instance. The full merge transaction (FK cascades,
// verified=true side-effect, audit FK restrict) is exercised
// end-to-end by e2e/authenticated/migration.spec.ts.

import { describe, expect, mock, test } from "bun:test";
import { AppError } from "../middleware/error";
import { type AdminApproveDeps, adminApproveMigration } from "./migration";

const ACTOR_ID = "00000000-0000-0000-0000-000000000abc";
const LEGACY_ID = "22222222-2222-2222-2222-222222222222";
const REAL_USER_ID = "11111111-1111-1111-1111-111111111111";
const PLACEHOLDER_ID = "placeholder-uuid";

interface Overrides {
    isLegacy?: boolean;
    isClaimed?: boolean;
    mappingMissing?: boolean;
    userMissing?: boolean;
    auditCalls?: Array<{
        actorId: string;
        action: string;
        targetUserId: string | null;
        payload: { oldValue?: unknown; newValue?: unknown };
    }>;
}

function makeDeps(overrides: Overrides = {}): AdminApproveDeps {
    const auditCalls =
        overrides.auditCalls ??
        ([] as Array<{
            actorId: string;
            action: string;
            targetUserId: string | null;
            payload: { oldValue?: unknown; newValue?: unknown };
        }>);

    return {
        findMapping: mock(async () =>
            overrides.mappingMissing
                ? undefined
                : {
                      id: LEGACY_ID,
                      placeholderUserId: PLACEHOLDER_ID,
                      realUserId: overrides.isClaimed ? "some-real-user" : null,
                  },
        ),
        findUser: mock(async () =>
            overrides.userMissing
                ? undefined
                : {
                      id: REAL_USER_ID,
                      isLegacy: overrides.isLegacy ?? false,
                  },
        ),
        executeMerge: mock(async () => ({
            success: true,
            stats: {
                workerRegistrations: 0,
                comments: 0,
                teamMemberships: 0,
                tickets: 0,
                guestRegistrations: 0,
            },
        })),
        recordAudit: mock(
            async (
                actorId: string,
                targetUserId: string,
                oldValue: unknown,
                newValue: unknown,
            ) => {
                auditCalls.push({
                    actorId,
                    action: "migration.admin.manual",
                    targetUserId,
                    payload: { oldValue, newValue },
                });
            },
        ),
    };
}

describe("adminApproveMigration", () => {
    test("400 LEGACY_USER_CANNOT_BE_TARGET when target user is legacy", async () => {
        const auditCalls: Array<{
            actorId: string;
            action: string;
            targetUserId: string | null;
            payload: { oldValue?: unknown; newValue?: unknown };
        }> = [];
        const deps = makeDeps({ isLegacy: true, auditCalls });

        try {
            await adminApproveMigration(
                LEGACY_ID,
                REAL_USER_ID,
                ACTOR_ID,
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).statusCode).toBe(400);
            expect((err as AppError).code).toBe("LEGACY_USER_CANNOT_BE_TARGET");
        }

        // No merge, no audit.
        expect(deps.executeMerge).not.toHaveBeenCalled();
        expect(auditCalls).toHaveLength(0);
    });

    test("happy path: runs the merge and records the audit entry", async () => {
        const auditCalls: Array<{
            actorId: string;
            action: string;
            targetUserId: string | null;
            payload: { oldValue?: unknown; newValue?: unknown };
        }> = [];
        const deps = makeDeps({ auditCalls });

        const result = await adminApproveMigration(
            LEGACY_ID,
            REAL_USER_ID,
            ACTOR_ID,
            deps,
        );
        expect(result.success).toBe(true);

        expect(deps.executeMerge).toHaveBeenCalledWith(
            PLACEHOLDER_ID,
            REAL_USER_ID,
            LEGACY_ID,
        );
        expect(auditCalls).toHaveLength(1);
        expect(auditCalls[0].actorId).toBe(ACTOR_ID);
        expect(auditCalls[0].action).toBe("migration.admin.manual");
        expect(auditCalls[0].targetUserId).toBe(REAL_USER_ID);
        expect(auditCalls[0].payload.oldValue).toEqual({ legacyId: LEGACY_ID });
        const newValue = auditCalls[0].payload.newValue as {
            migratedAt: string;
            placeholderUserId: string;
        };
        expect(newValue.placeholderUserId).toBe(PLACEHOLDER_ID);
        expect(typeof newValue.migratedAt).toBe("string");
    });

    test("400 IDS_REQUIRED when legacyId or userId is missing", async () => {
        const deps = makeDeps();

        try {
            await adminApproveMigration("", REAL_USER_ID, ACTOR_ID, deps);
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("IDS_REQUIRED");
        }
        expect(deps.findMapping).not.toHaveBeenCalled();
    });

    test("404 MAPPING_NOT_FOUND when the mapping does not exist", async () => {
        const deps = makeDeps({ mappingMissing: true });

        try {
            await adminApproveMigration(
                LEGACY_ID,
                REAL_USER_ID,
                ACTOR_ID,
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("MAPPING_NOT_FOUND");
        }
    });

    test("409 ALREADY_CLAIMED when the mapping is already claimed", async () => {
        const deps = makeDeps({ isClaimed: true });

        try {
            await adminApproveMigration(
                LEGACY_ID,
                REAL_USER_ID,
                ACTOR_ID,
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("ALREADY_CLAIMED");
        }
        // The legacy guard runs after the claim check, so we never
        // reach it.
        expect(deps.executeMerge).not.toHaveBeenCalled();
    });

    test("404 USER_NOT_FOUND when the real user does not exist", async () => {
        const deps = makeDeps({ userMissing: true });

        try {
            await adminApproveMigration(
                LEGACY_ID,
                REAL_USER_ID,
                ACTOR_ID,
                deps,
            );
            expect.unreachable("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe("USER_NOT_FOUND");
        }
        expect(deps.executeMerge).not.toHaveBeenCalled();
    });
});
