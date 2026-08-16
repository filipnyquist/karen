// src/islands/TicketCards.tsx
//
// Renders active + redeemed tickets.
// The QR code is pre-rendered server-side as a PNG data URL so the raw
// ticket token never reaches the browser — the island only sees opaque
// image bytes.
import { useState } from "preact/hooks";

interface ActiveTicket {
    id: string;
    qrPng: string;
    eventName: string;
    eventStartDate: string;
    createdAt: string;
}

interface RedeemedTicket {
    eventName: string;
    eventStartDate: string;
    redeemedAt: string | null;
}

interface TicketCardsProps {
    activeTickets: ActiveTicket[];
    redeemedTickets: RedeemedTicket[];
    lang: string;
    t: Record<string, string>;
}

export default function TicketCards({
    activeTickets,
    redeemedTickets,
    lang,
    t,
}: TicketCardsProps) {
    const [revealedTickets, setRevealedTickets] = useState<Set<string>>(
        new Set(),
    );

    function toggleReveal(id: string) {
        setRevealedTickets((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    return (
        <>
            {/* Usage instructions */}
            <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6">
                <h3 class="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                    {t["ticket.howToUse"] || "How to use your ticket"}
                </h3>
                <ol class="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
                    <li>
                        {t["ticket.instruction1"] ||
                            "Your QR code is generated automatically for each event you register for."}
                    </li>
                    <li>
                        {t["ticket.instruction2"] ||
                            "Show the QR code to the event staff at the entrance."}
                    </li>
                    <li>
                        {t["ticket.instruction3"] ||
                            "The staff will scan your code to confirm your entry."}
                    </li>
                </ol>
            </div>

            {/* Active tickets */}
            <section>
                <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    {t["ticket.active"] || "Active"}
                </h2>

                {activeTickets.length === 0 ? (
                    <div class="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
                        <svg
                            class="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.5"
                                d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                            />
                        </svg>
                        <p class="text-gray-500 dark:text-gray-400">
                            {t["ticket.noTickets"] || "No active tickets"}
                        </p>
                    </div>
                ) : (
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {activeTickets.map((ticket) => {
                            const isRevealed = revealedTickets.has(ticket.id);
                            return (
                                <div
                                    key={ticket.id}
                                    class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
                                >
                                    <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3">
                                        <p class="text-sm font-medium text-white truncate">
                                            {ticket.eventName}
                                        </p>
                                        <p class="text-xs text-blue-200">
                                            {new Date(
                                                ticket.eventStartDate,
                                            ).toLocaleDateString(lang, {
                                                month: "short",
                                                day: "numeric",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </p>
                                    </div>
                                    <div class="p-4 flex flex-col items-center">
                                        <div class="bg-white p-2 rounded-lg mb-3 relative">
                                            <img
                                                src={ticket.qrPng}
                                                alt={`QR ticket for ${ticket.eventName}`}
                                                width={160}
                                                height={160}
                                                class="block rounded"
                                                style={{
                                                    filter: isRevealed
                                                        ? "none"
                                                        : "blur(12px)",
                                                    transition:
                                                        "filter 0.3s ease",
                                                }}
                                            />
                                            {!isRevealed && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        toggleReveal(ticket.id)
                                                    }
                                                    class="absolute inset-0 flex items-center justify-center bg-black/5 rounded-lg cursor-pointer hover:bg-black/10 transition-colors"
                                                    title={
                                                        t[
                                                            "ticket.clickToReveal"
                                                        ] ||
                                                        "Click to reveal QR code"
                                                    }
                                                >
                                                    <div class="bg-white/90 dark:bg-gray-800/90 rounded-full p-3 shadow-lg">
                                                        <svg
                                                            class="w-6 h-6 text-gray-600 dark:text-gray-300"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path
                                                                stroke-linecap="round"
                                                                stroke-linejoin="round"
                                                                stroke-width="2"
                                                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                            />
                                                            <path
                                                                stroke-linecap="round"
                                                                stroke-linejoin="round"
                                                                stroke-width="2"
                                                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                                            />
                                                        </svg>
                                                    </div>
                                                </button>
                                            )}
                                            {isRevealed && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        toggleReveal(ticket.id)
                                                    }
                                                    class="absolute top-1 right-1 bg-white/80 dark:bg-gray-800/80 rounded-full p-1 shadow cursor-pointer hover:bg-white dark:hover:bg-gray-700 transition-colors"
                                                    title={
                                                        t[
                                                            "ticket.clickToHide"
                                                        ] ||
                                                        "Click to hide QR code"
                                                    }
                                                >
                                                    <svg
                                                        class="w-4 h-4 text-gray-500"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            stroke-linecap="round"
                                                            stroke-linejoin="round"
                                                            stroke-width="2"
                                                            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                                                        />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                        <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
                                            {t["ticket.issuedAt"] || "Issued"}:{" "}
                                            {new Date(
                                                ticket.createdAt,
                                            ).toLocaleDateString(lang, {
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Redeemed tickets */}
            {redeemedTickets.length > 0 && (
                <section>
                    <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        {t["ticket.redeemed"] || "Redeemed"}
                    </h2>
                    <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <ul class="divide-y divide-gray-200 dark:divide-gray-800">
                            {redeemedTickets.map((ticket) => (
                                <li
                                    key={`${ticket.eventName}-${ticket.eventStartDate}-${ticket.redeemedAt ?? ""}`}
                                    class="px-4 py-3 flex items-center justify-between"
                                >
                                    <div>
                                        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            {ticket.eventName}
                                        </p>
                                        <p class="text-xs text-gray-400 dark:text-gray-500">
                                            {t["ticket.redeemed"] || "Redeemed"}
                                            :{" "}
                                            {ticket.redeemedAt
                                                ? new Date(
                                                      ticket.redeemedAt,
                                                  ).toLocaleDateString(lang, {
                                                      month: "short",
                                                      day: "numeric",
                                                      hour: "2-digit",
                                                      minute: "2-digit",
                                                  })
                                                : "-"}
                                        </p>
                                    </div>
                                    <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                        {t["ticket.redeemed"] || "Redeemed"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            )}
        </>
    );
}
