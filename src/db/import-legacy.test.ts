// src/db/import-legacy.test.ts
//
// Unit tests for the ticket dedup helper. These are pure (no DB) so we
// can exercise the pick rules with synthetic input.

import { describe, expect, test } from "bun:test";
import { dedupeTickets } from "./import-legacy";

describe("dedupeTickets", () => {
    test("empty input returns empty output", () => {
        const out = dedupeTickets([], new Map(), new Map());
        expect(out.winners).toEqual([]);
        expect(out.skipped).toBe(0);
    });

    test("single row passes through", () => {
        const events = new Map<number, string>([[1, "new-evt-1"]]);
        const users = new Map<number, string>([[7, "new-user-7"]]);
        const out = dedupeTickets(
            [
                {
                    ticket_id: 100,
                    ticket_key: "abc",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
            ],
            events,
            users,
        );
        expect(out.skipped).toBe(0);
        expect(out.winners).toHaveLength(1);
        expect(out.winners[0]).toMatchObject({
            userId: "new-user-7",
            eventId: "new-evt-1",
            token: "abc",
            isActive: true,
            ticketId: 100,
        });
    });

    test("active wins over inactive for the same (user, event)", () => {
        const events = new Map<number, string>([[1, "e1"]]);
        const users = new Map<number, string>([[7, "u7"]]);
        const out = dedupeTickets(
            [
                {
                    ticket_id: 100,
                    ticket_key: "inactive-token",
                    is_active: false,
                    user_id: 7,
                    event_id: 1,
                },
                {
                    ticket_id: 200,
                    ticket_key: "active-token",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
            ],
            events,
            users,
        );
        expect(out.winners).toHaveLength(1);
        expect(out.winners[0].token).toBe("active-token");
        expect(out.winners[0].isActive).toBe(true);
    });

    test("higher ticket_id wins on active-vs-active tie", () => {
        const events = new Map<number, string>([[1, "e1"]]);
        const users = new Map<number, string>([[7, "u7"]]);
        const out = dedupeTickets(
            [
                {
                    ticket_id: 100,
                    ticket_key: "older",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
                {
                    ticket_id: 200,
                    ticket_key: "newer",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
                {
                    ticket_id: 150,
                    ticket_key: "middle",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
            ],
            events,
            users,
        );
        expect(out.winners).toHaveLength(1);
        expect(out.winners[0].token).toBe("newer");
    });

    test("distinct (user, event) pairs are kept independently", () => {
        const events = new Map<number, string>([
            [1, "e1"],
            [2, "e2"],
        ]);
        const users = new Map<number, string>([
            [7, "u7"],
            [8, "u8"],
        ]);
        const out = dedupeTickets(
            [
                {
                    ticket_id: 100,
                    ticket_key: "u7e1",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
                {
                    ticket_id: 100,
                    ticket_key: "u8e1",
                    is_active: true,
                    user_id: 8,
                    event_id: 1,
                },
                {
                    ticket_id: 100,
                    ticket_key: "u7e2",
                    is_active: true,
                    user_id: 7,
                    event_id: 2,
                },
            ],
            events,
            users,
        );
        expect(out.winners).toHaveLength(3);
    });

    test("rows with unresolved user or event are skipped", () => {
        const events = new Map<number, string>([[1, "e1"]]);
        const users = new Map<number, string>([[7, "u7"]]);
        const out = dedupeTickets(
            [
                {
                    ticket_id: 100,
                    ticket_key: "good",
                    is_active: true,
                    user_id: 7,
                    event_id: 1,
                },
                {
                    ticket_id: 101,
                    ticket_key: "no-event",
                    is_active: true,
                    user_id: 7,
                    event_id: 999,
                },
                {
                    ticket_id: 102,
                    ticket_key: "no-user",
                    is_active: true,
                    user_id: 999,
                    event_id: 1,
                },
            ],
            events,
            users,
        );
        expect(out.winners).toHaveLength(1);
        expect(out.winners[0].token).toBe("good");
        expect(out.skipped).toBe(2);
    });

    test("legacy duplicate scenario: 5 active + 3 inactive for one (user,event) collapses to 1", () => {
        // Models the actual pykaren dump pattern.
        const events = new Map<number, string>([[42, "e42"]]);
        const users = new Map<number, string>([[9, "u9"]]);
        const tickets = [
            ...Array.from({ length: 3 }, (_, i) => ({
                ticket_id: 1000 + i,
                ticket_key: `inactive-${i}`,
                is_active: false,
                user_id: 9,
                event_id: 42,
            })),
            ...Array.from({ length: 5 }, (_, i) => ({
                ticket_id: 2000 + i,
                ticket_key: `active-${i}`,
                is_active: true,
                user_id: 9,
                event_id: 42,
            })),
        ];
        const out = dedupeTickets(tickets, events, users);
        expect(out.winners).toHaveLength(1);
        expect(out.winners[0].isActive).toBe(true);
        expect(out.winners[0].ticketId).toBe(2004); // highest active id
    });
});
