// src/i18n/index.ts
import en from "./en";
import sv from "./sv";

export type Translation = typeof en;

const translations: Record<string, Translation> = { en, sv };

function getNestedValue(obj: Record<string, unknown>, path: string): string {
    const keys = path.split(".");
    let current: unknown = obj;
    for (const key of keys) {
        if (current && typeof current === "object" && key in current) {
            current = (current as Record<string, unknown>)[key];
        } else {
            return path;
        }
    }
    return typeof current === "string" ? current : path;
}

export function getTranslations(lang: string): Translation {
    return translations[lang] ?? translations.sv ?? sv;
}

export function t(lang: string): (key: string) => string {
    const translation = getTranslations(lang);
    return (key: string) =>
        getNestedValue(translation as unknown as Record<string, unknown>, key);
}

export function detectLanguage(request: Request): string {
    const cookie = request.headers.get("cookie") ?? "";
    const match = cookie.match(/lang=(en|sv)/);
    return match ? match[1] : "sv";
}

// Flatten translations for passing to Preact islands as a simple Record<string, string>
export function flattenTranslations(
    obj: Record<string, unknown>,
    prefix = "",
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string") {
            result[fullKey] = value;
        } else if (typeof value === "object" && value !== null) {
            Object.assign(
                result,
                flattenTranslations(value as Record<string, unknown>, fullKey),
            );
        }
    }
    return result;
}
