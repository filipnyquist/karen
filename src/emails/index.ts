/** @jsxImportSource react */
// Shared render helper for the four transactional emails.
//
// Each template accepts (template-specific props, lang, recipient, t)
// and exports a React component. renderEmail() resolves the subject
// from the same i18n tree the rest of the app uses, then renders both
// the HTML and a plain-text fallback via @react-email/render.

import { render } from "@react-email/render";
import { type ComponentType, createElement } from "react";
import { InvitationEmail } from "./templates/InvitationEmail";
import { MigrationLinkEmail } from "./templates/MigrationLinkEmail";
import { StudentVerificationEmail } from "./templates/StudentVerificationEmail";
import { VerificationEmail } from "./templates/VerificationEmail";

export type TFunc = (key: string) => string;

export type Lang = "en" | "sv";

export type EmailKey =
    | "verification"
    | "studentVerification"
    | "invitation"
    | "migration";

export interface BaseEmailProps {
    lang: Lang;
    recipient: string;
    t: TFunc;
}

interface RenderEmailArgs<P extends BaseEmailProps> {
    template: ComponentType<P>;
    props: Omit<P, keyof BaseEmailProps> & BaseEmailProps;
    key: EmailKey;
}

export async function renderEmail<P extends BaseEmailProps>(
    args: RenderEmailArgs<P>,
): Promise<{ subject: string; html: string; text: string }> {
    const subject = args.props.t(`emails.${args.key}.subject`);
    // JSX disallows member-expression element tags (`<args.template>`),
    // so construct the element via React.createElement — the runtime
    // output is identical to a JSX `<template {...props} />`.
    const element = createElement(args.template, args.props as P);
    const html = await render(element);
    const text = await render(element, { plainText: true });
    return { subject, html, text };
}

export {
    InvitationEmail,
    MigrationLinkEmail,
    StudentVerificationEmail,
    VerificationEmail,
};
