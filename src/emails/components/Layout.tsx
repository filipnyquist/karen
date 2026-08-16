/** @jsxImportSource react */
// Shared email chrome — wraps every template with the same header,
// preview text, container width, and footer. Keeps brand consistent
// across the four transactional emails and centralises the <Tailwind>
// config so each template just writes className.

import {
    Body,
    Container,
    Head,
    Hr,
    Html,
    Preview,
    Tailwind,
    Text,
} from "@react-email/components";

interface LayoutProps {
    preview: string;
    lang: "en" | "sv";
    recipient: string;
    children: React.ReactNode;
}

export function Layout({ preview, lang, recipient, children }: LayoutProps) {
    return (
        <Html lang={lang}>
            <Preview>{preview}</Preview>
            <Tailwind>
                {/* <Head /> must live inside <Tailwind> so the inliner
                    can inject the dark-mode media query it generates
                    for `dark:*` classes — otherwise rendering throws
                    "could not find a <head> element". */}
                <Head />
                <Body className="bg-gray-50 font-sans m-0">
                    <Container className="bg-white max-w-xl mx-auto my-0 p-8 rounded-lg">
                        {children}
                        <Hr className="my-6 border-gray-200" />
                        <Text className="text-xs text-gray-400 m-0">
                            Karen, Blekinge studentkårs pubplattform!· sent to{" "}
                            {recipient}
                        </Text>
                    </Container>
                </Body>
            </Tailwind>
        </Html>
    );
}
