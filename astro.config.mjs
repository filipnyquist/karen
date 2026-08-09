import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { wsDevPlugin } from "./src/integrations/ws-dev";

export default defineConfig({
    output: "server",
    security: {
        allowedDomains: [
            { hostname: "karen.nyqui.st", protocol: "https" },
            { hostname: "karen.bthstudent.se", protocol: "https" },
        ],
        csp: {
            scriptDirective: {
                // 'self' is NOT added by default in Astro 7 — must be explicit.
                // Turnstile is added per-page via Astro.csp?.insertScriptResource()
                resources: ["'self'"],
            },
            styleDirective: {
                // Astro auto-hashes inline <style> emitted by .astro files;
                // Tailwind v4 produces static stylesheets. No 'unsafe-inline'.
                resources: ["'self'"],
            },
            directives: [
                "default-src 'self'",
                "img-src 'self' data: blob:",
                "font-src 'self'",
                "connect-src 'self' ws: wss:",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "frame-ancestors 'none'",
            ],
        },
    },
    adapter: node({
        mode: "standalone",
    }),
    integrations: [preact()],
    srcDir: "./src",
    vite: {
        plugins: [tailwindcss(), wsDevPlugin()],
    },
});
