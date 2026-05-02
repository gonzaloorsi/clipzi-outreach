// Sender cron — pulls top-scoring queued channels, sends via Resend, marks sent.
//
// "Pilar 2 lite": multiple sender inboxes via SENDER_EMAIL_1..10, round-robin
// by least-recent usage, per-inbox daily_limit (default 100). No warm-up state
// machine, no automatic pause on bounce/complaint, no ESP rotation. Pilar 2
// proper adds those.
//
// The "no repeats" guarantee lives entirely in the DB:
//   - sends.channel_id UNIQUE → can't send to same channel twice
//   - sends.email UNIQUE → can't send to same email twice (different channels
//     sharing a manager email get one shot)
//   - candidate query excludes anything already in sends or unsubscribes
//
// Idempotent under concurrent runs: if two crons fire and pick the same row,
// one INSERT wins, the other gets ON CONFLICT DO NOTHING.

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { channels, sends, unsubscribes } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import {
  loadSenderEmails,
  syncSendersFromEnv,
  pickSender,
  recordSenderUsed,
  getTotalDailyCapacity,
} from "@/lib/sender-pool";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

const SEND_DELAY_MS = 200; // pacing between sends; Resend rate-limits at ~10/s

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const explicitMax = Number(url.searchParams.get("max"));
  const dailyLimitPerSender = Number(process.env.DAILY_SEND_CAP) || 100;
  const senderName = process.env.SENDER_NAME;
  const log = (msg: string) =>
    console.log(`[send ${new Date().toISOString()}]`, msg);

  // ─── Config validation ─────────────────────────────────────────────────
  const senderEmails = loadSenderEmails();
  const configErrors: string[] = [];
  if (senderEmails.length === 0)
    configErrors.push("no SENDER_EMAIL_1..10 (or SENDER_EMAIL) set");
  if (!senderName) configErrors.push("SENDER_NAME not set");
  if (!process.env.RESEND_API_KEY) configErrors.push("RESEND_API_KEY not set");

  if (configErrors.length > 0 && !dryRun) {
    log(`config errors: ${configErrors.join("; ")}`);
    return NextResponse.json(
      { ok: false, error: "missing config", details: configErrors },
      { status: 500 },
    );
  }

  log(
    `starting — dry=${dryRun} configuredSenders=${senderEmails.length} dailyLimitPerSender=${dailyLimitPerSender}`,
  );

  const startedAt = Date.now();

  try {
    // ─── 1. Sync senders table from env ─────────────────────────────────
    const syncResult = await syncSendersFromEnv(dailyLimitPerSender);
    log(
      `senders sync: ${syncResult.configured} configured, ${syncResult.inserted} new rows`,
    );

    const totalDailyCapacity = await getTotalDailyCapacity();
    // Bucket per cron tick: 1/24 of daily capacity (we run hourly).
    const max =
      explicitMax || Math.max(1, Math.ceil(totalDailyCapacity / 24));
    log(`daily capacity: ${totalDailyCapacity}, picking up to ${max} this run`);

    // ─── 2. Pick candidates ─────────────────────────────────────────────
    const candidates = await db
      .select({
        id: channels.id,
        title: channels.title,
        cleanName: channels.cleanName,
        primaryEmail: channels.primaryEmail,
        score: channels.score,
        country: channels.country,
        language: channels.language,
        subscribers: channels.subscribers,
      })
      .from(channels)
      .where(
        and(
          eq(channels.status, "queued"),
          sql`${channels.primaryEmail} IS NOT NULL`,
          sql`${channels.primaryEmail} NOT IN (SELECT email FROM ${sends})`,
          sql`${channels.primaryEmail} NOT IN (SELECT email FROM ${unsubscribes})`,
        ),
      )
      .orderBy(desc(channels.score))
      .limit(max);

    log(`candidates picked: ${candidates.length}`);

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        skipped: true,
        reason: "no_candidates",
        senders: senderEmails,
        totalDailyCapacity,
      });
    }

    // ─── 3. Send each ────────────────────────────────────────────────────
    let sent = 0;
    let failed = 0;
    let stoppedReason: string | null = null;
    const results: Array<{
      channelId: string;
      email: string;
      sender?: string;
      status: string;
      messageId?: string;
      error?: string;
    }> = [];

    for (const c of candidates) {
      // Pick sender for THIS send (round-robin by least 24h usage).
      const sender = await pickSender();
      if (!sender) {
        stoppedReason = "all_senders_capped";
        log(`stopped: all senders at daily limit`);
        break;
      }

      const channelName = c.cleanName || c.title;
      const email = c.primaryEmail!;

      if (dryRun) {
        results.push({
          channelId: c.id,
          email,
          sender: sender.email,
          status: "dry_run",
        });
        continue;
      }

      const res = await sendEmail({
        to: email,
        channelName,
        fromEmail: sender.email,
        fromName: senderName!,
      });

      if (res.ok) {
        // Sequential writes — neon-http doesn't support transactions.
        // sends INSERT is the source of truth for "we sent". The candidate
        // query filters by `email NOT IN sends`, so even if the channels
        // UPDATE fails afterwards, no duplicate send can occur.
        let insertOk = false;
        let insertErr: string | null = null;
        try {
          const inserted = await db
            .insert(sends)
            .values({
              channelId: c.id,
              email,
              senderId: sender.id,
              status: "sent",
              espMessageId: res.messageId,
              sentAt: new Date(),
              language: c.language ?? "en",
              templateId: "v1_en",
            })
            .onConflictDoNothing()
            .returning({ id: sends.id });
          insertOk = inserted.length > 0;
          if (!insertOk) {
            // ON CONFLICT skipped — race or pre-existing row. Still safe.
            insertOk = true;
          }
        } catch (e: unknown) {
          insertErr = e instanceof Error ? e.message : String(e);
        }

        if (insertOk) {
          // Best-effort status update. If this fails, channel stays
          // status='queued' but is filtered from future picks because its
          // email is now in sends.
          try {
            await db
              .update(channels)
              .set({ status: "sent", updatedAt: new Date() })
              .where(eq(channels.id, c.id));
          } catch (e: unknown) {
            log(
              `⚠️  channels status update failed for ${c.id} (send already recorded): ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          await recordSenderUsed(sender.id);
          sent++;
          results.push({
            channelId: c.id,
            email,
            sender: sender.email,
            status: "sent",
            messageId: res.messageId,
          });
        } else {
          // Email went out via Resend but we couldn't record it. Critical:
          // include the messageId so manual recovery is possible.
          failed++;
          log(
            `⚠️  email sent (resend id=${res.messageId}) via ${sender.email} but sends INSERT failed for ${email}: ${insertErr}`,
          );
          results.push({
            channelId: c.id,
            email,
            sender: sender.email,
            status: "sent_db_failed",
            messageId: res.messageId,
            error: insertErr ?? "unknown insert failure",
          });
        }
      } else {
        failed++;
        try {
          await db
            .insert(sends)
            .values({
              channelId: c.id,
              email,
              senderId: sender.id,
              status: "failed",
              errorMessage: res.error,
              language: c.language ?? "en",
              templateId: "v1_en",
            })
            .onConflictDoNothing();
        } catch {
          // Best effort
        }
        results.push({
          channelId: c.id,
          email,
          sender: sender.email,
          status: "failed",
          error: res.error,
        });
      }

      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    log(
      `done — sent=${sent} failed=${failed} stopped=${stoppedReason ?? "none"}`,
    );

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      attempted: candidates.length,
      stoppedReason,
      senders: senderEmails,
      totalDailyCapacity,
      durationMs: Date.now() - startedAt,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      results: dryRun ? results : results.slice(0, 10),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log(`ERROR: ${msg}`);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        stack: process.env.NODE_ENV === "development" ? stack : undefined,
      },
      { status: 500 },
    );
  }
}
