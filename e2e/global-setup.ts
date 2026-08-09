import { execSync } from "node:child_process";
import http from "node:http";

const COMPOSE_FILE = "docker-compose.e2e.yml";
const BASE_URL = "http://localhost:4322";

export default async function globalSetup() {
    console.log("[e2e] Starting E2E test infrastructure...");

    // Clean up any stale state from a previous crashed run
    cleanup();

    // Start DB + app containers
    console.log("[e2e] Starting containers...");
    execSync(`docker compose -f ${COMPOSE_FILE} up -d --wait`, {
        stdio: "inherit",
        cwd: process.cwd(),
    });

    // Run migrations inside the app container
    console.log("[e2e] Running migrations...");
    execSync(`docker compose -f ${COMPOSE_FILE} exec app bun db:migrate`, {
        stdio: "inherit",
        cwd: process.cwd(),
    });

    // Seed test data inside the app container
    console.log("[e2e] Seeding test data...");
    execSync(
        `docker compose -f ${COMPOSE_FILE} exec app bun src/db/seed-test.ts`,
        {
            stdio: "inherit",
            cwd: process.cwd(),
        },
    );

    // Wait for app to be ready
    await waitForUrl(BASE_URL, 30_000);

    // Warm up Vite — fetch key pages to trigger script compilation before tests start
    console.log("[e2e] Warming up Vite dev server...");
    const warmupPaths = ["/", "/login", "/event/list", "/migrate"];
    await Promise.all(
        warmupPaths.map((p) => fetchUrl(`${BASE_URL}${p}`, 15_000)),
    );
    console.log("[e2e] E2E infrastructure ready.");
}

export async function globalTeardown() {
    console.log("[e2e] Tearing down E2E infrastructure...");
    cleanup();
    console.log("[e2e] Teardown complete.");
}

function cleanup() {
    try {
        execSync(`docker compose -f ${COMPOSE_FILE} down -v --remove-orphans`, {
            stdio: "pipe",
            cwd: process.cwd(),
        });
    } catch {
        // Best-effort — may fail if nothing to clean
    }
}

function waitForUrl(url: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        function attempt() {
            if (Date.now() - start > timeoutMs) {
                return reject(
                    new Error(
                        `[e2e] App did not respond within ${timeoutMs}ms`,
                    ),
                );
            }
            const req = http.get(url, (res) => {
                if (res.statusCode && res.statusCode < 400) {
                    resolve();
                } else {
                    setTimeout(attempt, 500);
                }
            });
            req.on("error", () => setTimeout(attempt, 500));
            req.end();
        }
        attempt();
    });
}

function fetchUrl(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            res.on("end", () => resolve());
        });
        req.on("error", () => resolve());
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve();
        });
        req.end();
    });
}
