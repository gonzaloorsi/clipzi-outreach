// Hot-moments cron — "most replayed" enrich for queued YouTube channels, run
// hourly right ahead of the send cron. For each channel about to be emailed it
// picks the target video (latest long upload, else the most viewed of the
// year), reads the replay heatmap from InnerTube and, failing that, the top
// comment or the upload cadence (lib/heatmap.ts). Results land on channels.hot_*
// and the youtube-hot template reads them; rows with nothing usable still get
// hot_checked_at stamped so they are never retried and fall back to the
// question template.
//
// Quota: 2 Data API units per channel (+1 when the comment fallback runs).
// 400/tick x 24 = ~9.6k units/day of the 50k pool. InnerTube is unmetered but
// undocumented, hence the modest per-tick cap and the concurrency of 5.
//
// Query params for testing:
//   ?dry=1          → compute, print, write nothing
//   ?max=20         → limit channels this run
//   ?channelId=UC.. → one channel (skips the queue filter; still respects dry)
//
// Env: HOT_MOMENTS_PER_TICK (default 400).

import { NextRequest, NextResponse } from "next/server";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { channels } from "@/db/schema";
import { YouTubeClient, QuotaExceededError } from "@/lib/youtube";
import { computeHotMoment, formatMmss, type HotMoment } from "@/lib/heatmap";
import { requestFrame } from "@/lib/frames";
import { detectLanguage } from "@/lib/templates";
import { sendCronFailureAlert } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

const TIME_GUARD_MS = 700_000;
const CONCURRENCY = 5;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

type Row = { id: string; title: string; subscribers: number | null; country: string | null; language: string | null };

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const onlyChannel = url.searchParams.get("channelId") || null;
  const perTick = Number(url.searchParams.get("max")) || Number(process.env.HOT_MOMENTS_PER_TICK) || 400;
  const log = (msg: string) => console.log(`[hot-moments ${new Date().toISOString()}]`, msg);

  try {
    const candidates: Row[] = onlyChannel
      ? await db
          .select({ id: channels.id, title: channels.title, subscribers: channels.subscribers, country: channels.country, language: channels.language })
          .from(channels)
          .where(eq(channels.id, onlyChannel))
      : await db
          .select({ id: channels.id, title: channels.title, subscribers: channels.subscribers, country: channels.country, language: channels.language })
          .from(channels)
          .where(
            sql`${channels.status} = 'queued'
              AND ${channels.hotCheckedAt} IS NULL
              AND ${channels.id} LIKE 'UC%'
              AND ${channels.primaryEmail} IS NOT NULL
              AND (${channels.discoveredVia} IS NULL OR ${channels.discoveredVia} NOT LIKE 'sonar:%')`,
          )
          .orderBy(sql`${channels.score} DESC NULLS LAST, ${channels.subscribers} DESC NULLS LAST`)
          .limit(perTick);

    log(`starting dry=${dryRun} candidates=${candidates.length} perTick=${perTick}`);

    const yt = new YouTubeClient();
    const counts = { processed: 0, heatmap: 0, top_comment: 0, cadence: 0, none: 0, errors: 0, frames_requested: 0 };
    const sample: Array<Record<string, unknown>> = [];
    let stoppedEarly: string | null = null;

    // Simple worker pool: CONCURRENCY channels in flight at a time.
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        if (Date.now() - startedAt > TIME_GUARD_MS) {
          stoppedEarly = "time guard";
          return;
        }
        if (stoppedEarly) return;
        const c = candidates[cursor++];
        let hot: HotMoment | null = null;
        let failed = false;
        try {
          hot = await computeHotMoment(yt, c.id);
        } catch (e) {
          if (e instanceof QuotaExceededError) {
            stoppedEarly = "quota exhausted";
            return;
          }
          failed = true;
          counts.errors++;
          log(`error on ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
        counts.processed++;
        if (hot) counts[hot.source]++;
        else if (!failed) counts.none++;

        // The email attaches a still of the peak: ask Modal to render it now
        // (202 in <1s) so it is in R2 by the time the send cron runs.
        if (hot?.source === "heatmap" && hot.startS != null && hot.markers && !dryRun) {
          const ok = await requestFrame({
            videoId: hot.video.videoId,
            startS: hot.startS,
            durationS: hot.video.durationS,
            markers: hot.markers,
            language: detectLanguage(c.country, c.language),
          });
          if (ok) counts.frames_requested++;
        }

        if (sample.length < 15) {
          sample.push({
            id: c.id,
            title: c.title,
            source: hot?.source ?? null,
            video: hot?.video.title ?? null,
            mmss: hot?.startS != null ? formatMmss(hot.startS) : null,
            mmss2: hot?.start2S != null ? formatMmss(hot.start2S) : null,
            label: hot?.label ?? null,
            perMonth: hot?.perMonth ?? null,
          });
        }

        // Errors are stamped too (hot_source NULL → question template): a
        // channel that fails once would otherwise be retried every tick,
        // burning quota forever. Dry runs write nothing.
        if (dryRun) continue;
        const now = new Date();
        await db
          .update(channels)
          .set(
            hot
              ? {
                  hotVideoId: hot.video.videoId,
                  hotVideoTitle: hot.video.title,
                  hotVideoDurationS: hot.video.durationS,
                  hotPublishedAt: new Date(hot.video.publishedAt),
                  hotStartS: hot.startS != null ? Math.round(hot.startS) : null,
                  hotStart2S: hot.start2S != null ? Math.round(hot.start2S) : null,
                  hotLabel: hot.label,
                  hotSource: hot.source,
                  hotPerMonth: hot.perMonth,
                  hotAvgMinutes: hot.avgMinutes,
                  hotCheckedAt: now,
                  updatedAt: now,
                }
              : { hotSource: null, hotCheckedAt: now, updatedAt: now },
          )
          .where(eq(channels.id, c.id));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));

    const result = {
      ok: true,
      dryRun,
      candidates: candidates.length,
      ...counts,
      hitRate: counts.processed > 0 ? `${(((counts.heatmap + counts.top_comment + counts.cadence) / counts.processed) * 100).toFixed(1)}%` : null,
      quotaUsed: yt.quotaUsed,
      stoppedEarly,
      durationMs: Date.now() - startedAt,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      sample,
    };
    log(JSON.stringify({ ...result, sample: undefined }));
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    await sendCronFailureAlert("hot-moments", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
