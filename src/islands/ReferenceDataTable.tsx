// src/islands/ReferenceDataTable.tsx
//
// Shared CRUD island for the small "system reference data" tables
// (locations and education_types). Server-rendered with `initialRows`,
// then re-fetches the list after every successful mutation so the table
// stays in sync with the server view of the world. Stays small and
// in-memory — these tables have a handful of rows at most.

import { useEffect, useMemo, useState } from "preact/hooks";

interface BaseRow {
    id: number;
    name: string;
    description: string | null;
}

interface LocationRow extends BaseRow {
    // Gates the public picker; toggled by the locations admin modal.
    // See `src/api/index.ts` (GET /api/locations) and
    // `src/services/events.ts` (`createEvent`) for the filter.
    active: boolean;
}

interface EducationTypeRow extends BaseRow {
    validityMonths: number | null;
    // Per-locale fields. Nullable in the DB; the modal lets admin
    // edit SV/EN independently. The cascade EN → SV → `name` makes
    // the legacy `name` column the safety-net fallback.
    nameSv: string | null;
    nameEn: string | null;
    descriptionSv: string | null;
    descriptionEn: string | null;
}

type Row = LocationRow | EducationTypeRow;

interface ReferenceDataTableProps {
    kind: "location" | "educationType";
    initialRows: Row[];
    t: Record<string, string>;
}

interface ModalState {
    open: boolean;
    mode: "create" | "edit";
    row: Row | null;
}

const EMPTY_LOCATION: LocationRow = {
    id: 0,
    name: "",
    description: null,
    active: true,
};

const EMPTY_EDUCATION_TYPE: EducationTypeRow = {
    id: 0,
    name: "",
    description: null,
    validityMonths: null,
    nameSv: null,
    nameEn: null,
    descriptionSv: null,
    descriptionEn: null,
};

