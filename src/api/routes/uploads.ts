// src/api/routes/uploads.ts

import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../../db";
import { users } from "../../db/schema";
import { MAX_FILE_SIZE, processAndStoreImage } from "../../lib/uploads";
import { authDerive } from "../middleware/auth";
import { AppError } from "../middleware/error";

export const uploadRoutes = new Elysia({ prefix: "/uploads" })
    .derive(authDerive)
    .post(
        "/profile-pic",
        async ({ body, user }) => {
            const file = body.file;

            if (!file.type.startsWith("image/")) {
                throw new AppError(
                    "Only image files are allowed",
                    400,
                    "INVALID_FILE_TYPE",
                );
            }

            // Filename: {userId}-{ts}.webp (always webp after resize/encode).
            const filenameBase = `${user.id}-${Date.now()}`;

            try {
                const { publicUrl } = await processAndStoreImage(
                    file,
                    filenameBase,
                    { maxWidth: 256, maxHeight: 256 },
                );

                await db
                    .update(users)
                    .set({ profilePic: publicUrl, updatedAt: new Date() })
                    .where(eq(users.id, user.id));

                return { url: publicUrl };
            } catch (err: unknown) {
                if (
                    err instanceof Error &&
                    err.message.startsWith("INVALID_IMAGE")
                ) {
                    throw new AppError(
                        "Could not process image — is it a valid image file?",
                        400,
                        "INVALID_IMAGE",
                    );
                }
                throw err;
            }
        },
        {
            body: t.Object({
                file: t.File({ type: "image/*", maxSize: MAX_FILE_SIZE }),
            }),
        },
    );
