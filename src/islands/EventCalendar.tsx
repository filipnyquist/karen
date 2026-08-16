// src/islands/EventCalendar.tsx
import { useEffect, useState } from "preact/hooks";

interface CalendarEvent {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    locationName: string;
    willOccur: number;
}

interface EventCalendarProps {
    events: CalendarEvent[];
    lang: string;
}

const WEEKDAYS_SV = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const WEEKDAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_SV = [
    "Januari",
    "Februari",
    "Mars",
    "April",
    "Maj",
    "Juni",
    "Juli",
    "Augusti",
    "September",
    "Oktober",
    "November",
    "December",
];
const MONTHS_EN = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
    const day = new Date(year, month, 1).getDay();
    return day === 0 ? 6 : day - 1;
}

function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stateColor(willOccur: number) {
    if (willOccur === 1) return "bg-green-500";
    if (willOccur === 2) return "bg-red-500";
    if (willOccur === 3) return "bg-yellow-500";
    return "bg-blue-500";
}

function stateDotColor(ev: CalendarEvent) {
    if (ev.willOccur !== 1) return stateColor(ev.willOccur);
    const now = new Date();
    const start = new Date(ev.startDate);
    const end = new Date(ev.endDate);
    if (start > now) return "bg-green-500";
    if (end >= now) return "bg-blue-500";
    return "bg-gray-400";
}

function stateTextLabel(ev: CalendarEvent, isSv: boolean) {
    if (ev.willOccur === 2) return isSv ? "Inställt" : "Cancelled";
    if (ev.willOccur === 3) return isSv ? "Preliminärt" : "Tentative";
    const now = new Date();
    const start = new Date(ev.startDate);
    const end = new Date(ev.endDate);
    if (start > now) return isSv ? "Kommande" : "Upcoming";
    if (end >= now) return isSv ? "Pågående" : "Ongoing";
    return isSv ? "Hänt" : "Has happened";
}

