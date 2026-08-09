// src/api/middleware/error.ts
import { Elysia } from "elysia";

export class AppError extends Error {
    constructor(
        message: string,
        public statusCode: number = 400,
        public code: string = "BAD_REQUEST",
    ) {
        super(message);
    }
}

// Registers the AppError type with Elysia.
// Actual onError handling is in src/api/index.ts (must be on the root instance).
export const errorPlugin = new Elysia().error({ AppError });
