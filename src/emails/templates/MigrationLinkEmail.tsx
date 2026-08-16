/** @jsxImportSource react */
// Legacy-account claim link for the migration flow.

import { Heading, Section, Text } from "@react-email/components";
import { EmailButton } from "../components/EmailButton";
import { EmailLinkFallback } from "../components/EmailLinkFallback";
import { Layout } from "../components/Layout";
import type { TFunc } from "../index";

export interface MigrationLinkEmailProps {
    url: string;
    lang: "en" | "sv";
    recipient: string;
    t: TFunc;
}

export function MigrationLinkEmail({
    url,
    lang,
    recipient,
    t,
}: MigrationLinkEmailProps) {
    return (
        <Layout
            preview={t("emails.migration.preview")}
            lang={lang}
            recipient={recipient}
        >
            <Heading className="text-xl font-semibold text-gray-900 m-0 mb-4">
                {t("emails.migration.subject")}
            </Heading>
            <Text className="text-sm text-gray-700 m-0 mb-6">
                {t("emails.migration.intro")}
            </Text>
            <Section className="mb-6">
                <EmailButton href={url}>
                    {t("emails.migration.cta")}
                </EmailButton>
            </Section>
            <Text className="text-xs text-gray-500 m-0">
                {t("emails.migration.ignore")}
            </Text>
            <EmailLinkFallback url={url} label={t("emails.fallbackCopy")} />
        </Layout>
    );
}