export default function ReferenceDataTable({
    kind,
    initialRows,
    t,
}: ReferenceDataTableProps) {
    const [rows, setRows] = useState<Row[]>(initialRows);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [modal, setModal] = useState<ModalState>({
        open: false,
        mode: "create",
        row: null,
    });
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [saving, setSaving] = useState(false);

    // Debounce search input — 300ms keeps it snappy without filtering on
    // every keystroke. The list is tiny so the actual filter is cheap.
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(handle);
    }, [search]);

    const filteredRows = useMemo(() => {
        const q = debouncedSearch.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (r) =>
                r.name.toLowerCase().includes(q) ||
                (r.description?.toLowerCase().includes(q) ?? false),
        );
    }, [rows, debouncedSearch]);

    const endpointBase = `/api/admin/reference-data/${
        kind === "location" ? "locations" : "education-types"
    }`;

    const openCreate = () => {
        setModal({
            open: true,
            mode: "create",
            row:
                kind === "location"
                    ? { ...EMPTY_LOCATION }
                    : { ...EMPTY_EDUCATION_TYPE },
        });
        setError("");
        setSuccess("");
    };

    const openEdit = (row: Row) => {
        setModal({ open: true, mode: "edit", row: { ...row } });
        setError("");
        setSuccess("");
    };

    const closeModal = () => {
        if (saving) return;
        setModal({ open: false, mode: "create", row: null });
        setError("");
    };

    async function reload() {
        const res = await fetch(endpointBase, { credentials: "same-origin" });
        if (!res.ok) {
            throw new Error(t["common.failedToLoad"] || "Failed to load data");
        }
        const data = (await res.json()) as Row[];
        setRows(data);
    }

    async function handleSave() {
        const current = modal.row;
        if (!current) return;
        const trimmedName = current.name.trim();
        if (!trimmedName) {
            setError(t["validation.nameRequired"] || "Name is required");
            return;
        }
        setSaving(true);
        setError("");
        try {
            const body =
                kind === "location"
                    ? {
                          name: trimmedName,
                          description: current.description || undefined,
                          active: (current as LocationRow).active,
                      }
                    : {
                          name: trimmedName,
                          description: current.description || undefined,
                          validityMonths: (current as EducationTypeRow)
                              .validityMonths,
                          nameSv:
                              (current as EducationTypeRow).nameSv || undefined,
                          nameEn:
                              (current as EducationTypeRow).nameEn || undefined,
                          descriptionSv:
                              (current as EducationTypeRow).descriptionSv ||
                              undefined,
                          descriptionEn:
                              (current as EducationTypeRow).descriptionEn ||
                              undefined,
                      };
            const url =
                modal.mode === "create"
                    ? endpointBase
                    : `${endpointBase}/${current.id}`;
            const method = modal.mode === "create" ? "POST" : "PUT";
            const res = await fetch(url, {
                method,
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => null);
                throw new AppFetchError(
                    errBody?.message || t["common.saveFailed"] || "Save failed",
                );
            }
            await reload();
            setSuccess(
                modal.mode === "create"
                    ? t["common.created"] || "Created"
                    : t["common.updated"] || "Updated",
            );
            setModal({ open: false, mode: "create", row: null });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    function handleDelete(row: Row) {
        const name = row.name;
        const confirmMsg = (
            t["admin.confirmDelete"] || "Delete {name}?"
        ).replace("{name}", name);
        // window.appConfirm is exposed by BaseLayout
        (
            window as unknown as {
                appConfirm: (msg: string, onYes: () => void) => void;
            }
        ).appConfirm(confirmMsg, async () => {
            setError("");
            setSuccess("");
            try {
                const res = await fetch(`${endpointBase}/${row.id}`, {
                    method: "DELETE",
                    credentials: "same-origin",
                });
                if (!res.ok) {
                    const errBody = await res.json().catch(() => null);
                    throw new AppFetchError(
                        errBody?.message ||
                            t["common.deleteFailed"] ||
                            "Delete failed",
                    );
                }
                await reload();
                setSuccess(t["common.deleted"] || "Deleted");
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        });
    }

    const isLocation = kind === "location";
    const current = modal.row;

    return (
        <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-3">
                <div class="relative">
                    <input
                        type="search"
                        placeholder={t["common.search"] || "Search…"}
                        value={search}
                        onInput={(e) =>
                            setSearch((e.target as HTMLInputElement).value)
                        }
                        class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-w-64"
                    />
                </div>
                <button
                    type="button"
                    onClick={openCreate}
                    class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                    +{" "}
                    {isLocation
                        ? t["admin.locations.addButton"] || "Add location"
                        : t["admin.educationTypes.addButton"] ||
                          "Add education type"}
                </button>
            </div>

            {error && (
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    {error}
                </div>
            )}
            {success && (
                <div class="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                    {success}
                </div>
            )}

            <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.table.name"] || "Name"}
                                </th>
                                <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.table.description"] ||
                                        "Description"}
                                </th>
                                {isLocation && (
                                    <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                        {t["admin.table.active"] || "Active"}
                                    </th>
                                )}
                                {!isLocation && (
                                    <th class="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                                        {t["admin.table.validityMonths"] ||
                                            "Validity (months)"}
                                    </th>
                                )}
                                <th class="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                                    {t["admin.table.actions"] || "Actions"}
                                </th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredRows.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={isLocation ? 4 : 4}
                                        class="px-4 py-8 text-center text-gray-400"
                                    >
                                        {t["admin.table.empty"] || "No rows"}
                                    </td>
                                </tr>
                            ) : (
                                filteredRows.map((row) => (
                                    <tr
                                        key={row.id}
                                        class="hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer transition-colors"
                                        onClick={() => openEdit(row)}
                                    >
                                        <td class="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                                            {row.name}
                                        </td>
                                        <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                            {row.description || "-"}
                                        </td>
                                        {isLocation && (
                                            <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                                <span
                                                    class={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                                        (row as LocationRow)
                                                            .active
                                                            ? "text-green-700 dark:text-green-400"
                                                            : "text-gray-400 dark:text-gray-500"
                                                    }`}
                                                >
                                                    <span
                                                        class={`inline-block h-2 w-2 rounded-full ${
                                                            (row as LocationRow)
                                                                .active
                                                                ? "bg-green-500"
                                                                : "bg-gray-300 dark:bg-gray-600"
                                                        }`}
                                                    />
                                                    {(row as LocationRow).active
                                                        ? t[
                                                              "admin.activeYes"
                                                          ] || "Yes"
                                                        : t["admin.activeNo"] ||
                                                          "Hidden"}
                                                </span>
                                            </td>
                                        )}
                                        {!isLocation && (
                                            <td class="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                                                {(row as EducationTypeRow)
                                                    .validityMonths ?? "-"}
                                            </td>
                                        )}
                                        <td
                                            class="px-4 py-2.5 text-right"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleDelete(row)
                                                }
                                                class="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm font-medium"
                                            >
                                                {t["common.delete"] || "Delete"}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <p class="text-xs text-gray-400">
                {(t["admin.rowsShown"] || "{count} rows").replace(
                    "{count}",
                    String(filteredRows.length),
                )}
            </p>

            {modal.open && current && (
                <div
                    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                    onClick={closeModal}
                >
                    <div
                        class="bg-white dark:bg-gray-900 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div class="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
                            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                                {modal.mode === "create"
                                    ? isLocation
                                        ? t[
                                              "admin.locations.modal.createTitle"
                                          ] || "Add location"
                                        : t[
                                              "admin.educationTypes.modal.createTitle"
                                          ] || "Add education type"
                                    : isLocation
                                      ? t["admin.locations.modal.editTitle"] ||
                                        "Edit location"
                                      : t[
                                            "admin.educationTypes.modal.editTitle"
                                        ] || "Edit education type"}
                            </h2>
                            <button
                                type="button"
                                onClick={closeModal}
                                disabled={saving}
                                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 disabled:opacity-50"
                                aria-label="Close"
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
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>

                        <div class="p-6 space-y-4">
                            {error && (
                                <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                                    {error}
                                </div>
                            )}

                            <label class="block text-sm">
                                <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.table.name"] || "Name"}
                                </span>
                                <input
                                    type="text"
                                    value={current.name}
                                    maxLength={100}
                                    onInput={(e) =>
                                        setModal({
                                            ...modal,
                                            row: {
                                                ...current,
                                                name: (
                                                    e.target as HTMLInputElement
                                                ).value,
                                            },
                                        })
                                    }
                                    class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                />
                            </label>

                            <label class="block text-sm">
                                <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    {t["admin.table.description"] ||
                                        "Description"}
                                </span>
                                <textarea
                                    value={current.description ?? ""}
                                    maxLength={500}
                                    rows={3}
                                    onInput={(e) =>
                                        setModal({
                                            ...modal,
                                            row: {
                                                ...current,
                                                description:
                                                    (
                                                        e.target as HTMLTextAreaElement
                                                    ).value || null,
                                            },
                                        })
                                    }
                                    class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                />
                            </label>

                            {/* `active` checkbox for locations: when
                                unchecked, hides the row from the public
                                event-creation picker. Defaults to true on
                                create; PUT only flips when the field is
                                touched so a quick name-edit doesn't
                                accidentally unlist a location. */}
                            {isLocation && (
                                <label class="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={
                                            (current as LocationRow).active
                                        }
                                        onChange={(e) =>
                                            setModal({
                                                ...modal,
                                                row: {
                                                    ...current,
                                                    active: (
                                                        e.target as HTMLInputElement
                                                    ).checked,
                                                } as LocationRow,
                                            })
                                        }
                                        class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
                                    />
                                    <span>
                                        {t["admin.locations.activeLabel"] ||
                                            "Active in picker"}
                                    </span>
                                </label>
                            )}

                            {!isLocation && (
                                <label class="block text-sm">
                                    <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                        {t["admin.table.validityMonths"] ||
                                            "Validity (months)"}
                                    </span>
                                    <div class="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={0}
                                            max={120}
                                            value={
                                                (current as EducationTypeRow)
                                                    .validityMonths ?? ""
                                            }
                                            onInput={(e) => {
                                                const raw = (
                                                    e.target as HTMLInputElement
                                                ).value;
                                                const num =
                                                    raw === ""
                                                        ? null
                                                        : parseInt(raw, 10);
                                                setModal({
                                                    ...modal,
                                                    row: {
                                                        ...current,
                                                        validityMonths:
                                                            num !== null &&
                                                            Number.isNaN(num)
                                                                ? null
                                                                : num,
                                                    } as EducationTypeRow,
                                                });
                                            }}
                                            class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setModal({
                                                    ...modal,
                                                    row: {
                                                        ...current,
                                                        validityMonths: null,
                                                    } as EducationTypeRow,
                                                })
                                            }
                                            class="px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                        >
                                            {t["admin.clear"] || "Clear"}
                                        </button>
                                    </div>
                                    <p class="mt-1 text-xs text-gray-400">
                                        {t["admin.table.validityMonthsHelp"] ||
                                            "0–120, or empty for no expiry"}
                                    </p>
                                </label>
                            )}

                            {!isLocation && (
                                <>
                                    <fieldset class="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-3">
                                        <legend class="text-xs font-medium text-gray-500 dark:text-gray-400 px-1">
                                            Svenska (sv)
                                        </legend>
                                        <label class="block text-sm">
                                            <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                                Namn (sv)
                                            </span>
                                            <input
                                                type="text"
                                                maxLength={100}
                                                value={
                                                    (
                                                        current as EducationTypeRow
                                                    ).nameSv ?? ""
                                                }
                                                onInput={(e) =>
                                                    setModal({
                                                        ...modal,
                                                        row: {
                                                            ...current,
                                                            nameSv:
                                                                (
                                                                    e.target as HTMLInputElement
                                                                ).value || null,
                                                        } as EducationTypeRow,
                                                    })
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                            />
                                        </label>
                                        <label class="block text-sm">
                                            <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                                Beskrivning (sv)
                                            </span>
                                            <textarea
                                                maxLength={500}
                                                rows={2}
                                                value={
                                                    (
                                                        current as EducationTypeRow
                                                    ).descriptionSv ?? ""
                                                }
                                                onInput={(e) =>
                                                    setModal({
                                                        ...modal,
                                                        row: {
                                                            ...current,
                                                            descriptionSv:
                                                                (
                                                                    e.target as HTMLTextAreaElement
                                                                ).value || null,
                                                        } as EducationTypeRow,
                                                    })
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                            />
                                        </label>
                                    </fieldset>

                                    <fieldset class="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-3">
                                        <legend class="text-xs font-medium text-gray-500 dark:text-gray-400 px-1">
                                            English (en)
                                        </legend>
                                        <label class="block text-sm">
                                            <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                                Name (en)
                                            </span>
                                            <input
                                                type="text"
                                                maxLength={100}
                                                value={
                                                    (
                                                        current as EducationTypeRow
                                                    ).nameEn ?? ""
                                                }
                                                onInput={(e) =>
                                                    setModal({
                                                        ...modal,
                                                        row: {
                                                            ...current,
                                                            nameEn:
                                                                (
                                                                    e.target as HTMLInputElement
                                                                ).value || null,
                                                        } as EducationTypeRow,
                                                    })
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                            />
                                        </label>
                                        <label class="block text-sm">
                                            <span class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                                Description (en)
                                            </span>
                                            <textarea
                                                maxLength={500}
                                                rows={2}
                                                value={
                                                    (
                                                        current as EducationTypeRow
                                                    ).descriptionEn ?? ""
                                                }
                                                onInput={(e) =>
                                                    setModal({
                                                        ...modal,
                                                        row: {
                                                            ...current,
                                                            descriptionEn:
                                                                (
                                                                    e.target as HTMLTextAreaElement
                                                                ).value || null,
                                                        } as EducationTypeRow,
                                                    })
                                                }
                                                class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 text-sm"
                                            />
                                        </label>
                                    </fieldset>
                                </>
                            )}
                        </div>

                        <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-6 py-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeModal}
                                disabled={saving}
                                class="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                {t["common.cancel"] || "Cancel"}
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {saving
                                    ? t["common.saving"] || "Saving…"
                                    : t["common.save"] || "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* Local error type so we can throw with a message but keep the calling
 * signature simple. The fetch caller catches instances and reads .message. */
class AppFetchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AppFetchError";
    }
}
