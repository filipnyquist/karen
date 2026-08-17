// src/islands/EventForm.tsx
import { useEffect, useState } from "preact/hooks";

interface EventFormProps {
    eventId?: string;
    t: Record<string, string>;
}

interface Location {
    id: number;
    name: string;
    description: string | null;
}

interface EventState {
    id: number;
    name: string;
}

interface FormData {
    name: string;
    description: string;
    locationId: string;
    startDate: string;
    endDate: string;
    maxGuests: string;
    maxGuestsPerUser: string;
    maxWorkers: string;
    maxResponsibles: string;
    minWorkers: string;
    minResponsibles: string;
    givesPoints: boolean;
    willOccur: string;
}

const emptyForm: FormData = {
    name: "",
    description: "",
    locationId: "",
    startDate: "",
    endDate: "",
    maxGuests: "35",
    maxGuestsPerUser: "3",
    maxWorkers: "",
    maxResponsibles: "",
    minWorkers: "",
    minResponsibles: "",
    givesPoints: true,
    willOccur: "",
};

// Palette for the segmented "event state" picker. Colours mirror
// the badges rendered on the event cards (EventCard.astro /
// EventCalendar). Keep in sync if the badge palette changes.
const STATE_PALETTE: Record<string, { selected: string; idle: string }> = {
    yes: {
        selected:
            "bg-green-600 text-white border-green-600 dark:bg-green-600 dark:border-green-500",
        idle: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800 dark:hover:bg-green-900/50",
    },
    no: {
        selected:
            "bg-red-600 text-white border-red-600 dark:bg-red-600 dark:border-red-500",
        idle: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/50",
    },
    maybe: {
        selected:
            "bg-yellow-500 text-white border-yellow-500 dark:bg-yellow-500 dark:border-yellow-400",
        idle: "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800 dark:hover:bg-yellow-900/50",
    },
};
const DEFAULT_STATE_PALETTE = {
    selected:
        "bg-blue-600 text-white border-blue-600 dark:bg-blue-600 dark:border-blue-500",
    idle: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700",
};

