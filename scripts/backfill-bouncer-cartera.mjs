// Backfill Bouncer email-verification across the entire `queued` cartera.
// Channels inserted before the Bouncer integration (commit a615999) entered
// `status='queued'` without validation. This script picks them up, calls
// Bouncer, caches the verdict, and demotes unsafe ones to `low_quality` so
// the send cron skips them.
//
// Idempotent: re-runs continue where the previous one stopped because the
// candidate query excludes anything already in `email_validations`.
//
// Stops cleanly on HTTP 402 (out of credits) and reports how many remained.
//
// Usage:
//   npx tsx scripts/backfill-bouncer-cartera.mjs --dryRun
//   npx tsx scripts/backfill-bouncer-cartera.mjs
//   npx tsx scripts/backfill-bouncer-cartera.mjs --limit 500

import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const BOUNCER_KEY = process.env.BOUNCER_API_KEY;
const BOUNCER_URL = "https://api.usebouncer.com/v1.1/email/verify";
const TIMEOUT_MS = 15_000;
const BATCH = 8;

const DRY_RUN = process.argv.includes("--dryRun");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT =
  limitFlagIdx !== -1 ? parseInt(process.argv[limitFlagIdx + 1], 10) : null;

if (!BOUNCER_KEY && !DRY_RUN) {
  console.error("Missing BOUNCER_API_KEY in .env.local");
  process.exit(1);
}

// Mirror of lib/bouncer.ts:isSafeToSend. Inline so this script is
// self-contained and doesn't need to import TS files.
function isSafeToSend(v) {
  if (!v || !v.raw) return true; // fail-open when Bouncer didn't speak
  if (v.status === "deliverable") return true;
  if (v.status === "risky") {
    if (v.raw?.domain?.disposable === "yes") return false;
    if (v.raw?.account?.fullMailbox === "yes") return false;
    return true;
  }
  return false; // undeliverable | unknown (real Bouncer verdicts)
}

async function verifyOne(email) {
  const normalized = email.trim().toLowerCase();
  const url = `${BOUNCER_URL}?email=${encodeURIComponent(normalized)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": BOUNCER_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 402) {
      return { __outOfCredits: true };
    }
    if (!res.ok) {
      // 429 / 5xx / etc — cache as unknown without raw, fail-open
      return { status: "unknown", reason: `api_${res.status}`, raw: null };
    }
    const json = await res.json();
    return {
      status: json.status ?? "unknown",
      reason: json.reason ?? null,
      score: typeof json.score === "number" ? json.score : null,
      raw: json,
    };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "TimeoutError" ? "timeout" : "api_error";
    return { status: "unknown", reason, raw: null };
  }
}

async function main() {
  const candidates = LIMIT
    ? await sql`
        SELECT c.id, c.title, c.primary_email
        FROM channels c
        WHERE c.status = 'queued'
          AND c.primary_email IS NOT NULL
          AND c.primary_email NOT IN (SELECT email FROM sends)
          AND c.primary_email NOT IN (SELECT email FROM unsubscribes)
          AND LOWER(c.primary_email) NOT IN (SELECT email FROM email_validations)
        ORDER BY c.id ASC
        LIMIT ${LIMIT}
      `
    : await sql`
        SELECT c.id, c.title, c.primary_email
        FROM channels c
        WHERE c.status = 'queued'
          AND c.primary_email IS NOT NULL
          AND c.primary_email NOT IN (SELECT email FROM sends)
          AND c.primary_email NOT IN (SELECT email FROM unsubscribes)
          AND LOWER(c.primary_email) NOT IN (SELECT email FROM email_validations)
        ORDER BY c.id ASC
      `;

  console.log(`Found ${candidates.length} queued channels without Bouncer cache.`);

  if (candidates.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  if (DRY_RUN) {
    console.log("\nSample (first 10):");
    console.table(candidates.slice(0, 10));
    console.log("\n--dryRun set, exiting without API calls.");
    return;
  }

  let processed = 0;
  let deliverable = 0;
  let demoted = 0;
  let outOfCredits = false;

  for (let i = 0; i < candidates.length; i += BATCH) {
    if (outOfCredits) break;
    const slice = candidates.slice(i, i + BATCH);
    const verdicts = await Promise.all(
      slice.map((c) => verifyOne(c.primary_email)),
    );

    for (let j = 0; j < slice.length; j++) {
      const c = slice[j];
      const v = verdicts[j];

      if (v && v.__outOfCredits) {
        outOfCredits = true;
        break;
      }
      if (!v) continue;

      const normalized = c.primary_email.trim().toLowerCase();

      // Cache verdict (only when Bouncer actually responded — raw !== null).
      // For 429/5xx/timeout we DON'T cache so the next run retries.
      if (v.raw !== null) {
        await sql`
          INSERT INTO email_validations (email, status, reason, score, raw, verified_at)
          VALUES (${normalized}, ${v.status}, ${v.reason}, ${v.score}, ${JSON.stringify(v.raw)}::jsonb, NOW())
          ON CONFLICT (email) DO UPDATE SET
            status = EXCLUDED.status,
            reason = EXCLUDED.reason,
            score = EXCLUDED.score,
            raw = EXCLUDED.raw,
            verified_at = NOW()
        `;
      }

      // Demote channel if unsafe (only when Bouncer gave a real verdict).
      // fail-open cases (raw=null) keep status='queued' so they get retried.
      if (v.raw !== null && !isSafeToSend(v)) {
        await sql`
          UPDATE channels SET status = 'low_quality', updated_at = NOW()
          WHERE id = ${c.id}
        `;
        demoted++;
      } else if (v.raw !== null) {
        deliverable++;
      }

      processed++;
    }

    // Progress every ~100
    if (Math.floor((i + BATCH) / 100) > Math.floor(i / 100)) {
      console.log(
        `[${processed}/${candidates.length}] deliverable=${deliverable} demoted=${demoted}`,
      );
    }
  }

  const pending = candidates.length - processed;
  if (outOfCredits) {
    console.log(
      `\n⚠️  Bouncer out of credits (HTTP 402). Stopping.`,
    );
  }
  console.log(
    `\nDone. processed=${processed} deliverable=${deliverable} demoted=${demoted} pending=${pending}`,
  );
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
