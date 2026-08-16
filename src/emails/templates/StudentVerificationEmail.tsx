/** @jsxImportSource react */
// BTH-student / alumni verification link.

import { Heading, Section, Text } from "@react-email/components";
import { EmailButton } from "../components/EmailButton";
import { EmailLinkFallback } from "../components/EmailLinkFallback";
import { Layout } from "../components/Layout";
import type { TFunc } from "../index";

export interface StudentVerificationEmailProps {
    url: string;
    lang: "en" | "sv";
    recipient: string;
    t: TFunc;
}

export function StudentVerificationEmail({
    url,
    lang,
    recipient,
    t,
}: StudentVerificationEmailProps) {
    return (
        <Layout
            preview={t("emails.studentVerification.preview")}
            lang={lang}
            recipient={recipient}
        >
            <Heading className="text-xl font-semibold text-gray-900 m-0 mb-4">
                {t("emails.studentVerification.subject")}
            </Heading>
            <Text className="text-sm text-gray-700 m-0 mb-6">
                {t("emails.studentVerification.intro")}
            </Text>
            <Section className="mb-4">
                <EmailButton href={url}>
                    {t("emails.studentVerification.cta")}
                </EmailButton>
            </Section>
            <Text className="text-xs text-gray-500 m-0 mb-2">
                {t("emails.studentVerification.expiry")}
            </Text>
            <Text className="text-xs text-gray-500 m-0">
                {t("emails.studentVerification.ignore")}
            </Text>
            <EmailLinkFallback url={url} label={t("emails.fallbackCopy")} />
        </Layout>
    );
}
