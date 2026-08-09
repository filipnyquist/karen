// src/islands/useLiveRefresh.test.ts
//
// Verifies the polling-scheduler logic via the pure `createLiveRefresh`
// export. We don't need a DOM or testing-library for this — the
// scheduler takes its setInterval/clearInterval/document as injected
// deps, so we drive fake timers + a fake document by hand.

import { describe, expect, mock, test } from "bun:test";
import { createLiveRefresh, type LiveRefreshDeps } from "./useLiveRefresh";

/** A controllable fake document for the scheduler tests. */
function makeFakeDoc(initial: "visible" | "hidden" = "visible") {
    let state = initial;
    const listeners: Array<() => void> = [];
    return {
        get visibilityState() {
            return state;
        },
        set visibilityState(v: "visible" | "hidden") {
            state = v;
            for (const l of listeners) l();
        },
        addEventListener(_event: string, cb: () => void) {
            listeners.push(cb);
        },
        removeEventListener(_event: string, cb: () => void) {
            const i = listeners.indexOf(cb);
            if (i >= 0) listeners.splice(i, 1);
        },
        _listeners: listeners,
    };
}

/** A manually-driven timer + fake document, so we can step time
 *  deterministically without sleeping. */
function makeDeps(initial?: "visible" | "hidden") {
    const doc = makeFakeDoc(initial);
    const callbacks = new Map<number, () => void>();
    let nextId = 1;
    const setInterval = ((cb: () => void, _ms: number) => {
        const id = nextId++;
        callbacks.set(id, cb);
        return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof globalThis.setInterval;
    const clearInterval = ((id: ReturnType<typeof setInterval>) => {
        callbacks.delete(id as unknown as number);
    }) as typeof globalThis.clearInterval;
    function tick() {
        for (const cb of [...callbacks.values()]) cb();
    }
    return {
        deps: {
            setInterval,
            clearInterval,
            document: doc,
        } satisfies LiveRefreshDeps,
        tick,
        doc,
        activeTimers: () => callbacks.size,
    };
}

describe("createLiveRefresh (pure scheduler)", () => {
    test("starts polling immediately when document is visible", () => {
        const { deps, tick, activeTimers, doc } = makeDeps("visible");
        const fetcher = mock(async () => {});
        const handle = createLiveRefresh(fetcher, { intervalMs: 1000 }, deps);

        expect(activeTimers()).toBe(1); // interval armed

        tick();
        tick();
        expect(fetcher.mock.calls.length).toBe(2);

        handle.dispose();
        expect(activeTimers()).toBe(0);
        expect(doc._listeners.length).toBe(0); // listener removed
    });

    test("does not start polling when document is initially hidden", () => {
        const { deps, tick, activeTimers } = makeDeps("hidden");
        const fetcher = mock(async () => {});
        const handle = createLiveRefresh(fetcher, { intervalMs: 1000 }, deps);
        expect(activeTimers()).toBe(0);

        tick();
        tick();
        expect(fetcher.mock.calls.length).toBe(0);

        handle.dispose();
    });

    test("hiding the tab cancels the interval", () => {
        const { deps, tick, activeTimers, doc } = makeDeps("visible");
        const fetcher = mock(async () => {});
        const handle = createLiveRefresh(fetcher, { intervalMs: 1000 }, deps);
        expect(activeTimers()).toBe(1);

        doc.visibilityState = "hidden"; // triggers stop()
        expect(activeTimers()).toBe(0);

        tick();
        tick();
        expect(fetcher.mock.calls.length).toBe(0);

        handle.dispose();
    });

    test("becoming visible again fetches once + resumes polling", () => {
        const { deps, tick, activeTimers, doc } = makeDeps("hidden");
        const fetcher = mock(async () => {});
        const handle = createLiveRefresh(fetcher, { intervalMs: 1000 }, deps);
        expect(activeTimers()).toBe(0);

        doc.visibilityState = "visible"; // fetches once + starts interval
        expect(fetcher.mock.calls.length).toBe(1);
        expect(activeTimers()).toBe(1);

        tick();
        expect(fetcher.mock.calls.length).toBe(2);

        handle.dispose();
    });

    test("respects pauseWhile returning true", () => {
        const { deps, tick, activeTimers } = makeDeps("visible");
        let paused = false;
        const fetcher = mock(async () => {});
        const handle = createLiveRefresh(
            fetcher,
            { intervalMs: 1000, pauseWhile: () => paused },
            deps,
        );
        expect(activeTimers()).toBe(1);

        tick();
        expect(fetcher.mock.calls.length).toBe(1);

        paused = true;
        tick();
        tick();
        expect(fetcher.mock.calls.length).toBe(1); // unchanged

        paused = false;
        tick();
        expect(fetcher.mock.calls.length).toBe(2);

        handle.dispose();
    });

    test("bump() forces one fetch right now", () => {
        const { deps, activeTimers } = makeDeps("visible");
        const fetcher = mock(async () => {});
        const handle = createLiveRefresh(
            fetcher,
            { intervalMs: 999999 }, // never ticks
            deps,
        );
        expect(fetcher.mock.calls.length).toBe(0);

        handle.bump();
        handle.bump();
        expect(fetcher.mock.calls.length).toBe(2);

        // bump respects pauseWhile too.
        const fetcher2 = mock(async () => {});
        const handle2 = createLiveRefresh(
            fetcher2,
            { intervalMs: 999999, pauseWhile: () => true },
            deps,
        );
        handle2.bump();
        expect(fetcher2.mock.calls.length).toBe(0);
        handle2.dispose();
        handle.dispose();
        expect(activeTimers()).toBe(0); // both disposed
    });

    test("accepts updates to fetcher without re-subscribing", () => {
        const { deps, tick, activeTimers } = makeDeps("visible");
        const fetcherA = mock(async () => {});
        const fetcherB = mock(async () => {});
        let currentFetcher = fetcherA;
        const handle = createLiveRefresh(
            () => currentFetcher(),
            { intervalMs: 1000 },
            deps,
        );

        tick();
        expect(fetcherA.mock.calls.length).toBe(1);
        expect(fetcherB.mock.calls.length).toBe(0);

        // Swap fetcher (used by the hook's ref pattern) and tick again.
        currentFetcher = fetcherB;
        tick();
        expect(fetcherB.mock.calls.length).toBe(1);
        expect(activeTimers()).toBe(1); // still the same interval

        handle.dispose();
    });

    test("fetcher errors are swallowed (next tick retries)", async () => {
        const { deps, tick } = makeDeps("visible");
        let throwIt = true;
        const fetcher = mock(async () => {
            if (throwIt) throw new Error("boom");
        });
        const handle = createLiveRefresh(fetcher, { intervalMs: 1000 }, deps);

        tick();
        await new Promise((r) => setTimeout(r, 5));
        // Second tick should still be attempted (no crash).
        throwIt = false;
        tick();
        await new Promise((r) => setTimeout(r, 5));
        expect(fetcher.mock.calls.length).toBe(2);
        handle.dispose();
    });
});
