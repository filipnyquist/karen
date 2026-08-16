/// <reference types="astro/client" />
declare namespace App {
    interface Locals {
        lang: string;
        t: (key: string) => string;
        translations: import("./i18n/index").Translation;
        user: import("./api/middleware/auth").AuthUser | null;
    }
}

interface Window {
    appAlert: (message: string) => void;
    appConfirm: (message: string, onConfirm: () => void) => void;
}
