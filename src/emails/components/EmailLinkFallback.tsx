/** @jsxImportSource react */
// Plain-URL fallback shown under every transactional email's CTA
// button. Some mail clients (Outlook desktop, sandboxed previews,
// iframe-rendered webmail) strip or render non-clickable buttons
// — users with broken buttons still have a copy-paste path. Renders
// into both the HTML body and the plain-text fallback because it's
// ordinary JSX; @react-email/render's plainText mode preserves the
// <Link> href inline.

import { Link, Section, Text } from "@react-email/components";

export interface EmailLinkFallbackProps {
    url: string;
    label: string;
}

export function EmailLinkFallback({ url, label }: EmailLinkFallbackProps) {
    return (
        <Section className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Text className="text-xs text-gray-500 dark:text-gray-400 mb-2 m-0">
                {label}
            </Text>
            <Link
                href={url}
                className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all underline"
            >
                {url}
            </Link>
        </Section>
    );
}
