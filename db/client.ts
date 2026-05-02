// Load .env.local when running outside Next.js (scripts, drizzle-kit).
// Inside Next.js this is a no-op since env is already loaded.
if (!process.env.DATABASE_URL && typeof window === "undefined") {
  // dynamic require to avoid bundling dotenv into Next.js client/server runtimes
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = await import("dotenv");
    dotenv.config({ path: ".env.local" });
  } catch {
    // dotenv not installed in production runtime — that's fine, env is set by Vercel
  }
}

import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Cache the SQL function in development to survive HMR.
declare global {
  // eslint-disable-next-line no-var
  var __dbSql: ReturnType<typeof neon> | undefined;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Use connection pooling on Neon (the URL we have is the -pooler endpoint).
neonConfig.fetchConnectionCache = true;

const sql = global.__dbSql ?? neon(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "production") global.__dbSql = sql;

export const db = drizzle(sql, { schema });

export { schema };
