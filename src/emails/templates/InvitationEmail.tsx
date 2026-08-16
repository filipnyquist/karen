/** @jsxImportSource react */
// Superadmin-issued invitation to join Karen with a chosen role.

import { Heading, Section, Text } from "@react-email/components";
import { EmailButton } from "../components/EmailButton";
import { EmailLinkFallback } from "../components/EmailLinkFallback";
import { Layout } from "../components/Layout";
import type { TFunc } from "../index";

export interface InvitationEmailProps {
    url: string;
    role: string;
    lang: "en" | "sv";
    recipient: string;
    t: TFunc;
}

export function InvitationEmail({
    url,
    role,
    lang,
    recipient,
    t,
}: InvitationEmailProps) {
    return (
        <Layout
            preview={t("emails.invitation.preview")}
            lang={lang}
            recipient={recipient}
        >
            <Heading className="text-xl font-semibold text-gray-900 m-0 mb-4">
                {t("emails.invitation.subject")}
            </Heading>
            <Text className="text-sm text-gray-700 m-0 mb-6">
                {t("emails.invitation.intro").replace("{role}", role)}
            </Text>
            <Section className="mb-4">
                <EmailButton href={url}>
                    {t("emails.invitation.cta")}
                </EmailButton>
            </Section>
            <Text className="text-xs text-gray-500 m-0 mb-2">
                {t("emails.invitation.expiry")}
            </Text>
            <Text className="text-xs text-gray-500 m-0">
                {t("emails.invitation.ignore")}
            </Text>
            <EmailLinkFallback url={url} label={t("emails.fallbackCopy")} />
        </Layout>
    );
}
