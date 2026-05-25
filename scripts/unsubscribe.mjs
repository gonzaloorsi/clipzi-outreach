// Suppress one or more contacts so the send pipeline never emails them again.
//
// Usage:
//   node scripts/unsubscribe.mjs <email-or-domain> [more...] [--reason="..."]
//
// For each arg:
//   - contains "@"  → treated as an exact email to suppress
//   - otherwise     → treated as a domain; every channel whose primary_email
//                     ends with @<domain> is suppressed too
//
// It also pulls in the primary_email of any channel matching an arg's domain,
// so if a person replies "unsubscribe" from dan@acme.com but we actually
// emailed info@acme.com, BOTH get suppressed.
//
// Effects (idempotent):
//   1. INSERT into unsubscribes (ON CONFLICT DO NOTHING) — this is what the
//      send candidate query checks (primary_email NOT IN unsubscribes).
//   2. UPDATE matching channels SET status='opted_out'.
//
// Reversible: delete the rows from unsubscribes and re-enrich to undo.

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set in .env.local");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const reasonFlag = process.argv.find((a) => a.startsWith("--reason="));
const reason = reasonFlag?.split("=").slice(1).join("=") || "unsubscribe request (reply)";
const args = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

if (args.length === 0) {
  console.error('Usage: node scripts/unsubscribe.mjs <email-or-domain> [more...] [--reason="..."]');
  process.exit(1);
}

const explicitEmails = args.filter((a) => a.includes("@"));
const domains = [
  ...new Set([
    ...args.filter((a) => !a.includes("@")),
    ...explicitEmails.map((e) => e.split("@")[1]).filter(Boolean),
  ]),
];

// 1. Find channels that match any explicit email or any domain.
const domainPatterns = domains.map((d) => `%@${d}`);
const matched = await sql`
  SELECT id, title, primary_email, status, discovered_via
  FROM channels
  WHERE lower(primary_email) = ANY(${explicitEmails})
     OR lower(primary_email) LIKE ANY(${domainPatterns})
  ORDER BY status, primary_email
`;

console.log(`\nMatched channels (${matched.length}):`);
for (const r of matched) {
  console.log(
    `  ${r.id}  [${r.status}]  ${r.primary_email}  "${r.title}"  via=${r.discovered_via ?? "-"}`,
  );
}

// 2. Build the full suppression set: explicit emails + matched channels' emails.
const emailsToSuppress = [
  ...new Set([
    ...explicitEmails,
    ...matched.map((r) => r.primary_email?.toLowerCase()).filter(Boolean),
  ]),
];

if (emailsToSuppress.length === 0) {
  console.log("\nNothing to suppress (no explicit emails and no domain matches).");
  process.exit(0);
}

console.log(`\nSuppressing ${emailsToSuppress.length} email(s): ${emailsToSuppress.join(", ")}`);

// 3. Insert into unsubscribes (idempotent). Attach the channelId when we know it.
const channelByEmail = new Map(
  matched.map((r) => [r.primary_email?.toLowerCase(), r.id]),
);
let inserted = 0;
for (const email of emailsToSuppress) {
  const channelId = channelByEmail.get(email) ?? null;
  const res = await sql`
    INSERT INTO unsubscribes (email, channel_id, reason, source)
    VALUES (${email}, ${channelId}, ${reason}, ${"manual-script"})
    ON CONFLICT (email) DO NOTHING
    RETURNING email
  `;
  if (res.length > 0) inserted++;
}

// 4. Mark matching channels opted_out.
const updated = await sql`
  UPDATE channels
  SET status = 'opted_out', updated_at = NOW()
  WHERE lower(primary_email) = ANY(${emailsToSuppress})
    AND status <> 'opted_out'
  RETURNING id
`;

console.log(
  `\nDone. unsubscribes: ${inserted} new (${emailsToSuppress.length - inserted} already present). channels → opted_out: ${updated.length}.`,
);
