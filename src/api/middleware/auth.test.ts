// src/api/middleware/auth.test.ts
//
// Verifies the role-derivation helpers. The admin/superadmin split is the
// security boundary for the whole app, so a regression here is high-impact
// — we want unit tests that don't depend on the database.

import { describe, expect, mock, test } from "bun:test";

// Mock the DB-touching loadSessionUser BEFORE importing auth.ts.
const loadSessionUserMock = mock(
    async (
        _req: Request,
    ): Promise<{
        id: string;
        email: string;
        role: string;
        verified: boolean | null;
        emailVerified: boolean | null;
        name: string | null;
        nickname: string | null;
        seenMigrationPrompt: boolean;
    } | null> => null,
);

await mock.module("./auth", () => ({
    isAdmin: (r: string | null | undefined) =>
        r === "admin" || r === "superadmin",
    isSuperadmin: (r: string | null | undefined) => r === "superadmin",
    adminDerive: async ({ request }: { request: Request }) => {
        const user = await loadSessionUserMock(request);
        if (!user) {
            const e: Error & { statusCode: number } = Object.assign(
                new Error("Not authenticated"),
                { statusCode: 401 },
            );
            throw e;
        }
        if (user.role !== "admin" && user.role !== "superadmin") {
            const e: Error & { statusCode: number } = Object.assign(
                new Error("Admin access required"),
                { statusCode: 403 },
            );
            throw e;
        }
        return { user };
    },
    superadminDerive: async ({ request }: { request: Request }) => {
        const user = await loadSessionUserMock(request);
        if (!user) {
            const e: Error & { statusCode: number } = Object.assign(
                new Error("Not authenticated"),
                { statusCode: 401 },
            );
            throw e;
        }
        if (user.role !== "superadmin") {
            const e: Error & { statusCode: number } = Object.assign(
                new Error("Superadmin access required"),
                { statusCode: 403 },
            );
            throw e;
        }
        return { user };
    },
    loadSessionUser: loadSessionUserMock,
    authDerive: () => {
        throw new Error("not used in this test");
    },
    verifiedDerive: () => {
        throw new Error("not used in this test");
    },
    responsibleOrAdminDerive: () => () => {
        throw new Error("not used in this test");
    },
    requireAuth: {},
    requireAdmin: {},
    requireSuperadmin: {},
    requireVerified: {},
    requireResponsibleOrAdmin: () => ({}),
}));

const { adminDerive, superadminDerive, isAdmin, isSuperadmin } = await import(
    "./auth"
);

function makeUser(role: string) {
    return {
        id: "00000000-0000-0000-0000-000000000001",
        email: `${role}@karen.se`,
        role,
        verified: true,
        emailVerified: true,
        name: null,
        nickname: null,
        seenMigrationPrompt: false,
    };
}

const dummyReq = () => new Request("http://localhost/");

describe("isAdmin / isSuperadmin predicates", () => {
    test("isAdmin accepts admin and superadmin", () => {
        expect(isAdmin("admin")).toBe(true);
        expect(isAdmin("superadmin")).toBe(true);
    });

    test("isAdmin rejects user / null / undefined", () => {
        expect(isAdmin("user")).toBe(false);
        expect(isAdmin(null)).toBe(false);
        expect(isAdmin(undefined)).toBe(false);
    });

    test("isSuperadmin is strict", () => {
        expect(isSuperadmin("superadmin")).toBe(true);
        expect(isSuperadmin("admin")).toBe(false);
        expect(isSuperadmin("user")).toBe(false);
        expect(isSuperadmin(null)).toBe(false);
    });
});

describe("adminDerive", () => {
    test("rejects missing session with 401", async () => {
        loadSessionUserMock.mockImplementation(async () => null);
        await expect(
            adminDerive({ request: dummyReq() }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    test("accepts role=admin", async () => {
        loadSessionUserMock.mockImplementation(async () => makeUser("admin"));
        const result = await adminDerive({ request: dummyReq() });
        expect(result.user.role).toBe("admin");
    });

    test("accepts role=superadmin (superset)", async () => {
        loadSessionUserMock.mockImplementation(async () =>
            makeUser("superadmin"),
        );
        const result = await adminDerive({ request: dummyReq() });
        expect(result.user.role).toBe("superadmin");
    });

    test("rejects role=user with 403", async () => {
        loadSessionUserMock.mockImplementation(async () => makeUser("user"));
        await expect(
            adminDerive({ request: dummyReq() }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe("superadminDerive", () => {
    test("rejects missing session with 401", async () => {
        loadSessionUserMock.mockImplementation(async () => null);
        await expect(
            superadminDerive({ request: dummyReq() }),
        ).rejects.toMatchObject({ statusCode: 401 });
    });

    test("accepts role=superadmin", async () => {
        loadSessionUserMock.mockImplementation(async () =>
            makeUser("superadmin"),
        );
        const result = await superadminDerive({ request: dummyReq() });
        expect(result.user.role).toBe("superadmin");
    });

    test("rejects role=admin with 403", async () => {
        loadSessionUserMock.mockImplementation(async () => makeUser("admin"));
        await expect(
            superadminDerive({ request: dummyReq() }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    test("rejects role=user with 403", async () => {
        loadSessionUserMock.mockImplementation(async () => makeUser("user"));
        await expect(
            superadminDerive({ request: dummyReq() }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});
