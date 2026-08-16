import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 30_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }]]
        : "list",
    globalSetup: "./e2e/global-setup.ts",
    globalTeardown: "./e2e/global-setup.ts",
    use: {
        baseURL: "http://localhost:4322",
        locale: "sv-SE",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
