/** @jsxImportSource react */
// Self-service password reset link. Sent when a user requests a
// forgot-password reset; the link is the proof of inbox ownership
// that the consume endpoint will require.

import { Heading, Section, Text } from "@react-email/components";
import { EmailButton } from "../components/EmailButton";
import { EmailLinkFallback } from "../components/EmailLinkFallback";
import { Layout } from "../components/Layout";
import type { TFunc } from "../index";

export interface PasswordResetEmailProps {
    url: string;
    lang: "en" | "sv";
    recipient: string;
    t: TFunc;
}

export function PasswordResetEmail({
    url,
    lang,
    recipient,
    t,
}: PasswordResetEmailProps) {
    return (
        <Layout
            preview={t("emails.passwordReset.preview")}
            lang={lang}
            recipient={recipient}
        >
            <Heading className="text-xl font-semibold text-gray-900 m-0 mb-4">
                {t("emails.passwordReset.subject")}
            </Heading>
            <Text className="text-sm text-gray-700 m-0 mb-6">
                {t("emails.passwordReset.intro")}
            </Text>
            <Section className="mb-4">
                <EmailButton href={url}>
                    {t("emails.passwordReset.cta")}
                </EmailButton>
            </Section>
            <Text className="text-xs text-gray-500 m-0 mb-2">
                {t("emails.passwordReset.expiry")}
            </Text>
            <Text className="text-xs text-gray-500 m-0">
                {t("emails.passwordReset.ignore")}
            </Text>
            <EmailLinkFallback url={url} label={t("emails.fallbackCopy")} />
        </Layout>
    );
}
