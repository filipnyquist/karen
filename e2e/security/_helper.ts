/**
 * CSRF-aware fetch helper for security specs. The Elysia CSRF middleware
 * rejects POST/PUT/DELETE without `X-CSRF-Token` after the first
 * "session set + csrf cookie missing" bypass. Playwright's `page.request`
 * sends cookies but NOT the JS-readable `csrf_token` header. So we go
 * through `page.evaluate` + `fetch`, which reads `document.cookie` and
 * stamps the header exactly like the app's own client does.
 */

import type { Page } from "@playwright/test";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export async function csrfFetch(
    page: Page,
    method: HttpMethod,
    url: string,
    body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
    return await page.evaluate(
        async ([m, u, b]) => {
            const csrf =
                document.cookie
                    .split("; ")
                    .find((c) => c.startsWith("csrf_token="))
                    ?.split("=")[1] ?? "";
            const res = await fetch(u as string, {
                method: m as string,
                headers: {
                    "Content-Type": "application/json",
                    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
                },
                credentials: "same-origin",
                body:
                    m === "GET" || b === undefined
                        ? undefined
                        : JSON.stringify(b),
            });
            const text = await res.text();
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
            return { ok: res.ok, status: res.status, body: parsed };
        },
        [method, url, body] as [string, string, unknown],
    );
}