export default function EventForm({ eventId, t }: EventFormProps) {
    const isEdit = Boolean(eventId);
    const [form, setForm] = useState<FormData>(emptyForm);
    const [locations, setLocations] = useState<Location[]>([]);
    const [eventStates, setEventStates] = useState<EventState[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        async function loadInitialData() {
            try {
                const locRes = await fetch("/api/locations");
                if (locRes.ok) {
                    const locData = await locRes.json();
                    setLocations(locData.locations ?? locData);
                }

                const stateRes = await fetch("/api/event-states");
                if (stateRes.ok) {
                    const stateData = await stateRes.json();
                    const states = (stateData.states ??
                        stateData) as EventState[];
                    setEventStates(states);

                    // On create mode, default to the "yes" state so the
                    // user doesn't have to interact with the segmented
                    // picker. EventCard badges still use the short
                    // "Confirmed" / "Cancelled" / "Tentative" labels
                    // (see EventCard.astro); the picker has its own
                    // descriptive copy via `event.stateYesFull` etc.
                    // Edit mode keeps the loaded value below.
                    if (!isEdit) {
                        const yesState = states.find((s) => s.name === "yes");
                        if (yesState) {
                            setForm((prev) =>
                                prev.willOccur === ""
                                    ? {
                                          ...prev,
                                          willOccur: String(yesState.id),
                                      }
                                    : prev,
                            );
                        }
                    }
                }

                if (isEdit && eventId) {
                    const eventRes = await fetch(`/api/events/${eventId}`);
                    if (!eventRes.ok) {
                        throw new Error(
                            t["common.failedToLoad"] || "Failed to load",
                        );
                    }
                    const eventData = await eventRes.json();
                    const ev = eventData.event ?? eventData;

                    const toDatetimeLocal = (iso: string) => {
                        const d = new Date(iso);
                        const pad = (n: number) => String(n).padStart(2, "0");
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    };

                    setForm({
                        name: ev.name ?? "",
                        description: ev.description ?? "",
                        locationId: String(ev.locationId ?? ""),
                        startDate: ev.startDate
                            ? toDatetimeLocal(ev.startDate)
                            : "",
                        endDate: ev.endDate ? toDatetimeLocal(ev.endDate) : "",
                        maxGuests:
                            ev.maxGuests != null ? String(ev.maxGuests) : "",
                        maxGuestsPerUser:
                            ev.maxGuestsPerUser != null
                                ? String(ev.maxGuestsPerUser)
                                : "3",
                        maxWorkers:
                            ev.maxWorkers != null ? String(ev.maxWorkers) : "",
                        maxResponsibles:
                            ev.maxResponsibles != null
                                ? String(ev.maxResponsibles)
                                : "",
                        minWorkers:
                            ev.minWorkers != null ? String(ev.minWorkers) : "",
                        minResponsibles:
                            ev.minResponsibles != null
                                ? String(ev.minResponsibles)
                                : "",
                        givesPoints: ev.givesPoints ?? true,
                        willOccur:
                            ev.willOccur != null ? String(ev.willOccur) : "",
                    });
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);

                setError(errMsg || t["common.error"] || "Something went wrong");
            } finally {
                setLoading(false);
            }
        }

        loadInitialData();
    }, [eventId, t["common.failedToLoad"], t["common.error"], isEdit]);

    function updateField(field: keyof FormData, value: string | boolean) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();
        setError("");
        setSubmitting(true);

        const payload = {
            name: form.name,
            description: form.description || undefined,
            locationId: form.locationId ? Number(form.locationId) : undefined,
            startDate: form.startDate
                ? new Date(form.startDate).toISOString()
                : undefined,
            endDate: form.endDate
                ? new Date(form.endDate).toISOString()
                : undefined,
            maxGuests: form.maxGuests ? Number(form.maxGuests) : undefined,
            maxGuestsPerUser: form.maxGuestsPerUser
                ? Number(form.maxGuestsPerUser)
                : undefined,
            maxWorkers: form.maxWorkers ? Number(form.maxWorkers) : undefined,
            maxResponsibles: form.maxResponsibles
                ? Number(form.maxResponsibles)
                : undefined,
            minWorkers: form.minWorkers ? Number(form.minWorkers) : undefined,
            minResponsibles: form.minResponsibles
                ? Number(form.minResponsibles)
                : undefined,
            givesPoints: form.givesPoints,
            willOccur: form.willOccur ? Number(form.willOccur) : undefined,
        };

        try {
            const url = isEdit ? `/api/events/${eventId}` : "/api/events";
            const method = isEdit ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(
                    data.error ||
                        data.message ||
                        t["common.error"] ||
                        "Something went wrong",
                );
            }

            const data = await res.json();
            const createdEvent = data.event ?? data;
            window.location.href = `/event/${createdEvent.id ?? eventId}`;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            setError(errMsg || t["common.error"] || "Something went wrong");
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return (
            <div class="flex justify-center items-center py-12">
                <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} class="max-w-2xl mx-auto space-y-6">
            {error && (
                <div class="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400">
                    {error}
                </div>
            )}

            {/* Name */}
            <div>
                <label
                    for="name"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                    {t["event.name"] || "Name"} *
                </label>
                <input
                    id="name"
                    type="text"
                    required
                    value={form.name}
                    maxLength={100}
                    onInput={(e) =>
                        updateField(
                            "name",
                            (e.target as HTMLInputElement).value,
                        )
                    }
                    class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={
                        t["event.eventNamePlaceholder"] || "e.g. Pub Night"
                    }
                />
            </div>

            {/* Description */}
            <div>
                <label
                    for="description"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                    {t["event.description"] || "Description"}
                </label>
                <textarea
                    id="description"
                    rows={4}
                    value={form.description}
                    maxLength={500}
                    onInput={(e) =>
                        updateField(
                            "description",
                            (e.target as HTMLTextAreaElement).value,
                        )
                    }
                    class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={
                        t["event.describeEvent"] || "Describe the event..."
                    }
                />
            </div>

            {/* Location */}
            <div>
                <label
                    for="locationId"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                    {t["event.location"] || "Location"} *
                </label>
                <select
                    id="locationId"
                    required
                    value={form.locationId}
                    onChange={(e) =>
                        updateField(
                            "locationId",
                            (e.target as HTMLSelectElement).value,
                        )
                    }
                    class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                    <option value="">
                        {t["event.selectLocation"] || "Select a location..."}
                    </option>
                    {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                            {loc.name}
                        </option>
                    ))}
                </select>
            </div>

            {/* Dates */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label
                        for="startDate"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["event.startDate"] || "Start date"} *
                    </label>
                    <input
                        id="startDate"
                        type="datetime-local"
                        lang="en-GB"
                        required
                        value={form.startDate}
                        onInput={(e) =>
                            updateField(
                                "startDate",
                                (e.target as HTMLInputElement).value,
                            )
                        }
                        class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
                <div>
                    <label
                        for="endDate"
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                        {t["event.endDate"] || "End date"} *
                    </label>
                    <input
                        id="endDate"
                        type="datetime-local"
                        lang="en-GB"
                        required
                        value={form.endDate}
                        onInput={(e) =>
                            updateField(
                                "endDate",
                                (e.target as HTMLInputElement).value,
                            )
                        }
                        class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
            </div>

            {/* Capacity & Staffing */}
            <fieldset class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
                <legend class="text-sm font-semibold text-gray-700 dark:text-gray-300 px-2">
                    {t["event.capacityStaffing"] || "Capacity & Staffing"}
                </legend>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label
                            for="maxGuests"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["event.maxGuests"] || "Max Guests"}
                        </label>
                        <input
                            id="maxGuests"
                            type="number"
                            min="0"
                            value={form.maxGuests}
                            onInput={(e) =>
                                updateField(
                                    "maxGuests",
                                    (e.target as HTMLInputElement).value,
                                )
                            }
                            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label
                            for="maxGuestsPerUser"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["event.maxGuestsPerUser"] ||
                                "Max Guests Per User"}
                        </label>
                        <input
                            id="maxGuestsPerUser"
                            type="number"
                            min="0"
                            value={form.maxGuestsPerUser}
                            onInput={(e) =>
                                updateField(
                                    "maxGuestsPerUser",
                                    (e.target as HTMLInputElement).value,
                                )
                            }
                            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label
                            for="maxWorkers"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["event.maxWorkers"] || "Max Workers"}
                        </label>
                        <input
                            id="maxWorkers"
                            type="number"
                            min="0"
                            value={form.maxWorkers}
                            onInput={(e) =>
                                updateField(
                                    "maxWorkers",
                                    (e.target as HTMLInputElement).value,
                                )
                            }
                            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label
                            for="maxResponsibles"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["event.maxResponsibles"] || "Max Responsibles"}
                        </label>
                        <input
                            id="maxResponsibles"
                            type="number"
                            min="0"
                            value={form.maxResponsibles}
                            onInput={(e) =>
                                updateField(
                                    "maxResponsibles",
                                    (e.target as HTMLInputElement).value,
                                )
                            }
                            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label
                            for="minWorkers"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["event.minWorkers"] || "Min Workers"}
                        </label>
                        <input
                            id="minWorkers"
                            type="number"
                            min="0"
                            value={form.minWorkers}
                            onInput={(e) =>
                                updateField(
                                    "minWorkers",
                                    (e.target as HTMLInputElement).value,
                                )
                            }
                            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label
                            for="minResponsibles"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        >
                            {t["event.minResponsibles"] || "Min Responsibles"}
                        </label>
                        <input
                            id="minResponsibles"
                            type="number"
                            min="0"
                            value={form.minResponsibles}
                            onInput={(e) =>
                                updateField(
                                    "minResponsibles",
                                    (e.target as HTMLInputElement).value,
                                )
                            }
                            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                </div>
            </fieldset>

            {/* Event State & Options */}
            <fieldset class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
                <legend class="text-sm font-semibold text-gray-700 dark:text-gray-300 px-2">
                    {t["event.options"] || "Options"}
                </legend>

                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t["event.eventState"] || "Event state"} *
                    </label>
                    {/* Segmented control: coloured to match the badges on
                        event cards (yes=green, no=red, maybe=yellow).
                        On create, "yes" is pre-selected by the default-to-
                        yes logic above. On edit, the loaded value drives
                        selection. role=radiogroup + aria-checked make this
                        accessible without bringing in a `<select>`. */}
                    <div
                        role="radiogroup"
                        aria-label={t["event.eventState"] || "Event state"}
                        class="flex flex-wrap gap-2"
                    >
                        {eventStates.map((s) => {
                            const isSelected = String(s.id) === form.willOccur;
                            const palette =
                                STATE_PALETTE[s.name] ?? DEFAULT_STATE_PALETTE;
                            const fullLabel =
                                s.name === "yes"
                                    ? t["event.stateYesFull"] ||
                                      "Yes — it will or has happened"
                                    : s.name === "no"
                                      ? t["event.stateNoFull"] ||
                                        "No — it has been cancelled"
                                      : s.name === "maybe"
                                        ? t["event.stateMaybeFull"] ||
                                          "Maybe — TBD"
                                        : s.name;
                            // Native <input type="radio"> is the
                            // canonical accessible segmented-control
                            // shape; we hide the radio itself with
                            // `sr-only` and style the adjacent
                            // `<label>` so it visually IS the button.
                            // `peer-checked:*` flips the label palette
                            // when the radio is selected.
                            return (
                                <label
                                    key={s.id}
                                    class={`cursor-pointer px-4 py-2 rounded-lg border text-sm font-medium transition-colors select-none ${isSelected ? palette.selected : palette.idle}`}
                                >
                                    <input
                                        type="radio"
                                        name="willOccur"
                                        value={s.id}
                                        checked={isSelected}
                                        onChange={() =>
                                            updateField(
                                                "willOccur",
                                                String(s.id),
                                            )
                                        }
                                        required
                                        class="sr-only peer"
                                    />
                                    {fullLabel}
                                </label>
                            );
                        })}
                    </div>
                </div>

                <div class="flex items-center gap-3">
                    <input
                        id="givesPoints"
                        type="checkbox"
                        checked={form.givesPoints}
                        onChange={(e) =>
                            updateField(
                                "givesPoints",
                                (e.target as HTMLInputElement).checked,
                            )
                        }
                        class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                        for="givesPoints"
                        class="text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                        {t["event.givesPointsToWorkers"] ||
                            "Gives Points to Workers"}
                    </label>
                </div>
            </fieldset>

            {/* Submit */}
            <div class="flex justify-end gap-3 pt-4">
                <a
                    href="/event/list"
                    class="py-2 px-6 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                    {t["common.cancel"] || "Cancel"}
                </a>
                <button
                    type="submit"
                    disabled={submitting}
                    class="py-2 px-6 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                    {submitting
                        ? isEdit
                            ? t["common.updating"] || "Updating..."
                            : t["common.creating"] || "Creating..."
                        : isEdit
                          ? t["event.updateEvent"] || "Update Event"
                          : t["event.createEvent"] || "Create Event"}
                </button>
            </div>
        </form>
    );
}
