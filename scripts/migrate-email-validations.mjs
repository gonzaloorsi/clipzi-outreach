// One-off migration: create email_validations table for Bouncer cache.
// Idempotent — safe to re-run.
//
// Usage: npx tsx scripts/migrate-email-validations.mjs

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Creating email_validations table (if not exists)…");
await sql`
  CREATE TABLE IF NOT EXISTS email_validations (
    email TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    reason TEXT,
    score INTEGER,
    raw JSONB,
    verified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  )
`;

console.log("Creating indexes (if not exist)…");
await sql`CREATE INDEX IF NOT EXISTS email_validations_status_idx ON email_validations (status)`;
await sql`CREATE INDEX IF NOT EXISTS email_validations_verified_at_idx ON email_validations (verified_at)`;

const count = await sql`SELECT COUNT(*)::int AS cnt FROM email_validations`;
console.log(`✓ Done. Current rows: ${count[0].cnt}`);