export default function EventCalendar({ events, lang }: EventCalendarProps) {
    const isSv = lang === "sv";
    const weekdays = isSv ? WEEKDAYS_SV : WEEKDAYS_EN;
    const months = isSv ? MONTHS_SV : MONTHS_EN;

    const today = new Date();
    const [currentYear, setCurrentYear] = useState(today.getFullYear());
    const [currentMonth, setCurrentMonth] = useState(today.getMonth());
    const [selectedDate, setSelectedDate] = useState<string | null>(null);

    // When the calendar receives a (possibly filtered) event list, jump to
    // the month of the earliest event so users on a search-filtered view see
    // the day the matching event falls on.
    useEffect(() => {
        if (events.length === 0) return;
        const sorted = [...events].sort(
            (a, b) =>
                new Date(a.startDate).getTime() -
                new Date(b.startDate).getTime(),
        );
        const first = new Date(sorted[0].startDate);
        setCurrentYear(first.getFullYear());
        setCurrentMonth(first.getMonth());
    }, [events.length, events]);

    // Build event map: dateKey -> events[]
    const eventMap = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
        const start = new Date(ev.startDate);
        const end = new Date(ev.endDate);
        const d = new Date(start);
        while (d <= end) {
            const key = dateKey(d);
            if (!eventMap.has(key)) eventMap.set(key, []);
            eventMap.get(key)?.push(ev);
            d.setDate(d.getDate() + 1);
        }
    }

    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const todayKey = dateKey(today);

    function prevMonth() {
        if (currentMonth === 0) {
            setCurrentMonth(11);
            setCurrentYear(currentYear - 1);
        } else {
            setCurrentMonth(currentMonth - 1);
        }
        setSelectedDate(null);
    }

    function nextMonth() {
        if (currentMonth === 11) {
            setCurrentMonth(0);
            setCurrentYear(currentYear + 1);
        } else {
            setCurrentMonth(currentMonth + 1);
        }
        setSelectedDate(null);
    }

    const selectedEvents = selectedDate
        ? (eventMap.get(selectedDate) ?? [])
        : [];

    return (
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            {/* Header */}
            <div class="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={prevMonth}
                    class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                >
                    <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 19l-7-7 7-7"
                        />
                    </svg>
                </button>
                <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
                    {months[currentMonth]} {currentYear}
                </h2>
                <button
                    onClick={nextMonth}
                    class="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                >
                    <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </button>
            </div>

            {/* Weekday headers */}
            <div class="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
                {weekdays.map((day) => (
                    <div
                        key={day}
                        class="px-1 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                        {day}
                    </div>
                ))}
            </div>

            {/* Day grid */}
            <div class="grid grid-cols-7">
                {/* Empty cells for days before the 1st. They're positional by
                     definition — index is the only available identifier,
                     which is biome's exact complaint. Suppressing on the
                     <div key={i}> directly below because biome-ignore on
                     JSX expression lines doesn't attach to inner props. */}
                {Array.from({ length: firstDay }).map((_, i) => (
                    <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional filler
                        key={i}
                        class="min-h-[72px] p-1 border-b border-r border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30"
                    />
                ))}

                {/* Day cells */}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dk = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const dayEvents = eventMap.get(dk) ?? [];
                    const isToday = dk === todayKey;
                    const isSelected = dk === selectedDate;

                    return (
                        <button
                            key={dk}
                            type="button"
                            onClick={() =>
                                setSelectedDate(dk === selectedDate ? null : dk)
                            }
                            class={`min-h-[72px] p-1 border-b border-r border-gray-100 dark:border-gray-800 text-left transition-colors ${
                                isSelected
                                    ? "bg-blue-50 dark:bg-blue-950/40"
                                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                            }`}
                        >
                            <div class="flex items-center justify-between">
                                <span
                                    class={`text-xs font-medium ${
                                        isToday
                                            ? "w-5 h-5 flex items-center justify-center rounded-full bg-blue-600 text-white"
                                            : "text-gray-700 dark:text-gray-300"
                                    }`}
                                >
                                    {day}
                                </span>
                            </div>
                            {dayEvents.length > 0 && (
                                <div class="mt-0.5 space-y-0.5">
                                    {dayEvents.slice(0, 2).map((ev) => (
                                        <div
                                            key={ev.id}
                                            class={`text-[10px] leading-tight px-1 py-0.5 rounded truncate ${stateDotColor(ev)} text-white`}
                                        >
                                            {ev.name}
                                        </div>
                                    ))}
                                    {dayEvents.length > 2 && (
                                        <div class="text-[10px] text-gray-500 dark:text-gray-400 px-1">
                                            +{dayEvents.length - 2}
                                        </div>
                                    )}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Selected day events */}
            {selectedDate && (
                <div class="border-t border-gray-200 dark:border-gray-700 p-4">
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                        {new Date(
                            `${selectedDate}T00:00:00`,
                        ).toLocaleDateString(lang, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                        })}
                    </h3>
                    {selectedEvents.length === 0 ? (
                        <p class="text-sm text-gray-400">
                            {isSv
                                ? "Inga evenemang denna dag"
                                : "No events this day"}
                        </p>
                    ) : (
                        <div class="space-y-2">
                            {selectedEvents.map((ev) => (
                                <a
                                    key={ev.id}
                                    href={`/event/${ev.id}`}
                                    class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <span
                                        class={`w-2 h-2 rounded-full shrink-0 ${stateDotColor(ev)}`}
                                    />
                                    <div class="min-w-0">
                                        <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
                                            {ev.name}{" "}
                                            <span class="text-xs font-normal text-gray-400">
                                                {stateTextLabel(ev, isSv)}
                                            </span>
                                        </p>
                                        <p class="text-xs text-gray-500 dark:text-gray-400">
                                            {new Date(
                                                ev.startDate,
                                            ).toLocaleTimeString(lang, {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}{" "}
                                            · {ev.locationName}
                                        </p>
                                    </div>
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
