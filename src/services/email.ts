// src/services/email.ts
//
// Thin layer over Nodemailer plus four typed wrappers around the React
// Email templates in `../emails`. All HTML/text rendering happens via
// `renderEmail(...)`; this module only owns the SMTP transport and the
// dev-mode stdout fallback (which refuses to log in production).
//
// **All sends are off-thread.** `sendEmail` schedules the SMTP round-trip
// via `setImmediate` so the HTTP response has already been flushed by the
// time the network I/O starts. This removes a latent timing-leak surface
// on every transactional flow (registration, student verify, invitation,
// migration link) — the response time no longer depends on whether (or
// how slowly) SMTP accepts the message. Errors are caught and logged
// with the `[email] send failed` prefix; callers don't see them and
// don't need to handle them.

import * as nodemailer from "nodemailer";
import { config } from "../config";
import {
    InvitationEmail,
    type Lang,
    MigrationLinkEmail,
    PasswordResetEmail,
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

// Exported so tests can construct an EmailOptions without going through
// renderEmail() (which drags in the React Email renderer).
export type { EmailOptions };

function getTransporter() {
    const { host, port, user, pass } = config.smtp;
    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
    });
}

async function sendEmailAsync(options: EmailOptions): Promise<void> {
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

/**
 * Fire-and-forget: schedule the SMTP round-trip on the next event-loop
 * tick and resolve immediately. Errors from `sendEmailAsync` are caught
 * and logged; callers don't see them and don't need to handle them.
 */
export function sendEmail(options: EmailOptions): void {
    setImmediate(() => {
        sendEmailAsync(options).catch((err) => {
            console.error("[email] send failed", {
                to: options.to,
                subject: options.subject,
                err: err instanceof Error ? err.message : String(err),
            });
        });
    });
}

export type { Lang } from "../emails";

/**
 * Wrapper helpers. Each is void-returning (not async) and fire-and-forget:
 * the caller hands it the args and walks away. The async IIFE inside
 * renders the template, dispatches via `sendEmail`, and swallows any
 * errors. Render failures get logged with `[email] ... failed` so an
 * SRE can alert on volume.
 */
export function sendVerificationEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): void {
    void (async () => {
        try {
            const t: TFunc = tFor(args.lang);
            const url = `${args.baseUrl}/api/auth/verify-email?token=${args.token}`;
            const rendered = await renderEmail({
                template: VerificationEmail,
                props: { url, t, lang: args.lang, recipient: args.to },
                key: "verification",
            });
            sendEmail({
                to: args.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });
        } catch (err) {
            console.error("[email] sendVerificationEmail failed", {
                to: args.to,
                err: err instanceof Error ? err.message : String(err),
            });
        }
    })();
}

export function sendStudentVerificationEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): void {
    void (async () => {
        try {
            const t: TFunc = tFor(args.lang);
            const url = `${args.baseUrl}/api/auth/verify-student?token=${args.token}`;
            const rendered = await renderEmail({
                template: StudentVerificationEmail,
                props: { url, t, lang: args.lang, recipient: args.to },
                key: "studentVerification",
            });
            sendEmail({
                to: args.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });
        } catch (err) {
            console.error("[email] sendStudentVerificationEmail failed", {
                to: args.to,
                err: err instanceof Error ? err.message : String(err),
            });
        }
    })();
}

export function sendInvitationEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    role: string;
    lang: Lang;
}): void {
    void (async () => {
        try {
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
            sendEmail({
                to: args.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });
        } catch (err) {
            console.error("[email] sendInvitationEmail failed", {
                to: args.to,
                err: err instanceof Error ? err.message : String(err),
            });
        }
    })();
}

export function sendMigrationLinkEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): void {
    void (async () => {
        try {
            const t: TFunc = tFor(args.lang);
            const url = `${args.baseUrl}/migrate?verify=${args.token}`;
            const rendered = await renderEmail({
                template: MigrationLinkEmail,
                props: { url, t, lang: args.lang, recipient: args.to },
                key: "migration",
            });
            sendEmail({
                to: args.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });
        } catch (err) {
            console.error("[email] sendMigrationLinkEmail failed", {
                to: args.to,
                err: err instanceof Error ? err.message : String(err),
            });
        }
    })();
}

export function sendPasswordResetEmail(args: {
    to: string;
    baseUrl: string;
    token: string;
    lang: Lang;
}): void {
    void (async () => {
        try {
            const t: TFunc = tFor(args.lang);
            const url = `${args.baseUrl}/reset-password?token=${args.token}`;
            const rendered = await renderEmail({
                template: PasswordResetEmail,
                props: { url, t, lang: args.lang, recipient: args.to },
                key: "passwordReset",
            });
            sendEmail({
                to: args.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });
        } catch (err) {
            console.error("[email] sendPasswordResetEmail failed", {
                to: args.to,
                err: err instanceof Error ? err.message : String(err),
            });
        }
    })();
}
