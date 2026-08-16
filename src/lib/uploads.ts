// src/lib/uploads.ts
//
// Shared helpers for image uploads. Both profile pictures and team
// pictures flow through `processAndStoreImage` which:
//   1. Validates the upload is a real image (imgkit decodes it).
//   2. Resizes to a configured bounding box (cover-cropped by default).
//   3. Always re-encodes to WebP at quality 85.
//   4. Writes the file with mode 0644 so it's readable cross-user.
//
// imgkit works on both Bun and Node, so this code is fine under Astro's
// dev/prod (Node) and src/server.ts (Bun).

import { chmodSync, mkdirSync } from "node:fs";
import { transform } from "imgkit";

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const WEBP_QUALITY = 85;

// Ensure the upload dir exists once on module import. Subsequent calls
// are no-ops.
try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
} catch {
    // Permission denied or read-only filesystem — let per-file writes
    // surface the actual error.
}

export interface ResizeOptions {
    /** Target width in pixels (the image is constrained by width OR height, whichever is hit first). */
    maxWidth: number;
    /** Target height in pixels. */
    maxHeight: number;
    /**
     * imgkit fit modes. Default `"cover"` crops to fill the box (matches
     * CSS `background-size: cover`). Use `"contain"` to letterbox/pillarbox
     * (CSS `contain`).
     */
    fit?: "cover" | "contain";
}

export interface StoredImage {
    /** Absolute path on disk. */
    path: string;
    /** Public URL (e.g. `/uploads/foo.webp`). */
    publicUrl: string;
    /** Size of the written file in bytes. */
    bytes: number;
}

/**
 * Decode + resize + re-encode to WebP + write to disk.
 *
 * Throws an Error with message starting `"INVALID_IMAGE"` if the file
 * cannot be decoded (e.g. it's not actually an image, or the runtime
 * is too old to support `imgkit`).
 */
export async function processAndStoreImage(
    file: File,
    outputFilenameNoExt: string,
    opts: ResizeOptions,
): Promise<StoredImage> {
    const bytes = new Uint8Array(await file.arrayBuffer());

    let out: Uint8Array;
    try {
        // imgkit's transform pipeline: resize then encode as WebP in one
        // call. `width`/`height` are the target dimensions; the image is
        // cover-cropped to fit (crop centered) or contained depending
        // on the fit mode. Default is cover to match our previous
        // behaviour.
        const transformed = await transform(Buffer.from(bytes), {
            resize: {
                width: opts.maxWidth,
                height: opts.maxHeight,
                fit: opts.fit ?? "cover",
            },
            output: {
                format: "webp",
                webp: { quality: WEBP_QUALITY },
            },
        });
        out =
            transformed instanceof Uint8Array
                ? transformed
                : new Uint8Array(transformed);
    } catch {
        throw new Error("INVALID_IMAGE: could not decode or process upload");
    }

    const filename = `${outputFilenameNoExt}.webp`;
    const path = `${UPLOAD_DIR}/${filename}`;

    await Bun.write(path, out);

    // Defend against a tight umask — the file is served by a different
    // process (the e2e docker container runs seed as root, the host test
    // runner is non-root).
    try {
        chmodSync(path, 0o644);
    } catch {
        // best-effort
    }

    return {
        path,
        publicUrl: `/uploads/${filename}`,
        bytes: out.byteLength,
    };
}

/**
 * Resolve a previously-stored filename to its MIME type for static serving.
 * Returns `application/octet-stream` as a safe fallback.
 */
export function mimeForFilename(filename: string): string {
    const dot = filename.lastIndexOf(".");
    if (dot < 0) return "application/octet-stream";
    const ext = filename.slice(dot + 1).toLowerCase();
    switch (ext) {
        case "webp":
            return "image/webp";
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}
