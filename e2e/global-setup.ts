import { execFileSync, execSync } from "node:child_process";
import http from "node:http";

const COMPOSE_FILE = "docker-compose.e2e.yml";
const BASE_URL = "http://localhost:4322";

/**
 * Run a command and dump captured stdout/stderr on failure. The drizzle-kit
 * spinner uses `\r` carriage returns to overwrite its own status line, so when
 * the migration fails the actual error message gets erased in the captured
 * CI log. To make CI failures debuggable, capture both streams to a file
 * and dump its contents on non-zero exit.
 */
function runOrDump(cmd: string, args: string[], cwd: string): void {
    try {
        execFileSync(cmd, args, { stdio: "inherit", cwd });
    } catch (err: unknown) {
        const e = err as { status?: number | null; stderr?: Buffer };
        const exitCode = e.status ?? "unknown";
        console.error(
            `\n[e2e] Command failed (exit ${exitCode}): ${cmd} ${args.join(" ")}\n`,
        );
        // execFileSync with stdio: 'inherit' doesn't capture output; re-run
        // with capture so we can dump the real error to the CI log.
        try {
            const out = execFileSync(cmd, args, {
                stdio: ["ignore", "pipe", "pipe"],
                cwd,
            });
            process.stderr.write(out.toString());
        } catch (err2: unknown) {
            const e2 = err2 as { stdout?: Buffer; stderr?: Buffer };
            if (e2.stdout?.length) process.stderr.write(e2.stdout);
            if (e2.stderr?.length) process.stderr.write(e2.stderr);
        }
        throw err;
    }
}

export default async function globalSetup() {
    console.log("[e2e] Starting E2E test infrastructure...");

    // Clean up any stale state from a previous crashed run
    cleanup();

    // Start DB + app containers
    console.log("[e2e] Starting containers...");
    runOrDump("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"], process.cwd());

    // Run migrations inside the app container
    console.log("[e2e] Running migrations...");
    runOrDump(
        "docker",
        ["compose", "-f", COMPOSE_FILE, "exec", "app", "bun", "db:migrate"],
        process.cwd(),
    );

    // Seed test data inside the app container
    console.log("[e2e] Seeding test data...");
    runOrDump(
        "docker",
        ["compose", "-f", COMPOSE_FILE, "exec", "app", "bun", "src/db/seed-test.ts"],
        process.cwd(),
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
