// Pause / unpause a specific sender. The pickSender() query in lib/sender-pool.ts
// filters by state='active' so this immediately removes the sender from rotation.
// syncSendersFromEnv() uses ON CONFLICT DO NOTHING — existing rows are never
// overwritten on redeploy, so paused state is durable.
//
// Usage:
//   npx tsx scripts/sender-state.mjs <email> pause [reason]
//   npx tsx scripts/sender-state.mjs <email> active
//   npx tsx scripts/sender-state.mjs --list

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const arg1 = process.argv[2];
const arg2 = process.argv[3];
const reason = process.argv.slice(4).join(" ") || null;

if (arg1 === "--list" || !arg1) {
  const rows = await sql`
    SELECT id, email, state, daily_limit, sent_total, paused_reason,
      TO_CHAR(last_used_at, 'YYYY-MM-DD HH24:MI') AS last_used
    FROM senders
    ORDER BY id
  `;
  console.table(rows);
  process.exit(0);
}

const email = arg1.trim().toLowerCase();
const state = arg2;

if (!state || !["active", "paused", "burned"].includes(state)) {
  console.error("Usage: sender-state.mjs <email> <active|paused|burned> [reason]");
  process.exit(1);
}

const updated = await sql`
  UPDATE senders
  SET state = ${state}, paused_reason = ${reason}, updated_at = NOW()
  WHERE email = ${email}
  RETURNING email, state, paused_reason
`;

if (updated.length === 0) {
  console.error(`No sender found with email=${email}`);
  process.exit(1);
}

console.log(`✓ ${updated[0].email} → state='${updated[0].state}' reason='${updated[0].paused_reason ?? "-"}'`);
