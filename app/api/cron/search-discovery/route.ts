// Search-discovery cron — keyword-driven YouTube discovery beyond trending.
// Runs search.list (100 units/call) for a rotating slice of niche×language
// queries, records new channels, enriches them, logs telemetry to discovery_runs.
//
// Why a slice + rotation: the full query pool × 100 units is expensive, so each
// tick spends a per-run budget (SEARCH_MAX_QUOTA, default 2500 = 25 searches) on
// a different slice, and rotates `order` (relevance/date/viewCount) so repeats of
// the same query surface different channels. Over a day the whole pool is covered.
//
// Quota: with 5 keys (50k/day) and trending using ~5%, search has huge headroom.
// Default cadence (every 4h) at 2500/run = ~15k/day = moderate.
//
// Auth: header `x-cron-secret` must match CRON_SECRET. Vercel Cron auto-sends
//   `Authorization: Bearer <CRON_SECRET>`.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { discoveryRuns } from "@/db/schema";
import { YouTubeClient, TOTAL_QUOTA, QuotaExceededError } from "@/lib/youtube";
import { crawlSearch, SEARCH_QUERIES, type SearchOrder } from "@/lib/sources/search";
import { enrichChannels, recordPendingChannels } from "@/lib/enrich";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

const ORDERS: SearchOrder[] = ["relevance", "date", "viewCount"];

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
  // Per-run budget: SEARCH_MAX_QUOTA (default 2500 = 25 searches). Each search
  // costs 100 units; enrichment adds ~1 unit per 50 new channels (negligible).
  const maxQuota =
    Number(url.searchParams.get("maxQuota")) ||
    Number(process.env.SEARCH_MAX_QUOTA) ||
    2500;
  const sliceSize = Math.max(1, Math.ceil(maxQuota / 100));
  const dryRun = url.searchParams.get("dry") === "1";

  // Rotate the query slice + order by 4h time-slot so consecutive runs cover
  // different queries and the same query is re-run under a different ordering.
  const slot = Math.floor(new Date().getUTCHours() / 4); // 0..5
  const offset =
    url.searchParams.get("offset") !== null
      ? Number(url.searchParams.get("offset"))
      : (slot * sliceSize) % SEARCH_QUERIES.length;
  const order =
    (url.searchParams.get("order") as SearchOrder | null) ?? ORDERS[slot % ORDERS.length];

  // Build the slice with wraparound so we never run short near the list's end.
  const queries = Array.from(
    { length: Math.min(sliceSize, SEARCH_QUERIES.length) },
    (_, i) => SEARCH_QUERIES[(offset + i) % SEARCH_QUERIES.length],
  );

  const startedAt = new Date();
  const log = (msg: string) => console.log(`[search-discovery ${new Date().toISOString()}]`, msg);

  let yt: YouTubeClient;
  let runId: number | null = null;
  try {
    yt = new YouTubeClient();
    log(
      `starting — keys=${yt.keyCount} totalQuota=${TOTAL_QUOTA} budget=${maxQuota} slice=${queries.length}@${offset} order=${order} dry=${dryRun}`,
    );

    if (!dryRun) {
      const [row] = await db
        .insert(discoveryRuns)
        .values({
          source: "search",
          params: { maxQuota, offset, order, queries: queries.map((q) => `${q.niche}:${q.lang}:${q.q}`) },
          startedAt,
        })
        .returning({ id: discoveryRuns.id });
      runId = row.id;
    }

    // ─── 1. Crawl search ────────────────────────────────────────────────
    const search = await crawlSearch(yt, { queries, order, maxQuota });
    log(
      `search: ${search.callsMade} calls, ${search.channelIds.size} unique channels, quota=${search.quotaUsed}`,
    );
    if (search.errors.length > 0) {
      log(`search errors (${search.errors.length}): ${search.errors.slice(0, 3).join(" | ")}`);
    }

    // ─── 2. Record as pending (returns truly NEW ids) ───────────────────
    const channelIdArr = [...search.channelIds];
    const { newIds, alreadyKnown } = dryRun
      ? { newIds: channelIdArr, alreadyKnown: 0 }
      : await recordPendingChannels(channelIdArr, "search");
    log(`recorded: ${newIds.length} new, ${alreadyKnown} already known`);

    // ─── 3. Enrich the new ones ─────────────────────────────────────────
    const enrichResult = dryRun
      ? null
      : await enrichChannels(yt, newIds, { source: "search" });
    if (enrichResult) {
      log(
        `enriched: ${enrichResult.enriched}/${enrichResult.processed}, queued=${enrichResult.queued}, no_email=${enrichResult.noEmail}, low_quality=${enrichResult.lowQuality}, invalid_email=${enrichResult.invalidEmail}, quota=${enrichResult.quotaUsed}`,
      );
    }

    // ─── 4. Update telemetry ────────────────────────────────────────────
    const channelsSeen = search.channelIds.size;
    const channelsNew = newIds.length;
    const qualifiedNew = enrichResult?.queued ?? 0;
    const totalQuota = yt.quotaUsed;

    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({ endedAt: new Date(), quotaUsed: totalQuota, channelsSeen, channelsNew, qualifiedNew })
        .where(eq(discoveryRuns.id, runId));
    }

    return NextResponse.json({
      ok: true,
      runId,
      durationMs: Date.now() - startedAt.getTime(),
      quotaUsed: totalQuota,
      quotaBudget: maxQuota,
      slice: { offset, size: queries.length, order, queries: search.queriesHit },
      search: {
        callsMade: search.callsMade,
        channelsSeen,
        channelsNew,
        alreadyKnown,
        errors: search.errors.length,
      },
      enrichment: enrichResult,
      freshness: channelsSeen > 0 ? channelsNew / channelsSeen : 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log(`ERROR: ${msg}`);
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
