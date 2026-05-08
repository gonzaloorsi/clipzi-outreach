// Media-org discovery cron — runs every 3h. Iterates (country × category) pairs
// for radios, podcast networks, and streaming-TV organizations. Falls back to
// website scraping when Sonar didn't surface an email. Upserts to channels with
// discoveredVia="sonar:media-org:{country}:{category}".
//
// Triggered by Vercel Cron (`45 */3 * * *`, 8 ticks/day) or manually via
// Bearer/x-cron-secret. With 9 countries × 4 categories = 36 pairs, slice
// rotation processes ~5 pairs/tick, well inside the 800s function cap. Each
// pair scrapes at most 5 sites without email to keep p99 runtime predictable.
//
// Query params for testing:
//   ?dry=1                       → no DB writes
//   ?country=AR                  → restrict to one country (skips slice rotation)
//   ?category=streaming-tv       → restrict to one category
//   ?max=5                       → limit total pairs processed (skips rotation)

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db/client";
import { channels, discoveryRuns } from "@/db/schema";
import {
  searchMediaOrgs,
  MEDIA_ORG_CATEGORIES,
  type MediaOrgCategory,
} from "@/lib/media-org-search";
import { fetchAgencyEmails } from "@/lib/agency-extract";
import { isPlaceholderEmail, type AgencyResult } from "@/lib/agency-search";
import { verifyEmailsBatch, isSafeToSend } from "@/lib/bouncer";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

// 9 LATAM-pesados. AR is the killer market for streaming-TV (Olga, Luzu,
// Vorterix, Bondi, Gelatina, Carajo, Blender). ES/MX/BR have strong radio
// + podcast network presence. US/GB primarily for podcast-network coverage.
const DEFAULT_COUNTRIES = [
  "AR", "MX", "ES", "CO", "CL", "UY", "BR", "US", "GB",
];

// 36 total pairs (9 countries × 4 categories). 8 ticks/day → ~5 pairs/tick.
const TICKS_PER_DAY = 8;

// Cap how many sites we scrape per pair when Sonar didn't return an email.
const MAX_SCRAPES_PER_PAIR = 5;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

function mediaOrgChannelId(domain: string): string {
  const h = createHash("sha1").update(domain.toLowerCase()).digest("hex").slice(0, 16);
  return `media-org:${h}`;
}

interface PairResult {
  country: string;
  category: MediaOrgCategory;
  fromSonar: number;
  domainsTried: number;
  emailsFound: number;
  bouncerSkipped: number;
  insertedNew: number;
  alreadyKnown: number;
  errors: string[];
  inputTokens?: number;
  outputTokens?: number;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const onlyCountry = url.searchParams.get("country")?.toUpperCase();
  const onlyCategory = url.searchParams.get("category") as MediaOrgCategory | null;
  const maxPairs = Number(url.searchParams.get("max")) || undefined;
  const log = (msg: string) =>
    console.log(`[media-org-discovery ${new Date().toISOString()}]`, msg);

  if (!process.env.AI_GATEWAY_API_KEY && !dryRun) {
    return NextResponse.json(
      { ok: false, error: "AI_GATEWAY_API_KEY not set in env" },
      { status: 500 },
    );
  }

  const countries = onlyCountry ? [onlyCountry] : DEFAULT_COUNTRIES;
  const categories: MediaOrgCategory[] = onlyCategory
    ? [onlyCategory]
    : MEDIA_ORG_CATEGORIES;

  const allPairs: Array<{ country: string; category: MediaOrgCategory }> = [];
  for (const c of countries) {
    for (const cat of categories) {
      allPairs.push({ country: c, category: cat });
    }
  }

  // Slice rotation across TICKS_PER_DAY based on UTC hour bucket. Skipped when
  // any manual filter is present — those are explicit override modes.
  const useRotation = !onlyCountry && !onlyCategory && !maxPairs;
  let pairs = allPairs;
  let sliceInfo = `all ${allPairs.length} pairs`;
  if (useRotation) {
    const utcHour = new Date().getUTCHours();
    const bucket = Math.floor(utcHour / Math.ceil(24 / TICKS_PER_DAY)); // 0..7
    const sliceSize = Math.ceil(allPairs.length / TICKS_PER_DAY);
    const start = bucket * sliceSize;
    pairs = allPairs.slice(start, start + sliceSize);
    sliceInfo = `slice ${bucket + 1}/${TICKS_PER_DAY} (pairs ${start}..${start + pairs.length - 1} of ${allPairs.length})`;
  }
  if (maxPairs) pairs = pairs.slice(0, maxPairs);

  log(
    `starting — dry=${dryRun} ${sliceInfo} countries=${countries.length} categories=${categories.length}`,
  );

  const startedAt = new Date();

  let runId: number | null = null;
  if (!dryRun) {
    const [row] = await db
      .insert(discoveryRuns)
      .values({
        source: "sonar:media-org",
        params: { countries, pairs: pairs.length },
        startedAt,
      })
      .returning({ id: discoveryRuns.id });
    runId = row.id;
  }

  const allResults: PairResult[] = [];
  let totalInsertedNew = 0;
  let totalSeen = 0;
  let totalErrors = 0;

  try {
    for (const { country, category } of pairs) {
      const r = await runOnePair({ country, category, dryRun, log });
      allResults.push(r);
      totalInsertedNew += r.insertedNew;
      totalSeen += r.fromSonar;
      totalErrors += r.errors.length;
    }

    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({
          endedAt: new Date(),
          channelsSeen: totalSeen,
          channelsNew: totalInsertedNew,
          qualifiedNew: totalInsertedNew,
        })
        .where(sql`${discoveryRuns.id} = ${runId}`);
    }

