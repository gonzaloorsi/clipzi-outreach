// Migrate legacy JSON state files → Postgres.
// Idempotent: uses ON CONFLICT DO NOTHING so re-runs are safe.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { channels, sends } from "./schema";

// ─── Helpers ───────────────────────────────────────────────────────────────

function legacyChannelIdFromEmail(email: string): string {
  const h = createHash("sha1").update(email.toLowerCase()).digest("hex").slice(0, 16);
  return `legacy:${h}`;
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
    if (i % (size * 10) === 0 && i > 0) {
      process.stdout.write(`    ${i}/${items.length}\r`);
    }
  }
  process.stdout.write(`    ${items.length}/${items.length}\n`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ─── Source data shapes ────────────────────────────────────────────────────

type DiscoveredId = string;

interface QueueItem {
  title: string;
  cleanName?: string;
  channelId: string;
  country?: string;
  subscribers?: number;
  videoCount?: number;
  emails?: string;
  primaryEmail?: string;
  score?: number;
  discoveredDate?: string;
}

interface SendResult {
  channel: string;
  cleanName?: string;
  email: string;
  channelId?: string;
  subscribers?: number;
  score?: number;
  status: string;
  id?: string;
  date?: string;
  sentFrom?: string;
}

// ─── Migration ─────────────────────────────────────────────────────────────

async function main() {
  console.log("📦 Loading source JSONs...");
  const discoveredIds = readJson<DiscoveredId[]>("discovered_ids.json");
  const queueItems = readJson<QueueItem[]>("email_queue.json");
  const sendResults = readJson<SendResult[]>("send_results.json");

  console.log(`  discovered_ids: ${discoveredIds.length}`);
  console.log(`  email_queue:    ${queueItems.length}`);
  console.log(`  send_results:   ${sendResults.length}`);

  // ─── Step 1: insert all discovered_ids as channels (status='enriched') ───
  console.log("\n[1/4] Inserting discovered channels (status=enriched)...");
  await chunked(discoveredIds, 1000, async (chunk) => {
    const rows = chunk.map((id) => ({
      id,
      title: id, // placeholder; we don't have titles for these
      status: "enriched" as const,
      discoveredVia: "legacy:discovered_ids",
    }));
    await db.insert(channels).values(rows).onConflictDoNothing();
  });

  // ─── Step 2: upsert from email_queue (status='queued', full data) ────────
  console.log("\n[2/4] Upserting queue items (status=queued)...");
  const queueRows = queueItems
    .filter((q) => q.channelId)
    .map((q) => ({
      id: q.channelId,
      title: q.title || q.cleanName || q.channelId,
      cleanName: q.cleanName,
      country: q.country || null,
      subscribers: q.subscribers ?? null,
      videoCount: q.videoCount ?? null,
      primaryEmail: q.primaryEmail || null,
      allEmails: q.emails ? q.emails.split(";").map((e) => e.trim()).filter(Boolean) : null,
      score: q.score ?? null,
      status: "queued" as const,
      discoveredVia: "legacy:email_queue",
      discoveredAt: q.discoveredDate ? new Date(q.discoveredDate) : new Date(),
    }));

  await chunked(queueRows, 500, async (chunk) => {
    await db
      .insert(channels)
      .values(chunk)
      .onConflictDoUpdate({
        target: channels.id,
        set: {
          title: sql`EXCLUDED.title`,
          cleanName: sql`EXCLUDED.clean_name`,
          country: sql`EXCLUDED.country`,
          subscribers: sql`EXCLUDED.subscribers`,
          videoCount: sql`EXCLUDED.video_count`,
          primaryEmail: sql`EXCLUDED.primary_email`,
          allEmails: sql`EXCLUDED.all_emails`,
          score: sql`EXCLUDED.score`,
          status: sql`EXCLUDED.status`,
          updatedAt: sql`NOW()`,
        },
      });
  });

  // ─── Step 3: insert sends (ensure every channel exists first) ────────────
  console.log("\n[3/4] Inserting sends...");

  // 3a — for entries WITHOUT channelId, create synthetic legacy channels
  const legacyOnly = sendResults.filter((s) => !s.channelId);
  const legacyChannelRows = legacyOnly.map((s) => ({
    id: legacyChannelIdFromEmail(s.email),
    title: s.channel,
    cleanName: s.cleanName || s.channel,
    primaryEmail: s.email,
    allEmails: [s.email],
    status: "sent" as const,
    discoveredVia: "legacy:pre_channelid",
  }));
  console.log(`  ${legacyChannelRows.length} legacy entries without channelId — creating synthetic channels`);
  await chunked(legacyChannelRows, 500, async (chunk) => {
    await db.insert(channels).values(chunk).onConflictDoNothing();
  });

  // 3b — for entries WITH channelId that may not exist in `channels` yet
  // (older sends from before discovered_ids tracking), insert stub rows
  const sendChannelStubs = sendResults
    .filter((s) => s.channelId)
    .map((s) => ({
      id: s.channelId!,
      title: s.channel || s.cleanName || s.channelId!,
      cleanName: s.cleanName || s.channel,
      primaryEmail: s.email,
      allEmails: [s.email],
      subscribers: s.subscribers ?? null,
      score: s.score ?? null,
      status: "sent" as const,
      discoveredVia: "legacy:send_results",
    }));
  console.log(`  ensuring ${sendChannelStubs.length} send-result channels exist`);
  await chunked(sendChannelStubs, 500, async (chunk) => {
    await db.insert(channels).values(chunk).onConflictDoNothing();
  });

  // 3b — insert sends for ALL entries
  const sendRows = sendResults.map((s) => {
    const channelId = s.channelId ?? legacyChannelIdFromEmail(s.email);
    return {
      channelId,
      email: s.email,
      status: (s.status === "sent" ? "sent" : "failed") as "sent" | "failed",
      espMessageId: s.id ?? null,
      sentAt: s.date ? new Date(s.date) : null,
    };
  });

  await chunked(sendRows, 500, async (chunk) => {
    // ON CONFLICT DO NOTHING (catches both channel_id and email uniques)
    await db.insert(sends).values(chunk).onConflictDoNothing();
  });

  // ─── Step 4: mark sent channels as status='sent' ─────────────────────────
  console.log("\n[4/4] Marking sent channels as status='sent'...");
  await db.execute(sql`
    UPDATE channels
    SET status = 'sent', updated_at = NOW()
    WHERE id IN (SELECT channel_id FROM sends WHERE status = 'sent')
  `);

  // ─── Verification ────────────────────────────────────────────────────────
  console.log("\n✓ Migration complete. Verification:");
  const counts = await db.execute<{
    table_name: string;
    cnt: number;
  }>(sql`
    SELECT 'channels' AS table_name, COUNT(*)::int AS cnt FROM channels
    UNION ALL
    SELECT 'sends', COUNT(*)::int FROM sends
  `);
  console.table(counts.rows ?? counts);

  const byStatus = await db.execute<{ status: string; cnt: number }>(sql`
    SELECT status, COUNT(*)::int AS cnt FROM channels GROUP BY status ORDER BY cnt DESC
  `);
  console.log("\nChannels by status:");
  console.table(byStatus.rows ?? byStatus);

  const sendsByStatus = await db.execute<{ status: string; cnt: number }>(sql`
    SELECT status, COUNT(*)::int AS cnt FROM sends GROUP BY status ORDER BY cnt DESC
  `);
  console.log("\nSends by status:");
  console.table(sendsByStatus.rows ?? sendsByStatus);
}

main().catch((e) => {
  console.error("❌ Migration failed:", e);
  process.exit(1);
});
