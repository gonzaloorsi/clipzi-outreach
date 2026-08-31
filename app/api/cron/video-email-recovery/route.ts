// Video-email recovery cron — works through the no_email backlog (~69k YouTube
// channels that passed the subs threshold but had no email in the channel
// description) looking for an email in their video descriptions instead.
// Creators set a contact email in their upload defaults, so it shows on every
// video even when the channel description has none.
//
// Mechanics: uploads playlist derived from the channel id (UC... -> UU..., no
// extra API call), playlistItems.list = 1 quota unit for up to 50 video
// descriptions. Found emails go through the same Bouncer gate as enrichment;
// safe ones promote the channel to 'queued' so the send cron picks it up with
// its original discovered_via attribution. Every processed channel gets
// video_email_checked_at stamped (found or not), so nothing is processed twice.
//
// Quota: ~600 units/tick x 8 ticks/day = ~4.8k/day of the ~100k pool. The
// backlog drains in ~2 weeks and then the cron finds nothing (new channels get
// the same fallback inline in lib/enrich.ts, so no new backlog forms).
//
// Query params for testing:
//   ?dry=1    → no DB writes, reports what would happen (still spends quota)
//   ?max=20   → limit channels processed this run
//
// Env: VIDEO_RECOVERY_PER_TICK (default 600).

import { NextRequest, NextResponse } from "next/server";
import { sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { channels } from "@/db/schema";
import { YouTubeClient, QuotaExceededError } from "@/lib/youtube";
import { findEmailInVideos } from "@/lib/enrich";
import { scoreChannel } from "@/lib/score";
import { verifyEmailsBatch, isSafeToSend } from "@/lib/bouncer";
import { sendCronFailureAlert } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

const TIME_GUARD_MS = 700_000;

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

  const startedAt = Date.now();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const maxParam = Number(url.searchParams.get("max")) || undefined;
  const perTick =
    maxParam ?? (Number(process.env.VIDEO_RECOVERY_PER_TICK) || 600);
  const log = (msg: string) =>
    console.log(`[video-email-recovery ${new Date().toISOString()}]`, msg);

  try {
    // Highest-score channels first: the recovered inventory feeds sends in
    // quality order. Only real YouTube channels (UC ids; sonar rows are
    // websites) never checked before.
    const candidates = await db
      .select({
        id: channels.id,
        subscribers: channels.subscribers,
        videoCount: channels.videoCount,
        topicCategories: channels.topicCategories,
        country: channels.country,
      })
      .from(channels)
      .where(
        sql`${channels.status} = 'no_email'
          AND ${channels.videoEmailCheckedAt} IS NULL
          AND ${channels.id} LIKE 'UC%'
          AND (${channels.discoveredVia} IS NULL OR ${channels.discoveredVia} NOT LIKE 'sonar:%')`,
      )
      .orderBy(sql`${channels.score} DESC NULLS LAST, ${channels.subscribers} DESC NULLS LAST`)
      .limit(perTick);

    log(`starting — dry=${dryRun} candidates=${candidates.length} perTick=${perTick}`);

    const yt = new YouTubeClient();
    type Found = { id: string; emails: string[]; score: number };
    const found: Found[] = [];
    const checkedNoEmail: string[] = [];
    let processed = 0;
    let stoppedEarly: string | null = null;

    for (const c of candidates) {
      if (Date.now() - startedAt > TIME_GUARD_MS) {
        stoppedEarly = "time guard";
        break;
      }
      let emails: string[];
      try {
        emails = await findEmailInVideos(yt, c.id);
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          stoppedEarly = "quota exhausted";
          break;
        }
        emails = [];
      }
      processed++;
      if (emails.length > 0) {
        found.push({
          id: c.id,
          emails,
          score: scoreChannel({
            subscribers: c.subscribers ?? 0,
            videoCount: c.videoCount ?? 0,
            topicCategories: c.topicCategories ?? [],
            primaryEmail: emails[0],
            country: c.country,
          }),
        });
      } else {
        checkedNoEmail.push(c.id);
      }
    }

    // Bouncer gate, batched like lib/enrich.ts. Unsafe emails: the channel is
    // stamped checked and stays no_email (the address is dead, not the channel
    // quality) so it never gets re-processed.
    const verdicts = await verifyEmailsBatch(found.map((f) => f.emails[0]), 8);
    const verdictByEmail = new Map(verdicts.map((v) => [v.email, v]));
    const promote: Found[] = [];
    for (const f of found) {
      const v = verdictByEmail.get(f.emails[0].toLowerCase());
      if (v && !isSafeToSend(v)) checkedNoEmail.push(f.id);
      else promote.push(f);
    }

    if (!dryRun) {
      const now = new Date();
      for (const f of promote) {
        await db
          .update(channels)
          .set({
            primaryEmail: f.emails[0],
            allEmails: f.emails,
            status: "queued",
            score: f.score,
            videoEmailCheckedAt: now,
            updatedAt: now,
          })
          .where(sql`${channels.id} = ${f.id} AND ${channels.status} = 'no_email'`);
      }
      // Stamp the misses in bulk so they are never re-processed.
      const CHUNK = 500;
      for (let i = 0; i < checkedNoEmail.length; i += CHUNK) {
        const ids = checkedNoEmail.slice(i, i + CHUNK);
        await db
          .update(channels)
          .set({ videoEmailCheckedAt: now, updatedAt: now })
          .where(inArray(channels.id, ids));
      }
    }

    const result = {
      ok: true,
      dryRun,
      candidates: candidates.length,
      processed,
      foundEmail: found.length,
      promoted: promote.length,
      bouncerRejected: found.length - promote.length,
      quotaUsed: yt.quotaUsed,
      stoppedEarly,
      hitRate: processed > 0 ? `${((found.length / processed) * 100).toFixed(1)}%` : null,
      durationMs: Date.now() - startedAt,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      sample: promote.slice(0, 10).map((f) => ({ id: f.id, email: f.emails[0] })),
    };
    log(JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    await sendCronFailureAlert("video-email-recovery", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
