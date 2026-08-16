// src/islands/QRScanner.tsx

import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useRef, useState } from "preact/hooks";

interface QRScannerProps {
    eventId: string;
    t?: Record<string, string>;
}

interface ScannedTicket {
    ticketId: string;
    token: string;
    user: {
        id: string;
        name: string;
        nickname: string | null;
        profilePic: string | null;
    };
}

type Step = "scanning" | "confirm" | "success" | "error";

/** Map a camera/DOMException name to a user-actionable translation key. */
function describeCameraError(err: unknown, t: Record<string, string>): string {
    const name =
        err && typeof err === "object" && "name" in err
            ? String((err as { name: string }).name)
            : "";
    if (
        name === "NotAllowedError" ||
        name === "SecurityError" ||
        name === "PermissionDeniedError"
    ) {
        return (
            t["ticket.cameraPermissionDenied"] ||
            "Camera access was blocked. Open your browser settings to allow it."
        );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return t["ticket.noCamera"] || "No camera found on this device.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
        return "The camera is in use by another application.";
    }
    return err instanceof Error ? err.message : String(err);
}

export default function QRScanner({ eventId, t = {} }: QRScannerProps) {
    const [step, setStep] = useState<Step>("scanning");
    const [ticketData, setTicketData] = useState<ScannedTicket | null>(null);
    const [errorMessage, setErrorMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [scanStats, setScanStats] = useState({
        scanned: 0,
        redeemed: 0,
        errors: 0,
    });
    const scannerRef = useRef<HTMLDivElement>(null);
    const stepRef = useRef<Step>(step);
    const processingRef = useRef(false);

    // Lazily create the Html5Qrcode instance ONCE and keep it alive across
    // step transitions. The library doesn't reliably re-attach a fresh
    // instance to a DOM element that's been used before — better to
    // start/stop the same instance in place.
    const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

    // ensureScanner is a closure defined inside this effect; the
    // outside-scoped meaningful deps are `step` and `t`.
    // biome-ignore lint/correctness/useExhaustiveDependencies: closures are local
    useEffect(() => {
        let cancelled = false;

        async function ensureScanner() {
            if (html5QrCodeRef.current || !scannerRef.current) return;

            if (cancelled || !scannerRef.current) return;
            html5QrCodeRef.current = new Html5Qrcode(scannerRef.current.id);
        }

        async function startScanner() {
            await ensureScanner();
            if (cancelled || !html5QrCodeRef.current) return;

            const viewportWidth = Math.max(
                typeof window !== "undefined" ? window.innerWidth : 360,
                320,
            );
            const qrboxSize = Math.min(viewportWidth - 32, 320);

            try {
                await html5QrCodeRef.current.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: { width: qrboxSize, height: qrboxSize } },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    async (decodedText: string) => {
                        if (
                            stepRef.current !== "scanning" ||
                            processingRef.current
                        )
                            return;
                        processingRef.current = true;
                        try {
                            await html5QrCodeRef.current?.stop();
                        } catch {
                            /* already stopped */
                        }
                        try {
                            navigator.vibrate?.(50);
                        } catch {
                            /* vibrate not available */
                        }
                        await handleScan(decodedText);
                        processingRef.current = false;
                    },
                    () => {
                        /* ignore per-frame scan failures */
                    },
                );
            } catch (err: unknown) {
                if (!cancelled) {
                    setErrorMessage(describeCameraError(err, t));
                    setStep("error");
                }
            }
        }

        if (step === "scanning") {
            startScanner();
        } else if (html5QrCodeRef.current) {
            // Stop the camera when leaving the scanning step but keep
            // the instance alive so the next "Scan Next" can restart
            // it on the same DOM element.
            html5QrCodeRef.current.stop().catch(() => {});
        }

        return () => {
            cancelled = true;
        };
    }, [step, t]);

    async function handleScan(scannedToken: string) {
        setLoading(true);
        try {
            const res = await fetch("/api/tickets/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: scannedToken, eventId }),
            });
            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(
                    data.error ?? t["ticket.scanFailed"] ?? "Scan failed",
                );
                setScanStats((s) => ({ ...s, errors: s.errors + 1 }));
                setStep("error");
                return;
            }

            // The /scan endpoint deliberately does NOT echo the token back
            // (the security audit closed that leak). But we still need
            // *this* scanner to know which token it's about to confirm.
            // The scanner just read it from the QR, so hold onto the
            // raw value locally for the confirm step.
            setTicketData({ ...data, token: scannedToken });
            setScanStats((s) => ({ ...s, scanned: s.scanned + 1 }));
            setStep("confirm");
        } catch {
            setErrorMessage(t["ticket.networkError"] ?? "Network error");
            setScanStats((s) => ({ ...s, errors: s.errors + 1 }));
            setStep("error");
        } finally {
            setLoading(false);
        }
    }

    async function handleConfirm() {
        if (!ticketData) return;
        setLoading(true);
        try {
            const res = await fetch("/api/tickets/redeem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: ticketData.token,
                    eventId,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(
                    data.error ??
                        t["ticket.redeemFailed"] ??
                        "Redemption failed",
                );
                setScanStats((s) => ({ ...s, errors: s.errors + 1 }));
                setStep("error");
                return;
            }

            setScanStats((s) => ({ ...s, redeemed: s.redeemed + 1 }));
            setStep("success");
        } catch {
            setErrorMessage(t["ticket.networkError"] ?? "Network error");
            setScanStats((s) => ({ ...s, errors: s.errors + 1 }));
            setStep("error");
        } finally {
            setLoading(false);
        }
    }

    function handleScanNext() {
        setTicketData(null);
        setErrorMessage("");
        processingRef.current = false;
        setStep("scanning");
    }

    return (
        <div class="max-w-md mx-auto">
            {/* Session stats */}
            <div class="flex gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4 justify-center">
                <span>
                    {t["ticket.scanned"] || "Scanned"}:{" "}
                    <span class="font-medium text-gray-900 dark:text-white">
                        {scanStats.scanned}
                    </span>
                </span>
                <span>
                    {t["ticket.redeemedStats"] || "Redeemed"}:{" "}
                    <span class="font-medium text-green-600 dark:text-green-400">
                        {scanStats.redeemed}
                    </span>
                </span>
                {scanStats.errors > 0 && (
                    <span>
                        {t["ticket.errors"] || "Errors"}:{" "}
                        <span class="font-medium text-red-600 dark:text-red-400">
                            {scanStats.errors}
                        </span>
                    </span>
                )}
            </div>

            {/* Scanning state */}
            {step === "scanning" && (
                <div class="space-y-4">
                    <h2 class="text-xl font-bold text-center">
                        {t["ticket.scanTitle"] || "Scan QR Code"}
                    </h2>
                    <div
                        id="qr-scanner"
                        ref={scannerRef}
                        class="w-full rounded-lg overflow-hidden bg-gray-900"
                        style={{ minHeight: "300px" }}
                    />
                    {loading && (
                        <p class="text-center text-gray-500 animate-pulse">
                            {t["ticket.processingScan"] || "Processing scan…"}
                        </p>
                    )}
                </div>
            )}

            {/* Confirm state */}
            {step === "confirm" && ticketData && (
                <div class="space-y-4 p-6 bg-white dark:bg-gray-900 rounded-lg shadow-md border border-gray-200 dark:border-gray-800">
                    <h2 class="text-xl font-bold text-center">
                        {t["ticket.confirmTitle"] || "Confirm Ticket"}
                    </h2>
                    <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        {ticketData.user.profilePic ? (
                            <img
                                src={ticketData.user.profilePic}
                                alt={ticketData.user.name}
                                class="w-16 h-16 rounded-full object-cover"
                            />
                        ) : (
                            <div class="w-16 h-16 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-2xl font-bold">
                                {ticketData.user.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div>
                            <p class="font-semibold text-lg text-gray-900 dark:text-white">
                                {ticketData.user.name}
                            </p>
                            {ticketData.user.nickname && (
                                <p class="text-gray-500 dark:text-gray-400">
                                    @{ticketData.user.nickname}
                                </p>
                            )}
                        </div>
                    </div>
                    <div class="flex gap-3">
                        <button
                            type="button"
                            onClick={handleScanNext}
                            class="flex-1 py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            disabled={loading}
                        >
                            {t["ticket.cancel"] || "Cancel"}
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            class="flex-1 py-2 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                            disabled={loading}
                        >
                            {loading
                                ? t["ticket.confirming"] || "Confirming…"
                                : t["ticket.confirmEntry"] || "Confirm Entry"}
                        </button>
                    </div>
                </div>
            )}

            {/* Success state */}
            {step === "success" && (
                <div class="text-center space-y-4 p-8">
                    <div class="w-24 h-24 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                        <svg
                            class="w-16 h-16 text-green-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                            />
                        </svg>
                    </div>
                    <h2 class="text-2xl font-bold text-green-700 dark:text-green-400">
                        {t["ticket.successTitle"] || "Ticket Redeemed!"}
                    </h2>
                    {ticketData && (
                        <p class="text-gray-600 dark:text-gray-400">
                            {ticketData.user.name}
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={handleScanNext}
                        class="mt-4 py-2 px-6 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                    >
                        {t["ticket.scanNext"] || "Scan Next"}
                    </button>
                </div>
            )}

            {/* Error state */}
            {step === "error" && (
                <div class="text-center space-y-4 p-8">
                    <div class="w-24 h-24 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <svg
                            class="w-16 h-16 text-red-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </div>
                    <h2 class="text-2xl font-bold text-red-700 dark:text-red-400">
                        {t["ticket.errorTitle"] || "Error"}
                    </h2>
                    <p class="text-gray-600 dark:text-gray-400">
                        {errorMessage}
                    </p>
                    <button
                        type="button"
                        onClick={handleScanNext}
                        class="mt-4 py-2 px-6 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                    >
                        {t["ticket.tryAgain"] || "Try Again"}
                    </button>
                </div>
            )}
        </div>
    );
}
