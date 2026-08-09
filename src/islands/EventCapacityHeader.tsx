// src/islands/EventCapacityHeader.tsx
//
// Tiny inline island that keeps the "X/Y" counters fresh under the
// page title. Polls /api/events/:eventId/counts every 10s.

import { useState } from "preact/hooks";
import { useLiveRefresh } from "./useLiveRefresh";

interface Counts {
    workers: number;
    maxWorkers: number | null;
    guests: number;
    maxGuests: number | null;
    maxGuestsPerUser: number;
}

interface Props {
    eventId: string;
    initial: Counts;
    /** Render any of the counts? Set to false to skip that block. */
    showWorkers?: boolean;
    showGuests?: boolean;
}

export default function EventCapacityHeader({
    eventId,
    initial,
    showWorkers = true,
    showGuests = true,
}: Props) {
    const [counts, setCounts] = useState<Counts>(initial);

    useLiveRefresh(async () => {
        try {
            const res = await fetch(`/api/events/${eventId}/counts`, {
                credentials: "same-origin",
            });
            if (!res.ok) return;
            const data = (await res.json()) as Counts;
            setCounts(data);
        } catch {
            /* swallow */
        }
    });

    return (
        <div class="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
            {showWorkers && (
                <span class="inline-flex items-center gap-1">
                    <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                    </svg>
                    Workers: {counts.workers}
                    {counts.maxWorkers ? `/${counts.maxWorkers}` : ""}
                </span>
            )}
            {showGuests && (
                <span class="inline-flex items-center gap-1">
                    <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5.121 17.804A4 4 0 018 16h8a4 4 0 012.879 1.804M15 11a3 3 0 11-6 0 3 3 0 016 0zM21 21v-2a4 4 0 00-3-3.87"
                        />
                    </svg>
                    Guests: {counts.guests}
                    {counts.maxGuests ? `/${counts.maxGuests}` : ""}
                </span>
            )}
        </div>
    );
}
