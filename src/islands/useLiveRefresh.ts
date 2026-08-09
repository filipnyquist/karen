// src/islands/useLiveRefresh.ts
//
// Visibility-aware polling hook for "live-ish" refreshes on the event
// detail page. Pauses entirely when the tab is hidden so we don't waste
// DB queries on background tabs. Re-fetches immediately when the tab
// becomes visible again so a user returning to the page sees current
// data without waiting for the next interval tick.
//
// Returns `bump()` so a panel that just mutated data (e.g. submitted a
// comment) can re-fetch immediately.

import { useEffect, useRef } from "preact/hooks";

export interface UseLiveRefreshOptions {
    intervalMs?: number;
    /** When this returns true, polling is paused (e.g. the comment
     *  textarea has unsent draft text). */
    pauseWhile?: () => boolean;
}

export interface UseLiveRefreshApi {
    /** Force a re-fetch right now, bypassing the interval + visibility check.
     *  Still respects `pauseWhile`. */
    bump: () => void;
}

export interface LiveRefreshDeps {
    setInterval: typeof globalThis.setInterval;
    clearInterval: typeof globalThis.clearInterval;
    document: {
        visibilityState: string;
        addEventListener: (event: string, cb: () => void) => void;
        removeEventListener: (event: string, cb: () => void) => void;
    };
}

/** Pure scheduler — exported for unit testing without needing a DOM. */
export function createLiveRefresh(
    fetcher: () => Promise<void> | void,
    options: UseLiveRefreshOptions,
    deps: LiveRefreshDeps,
): { bump: () => void; dispose: () => void } {
    const intervalMs = options.intervalMs ?? 10000;
    const pauseWhile = options.pauseWhile ?? (() => false);
    const { setInterval, clearInterval, document } = deps;

    let intervalId: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
        if (pauseWhile()) return;
        Promise.resolve(fetcher()).catch(() => {});
    };

    const start = () => {
        if (intervalId !== undefined) return;
        intervalId = setInterval(tick, intervalMs);
    };
    const stop = () => {
        if (intervalId === undefined) return;
        clearInterval(intervalId);
        intervalId = undefined;
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
            tick();
            start();
        } else {
            stop();
        }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return {
        bump: () => {
            if (pauseWhile()) return;
            tick();
        },
        dispose: () => {
            stop();
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
        },
    };
}

export function useLiveRefresh(
    fetcher: () => Promise<void> | void,
    options: UseLiveRefreshOptions = {},
): UseLiveRefreshApi {
    const intervalMs = options.intervalMs ?? 10000;
    const pauseWhile = options.pauseWhile ?? (() => false);

    // Latest-value refs so the long-lived scheduler callback always
    // reads the freshest fetcher / pauseWhile without needing to
    // re-subscribe.
    const fetcherRef = useRef(fetcher);
    const pauseRef = useRef(pauseWhile);
    fetcherRef.current = fetcher;
    pauseRef.current = pauseWhile;

    // Lazily-built api handle so the consumer can call bump() before
    // the effect runs without throwing.
    const apiRef = useRef<UseLiveRefreshApi | null>(null);
    if (apiRef.current === null) {
        apiRef.current = {
            bump: () => {
                if (pauseRef.current()) return;
                Promise.resolve(fetcherRef.current()).catch(() => {});
            },
        };
    }

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handle = createLiveRefresh(
            () => fetcherRef.current(),
            { intervalMs, pauseWhile: () => pauseRef.current() },
            {
                setInterval: window.setInterval.bind(window),
                clearInterval: window.clearInterval.bind(window),
                document,
            },
        );
        return handle.dispose;
    }, [intervalMs]);

    return apiRef.current;
}
