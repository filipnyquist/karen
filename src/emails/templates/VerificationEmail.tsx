/** @jsxImportSource react */
// Registration email-verification link.

import { Heading, Section, Text } from "@react-email/components";
import { EmailButton } from "../components/EmailButton";
import { EmailLinkFallback } from "../components/EmailLinkFallback";
import { Layout } from "../components/Layout";
import type { TFunc } from "../index";

export interface VerificationEmailProps {
    url: string;
    lang: "en" | "sv";
    recipient: string;
    t: TFunc;
}

export function VerificationEmail({
    url,
    lang,
    recipient,
    t,
}: VerificationEmailProps) {
    return (
        <Layout
            preview={t("emails.verification.preview")}
            lang={lang}
            recipient={recipient}
        >
            <Heading className="text-xl font-semibold text-gray-900 m-0 mb-4">
                {t("emails.verification.subject")}
            </Heading>
            <Text className="text-sm text-gray-700 m-0 mb-6">
                {t("emails.verification.intro")}
            </Text>
            <Section className="mb-6">
                <EmailButton href={url}>
                    {t("emails.verification.cta")}
                </EmailButton>
            </Section>
            <Text className="text-xs text-gray-500 m-0">
                {t("emails.verification.ignore")}
            </Text>
            <EmailLinkFallback url={url} label={t("emails.fallbackCopy")} />
        </Layout>
    );
}
