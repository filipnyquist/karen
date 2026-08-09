// src/services/email.ts
import * as nodemailer from "nodemailer";
import { config } from "../config";

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
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
        console.log(options.html);
        console.log("─────────────────────────────────");
        return;
    }

    const transporter = getTransporter();
    await transporter.sendMail({
        from: config.smtp.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
    });
}

export function verificationEmail(
    baseUrl: string,
    token: string,
): { subject: string; html: string } {
    const link = `${baseUrl}/api/auth/verify-email?token=${token}`;
    return {
        subject: "Verify your Karen account",
        html: `<p>Click <a href="${link}">here</a> to verify your email address.</p><p>If you didn't create an account, ignore this email.</p>`,
    };
}

export function pinEmail(pin: string): { subject: string; html: string } {
    return {
        subject: "Your Karen verification code",
        html: `<p>Your verification code is: <strong>${pin}</strong></p><p>This code expires in 15 minutes.</p>`,
    };
}

export function migrationLinkEmail(
    baseUrl: string,
    token: string,
): { subject: string; html: string } {
    const link = `${baseUrl}/migrate?verify=${token}`;
    return {
        subject: "Claim your Karen account",
        html: `<p>Click <a href="${link}">here</a> to claim your old account and transfer your data.</p><p>If you didn't request this, ignore this email.</p>`,
    };
}

export function studentVerificationEmail(
    baseUrl: string,
    token: string,
): { subject: string; html: string } {
    const link = `${baseUrl}/api/auth/verify-student?token=${token}`;
    return {
        subject: "Verify your student status",
        html: `<p>Click <a href="${link}">here</a> to verify your student/alumni status on Karen.</p><p>This link expires in 24 hours. If you didn't request this, ignore this email.</p>`,
    };
}

export function invitationEmail(
    baseUrl: string,
    token: string,
    role: string,
): { subject: string; html: string } {
    const link = `${baseUrl}/accept-invite?token=${token}`;
    return {
        subject: "You're invited to Karen",
        html: `<p>You've been invited to join Karen with the <strong>${role}</strong> role.</p><p>Click <a href="${link}">here</a> to set your password and activate your account.</p><p>This link expires in 7 days. If you weren't expecting this, ignore the email.</p>`,
    };
}
