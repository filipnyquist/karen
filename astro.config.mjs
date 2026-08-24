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
