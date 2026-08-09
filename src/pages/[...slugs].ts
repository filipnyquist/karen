// src/pages/[...slugs].ts
// Mount Elysia API as an Astro endpoint
import type { APIRoute } from "astro";
import { api } from "../api/index";

export const ALL: APIRoute = async (context) => {
    const url = new URL(context.request.url);
    const method = context.request.method;

    try {
        // For requests with bodies (POST/PUT/PATCH), we need to forward the raw body
        // because Astro's request wrapper can lose multipart form data.
        // Read the raw bytes and create a fresh Request with the correct headers.
        let req: Request;
        if (method !== "GET" && method !== "HEAD") {
            const bodyBytes = await new Response(
                context.request.body,
            ).arrayBuffer();
            req = new Request(url.toString(), {
                method,
                headers: context.request.headers,
                body: bodyBytes,
                // @ts-expect-error - duplex is needed for streaming in some runtimes
                duplex: "half",
            });
        } else {
            req = new Request(url.toString(), {
                method,
                headers: context.request.headers,
            });
        }

        const response = await api.handle(req);
        return response;
    } catch (err) {
        console.error("Elysia handler error:", err);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            },
        );
    }
};
