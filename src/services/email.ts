// src/services/email.ts
//
// Thin layer over Nodemailer plus four typed wrappers around the React
// Email templates in `../emails/`. All HTML/text rendering happens via
// `renderEmail(...)`; this module only owns the SMTP transport and the
// dev-mode stdout fallback (which refuses to log in production).

import * as nodemailer from "nodemailer";
import { config } from "../config";
import {
    InvitationEmail,
    type Lang,
    MigrationLinkEmail,
    renderEmail,
    StudentVerificationEmail,
    type TFunc,
    VerificationEmail,
} from "../emails";
import { t as tFor } from "../i18n";

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text: string;
}

function getTransporter() {
    const { host, port, user, pass } = config.smtp;
    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
    });
}

export async function sendEmail(options: EmailOptions): Promise<void> {
    if (!config.smtp.host) {
        // In development we log the rendered email so a developer can
        // copy the link out of the terminal. In production we refuse to
        // dump invite tokens and PII to stdout — the operator must
        // configure SMTP_HOST or the relevant call will throw.
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "sendEmail called with no SMTP_HOST configured — refusing to log email body to stdout in production. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM in the environment.",
            );
        }
        console.log("─── EMAIL (no SMTP configured) ───");
        console.log(`To: ${options.to}`);
        console.log(`Subject: ${options.subject}`);
        console.log("--- HTML ---");
        console.log(options.html);
        console.log("--- TEXT ---");
        console.log(options.text);
        console.log("───────────────────────────────────");
        return;
    }

    const transporter = getTransporter();
    await transporter.sendMail({
        from: config.smtp.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
    });
}

interface Rendered {
    subject: string;
    html: string;
    text: string;
}

async function renderAndSend(to: string, rendered: Rendered): Promise<void> {
    await sendEmail({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
    });
}

export type { Lang } from "../emails";

export async function sendVerificationEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): Promise<void> {
    const t: TFunc = tFor(args.lang);
    const url = `${args.baseUrl}/api/auth/verify-email?token=${args.token}`;
    const rendered = await renderEmail({
        template: VerificationEmail,
        props: { url, t, lang: args.lang, recipient: args.to },
        key: "verification",
    });
    await renderAndSend(args.to, rendered);
}

export async function sendStudentVerificationEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): Promise<void> {
    const t: TFunc = tFor(args.lang);
    const url = `${args.baseUrl}/api/auth/verify-student?token=${args.token}`;
    const rendered = await renderEmail({
        template: StudentVerificationEmail,
        props: { url, t, lang: args.lang, recipient: args.to },
        key: "studentVerification",
    });
    await renderAndSend(args.to, rendered);
}

export async function sendInvitationEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    role: string;
    lang: Lang;
}): Promise<void> {
    const t: TFunc = tFor(args.lang);
    const url = `${args.baseUrl}/accept-invite?token=${args.token}`;
    const rendered = await renderEmail({
        template: InvitationEmail,
        props: {
            url,
            role: args.role,
            t,
            lang: args.lang,
            recipient: args.to,
        },
        key: "invitation",
    });
    await renderAndSend(args.to, rendered);
}

export async function sendMigrationLinkEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): Promise<void> {
    const t: TFunc = tFor(args.lang);
    const url = `${args.baseUrl}/migrate?verify=${args.token}`;
    const rendered = await renderEmail({
        template: MigrationLinkEmail,
        props: { url, t, lang: args.lang, recipient: args.to },
        key: "migration",
    });
    await renderAndSend(args.to, rendered);
}