    return NextResponse.json({
      ok: true,
      runId,
      durationMs: Date.now() - startedAt.getTime(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      pairs: pairs.length,
      summary: {
        sonarReturned: totalSeen,
        insertedNew: totalInsertedNew,
        errors: totalErrors,
      },
      perPair: allResults,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    if (runId !== null) {
      await db
        .update(discoveryRuns)
        .set({ endedAt: new Date(), error: msg })
        .where(sql`${discoveryRuns.id} = ${runId}`);
    }
    return NextResponse.json(
      { ok: false, error: msg, partialResults: allResults },
      { status: 500 },
    );
  }
}

async function runOnePair({
  country,
  category,
  dryRun,
  log,
}: {
  country: string;
  category: MediaOrgCategory;
  dryRun: boolean;
  log: (s: string) => void;
}): Promise<PairResult> {
  const result: PairResult = {
    country,
    category,
    fromSonar: 0,
    domainsTried: 0,
    emailsFound: 0,
    bouncerSkipped: 0,
    insertedNew: 0,
    alreadyKnown: 0,
    errors: [],
  };

  log(`pair: ${country} × ${category}`);

  let sonar;
  try {
    sonar = await searchMediaOrgs(country, category, { maxResults: 10 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`sonar: ${msg.slice(0, 150)}`);
    return result;
  }
  result.fromSonar = sonar.results.length;
  result.inputTokens = sonar.inputTokens;
  result.outputTokens = sonar.outputTokens;
  log(
    `  sonar returned ${sonar.results.length} entries (in=${sonar.inputTokens} out=${sonar.outputTokens})`,
  );

  if (sonar.results.length === 0) return result;

  // Dedupe by domain within this batch
  const byDomain = new Map<string, AgencyResult>();
  for (const a of sonar.results) {
    if (!byDomain.has(a.website)) byDomain.set(a.website, a);
  }

  // Pass 1: keep entries that already have a usable email from Sonar.
  // Pass 2: scrape entries without one, capped to MAX_SCRAPES_PER_PAIR.
  const enriched: Array<AgencyResult & { extractedEmails?: string[] }> = [];
  const needScrape: AgencyResult[] = [];
  for (const a of byDomain.values()) {
    result.domainsTried++;
    if (a.email && !isPlaceholderEmail(a.email)) {
      enriched.push(a);
      result.emailsFound++;
    } else {
      needScrape.push(a);
    }
  }
  for (const a of needScrape.slice(0, MAX_SCRAPES_PER_PAIR)) {
    const { emails } = await fetchAgencyEmails(a.website);
    if (emails.length > 0) {
      enriched.push({ ...a, email: emails[0], extractedEmails: emails });
      result.emailsFound++;
    }
  }
  if (needScrape.length > MAX_SCRAPES_PER_PAIR) {
    log(
      `  capped scrapes: ${MAX_SCRAPES_PER_PAIR} of ${needScrape.length} entries needed scrape (rest skipped)`,
    );
  }

  log(`  emails found: ${result.emailsFound}/${result.domainsTried}`);

  if (enriched.length === 0) return result;

  // Bouncer validation — gate `queued` on deliverability
  const bouncerVerdicts = dryRun
    ? new Map<string, ReturnType<typeof isSafeToSend>>()
    : await (async () => {
        const verdicts = await verifyEmailsBatch(enriched.map((a) => a.email!), 8);
        return new Map(verdicts.map((v) => [v.email, isSafeToSend(v)] as const));
      })();

  const discoveredVia = `sonar:media-org:${country}:${category}`;
  const rows = enriched.map((a) => {
    const safe = dryRun ? true : (bouncerVerdicts.get(a.email!.toLowerCase()) ?? false);
    if (!safe) result.bouncerSkipped++;
    return {
      id: mediaOrgChannelId(a.website),
      title: a.name,
      cleanName: a.name,
      country,
      language: null,
      subscribers: null,
      videoCount: null,
      primaryEmail: a.email!,
      allEmails:
        a.extractedEmails && a.extractedEmails.length > 0
          ? a.extractedEmails
          : [a.email!],
      topicCategories: null,
      score: 50,
      status: (safe ? "queued" : "low_quality") as "queued" | "low_quality",
      discoveredVia,
      discoveredAt: new Date(),
      lastRefreshedAt: new Date(),
    };
  });
  if (result.bouncerSkipped > 0) {
    log(`  bouncer demoted: ${result.bouncerSkipped} of ${enriched.length} (set status=low_quality)`);
  }

  if (dryRun) {
    result.insertedNew = rows.length;
    return result;
  }

  // ON CONFLICT DO UPDATE: only demote existing rows when re-discovery's
  // Bouncer verdict is now low_quality. Never promote. Preserve terminal statuses.
  const affected = await db
    .insert(channels)
    .values(rows)
    .onConflictDoUpdate({
      target: channels.id,
      set: {
        status: sql`EXCLUDED.status`,
        updatedAt: sql`NOW()`,
      },
      setWhere: sql`EXCLUDED.status = 'low_quality' AND channels.status NOT IN ('sent', 'bounced', 'complained', 'opted_out')`,
    })
    .returning({ id: channels.id, isNew: sql<boolean>`xmax = 0` });

  result.insertedNew = affected.filter((r) => r.isNew).length;
  const reDemoted = affected.length - result.insertedNew;
  result.alreadyKnown = rows.length - result.insertedNew;
  log(
    `  inserted: ${result.insertedNew} new, ${result.alreadyKnown} known${reDemoted > 0 ? ` (${reDemoted} re-discovery demoted to low_quality)` : ""}`,
  );

  return result;
}
