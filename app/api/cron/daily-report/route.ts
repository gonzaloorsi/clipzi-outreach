// Daily digest cron — sends ONE summary email per day of the last 24h of sends.
// Runs at 00:00 UTC (= 21:00 ART). Replaces the per-tick report the send cron
// used to email after every hourly run.
//
// Triggered by Vercel Cron (or manually with x-cron-secret / Bearer header).
// Query params for testing:
//   ?dry=1        → no email sent, returns the JSON that would be summarized
//   ?hours=48     → widen/narrow the lookback window (default 24, clamp 1..168)
//
// Auth: header `x-cron-secret` must match CRON_SECRET, or Vercel's auto-sent
// `Authorization: Bearer <CRON_SECRET>`.

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sendDailyDigest, type DailyDigestRow } from "@/lib/report";
import { getKPIs, getSenderPool } from "@/lib/insights";
import { detectKind } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const hoursParam = Math.floor(Number(url.searchParams.get("hours")));
  const windowHours =
    Number.isFinite(hoursParam) && hoursParam >= 1 && hoursParam <= 168
      ? hoursParam
      : 24;
  const log = (msg: string) =>
    console.log(`[daily-report ${new Date().toISOString()}]`, msg);

  try {
    // Per-send rows in the window. Failed rows have sent_at=NULL (only sent rows
    // get sent_at set), so anchor the window on COALESCE(sent_at, created_at).
    const rowsRes = await db.execute<{
      status: string;
      email: string;
      language: string | null;
      error_message: string | null;
      sent_at: string | null;
      title: string | null;
      clean_name: string | null;
      country: string | null;
      subscribers: number | null;
      discovered_via: string | null;
      sender_email: string | null;
    }>(sql`
      SELECT
        s.status::text AS status,
        s.email,
        s.language,
        s.error_message,
        s.sent_at,
        c.title,
        c.clean_name,
        c.country,
        c.subscribers,
        c.discovered_via,
        snd.email AS sender_email
      FROM sends s
      JOIN channels c ON c.id = s.channel_id
      LEFT JOIN senders snd ON snd.id = s.sender_id
      WHERE COALESCE(s.sent_at, s.created_at) > NOW() - INTERVAL '1 hour' * ${windowHours}
        AND s.status IN ('sent', 'failed')
      ORDER BY s.sent_at DESC NULLS LAST
    `);
    const raw = rowsRes.rows ?? rowsRes;

    const rows: DailyDigestRow[] = raw.map((r) => ({
      status: r.status,
      email: r.email,
      senderEmail: r.sender_email ?? null,
      language: r.language ?? null,
      country: r.country ?? null,
      subscribers: r.subscribers ?? null,
      channelName: r.clean_name || r.title || r.email,
      kind: detectKind(r.discovered_via),
      error: r.error_message ?? null,
      sentAt: r.sent_at ?? null,
    }));

    const sent = rows.filter((r) => r.status === "sent").length;
    const failed = rows.filter((r) => r.status === "failed").length;

    const [kpis, senderPool] = await Promise.all([getKPIs(), getSenderPool()]);
    const senderStats = senderPool
      .filter((s) => s.state === "active")
      .map((s) => ({
        email: s.email,
        sent24h: s.sent_24h,
        dailyLimit: s.daily_limit,
      }));

    // Lead-reply agent activity in the window (auto-sent replies + escalations).
    const aiRes = await db.execute<{
      channel_name: string | null;
      lead_email: string | null;
      alias: string | null;
      code: string | null;
      action: string;
      reply_body: string | null;
      reason: string | null;
      created_at: string | null;
    }>(sql`
      SELECT channel_name, lead_email, alias, code, action, reply_body, reason, created_at
      FROM processed_threads
      WHERE created_at > NOW() - INTERVAL '1 hour' * ${windowHours}
        AND action IN ('sent', 'escalate', 'skip', 'automated')
      ORDER BY created_at DESC
    `);
    const allProcessed = (aiRes.rows ?? aiRes).map((r) => ({
      channelName: r.channel_name || r.lead_email || "(unknown)",
      leadEmail: r.lead_email ?? "",
      alias: r.alias ?? null,
      code: r.code ?? null,
      action: r.action,
      replyBody: r.reply_body ?? null,
      reason: r.reason ?? null,
      createdAt: r.created_at ?? null,
    }));
    const aiReplies = allProcessed.filter((r) => r.action === "sent" || r.action === "escalate");
    const noReplies = allProcessed.filter((r) => r.action === "skip" || r.action === "automated");

    log(`window=${windowHours}h sent=${sent} failed=${failed} aiReplies=${aiReplies.length} dry=${dryRun}`);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry: true,
        windowHours,
        sent,
        failed,
        senderStats,
        pipeline: {
          queuedSendable: kpis.queuedSendable,
          totalSentAllTime: kpis.totalSent,
          totalDailyCapacity: kpis.totalDailyCapacity,
        },
        rows: rows.slice(0, 20),
        aiReplies,
        noReplies,
      });
    }

    const report = await sendDailyDigest({
      generatedAt: new Date(),
      windowHours,
      rows,
      pipeline: {
        queuedSendable: kpis.queuedSendable,
        totalSentAllTime: kpis.totalSent,
        totalDailyCapacity: kpis.totalDailyCapacity,
      },
      senderStats,
      aiReplies,
      noReplies,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    });

    if (report.ok) {
      log(`digest email sent (id=${report.messageId})`);
    } else {
      log(`⚠️  digest email failed: ${report.error}`);
    }

    return NextResponse.json({
      ok: true,
      windowHours,
      sent,
      failed,
      report,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
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
