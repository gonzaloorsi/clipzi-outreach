// Run Bouncer against the most-recently-sent emails to see how many would
// have been flagged (and skipped) by the new validation pipeline.
//
// Usage: npx tsx scripts/audit-recent-sends-bouncer.mjs [limit=50]
// Cost: ~$0.004 per email × N (capped by cache hits if any duplicates).

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { verifyEmail, isSafeToSend } from "../lib/bouncer.ts";

const limit = Number(process.argv[2] ?? "50");
const sql = neon(process.env.DATABASE_URL);

console.log(`Pulling last ${limit} sent emails…`);
const rows = await sql`
  SELECT s.email, s.sent_at, c.title AS channel, c.country
  FROM sends s
  LEFT JOIN channels c ON c.id = s.channel_id
  WHERE s.status = 'sent'
  ORDER BY s.sent_at DESC
  LIMIT ${limit}
`;
console.log(`Got ${rows.length} sends. Validating via Bouncer (concurrency 1, ~1.2s each = ~${(rows.length * 1.2).toFixed(0)}s)…\n`);

const counts = { deliverable: 0, risky: 0, undeliverable: 0, unknown: 0 };
const wouldSend = { yes: 0, no: 0 };
const flags = { disposable: 0, fullMailbox: 0, role: 0, free: 0 };
const breakdown = [];

for (const row of rows) {
  const r = await verifyEmail(row.email);
  counts[r.status] = (counts[r.status] || 0) + 1;
  if (isSafeToSend(r)) wouldSend.yes++; else wouldSend.no++;
  if (r.disposable) flags.disposable++;
  if (r.fullMailbox) flags.fullMailbox++;
  if (r.roleBased) flags.role++;
  if (r.freeProvider) flags.free++;
  breakdown.push({
    email: row.email,
    status: r.status,
    reason: r.reason ?? "-",
    score: r.score ?? "-",
    safe: isSafeToSend(r) ? "✓" : "✗",
    flags: [
      r.disposable ? "disp" : null,
      r.fullMailbox ? "full" : null,
      r.roleBased ? "role" : null,
      r.freeProvider ? "free" : null,
    ].filter(Boolean).join(",") || "-",
    cache: r.fromCache ? "C" : "-",
  });
  if (breakdown.length % 10 === 0) {
    process.stdout.write(`  ${breakdown.length}/${rows.length}…\n`);
  }
}

console.log("\n=== Per-email verdicts ===");
console.table(breakdown);

console.log("\n=== Status counts ===");
console.table(counts);

console.log("\n=== Would Bouncer have let it through? ===");
console.table(wouldSend);

console.log("\n=== Flags (any kind) ===");
console.table(flags);

const skipPct = ((wouldSend.no / rows.length) * 100).toFixed(1);
console.log(`\nIf Bouncer had been active when these were sent, ${wouldSend.no} of ${rows.length} (${skipPct}%) would have been demoted to low_quality and never sent.`);
