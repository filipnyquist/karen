/** @jsxImportSource react */
// Branded CTA button. Matches the in-app blue (#2563eb / bg-blue-600)
// used by the rest of the UI. Wraps @react-email/components' <Button>
// so every email links out with the same visual weight.

import { Button } from "@react-email/components";

interface EmailButtonProps {
    href: string;
    children: React.ReactNode;
}

export function EmailButton({ href, children }: EmailButtonProps) {
    return (
        <Button
            href={href}
            className="bg-blue-600 text-white text-sm font-semibold px-5 py-3 rounded-md no-underline"
        >
            {children}
        </Button>
    );
}
