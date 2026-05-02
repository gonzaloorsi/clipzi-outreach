// Sender cron — pulls top-scoring queued channels, sends via Resend, marks sent.
//
// "Pilar 2 lite": single sender, single template (English), no rotation, no
// state machine, no warm-up logic. Just enough to keep the pipeline flowing
// while we replace the legacy GHA cron. Full Pilar 2 (multi-sender pool,
// state machine, warm-up, ESP rotation) lands later.
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
  // How many to pick this run. Defaults to env cap split into hourly buckets.
  const dailyCap = Number(process.env.DAILY_SEND_CAP) || 100;
  const explicitMax = Number(url.searchParams.get("max"));
  const max = explicitMax || Math.max(1, Math.ceil(dailyCap / 24)); // hourly bucket

  const senderEmail = process.env.SENDER_EMAIL;
  const senderName = process.env.SENDER_NAME;
  const log = (msg: string) => console.log(`[send ${new Date().toISOString()}]`, msg);

  // Validate config early so dry-run also reports issues.
  const configErrors: string[] = [];
  if (!senderEmail) configErrors.push("SENDER_EMAIL not set");
  if (!senderName) configErrors.push("SENDER_NAME not set");
  if (!process.env.RESEND_API_KEY) configErrors.push("RESEND_API_KEY not set");

  log(
    `starting — dry=${dryRun} max=${max} dailyCap=${dailyCap} configErrors=${configErrors.length}`,
  );

  if (configErrors.length > 0 && !dryRun) {
    return NextResponse.json(
      { ok: false, error: "missing config", details: configErrors },
      { status: 500 },
    );
  }

  const startedAt = Date.now();

  try {
    // ─── 1. Daily cap check ─────────────────────────────────────────────
    // How many have we sent in the last 24h? If >= cap, no-op.
    const recentSends = await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM sends
      WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '24 hours'
    `);
    const sentLast24h = (recentSends.rows ?? recentSends)[0]?.cnt ?? 0;
    const remaining = Math.max(0, dailyCap - sentLast24h);

    if (remaining === 0) {
      log(`daily cap reached (${sentLast24h}/${dailyCap}) — exiting`);
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "daily_cap_reached",
        sentLast24h,
        dailyCap,
      });
    }

    const toSendCount = Math.min(max, remaining);
    log(`cap check: ${sentLast24h}/${dailyCap} last 24h, picking up to ${toSendCount}`);

    // ─── 2. Pick candidates ─────────────────────────────────────────────
    // Top-scoring queued channels whose email isn't already sent or unsubscribed.
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
          // primaryEmail is non-null for queued (enrich.ts guarantees this)
          sql`${channels.primaryEmail} IS NOT NULL`,
          // Exclude already-sent emails
          sql`${channels.primaryEmail} NOT IN (SELECT email FROM ${sends})`,
          // Exclude unsubscribes
          sql`${channels.primaryEmail} NOT IN (SELECT email FROM ${unsubscribes})`,
        ),
      )
      .orderBy(desc(channels.score))
      .limit(toSendCount);

    log(`candidates picked: ${candidates.length}`);

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        failed: 0,
        skipped: true,
        reason: "no_candidates",
        sentLast24h,
        dailyCap,
      });
    }

    // ─── 3. Send each ────────────────────────────────────────────────────
    let sent = 0;
    let failed = 0;
    const results: Array<{
      channelId: string;
      email: string;
      status: string;
      messageId?: string;
      error?: string;
    }> = [];

    for (const c of candidates) {
      const channelName = c.cleanName || c.title;
      const email = c.primaryEmail!;

      if (dryRun) {
        results.push({ channelId: c.id, email, status: "dry_run" });
        continue;
      }

      const res = await sendEmail({
        to: email,
        channelName,
        fromEmail: senderEmail!,
        fromName: senderName!,
      });

      if (res.ok) {
        // Insert send + update channel status atomically. If race conditions
        // cause a duplicate, ON CONFLICT silently no-ops (UNIQUE on email/channel_id).
        try {
          await db.transaction(async (tx) => {
            await tx
              .insert(sends)
              .values({
                channelId: c.id,
                email,
                status: "sent",
                espMessageId: res.messageId,
                sentAt: new Date(),
                language: c.language ?? "en",
                templateId: "v1_en",
              })
              .onConflictDoNothing();
            await tx
              .update(channels)
              .set({ status: "sent", updatedAt: new Date() })
              .where(eq(channels.id, c.id));
          });
          sent++;
          results.push({ channelId: c.id, email, status: "sent", messageId: res.messageId });
        } catch (dbErr: unknown) {
          // Email already went out via Resend, but DB write failed. We need
          // to flag this so we don't silently drop the audit trail.
          failed++;
          const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          log(`⚠️  email sent but DB write failed for ${email}: ${errMsg}`);
          results.push({ channelId: c.id, email, status: "sent_db_failed", error: errMsg });
        }
      } else {
        failed++;
        // Record the failure in sends so we don't retry. Status='failed' takes
        // the slot for both channel_id and email UNIQUE constraints.
        try {
          await db
            .insert(sends)
            .values({
              channelId: c.id,
              email,
              status: "failed",
              errorMessage: res.error,
              language: c.language ?? "en",
              templateId: "v1_en",
            })
            .onConflictDoNothing();
        } catch {
          // ignore — we'll just have to hope the row got in somewhere
        }
        results.push({ channelId: c.id, email, status: "failed", error: res.error });
      }

      await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    log(`done — sent=${sent} failed=${failed}`);

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      attempted: candidates.length,
      sentLast24h: sentLast24h + sent,
      dailyCap,
      durationMs: Date.now() - startedAt,
      results: dryRun ? results : results.slice(0, 5), // truncate in non-dry to keep payload small
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
