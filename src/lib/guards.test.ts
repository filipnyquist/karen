// src/lib/guards.test.ts
//
// Unit tests for the page-level auth gate helpers. We mock Astro's
// `redirect` (which mutates the response and returns a `Response`)
// to verify both the redirect target and the returned AuthUser.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AstroGlobal } from "astro";
import type { AuthUser } from "../api/middleware/auth";
import { requireAdmin, requireAuth, requireSuperadmin } from "./guards";

function fakeAstro(currentUser: AuthUser | null): AstroGlobal {
    const astro: { redirect: (target: string) => Response } = {
        redirect: (target) =>
            new Response(null, {
                status: 302,
                headers: { Location: target },
            }),
    };
    (astro as unknown as { locals: { user: AuthUser | null } }).locals = {
        user: currentUser,
    };
    return astro as unknown as AstroGlobal;
}

const fakeUser: AuthUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alice@karen.se",
    role: "user",
    verified: true,
    emailVerified: true,
    name: "Alice",
    nickname: "Alicia",
    seenMigrationPrompt: false,
};

beforeEach(() => {
    // The guards call `Astro.redirect` directly. Stub it on `Astro` so the
    // returned Response object is observable.
    mock.module("astro:middleware", () => ({
        defineMiddleware: (fn: unknown) => fn,
    }));
});

describe("requireAuth", () => {
    test("returns the user when authenticated", () => {
        const r = requireAuth(fakeAstro(fakeUser));
        expect(r).toBe(fakeUser);
    });

    test("returns a 302 redirect to /login when anonymous", () => {
        const r = requireAuth(fakeAstro(null));
        expect(r).toBeInstanceOf(Response);
        const res = r as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("/login");
    });
});

describe("requireAdmin", () => {
    test("returns the user for admin", () => {
        const admin = { ...fakeUser, role: "admin" as const };
        const r = requireAdmin(fakeAstro(admin));
        expect(r).toBe(admin);
    });

    test("returns the user for superadmin", () => {
        const superadmin = { ...fakeUser, role: "superadmin" as const };
        const r = requireAdmin(fakeAstro(superadmin));
        expect(r).toBe(superadmin);
    });

    test("redirects to / for a logged-in non-admin", () => {
        const r = requireAdmin(fakeAstro(fakeUser));
        expect(r).toBeInstanceOf(Response);
        const res = r as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("/");
    });

    test("redirects to /login for an anonymous user", () => {
        const r = requireAdmin(fakeAstro(null));
        expect(r).toBeInstanceOf(Response);
        const res = r as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("/login");
    });
});

describe("requireSuperadmin", () => {
    test("returns the user for superadmin", () => {
        const superadmin = { ...fakeUser, role: "superadmin" as const };
        const r = requireSuperadmin(fakeAstro(superadmin));
        expect(r).toBe(superadmin);
    });

    test("redirects to / for admin (not superadmin)", () => {
        const admin = { ...fakeUser, role: "admin" as const };
        const r = requireSuperadmin(fakeAstro(admin));
        expect(r).toBeInstanceOf(Response);
        const res = r as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("/");
    });
});
