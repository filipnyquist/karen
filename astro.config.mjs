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
                // User-authored inline scripts (login/register/BaseLayout/event/
                // pubteam) are whitelisted via Astro.csp.insertScriptHash() in
                // each page's frontmatter.
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
                // Turnstile renders inside an iframe at challenges.cloudflare.com.
                "frame-src 'self' https://challenges.cloudflare.com",
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
