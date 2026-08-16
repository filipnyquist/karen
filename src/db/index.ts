// src/db/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

const client = postgres(config.databaseUrl, {
    ssl: config.databaseSsl ? "require" : false,
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
});

export const db = drizzle(client, { schema });
