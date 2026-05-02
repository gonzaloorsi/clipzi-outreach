// Discovery cron — runs the trending crawler within a quota budget,
// records new channels, enriches them, logs telemetry to discovery_runs.
//
// Triggered by Vercel Cron (or manually via curl with x-cron-secret header).
// Auth: header `x-cron-secret` must match CRON_SECRET env var.
//   Vercel Cron auto-sends `Authorization: Bearer <CRON_SECRET>` instead.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { discoveryRuns } from "@/db/schema";
import { YouTubeClient, TOTAL_QUOTA, QuotaExceededError } from "@/lib/youtube";
import { crawlTrending } from "@/lib/sources/trending";
import { enrichChannels, recordPendingChannels } from "@/lib/enrich";

export const runtime = "nodejs";
export const maxDuration = 800; // 13min, max on Pro fluid compute
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // local dev without secret
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
  // Allow query overrides for manual testing
  // 85% of total quota — we have 800s on Vercel Pro to spend it. The remaining
  // 15% is a safety margin so we can do an emergency on-demand run later in the
  // day without rotating into quota_exceeded mid-cron.
  const maxQuota = Number(url.searchParams.get("maxQuota")) || Math.floor(TOTAL_QUOTA * 0.85);
  const regions = url.searchParams.get("regions")?.split(",").filter(Boolean);
  const dryRun = url.searchParams.get("dry") === "1";

  const startedAt = new Date();
  const log = (msg: string) => console.log(`[discovery ${new Date().toISOString()}]`, msg);

  // Everything that can throw goes inside the try block so init errors surface
  // as JSON instead of a 500 with empty body.
  let yt: YouTubeClient;
  let runId: number | null = null;
  try {
    yt = new YouTubeClient();
    log(`starting — keys=${yt.keyCount} totalQuota=${TOTAL_QUOTA} budget=${maxQuota} dry=${dryRun}`);

    if (!dryRun) {
      const [row] = await db
        .insert(discoveryRuns)
        .values({
          source: "trending",
          params: { maxQuota, regions: regions ?? "default" },
          startedAt,
        })
        .returning({ id: discoveryRuns.id });
      runId = row.id;
    }
    // ─── 1. Crawl trending ──────────────────────────────────────────────
    const trending = await crawlTrending(yt, {
      maxQuota,
      regions: regions ?? undefined,
    });
    log(
      `trending: ${trending.callsMade} calls, ${trending.channelIds.size} unique channels, regions=${trending.regionsHit.length}, quota=${trending.quotaUsed}`,
    );
    if (trending.errors.length > 0) {
      log(`trending errors (${trending.errors.length}): ${trending.errors.slice(0, 3).join(" | ")}`);
    }

    // ─── 2. Record as pending (returns truly NEW ids) ────────────────────
    const channelIdArr = [...trending.channelIds];
    const { newIds, alreadyKnown } = dryRun
      ? { newIds: channelIdArr, alreadyKnown: 0 }
      : await recordPendingChannels(channelIdArr, "trending");
    log(`recorded: ${newIds.length} new, ${alreadyKnown} already known`);

    // ─── 3. Enrich the new ones ─────────────────────────────────────────
    const enrichResult = dryRun
      ? null
      : await enrichChannels(yt, newIds, { source: "trending" });
    if (enrichResult) {
      log(
        `enriched: ${enrichResult.enriched}/${enrichResult.processed}, queued=${enrichResult.queued}, no_email=${enrichResult.noEmail}, low_quality=${enrichResult.lowQuality}, quota=${enrichResult.quotaUsed}`,
      );
    }

    // ─── 4. Update telemetry ────────────────────────────────────────────
    const channelsSeen = trending.channelIds.size;
    const channelsNew = newIds.length;
    const qualifiedNew = enrichResult?.queued ?? 0;
    const totalQuota = yt.quotaUsed;

    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({
          endedAt: new Date(),
          quotaUsed: totalQuota,
          channelsSeen,
          channelsNew,
          qualifiedNew,
        })
        .where(eq(discoveryRuns.id, runId));
    }

    return NextResponse.json({
      ok: true,
      runId,
      durationMs: Date.now() - startedAt.getTime(),
      quotaUsed: totalQuota,
      quotaBudget: maxQuota,
      keyIndex: (yt as unknown as { keyIndex: number }).keyIndex,
      trending: {
        callsMade: trending.callsMade,
        regionsHit: trending.regionsHit.length,
        channelsSeen,
        channelsNew,
        alreadyKnown,
        errors: trending.errors.length,
      },
      enrichment: enrichResult,
      freshness: channelsSeen > 0 ? channelsNew / channelsSeen : 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log(`ERROR: ${msg}`);
    // yt may be undefined if YouTubeClient construction itself threw
    const quotaUsed = (yt! as YouTubeClient | undefined)?.quotaUsed ?? 0;
    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({ endedAt: new Date(), quotaUsed, error: msg })
        .where(eq(discoveryRuns.id, runId));
    }
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        stack: process.env.NODE_ENV === "development" ? stack : undefined,
        quotaUsed,
        wasQuotaError: e instanceof QuotaExceededError,
      },
      { status: 500 },
    );
  }
}
